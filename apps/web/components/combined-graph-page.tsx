"use client";

import type {
  DynamicPriceSnapshotRecord,
  HistoryArchive,
  WeatherForecastRecord,
} from "@emsd/core/client";
import {
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  applySolarSeriesSmoothing,
  buildSolarPredictionAccuracySummary,
  deriveBatteryStatusFromPower,
  findSolarSurplusBoundsFromSeries,
} from "@emsd/core/client";
import {
  BatteryCharging,
  CalendarClock,
  Gauge,
  Hand,
  HandCoins,
  SunMedium,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEnergyValue } from "../lib/energy-format";
import {
  formatAbsolutePowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import {
  computeExportPrice,
  formatCurrencyAmount,
  formatPricePerKwh,
  getActivePricePointAtOrBefore,
} from "../lib/price-format";
import { UI_CHART_STYLES, UI_COLORS, UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import {
  LegendChip,
  aggregatePowerSamples,
  buildBatteryHistoryPoints,
  buildMirroredYAxis,
  buildNowLabel,
  buildResponsiveDayTicks,
  buildYAxisLabel,
  fillSingleValueDay,
  formatDayTick,
  getBatteryHistoryStrategyBatteryId,
  invertSingleValueSeries,
  splitSingleValueSeriesByTime,
} from "./history";
import {
  HISTORY_STEP_MS,
  LEFT_Y_AXIS_WIDTH,
  RIGHT_Y_AXIS_WIDTH,
  STANDARD_LEFT_AXIS_MARGIN,
  STANDARD_RIGHT_AXIS_MARGIN,
} from "./history/constants";
import { buildExactBatteryStrategySegments } from "./history/series";
import { getBatteryStrategyLegendItems } from "./history/strategy-legend";
import { TooltipCard, TooltipMarker } from "./history/tooltips";
import type { BatteryHistoryPoint, TooltipPayloadEntry } from "./history/types";
import {
  buildHighestLabel,
  buildLowestLabel,
  deduplicateTooltipEntries,
  formatPercentValue,
  formatTooltipTimestamp,
} from "./history/utils";
import { MeasuredChartContainer } from "./measured-chart-container";
import { PageRefreshButton } from "./page-refresh-button";
import { RefreshWarning } from "./refresh-warning";
import type { SiteSnapshot } from "./settings-panel";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";
import { useChartSeriesVisibility } from "./use-chart-series-visibility";
import {
  type SiteCurrentResponse,
  type SolarCurrentResponse,
  useLiveJsonSWR,
} from "./use-live-json-swr";

type GraphType = "battery" | "solar" | "prices" | "grid";
type AxisKind = "power" | "charge" | "price" | "forecast";
type CombinedLegendItem = {
  color: string;
  dashed?: boolean;
  label: string;
  seriesId: string;
};
type CombinedLegendGroup = {
  items: CombinedLegendItem[];
  label: string;
  summaryLabel: string;
  type: GraphType;
};

const ALL_GRAPH_TYPES: GraphType[] = ["battery", "solar", "prices", "grid"];
const DEFAULT_GRAPH_TYPES: GraphType[] = ["battery"];
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;
const LIVE_REFRESH_INTERVAL_MS = 5_000;
const COMBINED_VISIBILITY_STORAGE_KEY = "emsd:chart-visibility:combined:v1";
const COMBINED_GRAPH_TYPES_CHANGE_EVENT = "emsd:combined-graph-types-change";
const LONG_PRESS_TOGGLE_DELAY_MS = 450;
const SOLAR_POWER_AXIS_MAX_W = 4_000;
const BATTERY_STRATEGY_BAND_HEIGHT_RATIO = 0.0603;
const BATTERY_STRATEGY_BAND_BOTTOM = 1 - BATTERY_STRATEGY_BAND_HEIGHT_RATIO;

const GRAPH_TYPE_META: Record<
  GraphType,
  { color: string; icon: typeof BatteryCharging; label: string }
> = {
  battery: {
    color: UI_COLORS.combinedBatteryPower,
    icon: BatteryCharging,
    label: "Battery",
  },
  solar: {
    color: UI_COLORS.combinedSolarPower,
    icon: SunMedium,
    label: "Solar",
  },
  prices: {
    color: UI_COLORS.combinedPriceImport,
    icon: HandCoins,
    label: "Prices",
  },
  grid: { color: UI_COLORS.combinedGridPower, icon: Gauge, label: "Grid" },
};

const SERIES_IDS = {
  batteryCharge: "combined:battery-charge",
  batteryPower: "combined:battery-power",
  gridExpectedLoad: "combined:grid-expected-load",
  gridPower: "combined:grid-power",
  gridSiteLoad: "combined:grid-site-load",
  priceImport: "combined:price-import",
  solarForecast: "combined:solar-forecast",
  solarGenerated: "combined:solar-generated",
  solarPredicted: "combined:solar-predicted",
} as const;

export function CombinedGraphPage({
  archive: initialArchive,
  dynamicPriceSnapshot,
  highestMarkerPeriodStarts,
  lowestMarkerPeriodStarts,
  requestedDay,
  site,
  weatherForecast,
}: {
  archive: HistoryArchive;
  dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null;
  highestMarkerPeriodStarts: string[];
  lowestMarkerPeriodStarts: string[];
  requestedDay: string | null;
  site: SiteSnapshot;
  weatherForecast: WeatherForecastRecord | null;
}) {
  const activeTypes = useActiveGraphTypes();
  const hasBatteryOrGrid =
    activeTypes.includes("battery") || activeTypes.includes("grid");
  const hasSolar = activeTypes.includes("solar");
  const livePollingEnabled = useDelayedEnabled(hasBatteryOrGrid || hasSolar);
  const requestedDayParam = requestedDay
    ? `&day=${encodeURIComponent(requestedDay)}`
    : "";
  const { data: archiveData, refreshError: archiveRefreshError } =
    useLiveJsonSWR<HistoryArchive>(
      `/api/history/archive?siteId=${encodeURIComponent(site.id)}${requestedDayParam}`,
      {
        failureMessage:
          "Combined graph history updates are retrying. Showing last available data.",
        refreshIntervalMs: GRAPH_REFRESH_INTERVAL_MS,
        retryIntervalMs: LIVE_REFRESH_INTERVAL_MS,
      },
    );
  const { data: currentData, refreshError: currentRefreshError } =
    useLiveJsonSWR<SiteCurrentResponse>(
      hasBatteryOrGrid
        ? `/api/site/current?siteId=${encodeURIComponent(site.id)}`
        : null,
      {
        failureMessage:
          "Combined live updates are retrying. Showing last available data.",
        refreshIntervalMs: LIVE_REFRESH_INTERVAL_MS,
        enabled: livePollingEnabled && hasBatteryOrGrid,
      },
    );
  const { data: solarCurrentData, refreshError: solarCurrentRefreshError } =
    useLiveJsonSWR<SolarCurrentResponse>(
      hasSolar
        ? `/api/solar/current?siteId=${encodeURIComponent(site.id)}`
        : null,
      {
        failureMessage:
          "Solar current updates are retrying. Showing last available data.",
        refreshIntervalMs: LIVE_REFRESH_INTERVAL_MS,
        enabled: livePollingEnabled && hasSolar,
      },
    );
  const archive = archiveData ?? initialArchive;
  const forecast = weatherForecast;
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const priceCurrency =
    dynamicPriceSnapshot?.currency ??
    archive.dynamicPriceSamples[0]?.currency ??
    "EUR";
  const refreshError =
    archiveRefreshError ?? currentRefreshError ?? solarCurrentRefreshError;

  return (
    <div className="space-y-5">
      {refreshError ? (
        <RefreshWarning action={<PageRefreshButton />} message={refreshError} />
      ) : null}

      <CombinedHistoryChart
        activeTypes={activeTypes}
        archive={archive}
        currentData={currentData}
        daySelection={daySelection}
        dynamicPriceSnapshot={dynamicPriceSnapshot}
        forecast={forecast}
        highestMarkerPeriodStarts={highestMarkerPeriodStarts}
        lowestMarkerPeriodStarts={lowestMarkerPeriodStarts}
        priceCurrency={priceCurrency}
        site={site}
        solarCurrentData={solarCurrentData}
      />
    </div>
  );
}

function useActiveGraphTypes(): GraphType[] {
  const searchParams = useSearchParams();
  const [activeTypes, setActiveTypes] = useState(() =>
    parseGraphTypes(searchParams.get("graphs")),
  );

  useEffect(() => {
    setActiveTypes(parseGraphTypes(searchParams.get("graphs")));
  }, [searchParams]);

  useEffect(() => {
    function syncFromLocation() {
      setActiveTypes(
        parseGraphTypes(
          new URLSearchParams(window.location.search).get("graphs"),
        ),
      );
    }

    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener(
      COMBINED_GRAPH_TYPES_CHANGE_EVENT,
      syncFromLocation,
    );

    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener(
        COMBINED_GRAPH_TYPES_CHANGE_EVENT,
        syncFromLocation,
      );
    };
  }, []);

  return activeTypes;
}

function parseGraphTypes(graphsParam: string | null): GraphType[] {
  const parsed = graphsParam
    ?.split(",")
    .filter((value): value is GraphType =>
      ALL_GRAPH_TYPES.includes(value as GraphType),
    );

  return parsed && parsed.length > 0 ? parsed : DEFAULT_GRAPH_TYPES;
}

function useDelayedEnabled(enabled: boolean): boolean {
  const [delayedEnabled, setDelayedEnabled] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDelayedEnabled(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setDelayedEnabled(true), 0);

    return () => window.clearTimeout(timeoutId);
  }, [enabled]);

  return delayedEnabled;
}

export function CombinedGraphTypeTabs() {
  const activeTypes = useActiveGraphTypes();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const longPressHandledRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);

  function updateGraphTypes(nextTypes: GraphType[]) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("graphs", nextTypes.join(","));
    window.history.pushState(null, "", `${pathname}?${params.toString()}`);
    window.dispatchEvent(new Event(COMBINED_GRAPH_TYPES_CHANGE_EVENT));
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function startLongPressToggle(
    event: PointerEvent<HTMLButtonElement>,
    graphType: GraphType,
  ) {
    if (event.button !== 0) return;

    clearLongPressTimer();
    longPressHandledRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressHandledRef.current = true;
      updateGraphTypes(toggleGraphType(activeTypes, graphType));
    }, LONG_PRESS_TOGGLE_DELAY_MS);
  }

  function selectGraphType(
    event: MouseEvent<HTMLButtonElement>,
    graphType: GraphType,
  ) {
    clearLongPressTimer();

    if (longPressHandledRef.current) {
      longPressHandledRef.current = false;
      event.preventDefault();
      return;
    }

    const isAdditive =
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
    const nextTypes = isAdditive
      ? toggleGraphType(activeTypes, graphType)
      : [graphType];
    updateGraphTypes(nextTypes);
  }

  return (
    <div
      className={cn(
        UI_STYLES.tabBar,
        "justify-start gap-4 border-b-0 px-0 pb-0",
      )}
    >
      {ALL_GRAPH_TYPES.map((graphType) => {
        const meta = GRAPH_TYPE_META[graphType];
        const Icon = meta.icon;
        const selected = activeTypes.includes(graphType);

        return (
          <button
            aria-pressed={selected}
            aria-label={`${meta.label}. Click to show only this graph. Long-press to combine graphs.`}
            className={cn(
              UI_STYLES.tabItem,
              "touch-manipulation select-none",
              selected ? UI_STYLES.tabItemActive : UI_STYLES.tabItemInactive,
            )}
            key={graphType}
            onClick={(event) => selectGraphType(event, graphType)}
            onPointerCancel={clearLongPressTimer}
            onPointerDown={(event) => startLongPressToggle(event, graphType)}
            onPointerLeave={clearLongPressTimer}
            onPointerUp={clearLongPressTimer}
            type="button"
          >
            <Icon
              size={14}
              style={{ color: selected ? meta.color : undefined }}
            />
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function toggleGraphType(
  activeTypes: GraphType[],
  graphType: GraphType,
): GraphType[] {
  if (!activeTypes.includes(graphType)) {
    return ALL_GRAPH_TYPES.filter(
      (type) => type === graphType || activeTypes.includes(type),
    );
  }

  const nextTypes = activeTypes.filter((type) => type !== graphType);
  return nextTypes.length > 0 ? nextTypes : [graphType];
}

function CombinedHistoryChart({
  activeTypes,
  archive,
  currentData,
  daySelection,
  dynamicPriceSnapshot,
  forecast,
  highestMarkerPeriodStarts,
  lowestMarkerPeriodStarts,
  priceCurrency,
  site,
  solarCurrentData,
}: {
  activeTypes: GraphType[];
  archive: HistoryArchive;
  currentData: SiteCurrentResponse | undefined;
  daySelection: ReturnType<typeof useTopLevelDaySelection>;
  dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null;
  forecast: WeatherForecastRecord | null;
  highestMarkerPeriodStarts: string[];
  lowestMarkerPeriodStarts: string[];
  priceCurrency: string;
  site: SiteSnapshot;
  solarCurrentData: SolarCurrentResponse | undefined;
}) {
  const hasBattery = activeTypes.includes("battery");
  const hasGrid = activeTypes.includes("grid");
  const hasPrices = activeTypes.includes("prices");
  const hasSolar = activeTypes.includes("solar");
  const basePoints = useMemo(
    () =>
      splitSingleValueSeriesByTime(
        fillSingleValueDay([], daySelection.selectedDay),
      ),
    [daySelection.selectedDay],
  );
  const batteryPoints = useMemo(
    () =>
      hasBattery
        ? buildBatteryHistoryPoints(
            archive.batteryPowerSamples,
            archive.batteryStrategyHistory,
            daySelection.selectedDay,
            archive.batteryStrategyPlansByBatteryId,
          )
        : [],
    [
      archive.batteryPowerSamples,
      archive.batteryStrategyHistory,
      archive.batteryStrategyPlansByBatteryId,
      daySelection.selectedDay,
      hasBattery,
    ],
  );
  const gridParts = useMemo(() => {
    if (!hasGrid) {
      return {
        expectedSiteLoadPoints: [],
        gridImportPricesByPeriodStart: new Map<string, number | null>(),
        gridPoints: [],
        siteLoadPoints: [],
      };
    }

    const points = splitSingleValueSeriesByTime(
      fillSingleValueDay(
        invertSingleValueSeries(aggregatePowerSamples(archive.p1MeterSamples)),
        daySelection.selectedDay,
      ),
    );

    return {
      expectedSiteLoadPoints: splitSingleValueSeriesByTime(
        archive.selectedDayExpectedSiteLoadSamples,
      ),
      gridImportPricesByPeriodStart: buildActiveImportPriceMap(
        points,
        archive.dynamicPriceSamples,
      ),
      gridPoints: points,
      siteLoadPoints: splitSingleValueSeriesByTime(
        archive.selectedDaySiteLoadSamples,
      ),
    };
  }, [
    archive.dynamicPriceSamples,
    archive.p1MeterSamples,
    archive.selectedDayExpectedSiteLoadSamples,
    archive.selectedDaySiteLoadSamples,
    daySelection.selectedDay,
    hasGrid,
  ]);
  const pricePoints = useMemo(
    () =>
      hasPrices || hasGrid
        ? splitSingleValueSeriesByTime(
            fillSingleValueDay(
              archive.dynamicPriceSamples.map((sample) => ({
                periodStart: sample.periodStart,
                value: sample.importPrice,
              })),
              daySelection.selectedDay,
            ),
          )
        : [],
    [archive.dynamicPriceSamples, daySelection.selectedDay, hasGrid, hasPrices],
  );
  const solarParts = useMemo(() => {
    if (!hasSolar) {
      return {
        forecastPoints: [],
        generatedPoints: [],
        predictedPoints: [],
        selectedDayGeneratedAccuracySeries: [],
        selectedDayPredictedSeries: [],
      };
    }

    const generatedPowerSeries = aggregatePowerSamples(
      archive.solarEnergyProviderSamples,
    );
    const generatedAccuracySeries = applySolarSeriesSmoothing(
      generatedPowerSeries,
      DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
    );

    return {
      forecastPoints: splitSingleValueSeriesByTime(
        fillSingleValueDay(
          archive.solarForecastSamples.map((sample) => ({
            periodStart: sample.periodStart,
            value: sample.value,
          })),
          daySelection.selectedDay,
        ),
      ),
      generatedPoints: splitSingleValueSeriesByTime(
        fillSingleValueDay(generatedPowerSeries, daySelection.selectedDay),
      ),
      predictedPoints: splitSingleValueSeriesByTime(
        fillSingleValueDay(
          archive.solarPredictedGeneration,
          daySelection.selectedDay,
        ),
      ),
      selectedDayGeneratedAccuracySeries: fillSingleValueDay(
        generatedAccuracySeries,
        daySelection.selectedDay,
      ),
      selectedDayPredictedSeries: fillSingleValueDay(
        archive.solarPredictedGeneration,
        daySelection.selectedDay,
      ),
    };
  }, [
    archive.solarEnergyProviderSamples,
    archive.solarForecastSamples,
    archive.solarPredictedGeneration,
    daySelection.selectedDay,
    hasSolar,
  ]);
  const chartData = useMemo(() => {
    let generatedCumulativeWh = 0;
    let predictedCumulativeWh = 0;
    let actualSiteLoadCumulativeWh = 0;
    let expectedSiteLoadCumulativeWh = 0;
    let cumulativeImportCost = 0;
    let cumulativeExportEarnings = 0;

    return basePoints.map((basePoint, index) => {
      const batteryPoint = batteryPoints[index];
      const gridPoint = gridParts.gridPoints[index];
      const siteLoadPoint = gridParts.siteLoadPoints[index];
      const expectedSiteLoadPoint = gridParts.expectedSiteLoadPoints[index];
      const generatedPoint = solarParts.generatedPoints[index];
      const predictedPoint = solarParts.predictedPoints[index];
      const forecastPoint = solarParts.forecastPoints[index];
      const importPrice = hasGrid
        ? (gridParts.gridImportPricesByPeriodStart.get(basePoint.periodStart) ??
          null)
        : null;
      if (typeof generatedPoint?.value === "number")
        generatedCumulativeWh +=
          generatedPoint.value * (HISTORY_STEP_MS / (60 * 60 * 1_000));
      if (typeof predictedPoint?.value === "number")
        predictedCumulativeWh +=
          predictedPoint.value * (HISTORY_STEP_MS / (60 * 60 * 1_000));
      if (typeof siteLoadPoint?.value === "number")
        actualSiteLoadCumulativeWh +=
          siteLoadPoint.value * (HISTORY_STEP_MS / (60 * 60 * 1_000));
      if (typeof expectedSiteLoadPoint?.value === "number")
        expectedSiteLoadCumulativeWh +=
          expectedSiteLoadPoint.value * (HISTORY_STEP_MS / (60 * 60 * 1_000));
      if (
        typeof gridPoint?.value === "number" &&
        typeof importPrice === "number"
      ) {
        const energyKwh =
          (Math.abs(gridPoint.value) * (HISTORY_STEP_MS / (60 * 60 * 1_000))) /
          1_000;

        if (gridPoint.value < 0) {
          cumulativeImportCost += energyKwh * importPrice;
        } else {
          cumulativeExportEarnings +=
            energyKwh *
            computeExportPrice(
              importPrice,
              site.dynamicPriceSources[0]?.exportDeduction,
            );
        }
      }

      return {
        actualSiteLoadCumulativeWh,
        actualSiteLoadCurrentValue: siteLoadPoint?.currentValue ?? null,
        actualSiteLoadFutureValue: siteLoadPoint?.futureValue ?? null,
        batteryChargeCurrentValue: batteryPoint?.currentChargePercent ?? null,
        batteryChargeFutureValue: batteryPoint?.futureChargePercent ?? null,
        batteryPowerCurrentValue: batteryPoint?.currentPower ?? null,
        batteryPowerFutureValue: batteryPoint?.futurePower ?? null,
        cumulativeExportEarnings,
        cumulativeImportCost,
        cumulativeNetCost: cumulativeImportCost - cumulativeExportEarnings,
        expectedSiteLoadCumulativeWh,
        expectedSiteLoadCurrentValue:
          expectedSiteLoadPoint?.currentValue ?? null,
        expectedSiteLoadFutureValue: expectedSiteLoadPoint?.futureValue ?? null,
        forecastCurrentValue: forecastPoint?.currentValue ?? null,
        forecastFutureValue: forecastPoint?.futureValue ?? null,
        generatedCumulativeWh,
        generatedCurrentValue: generatedPoint?.currentValue ?? null,
        generatedFutureValue: generatedPoint?.futureValue ?? null,
        gridCurrentValue: gridPoint?.currentValue ?? null,
        gridFutureValue: gridPoint?.futureValue ?? null,
        overlayValue: batteryPoint?.overlayValue ?? null,
        periodStart: basePoint.periodStart,
        predictedCumulativeWh,
        predictedCurrentValue: predictedPoint?.currentValue ?? null,
        predictedFutureValue: predictedPoint?.futureValue ?? null,
        priceCurrentValue: hasPrices
          ? (pricePoints[index]?.currentValue ?? null)
          : null,
        priceFutureValue: hasPrices
          ? (pricePoints[index]?.futureValue ?? null)
          : null,
        strategyColor: batteryPoint?.strategyColor ?? null,
        strategyDisplayLabel: batteryPoint?.strategyDisplayLabel ?? null,
        strategyDisplayState: batteryPoint?.strategyDisplayState ?? null,
        strategyItemLabel: batteryPoint?.strategyItemLabel ?? null,
        strategySource: batteryPoint?.strategySource ?? null,
        timestampMs: new Date(basePoint.periodStart).getTime(),
      };
    });
  }, [
    basePoints,
    batteryPoints,
    gridParts,
    hasGrid,
    hasPrices,
    pricePoints,
    site.dynamicPriceSources,
    solarParts,
  ]);
  const strategyStates = useMemo(
    () => (hasBattery ? getBatteryStrategyLegendItems(batteryPoints) : []),
    [batteryPoints, hasBattery],
  );
  const seriesIds = useMemo(
    () => [
      ...getSeriesIds(activeTypes),
      ...strategyStates.map((state) => state.seriesId),
    ],
    [activeTypes, strategyStates],
  );
  const { isVisible, toggle } = useChartSeriesVisibility({
    seriesIds,
    storageKey: COMBINED_VISIBILITY_STORAGE_KEY,
  });
  const activeAxisKinds = useMemo(
    () => getActiveAxisKinds(activeTypes),
    [activeTypes],
  );
  const primaryAxis = getPrimaryAxisKind(activeTypes);
  const secondaryAxis = getSecondaryAxisKind(activeAxisKinds, primaryAxis);
  const mirrorPrimaryAxis = shouldMirrorRightAxis(activeTypes);
  const hideSecondaryAxisDetails = activeTypes.length > 1;
  const axisConfigs = useMemo(() => {
    const configs: Partial<
      Record<AxisKind, ReturnType<typeof buildMirroredYAxis>>
    > = {};

    for (const axisKind of activeAxisKinds) {
      if (axisKind === "charge") {
        configs[axisKind] = buildMirroredYAxis(
          chartData.flatMap((point) => [
            point.batteryChargeCurrentValue,
            point.batteryChargeFutureValue,
          ]),
          [0, 100],
        );
        continue;
      }

      if (axisKind === "forecast") {
        configs[axisKind] = buildMirroredYAxis(
          chartData.flatMap((point) => [
            point.forecastCurrentValue,
            point.forecastFutureValue,
          ]),
        );
        continue;
      }

      if (axisKind === "price") {
        configs[axisKind] = buildMirroredYAxis(
          chartData.flatMap((point) => [
            point.priceCurrentValue,
            point.priceFutureValue,
          ]),
          undefined,
          undefined,
          false,
        );
        continue;
      }

      configs[axisKind] = buildMirroredYAxis(
        chartData.flatMap((point) => [
          point.batteryPowerCurrentValue,
          point.batteryPowerFutureValue,
          point.gridCurrentValue,
          point.gridFutureValue,
          point.actualSiteLoadCurrentValue,
          point.actualSiteLoadFutureValue,
          point.expectedSiteLoadCurrentValue,
          point.expectedSiteLoadFutureValue,
          point.generatedCurrentValue,
          point.generatedFutureValue,
          point.predictedCurrentValue,
          point.predictedFutureValue,
        ]),
        activeTypes.length === 1 && activeTypes[0] === "solar"
          ? [0, SOLAR_POWER_AXIS_MAX_W]
          : undefined,
      );
    }

    return configs;
  }, [activeAxisKinds, activeTypes, chartData]);
  function getActiveAxisConfig(axisKind: AxisKind) {
    const config = axisConfigs[axisKind];
    if (!config) {
      throw new Error(`Missing combined chart axis config for ${axisKind}`);
    }

    return config;
  }
  const hasValues = useMemo(
    () =>
      chartData.some((point) =>
        seriesIds.some((seriesId) => hasSeriesValue(point, seriesId)),
      ),
    [chartData, seriesIds],
  );
  const forecastUnitLabel = forecast?.unitLabel ?? "W/m²";
  const strategyBatteryId = useMemo(
    () =>
      hasBattery
        ? getBatteryHistoryStrategyBatteryId(
            archive.batteryPowerSamples,
            daySelection.selectedDay,
          )
        : null,
    [archive.batteryPowerSamples, daySelection.selectedDay, hasBattery],
  );
  const xAxisStartMs = chartData[0]?.timestampMs ?? 0;
  const xAxisEndMs = (chartData.at(-1)?.timestampMs ?? 0) + HISTORY_STEP_MS;
  const showPriceMarkers = hasPrices && isVisible(SERIES_IDS.priceImport);
  const visibleLowestMarkerTimes = showPriceMarkers
    ? getVisibleMarkerTimes(lowestMarkerPeriodStarts, xAxisStartMs, xAxisEndMs)
    : [];
  const visibleHighestMarkerTimes = showPriceMarkers
    ? getVisibleMarkerTimes(highestMarkerPeriodStarts, xAxisStartMs, xAxisEndMs)
    : [];
  const strategySegments = useMemo(
    () =>
      hasBattery
        ? buildExactBatteryStrategySegments({
            chartEndMs: xAxisEndMs,
            chartStartMs: xAxisStartMs,
            cutoffMs: daySelection.nowMarkerPeriodStart
              ? new Date(daySelection.nowMarkerPeriodStart).getTime()
              : null,
            strategyBatteryId,
            strategyHistory: archive.batteryStrategyHistory,
            strategyPlansByBatteryId: archive.batteryStrategyPlansByBatteryId,
          })
        : [],
    [
      archive.batteryStrategyHistory,
      archive.batteryStrategyPlansByBatteryId,
      daySelection.nowMarkerPeriodStart,
      hasBattery,
      strategyBatteryId,
      xAxisEndMs,
      xAxisStartMs,
    ],
  );
  const solarSurplusBounds = useMemo(
    () =>
      hasSolar
        ? findSolarSurplusBoundsFromSeries({
            expectedLoadSeries: archive.selectedDayExpectedSiteLoadSamples,
            fallbackEndTime:
              solarParts.predictedPoints.at(-1)?.periodStart ?? null,
            predictedSeries: solarParts.predictedPoints,
            selectedDayKey: daySelection.selectedDay,
          })
        : { finalEndTime: null, firstStartTime: null },
    [
      archive.selectedDayExpectedSiteLoadSamples,
      daySelection.selectedDay,
      hasSolar,
      solarParts.predictedPoints,
    ],
  );
  const predictionAccuracyPercentage = useMemo(
    () =>
      hasSolar
        ? buildSolarPredictionAccuracySummary({
            generatedSeries: solarParts.selectedDayGeneratedAccuracySeries,
            predictedSeries: solarParts.selectedDayPredictedSeries,
            nowMarkerPeriodStart: daySelection.nowMarkerPeriodStart,
          }).overallAccuracyPercentage
        : null,
    [
      daySelection.nowMarkerPeriodStart,
      hasSolar,
      solarParts.selectedDayGeneratedAccuracySeries,
      solarParts.selectedDayPredictedSeries,
    ],
  );
  const summaries = useMemo(
    () =>
      getLegendSummaries({
        archive,
        chartData,
        currentData,
        dynamicPriceSnapshot,
        priceCurrency,
        site,
        solarCurrentData,
      }),
    [
      archive,
      chartData,
      currentData,
      dynamicPriceSnapshot,
      priceCurrency,
      site,
      solarCurrentData,
    ],
  );

  return (
    <div className="space-y-2.5">
      <div className="flex justify-center">
        <TopLevelDaySelect daySelection={daySelection} />
      </div>
      <div className="relative">
        <MeasuredChartContainer className="h-[440px] min-w-0 w-full">
          {({ height, width }) => {
            const xAxisTicks = buildResponsiveDayTicks(
              chartData.map((point) => point.timestampMs),
              width,
            );
            return (
              <LineChart
                data={chartData}
                height={height}
                margin={{
                  top: 12,
                  right: STANDARD_RIGHT_AXIS_MARGIN,
                  bottom: 0,
                  left: STANDARD_LEFT_AXIS_MARGIN,
                }}
                width={width}
              >
                <CartesianGrid
                  stroke={UI_COLORS.chartGrid}
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="timestampMs"
                  domain={[xAxisStartMs, xAxisEndMs]}
                  interval={0}
                  minTickGap={28}
                  tick={UI_CHART_STYLES.axisTick}
                  tickFormatter={formatDayTick}
                  tickLine={false}
                  ticks={xAxisTicks}
                  type="number"
                />
                {renderAxis(
                  primaryAxis,
                  getActiveAxisConfig(primaryAxis),
                  "left",
                  getAxisLabel(primaryAxis, priceCurrency, forecastUnitLabel),
                  getAxisFormatter(primaryAxis, priceCurrency),
                  undefined,
                  true,
                )}
                {activeAxisKinds
                  .filter((axisKind) => axisKind !== primaryAxis)
                  .map((axisKind) =>
                    renderAxis(
                      axisKind,
                      getActiveAxisConfig(axisKind),
                      axisKind === secondaryAxis ? "right" : "hidden",
                      hideSecondaryAxisDetails
                        ? ""
                        : getAxisLabel(
                            axisKind,
                            priceCurrency,
                            forecastUnitLabel,
                          ),
                      hideSecondaryAxisDetails
                        ? formatHiddenAxisTick
                        : getAxisFormatter(axisKind, priceCurrency),
                      undefined,
                      !hideSecondaryAxisDetails,
                    ),
                  )}
                {mirrorPrimaryAxis
                  ? renderAxis(
                      primaryAxis,
                      getActiveAxisConfig(primaryAxis),
                      "right",
                      getAxisLabel(
                        primaryAxis,
                        priceCurrency,
                        forecastUnitLabel,
                      ),
                      getAxisFormatter(primaryAxis, priceCurrency),
                      `${primaryAxis}-mirror`,
                    )
                  : null}
                {mirrorPrimaryAxis ? (
                  <Line
                    activeDot={false}
                    dataKey={getMirrorAxisDataKey(primaryAxis)}
                    dot={false}
                    isAnimationActive={false}
                    legendType="none"
                    name="__mirrorAxis"
                    stroke="transparent"
                    strokeWidth={1}
                    type="monotone"
                    yAxisId={`${primaryAxis}-mirror`}
                  />
                ) : null}
                {activeAxisKinds.includes("power") ? (
                  <ReferenceLine
                    stroke={UI_COLORS.chartZeroLine}
                    strokeDasharray="4 6"
                    y={0}
                    yAxisId="power"
                  />
                ) : null}
                <Tooltip
                  content={
                    <CombinedTooltip
                      activeTypes={activeTypes}
                      exportDeduction={
                        site.dynamicPriceSources[0]?.exportDeduction
                      }
                      forecastUnitLabel={forecastUnitLabel}
                      priceCurrency={priceCurrency}
                    />
                  }
                />
                <YAxis domain={[0, 1]} hide width={0} yAxisId="overlay" />
                {activeTypes.includes("battery") ? (
                  <Line
                    activeDot={false}
                    dataKey="overlayValue"
                    dot={false}
                    isAnimationActive={false}
                    legendType="none"
                    name="__overlayAxis"
                    stroke="transparent"
                    strokeWidth={1}
                    type="monotone"
                    yAxisId="overlay"
                  />
                ) : null}
                {activeTypes.includes("battery")
                  ? strategySegments
                      .filter((segment) => isVisible(segment.seriesId))
                      .map((segment) => (
                        <ReferenceArea
                          fill={segment.color}
                          fillOpacity={1}
                          ifOverflow="hidden"
                          key={`${segment.seriesId}-${segment.startMs}-${segment.endMs}`}
                          stroke={segment.color}
                          strokeOpacity={0.95}
                          strokeWidth={1.2}
                          x1={segment.startMs}
                          x2={segment.endMs}
                          y1={BATTERY_STRATEGY_BAND_BOTTOM}
                          y2={1}
                          yAxisId="overlay"
                        />
                      ))
                  : null}
                {daySelection.nowMarkerPeriodStart ? (
                  <ReferenceLine
                    label={buildNowLabel()}
                    stroke={UI_COLORS.textPrimary}
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                    x={new Date(daySelection.nowMarkerPeriodStart).getTime()}
                    yAxisId={primaryAxis}
                  />
                ) : null}
                {visibleLowestMarkerTimes.map((markerTime) => (
                  <ReferenceLine
                    key={`low-${markerTime}`}
                    label={buildLowestLabel()}
                    stroke={UI_COLORS.success}
                    strokeDasharray="2 2"
                    strokeOpacity={0.65}
                    x={markerTime}
                    yAxisId="price"
                  />
                ))}
                {visibleHighestMarkerTimes.map((markerTime) => (
                  <ReferenceLine
                    key={`high-${markerTime}`}
                    label={buildHighestLabel()}
                    stroke={UI_COLORS.error}
                    strokeDasharray="2 2"
                    strokeOpacity={0.65}
                    x={markerTime}
                    yAxisId="price"
                  />
                ))}
                {activeTypes.includes("solar") &&
                (isVisible(SERIES_IDS.solarPredicted) ||
                  isVisible(SERIES_IDS.solarGenerated)) &&
                solarSurplusBounds.firstStartTime ? (
                  <ReferenceLine
                    label={buildSolarSurplusLabel(
                      "Surplus start",
                      UI_COLORS.success,
                    )}
                    stroke={UI_COLORS.success}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                    x={new Date(solarSurplusBounds.firstStartTime).getTime()}
                    yAxisId="power"
                  />
                ) : null}
                {activeTypes.includes("solar") &&
                (isVisible(SERIES_IDS.solarPredicted) ||
                  isVisible(SERIES_IDS.solarGenerated)) &&
                solarSurplusBounds.finalEndTime ? (
                  <ReferenceLine
                    label={buildSolarSurplusLabel(
                      "Surplus end",
                      UI_COLORS.combinedSolarPower,
                    )}
                    stroke={UI_COLORS.combinedSolarPower}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                    x={new Date(solarSurplusBounds.finalEndTime).getTime()}
                    yAxisId="power"
                  />
                ) : null}
                {renderLines(activeTypes, isVisible)}
              </LineChart>
            );
          }}
        </MeasuredChartContainer>
        {!hasValues ? (
          <EmptyChartMessage message="No samples for the active graph types on this day." />
        ) : null}
      </div>
      <GroupedLegend
        activeTypes={activeTypes}
        isVisible={isVisible}
        predictionAccuracyPercentage={predictionAccuracyPercentage}
        strategyStates={strategyStates}
        summaries={summaries}
        toggle={toggle}
      />
      <p className="text-xs leading-5 text-slate-500">
        Tip: click a graph type to show only it. Long-press or use Ctrl,
        Command, Shift, or Alt/Option-click to add or remove graph types.
      </p>
      {dynamicPriceSnapshot === null && activeTypes.includes("prices") ? (
        <p className="text-xs leading-5 text-amber-100">
          Dynamic price snapshot is not available yet; plotted archive prices
          may still appear when history exists.
        </p>
      ) : null}
    </div>
  );
}

function GroupedLegend({
  activeTypes,
  isVisible,
  predictionAccuracyPercentage,
  strategyStates,
  summaries,
  toggle,
}: {
  activeTypes: GraphType[];
  isVisible: (seriesId: string) => boolean;
  predictionAccuracyPercentage: number | null;
  strategyStates: ReturnType<typeof getBatteryStrategyLegendItems>;
  summaries: Record<GraphType, string>;
  toggle: (seriesId: string) => void;
}) {
  const groups = getLegendGroups(
    activeTypes,
    summaries,
    predictionAccuracyPercentage,
  );
  return (
    <div className="space-y-3 text-xs font-medium text-slate-300">
      {groups.map((group) => (
        <div
          className="w-fit max-w-full rounded-2xl border border-white/10 bg-slate-950/35 p-2"
          key={group.type}
        >
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
            {group.label} • {group.summaryLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.items.map((item) => (
              <LegendChip
                color={item.color}
                key={item.seriesId}
                label={item.label}
                marker={
                  item.dashed ? (
                    <DashedLegendMarker
                      color={
                        isVisible(item.seriesId)
                          ? item.color
                          : UI_COLORS.chartTickMuted
                      }
                    />
                  ) : undefined
                }
                onClick={() => toggle(item.seriesId)}
                selected={isVisible(item.seriesId)}
              />
            ))}
            {group.type === "battery"
              ? strategyStates.map((state) => (
                  <LegendChip
                    color={state.color}
                    key={state.key}
                    label={state.label}
                    marker={
                      <StrategyLegendMarker
                        color={state.color}
                        selected={isVisible(state.seriesId)}
                        source={state.source}
                      />
                    }
                    onClick={() => toggle(state.seriesId)}
                    selected={isVisible(state.seriesId)}
                  />
                ))
              : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function getLegendGroups(
  activeTypes: GraphType[],
  summaries: Record<GraphType, string>,
  predictionAccuracyPercentage: number | null,
): CombinedLegendGroup[] {
  return activeTypes.map((type) => {
    if (type === "battery")
      return {
        type,
        label: "Battery",
        summaryLabel: summaries.battery,
        items: [
          {
            seriesId: SERIES_IDS.batteryPower,
            color: UI_COLORS.combinedBatteryPower,
            label: "Power",
          },
          {
            seriesId: SERIES_IDS.batteryCharge,
            color: UI_COLORS.combinedBatteryCharge,
            label: "Charge",
          },
        ],
      };
    if (type === "solar")
      return {
        type,
        label: "Solar",
        summaryLabel: summaries.solar,
        items: [
          {
            seriesId: SERIES_IDS.solarForecast,
            color: UI_COLORS.combinedSolarForecast,
            label: "Forecast",
          },
          {
            seriesId: SERIES_IDS.solarPredicted,
            color: UI_COLORS.combinedSolarPower,
            label: buildPredictedSolarLegendLabel(predictionAccuracyPercentage),
            dashed: true,
          },
          {
            seriesId: SERIES_IDS.solarGenerated,
            color: UI_COLORS.combinedSolarPower,
            label: "Generated",
          },
        ],
      };
    if (type === "prices")
      return {
        type,
        label: "Prices",
        summaryLabel: summaries.prices,
        items: [
          {
            seriesId: SERIES_IDS.priceImport,
            color: UI_COLORS.combinedPriceImport,
            label: "Import price",
          },
        ],
      };
    return {
      type,
      label: "Grid",
      summaryLabel: summaries.grid,
      items: [
        {
          seriesId: SERIES_IDS.gridPower,
          color: UI_COLORS.combinedGridPower,
          label: "Grid power",
        },
        {
          seriesId: SERIES_IDS.gridSiteLoad,
          color: UI_COLORS.combinedGridLoad,
          label: "Inferred load",
        },
        {
          seriesId: SERIES_IDS.gridExpectedLoad,
          color: UI_COLORS.combinedGridLoad,
          label: "Expected load",
          dashed: true,
        },
      ],
    };
  });
}

function getLegendSummaries({
  archive,
  chartData,
  currentData,
  dynamicPriceSnapshot,
  priceCurrency,
  site,
  solarCurrentData,
}: {
  archive: HistoryArchive;
  chartData: Array<{
    batteryChargeCurrentValue: number | null;
    batteryPowerCurrentValue: number | null;
    generatedCurrentValue: number | null;
    gridCurrentValue: number | null;
    periodStart: string;
    priceCurrentValue: number | null;
  }>;
  currentData: SiteCurrentResponse | undefined;
  dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null;
  priceCurrency: string;
  site: SiteSnapshot;
  solarCurrentData: SolarCurrentResponse | undefined;
}): Record<GraphType, string> {
  const batteryChargePercent = currentData
    ? (currentData.currentBatteryChargePercent ?? null)
    : getLatestChartValue(chartData, "batteryChargeCurrentValue");
  const batteryPowerW = currentData
    ? (currentData.currentBatteryPowerW ?? null)
    : getLatestChartValue(chartData, "batteryPowerCurrentValue");
  const solarPowerW = solarCurrentData
    ? (solarCurrentData.currentGeneratedPower ?? null)
    : (currentData?.currentSolarPowerW ??
      getLatestChartValue(chartData, "generatedCurrentValue"));
  const gridPowerW = currentData
    ? (currentData.currentGridPowerW ?? null)
    : getLatestChartValue(chartData, "gridCurrentValue");

  return {
    battery: formatBatterySummary(batteryChargePercent, batteryPowerW),
    grid: formatGridSummary(gridPowerW),
    prices: formatPriceSummary({
      archive,
      dynamicPriceSnapshot,
      exportDeduction: site.dynamicPriceSources[0]?.exportDeduction,
      priceCurrency,
    }),
    solar: formatSolarSummary(site, solarPowerW),
  };
}

function getLatestChartValue<
  T extends Record<string, number | string | null>,
  K extends keyof T,
>(points: T[], key: K): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.[key];
    if (typeof value === "number") return value;
  }

  return null;
}

function formatBatterySummary(
  chargePercent: number | null,
  powerW: number | null,
): string {
  const chargeLabel =
    chargePercent === null
      ? "Charge unavailable"
      : `${Math.round(chargePercent)}%`;

  return `${chargeLabel} • ${formatBatteryPowerSummary(powerW)}`;
}

function formatBatteryPowerSummary(value: number | null): string {
  if (value === null) return "Power unavailable";

  const state = deriveBatteryStatusFromPower(value);
  if (state === "idle") return "Idle";

  const direction = state === "charging" ? "Charging" : "Discharging";
  return `${direction} ${formatAbsolutePowerValue(value)}`;
}

function formatSolarSummary(site: SiteSnapshot, powerW: number | null): string {
  const hasDisabledProvider = site.devices.some(
    (device) =>
      device.kind === "solar-energy-provider" &&
      device.telemetry?.productionControlStatus === "disabled",
  );

  if (hasDisabledProvider) return "Disabled";
  return powerW === null
    ? "Generating unavailable"
    : `Generating ${formatAbsolutePowerValue(powerW)}`;
}

function formatPriceSummary({
  archive,
  dynamicPriceSnapshot,
  exportDeduction,
  priceCurrency,
}: {
  archive: HistoryArchive;
  dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null;
  exportDeduction: number | undefined;
  priceCurrency: string;
}): string {
  const currentPricePoint =
    getActivePricePointAtOrBefore(
      dynamicPriceSnapshot?.points ?? [],
      Date.now(),
    ) ??
    dynamicPriceSnapshot?.points[0] ??
    null;
  const importPrice =
    currentPricePoint?.importPrice ??
    getActivePricePointAtOrBefore(archive.dynamicPriceSamples, Date.now())
      ?.importPrice ??
    null;

  if (importPrice === null) return "Price unavailable";

  const exportPrice = computeExportPrice(importPrice, exportDeduction);
  return `Import ${formatPricePerKwh(importPrice, priceCurrency)} • Export ${formatPricePerKwh(exportPrice, priceCurrency)}`;
}

function formatGridSummary(value: number | null): string {
  if (value === null) return "Grid unavailable";
  if (Math.abs(value) <= 10) return "Idle";

  const direction = value < 0 ? "Importing" : "Exporting";
  return `${direction} ${formatAbsolutePowerValue(value)}`;
}

function buildPredictedSolarLegendLabel(
  predictionAccuracyPercentage: number | null,
): string {
  if (predictionAccuracyPercentage === null) return "Predicted";
  return `Predicted • Accuracy ${Math.round(predictionAccuracyPercentage)}%`;
}

function StrategyLegendMarker({
  color,
  selected,
  source,
}: {
  color: string;
  selected?: boolean;
  source: BatteryHistoryPoint["strategySource"];
}) {
  const Icon = source === "manual" ? Hand : CalendarClock;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-2.5 w-4 rounded-sm border border-white/10"
        style={{ backgroundColor: selected ? color : UI_COLORS.chartTickMuted }}
      />
      <Icon
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0"
        style={{
          color: selected ? UI_COLORS.textPrimary : UI_COLORS.chartTickMuted,
        }}
      />
    </span>
  );
}

function renderAxis(
  axisKind: AxisKind,
  axisConfig: ReturnType<typeof buildMirroredYAxis>,
  placement: "left" | "right" | "hidden",
  label: string,
  formatter: (value: number) => string,
  yAxisId: string = axisKind,
  showTicks = true,
  width = placement === "hidden"
    ? 0
    : placement === "right"
      ? RIGHT_Y_AXIS_WIDTH
      : LEFT_Y_AXIS_WIDTH,
) {
  return (
    <YAxis
      axisLine={false}
      domain={axisConfig.domain}
      hide={placement === "hidden"}
      key={yAxisId}
      {...(placement === "hidden"
        ? {}
        : {
            label: buildYAxisLabel(
              label,
              placement === "left" ? "insideLeft" : "right",
            ),
          })}
      orientation={placement === "right" ? "right" : "left"}
      tick={UI_CHART_STYLES.axisTickMuted}
      tickFormatter={formatter}
      tickLine={false}
      tickMargin={8}
      ticks={showTicks ? axisConfig.ticks : []}
      width={width}
      yAxisId={yAxisId}
    />
  );
}

function getVisibleMarkerTimes(
  periodStarts: string[],
  startMs: number,
  endMs: number,
): number[] {
  return periodStarts.flatMap((periodStart) => {
    const markerTime = new Date(periodStart).getTime();

    return markerTime >= startMs && markerTime <= endMs ? [markerTime] : [];
  });
}

function buildActiveImportPriceMap(
  points: Array<{ periodStart: string }>,
  priceSamples: Array<{ importPrice: number | null; periodStart: string }>,
): Map<string, number | null> {
  const priceByPeriodStart = new Map<string, number | null>();
  let activeImportPrice: number | null = null;
  let priceIndex = 0;
  const sortedPriceSamples = [...priceSamples].sort(
    (left, right) =>
      new Date(left.periodStart).getTime() -
      new Date(right.periodStart).getTime(),
  );

  for (const point of points) {
    const pointTime = new Date(point.periodStart).getTime();

    while (priceIndex < sortedPriceSamples.length) {
      const sample = sortedPriceSamples[priceIndex];
      if (!sample || new Date(sample.periodStart).getTime() > pointTime) break;

      activeImportPrice = sample.importPrice;
      priceIndex += 1;
    }

    priceByPeriodStart.set(point.periodStart, activeImportPrice);
  }

  return priceByPeriodStart;
}

function formatHiddenAxisTick(): string {
  return "";
}

function renderLines(
  activeTypes: GraphType[],
  isVisible: (seriesId: string) => boolean,
): ReactNode {
  return (
    <>
      {activeTypes.includes("battery") && isVisible(SERIES_IDS.batteryPower)
        ? renderCurrentFutureLine(
            "batteryPower",
            "Battery Power",
            UI_COLORS.combinedBatteryPower,
            "power",
          )
        : null}
      {activeTypes.includes("battery") && isVisible(SERIES_IDS.batteryCharge)
        ? renderCurrentFutureLine(
            "batteryCharge",
            "Battery Charge",
            UI_COLORS.combinedBatteryCharge,
            "charge",
          )
        : null}
      {activeTypes.includes("prices") && isVisible(SERIES_IDS.priceImport)
        ? renderCurrentFutureLine(
            "price",
            "Import Price",
            UI_COLORS.combinedPriceImport,
            "price",
          )
        : null}
      {activeTypes.includes("solar") && isVisible(SERIES_IDS.solarForecast)
        ? renderCurrentFutureLine(
            "forecast",
            "Solar Forecast",
            UI_COLORS.combinedSolarForecast,
            "forecast",
          )
        : null}
      {activeTypes.includes("solar") && isVisible(SERIES_IDS.solarPredicted)
        ? renderCurrentFutureLine(
            "predicted",
            "Predicted Solar",
            UI_COLORS.combinedSolarPower,
            "power",
            "1 6",
          )
        : null}
      {activeTypes.includes("solar") && isVisible(SERIES_IDS.solarGenerated)
        ? renderCurrentFutureLine(
            "generated",
            "Generated Solar",
            UI_COLORS.combinedSolarPower,
            "power",
          )
        : null}
      {activeTypes.includes("grid") && isVisible(SERIES_IDS.gridPower)
        ? renderCurrentFutureLine(
            "grid",
            "Grid Power",
            UI_COLORS.combinedGridPower,
            "power",
          )
        : null}
      {activeTypes.includes("grid") && isVisible(SERIES_IDS.gridSiteLoad)
        ? renderCurrentFutureLine(
            "actualSiteLoad",
            "Inferred Site Load",
            UI_COLORS.combinedGridLoad,
            "power",
          )
        : null}
      {activeTypes.includes("grid") && isVisible(SERIES_IDS.gridExpectedLoad)
        ? renderCurrentFutureLine(
            "expectedSiteLoad",
            "Expected Site Load",
            UI_COLORS.combinedGridLoad,
            "power",
            "1 6",
          )
        : null}
    </>
  );
}

function renderCurrentFutureLine(
  prefix: string,
  name: string,
  color: string,
  yAxisId: AxisKind,
  strokeDasharray?: string,
): ReactNode {
  const dashProps = strokeDasharray ? { strokeDasharray } : {};

  return (
    <>
      <Line
        activeDot={false}
        dataKey={`${prefix}CurrentValue`}
        dot={false}
        isAnimationActive={false}
        name={name}
        stroke={color}
        {...dashProps}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.6}
        type="monotone"
        yAxisId={yAxisId}
      />
      <Line
        activeDot={false}
        dataKey={`${prefix}FutureValue`}
        dot={false}
        isAnimationActive={false}
        name={name}
        stroke={color}
        {...dashProps}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.35}
        strokeWidth={2.6}
        type="monotone"
        yAxisId={yAxisId}
      />
    </>
  );
}

function CombinedTooltip({
  active,
  activeTypes,
  exportDeduction,
  forecastUnitLabel,
  label,
  payload,
  priceCurrency,
}: {
  active?: boolean;
  activeTypes: GraphType[];
  exportDeduction: number | undefined;
  forecastUnitLabel: string;
  label?: string;
  payload?: TooltipPayloadEntry[];
  priceCurrency: string;
}) {
  if (!active || !label || !payload || payload.length === 0) return null;
  const numericEntries = payload.filter(
    (entry): entry is TooltipPayloadEntry & { value: number } =>
      typeof entry.value === "number" &&
      entry.name !== "__mirrorAxis" &&
      entry.name !== "__overlayAxis" &&
      isTooltipEntryActive(entry.dataKey, activeTypes),
  );
  const entries = deduplicateTooltipEntries(numericEntries);
  const point = payload.find((entry) => entry.payload)?.payload as
    | CombinedTooltipPoint
    | undefined;
  const strategyLabel = activeTypes.includes("battery")
    ? formatStrategyTooltipLabel(point)
    : null;
  const priceEntry = entries.find((entry) =>
    entry.dataKey?.startsWith("price"),
  );
  const showGridCosts = entries.some(
    (entry) => getTooltipEntryGraphType(entry.dataKey) === "grid",
  );
  if (entries.length === 0 && !strategyLabel) return null;

  return (
    <TooltipCard>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {formatTooltipTimestamp(label)}
      </p>
      <div className="space-y-1.5">
        {activeTypes.map((type) => {
          const categoryEntries = entries.filter(
            (entry) => getTooltipEntryGraphType(entry.dataKey) === type,
          );

          if (
            categoryEntries.length === 0 &&
            !(type === "battery" && strategyLabel) &&
            !(type === "prices" && priceEntry) &&
            !(type === "grid" && showGridCosts && point)
          ) {
            return null;
          }

          return (
            <div className="space-y-1.5" key={type}>
              {categoryEntries.map((entry) => (
                <div
                  className="flex items-center justify-between gap-4"
                  key={`${entry.dataKey}-${entry.name}`}
                >
                  <span className="flex items-center gap-2 text-slate-200">
                    <TooltipMarker
                      color={entry.color ?? UI_COLORS.chartSeriesFallback}
                      strokeDasharray={
                        entry.dataKey?.startsWith("predicted") ||
                        entry.dataKey?.startsWith("expected")
                          ? "1 6"
                          : undefined
                      }
                    />
                    {formatTooltipLabel(entry.dataKey, entry.value)}
                  </span>
                  <span className="font-medium text-white">
                    {formatTooltipValue(
                      entry.value,
                      entry.dataKey,
                      entry.payload,
                      priceCurrency,
                      forecastUnitLabel,
                    )}
                  </span>
                </div>
              ))}
              {type === "battery" && strategyLabel ? (
                <CombinedTooltipDetailRow
                  color={point?.strategyColor ?? getStrategyTooltipColor(point)}
                  label="Strategy"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      {point?.strategySource ? (
                        <StrategySourceIcon source={point.strategySource} />
                      ) : null}
                      <span>{strategyLabel}</span>
                    </span>
                  }
                />
              ) : null}
              {type === "prices" && priceEntry ? (
                <CombinedTooltipDetailRow
                  color={UI_COLORS.success}
                  label="Export Price"
                  value={formatPricePerKwh(
                    computeExportPrice(priceEntry.value, exportDeduction),
                    priceCurrency,
                  )}
                />
              ) : null}
              {type === "grid" && showGridCosts && point ? (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <div className="space-y-1.5">
                    <CombinedTooltipPlainRow
                      label="Import Cost"
                      value={formatCurrencyAmount(
                        point.cumulativeImportCost,
                        priceCurrency,
                      )}
                    />
                    <CombinedTooltipPlainRow
                      label="Export Earnings"
                      value={formatCurrencyAmount(
                        point.cumulativeExportEarnings,
                        priceCurrency,
                      )}
                    />
                    <CombinedTooltipPlainRow
                      label={
                        point.cumulativeNetCost > 0
                          ? "Net Energy Cost"
                          : "Net Energy Earnings"
                      }
                      value={formatCurrencyAmount(
                        Math.abs(point.cumulativeNetCost),
                        priceCurrency,
                      )}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </TooltipCard>
  );
}

type CombinedTooltipPoint = {
  cumulativeExportEarnings: number;
  cumulativeImportCost: number;
  cumulativeNetCost: number;
  strategyColor: string | null;
  strategyDisplayLabel: string | null;
  strategyDisplayState: BatteryHistoryPoint["strategyDisplayState"];
  strategyItemLabel: string | null;
  strategySource: BatteryHistoryPoint["strategySource"];
};

function isTooltipEntryActive(
  dataKey: string | undefined,
  activeTypes: GraphType[],
): boolean {
  const graphType = getTooltipEntryGraphType(dataKey);
  return graphType !== null && activeTypes.includes(graphType);
}

function getTooltipEntryGraphType(
  dataKey: string | undefined,
): GraphType | null {
  if (!dataKey) return null;
  if (dataKey.startsWith("battery")) return "battery";
  if (
    dataKey.startsWith("generated") ||
    dataKey.startsWith("predicted") ||
    dataKey.startsWith("forecast")
  ) {
    return "solar";
  }
  if (dataKey.startsWith("price")) return "prices";
  if (
    dataKey.startsWith("grid") ||
    dataKey.startsWith("actualSiteLoad") ||
    dataKey.startsWith("expectedSiteLoad")
  ) {
    return "grid";
  }
  return null;
}

function CombinedTooltipDetailRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-slate-200">
        <TooltipMarker color={color} strokeDasharray={undefined} />
        {label}
      </span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function CombinedTooltipPlainRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-slate-200">
        <span aria-hidden="true" className="shrink-0" style={{ width: 18 }} />
        {label}
      </span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function StrategySourceIcon({
  source,
}: {
  source: NonNullable<BatteryHistoryPoint["strategySource"]>;
}) {
  const Icon = source === "manual" ? Hand : CalendarClock;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
}

function formatStrategyTooltipLabel(
  point: CombinedTooltipPoint | undefined,
): string | null {
  if (!point?.strategyDisplayState) return null;

  const itemLabel = point.strategyItemLabel?.trim() ?? "";
  if (itemLabel.length > 0) return itemLabel;

  const displayLabel = point.strategyDisplayLabel?.trim() ?? "";
  if (displayLabel.length > 0) return displayLabel;

  switch (point.strategyDisplayState) {
    case "self-consumption":
      return "Self-consumption";
    case "charge":
      return "Charge";
    case "discharge":
      return "Discharge";
    case "idle":
      return "Idle";
  }
}

function getStrategyTooltipColor(point: CombinedTooltipPoint | undefined) {
  switch (point?.strategyDisplayState) {
    case "charge":
      return UI_COLORS.strategyCharge;
    case "discharge":
      return UI_COLORS.strategyDischarge;
    case "idle":
      return UI_COLORS.strategyIdle;
    case "self-consumption":
      return UI_COLORS.strategySelfConsumption;
    default:
      return UI_COLORS.chartSeriesFallback;
  }
}

function formatTooltipLabel(key: string | undefined, value: number): string {
  if (key?.startsWith("batteryPower"))
    return value < 0
      ? "Battery Charging Power"
      : value > 0
        ? "Battery Discharging Power"
        : "Battery Power";
  if (key?.startsWith("batteryCharge")) return "Battery Charge";
  if (key?.startsWith("price")) return "Import Price";
  if (key?.startsWith("generated")) return "Generated Solar";
  if (key?.startsWith("predicted")) return "Predicted Solar";
  if (key?.startsWith("forecast")) return "Solar Forecast";
  if (key?.startsWith("grid"))
    return value < 0 ? "Grid Import Power" : "Grid Export Power";
  if (key?.startsWith("actualSiteLoad")) return "Inferred Site Load";
  if (key?.startsWith("expectedSiteLoad")) return "Expected Site Load";
  return "Value";
}

function formatTooltipValue(
  value: number,
  key: string | undefined,
  payload: unknown,
  priceCurrency: string,
  forecastUnitLabel: string,
): string {
  if (key?.startsWith("batteryCharge")) return formatPercentValue(value);
  if (key?.startsWith("price")) return formatPricePerKwh(value, priceCurrency);
  if (key?.startsWith("forecast"))
    return `${Math.round(value)} ${forecastUnitLabel}`;
  const totalWh = getTooltipRunningTotalWh(key, payload);
  const powerValue = formatAbsolutePowerValue(value);
  return totalWh === null
    ? powerValue
    : `${powerValue} • Total ${formatEnergyValue(totalWh)}`;
}

function getTooltipRunningTotalWh(
  key: string | undefined,
  payload: unknown,
): number | null {
  if (!payload || typeof payload !== "object") return null;
  if (key?.startsWith("generated"))
    return getNumericPayloadValue(payload, "generatedCumulativeWh");
  if (key?.startsWith("predicted"))
    return getNumericPayloadValue(payload, "predictedCumulativeWh");
  if (key?.startsWith("actualSiteLoad"))
    return getNumericPayloadValue(payload, "actualSiteLoadCumulativeWh");
  if (key?.startsWith("expectedSiteLoad"))
    return getNumericPayloadValue(payload, "expectedSiteLoadCumulativeWh");
  return null;
}

function getNumericPayloadValue(payload: unknown, key: string): number | null {
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function getSeriesIds(activeTypes: GraphType[]): string[] {
  return activeTypes.flatMap((type) => {
    if (type === "battery")
      return [SERIES_IDS.batteryPower, SERIES_IDS.batteryCharge];
    if (type === "solar")
      return [
        SERIES_IDS.solarForecast,
        SERIES_IDS.solarPredicted,
        SERIES_IDS.solarGenerated,
      ];
    if (type === "prices") return [SERIES_IDS.priceImport];
    return [
      SERIES_IDS.gridPower,
      SERIES_IDS.gridSiteLoad,
      SERIES_IDS.gridExpectedLoad,
    ];
  });
}

function getActiveAxisKinds(activeTypes: GraphType[]): AxisKind[] {
  const axes = new Set<AxisKind>();
  for (const type of activeTypes) {
    if (type === "battery") {
      axes.add("power");
      axes.add("charge");
    }
    if (type === "solar") {
      axes.add("power");
      axes.add("forecast");
    }
    if (type === "prices") axes.add("price");
    if (type === "grid") axes.add("power");
  }
  return [...axes];
}

function getPrimaryAxisKind(activeTypes: GraphType[]): AxisKind {
  if (activeTypes.length === 1 && activeTypes[0] === "prices") return "price";
  if (activeTypes.length === 1 && activeTypes[0] === "solar") return "forecast";
  return "power";
}

function getSecondaryAxisKind(
  axisKinds: AxisKind[],
  primaryAxis: AxisKind,
): AxisKind | null {
  return axisKinds.find((axisKind) => axisKind !== primaryAxis) ?? null;
}

function shouldMirrorRightAxis(activeTypes: GraphType[]): boolean {
  return (
    activeTypes.length === 1 &&
    (activeTypes[0] === "prices" || activeTypes[0] === "grid")
  );
}

function getMirrorAxisDataKey(axisKind: AxisKind): string {
  if (axisKind === "price") return "priceCurrentValue";
  if (axisKind === "charge") return "batteryChargeCurrentValue";
  if (axisKind === "forecast") return "forecastCurrentValue";
  return "gridCurrentValue";
}

function getAxisLabel(
  axisKind: AxisKind,
  priceCurrency: string,
  forecastUnitLabel: string,
): string {
  if (axisKind === "charge") return "Charge (%)";
  if (axisKind === "price") return `${priceCurrency}/kWh`;
  if (axisKind === "forecast") return forecastUnitLabel;
  return "Power (W)";
}

function getAxisFormatter(
  axisKind: AxisKind,
  priceCurrency: string,
): (value: number) => string {
  if (axisKind === "charge") return (value) => `${Math.round(value)}%`;
  if (axisKind === "price") return (value) => value.toFixed(3);
  if (axisKind === "forecast") return (value) => `${Math.round(value)}`;
  return formatShortPowerValue;
}

function buildSolarSurplusLabel(value: string, fill: string) {
  return {
    fill,
    fontSize: 11,
    position: "top" as const,
    value,
  };
}

function hasSeriesValue(
  point: Record<string, unknown>,
  seriesId: string,
): boolean {
  const prefixes: Record<string, string> = {
    [SERIES_IDS.batteryCharge]: "batteryCharge",
    [SERIES_IDS.batteryPower]: "batteryPower",
    [SERIES_IDS.gridExpectedLoad]: "expectedSiteLoad",
    [SERIES_IDS.gridPower]: "grid",
    [SERIES_IDS.gridSiteLoad]: "actualSiteLoad",
    [SERIES_IDS.priceImport]: "price",
    [SERIES_IDS.solarForecast]: "forecast",
    [SERIES_IDS.solarGenerated]: "generated",
    [SERIES_IDS.solarPredicted]: "predicted",
  };
  const prefix = prefixes[seriesId];
  return (
    typeof point[`${prefix}CurrentValue`] === "number" ||
    typeof point[`${prefix}FutureValue`] === "number"
  );
}

function DashedLegendMarker({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height="8"
      viewBox="0 0 18 8"
      width="18"
    >
      <line
        stroke={color}
        strokeDasharray="1 6"
        strokeLinecap="round"
        strokeWidth="2.8"
        x1="1.4"
        x2="16.6"
        y1="4"
        y2="4"
      />
    </svg>
  );
}

function EmptyChartMessage({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
      <p className="max-w-md text-sm leading-6 text-slate-400">{message}</p>
    </div>
  );
}
