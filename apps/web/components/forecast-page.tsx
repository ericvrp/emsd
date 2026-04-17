"use client";

import type {
  HistoryArchive,
  SolarEnergyProviderSampleRecord,
  SolarPredictionAlgorithmVersion,
  SolarForecastSampleRecord,
  WeatherForecastPointRecord,
  WeatherForecastRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core/client";
import {
  buildSolarPredictionAccuracySummary,
  buildPredictedSolarGenerationSeries,
} from "@emsd/core/client";
import { type ReactNode, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";
import {
  formatAbsolutePowerValue,
  formatPowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { UI_CHART_STYLES, UI_COLORS } from "../lib/ui-colors";
import {
  LegendChip,
  aggregatePowerSamples,
  fillSingleValueDay,
  splitSingleValueSeriesByTime,
} from "./history";
import {
  LEFT_Y_AXIS_WIDTH,
  RIGHT_Y_AXIS_WIDTH,
  STANDARD_LEFT_AXIS_MARGIN,
  STANDARD_RIGHT_AXIS_MARGIN,
} from "./history/constants";
import { HistoryTooltip } from "./history/tooltips";
import type { SplitSingleValuePoint } from "./history/types";
import {
  buildMirroredYAxis,
  buildNowLabel,
  buildResponsiveDayTicks,
  buildYAxisLabel,
  formatDayTick,
  formatTooltipTimestamp,
} from "./history/utils";
import { MeasuredChartContainer } from "./measured-chart-container";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import type { SiteSnapshot } from "./settings-panel";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

const LIVE_SOLAR_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;
const SOLAR_PREDICTION_BUCKET_MS = 15 * 60 * 1_000;
const SOLAR_POWER_AXIS_MAX_W = 4_000;

type SolarPredictionSmoothingMode =
  | "off"
  | "weighted-3"
  | "average-3"
  | "average-5"
  | "weighted-5";

const SOLAR_PREDICTION_SMOOTHING_MODES: SolarPredictionSmoothingMode[] = [
  "off",
  "weighted-3",
  "average-3",
  "average-5",
  "weighted-5",
];
const DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE: SolarPredictionSmoothingMode =
  "average-5";
const SOLAR_PREDICTION_ALGORITHM_VERSIONS: SolarPredictionAlgorithmVersion[] = [
  "v0",
  "v1",
  "v2",
];
const DEFAULT_SOLAR_PREDICTION_ALGORITHM_VERSION: SolarPredictionAlgorithmVersion =
  "v2";

export function WeatherForecastSection({
  archive: initialArchive,
  site,
  forecast: initialForecast,
  error: initialError,
  requestedDay,
  source,
}: {
  archive: HistoryArchive;
  site: SiteSnapshot;
  forecast: WeatherForecastRecord | null;
  error: string | null;
  requestedDay: string | null;
  source: WeatherForecastSourceRecord | null;
}) {
  const [archive, setArchive] = useState(initialArchive);
  const [forecast, setForecast] = useState(initialForecast);
  const [error, setError] = useState(initialError);
  const [graphRefreshError, setGraphRefreshError] = useState<string | null>(
    null,
  );
  const [currentRefreshError, setCurrentRefreshError] = useState<string | null>(
    null,
  );
  const [
    generatedAccuracyFilteringEnabled,
    setGeneratedAccuracyFilteringEnabled,
  ] = useState(true);
  const [predictionSmoothingMode, setPredictionSmoothingMode] =
    useState<SolarPredictionSmoothingMode>(
      DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
    );
  const [predictionAlgorithmVersion, setPredictionAlgorithmVersion] =
    useState<SolarPredictionAlgorithmVersion>(
      DEFAULT_SOLAR_PREDICTION_ALGORITHM_VERSION,
    );
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const selectedDayForecastSeries = fillSingleValueDay(
    archive.solarForecastSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.value,
    })),
    daySelection.selectedDay,
  );
  const generatedSeries = aggregatePowerSamples(
    archive.solarEnergyProviderSamples,
  );
  const generatedAccuracySeries = generatedAccuracyFilteringEnabled
    ? applySolarSeriesSmoothing(generatedSeries, predictionSmoothingMode)
    : generatedSeries;
  const predictedSolarGeneration = buildPredictedSolarGenerationSeries({
    algorithmVersion: predictionAlgorithmVersion,
    forecastSamples: archive.solarForecastSamples,
    solarEnergyProviderSamples: archive.solarEnergyProviderSamples,
  });
  const selectedDayPredictedSeries = fillSingleValueDay(
    predictedSolarGeneration,
    daySelection.selectedDay,
  );
  const selectedDayGeneratedSeries = fillSingleValueDay(
    generatedSeries,
    daySelection.selectedDay,
  );
  const selectedDayGeneratedAccuracySeries = fillSingleValueDay(
    generatedAccuracySeries,
    daySelection.selectedDay,
  );
  const predictionAccuracySummary = buildSolarPredictionAccuracySummary({
    generatedSeries: selectedDayGeneratedAccuracySeries,
    predictedSeries: selectedDayPredictedSeries,
    nowMarkerPeriodStart: daySelection.nowMarkerPeriodStart,
  });
  const archiveCurrentGeneratedPower = getLatestValueAtOrBefore(
    generatedSeries,
    new Date().toISOString(),
  );
  const liveCurrentGeneratedPower = getCurrentSolarPower(site);
  const [currentGeneratedPower, setCurrentGeneratedPower] = useState<
    number | null
  >(liveCurrentGeneratedPower ?? archiveCurrentGeneratedPower);

  useEffect(() => {
    setArchive(initialArchive);
    setForecast(initialForecast);
    setError(initialError);
  }, [initialArchive, initialError, initialForecast]);

  useEffect(() => {
    let cancelled = false;

    async function refreshGraph() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/solar/graph?siteId=${encodeURIComponent(site.id)}`,
          {
            cache: "no-store",
          },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Solar graph request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          archive: HistoryArchive;
          forecast: WeatherForecastRecord | null;
          forecastError: string | null;
        };

        if (!cancelled) {
          setGraphRefreshError(null);
          setArchive(payload.archive);
          setForecast(payload.forecast);
          setError(payload.forecastError);
        }
      } catch {
        if (!cancelled) {
          setGraphRefreshError(
            "Solar graph updates paused. Showing last available data.",
          );
        }
      }
    }

    void refreshGraph();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshGraph();
      }
    }

    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat("refresh graph");
      void refreshGraph();
    }, GRAPH_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [site.id]);

  useEffect(() => {
    setCurrentGeneratedPower(
      liveCurrentGeneratedPower ?? archiveCurrentGeneratedPower,
    );
  }, [archiveCurrentGeneratedPower, liveCurrentGeneratedPower]);

  useEffect(() => {
    let cancelled = false;

    async function refreshCurrentGeneratedPower() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/solar/current?siteId=${encodeURIComponent(site.id)}`,
          {
            cache: "no-store",
          },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Solar current request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          currentGeneratedPower?: number | null;
        };

        if (cancelled) {
          return;
        }

        setCurrentRefreshError(null);
        setCurrentGeneratedPower(
          typeof payload.currentGeneratedPower === "number"
            ? payload.currentGeneratedPower
            : archiveCurrentGeneratedPower,
        );
      } catch {
        if (!cancelled) {
          setCurrentRefreshError(
            "Solar current updates paused. Showing last available data.",
          );
          setCurrentGeneratedPower(archiveCurrentGeneratedPower);
        }
      }
    }

    void refreshCurrentGeneratedPower();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshCurrentGeneratedPower();
      }
    }

    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat("refresh current");
      void refreshCurrentGeneratedPower();
    }, LIVE_SOLAR_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [archiveCurrentGeneratedPower, site.id]);

  function handleCyclePredictionSmoothing() {
    const nextMode = getNextSolarPredictionSmoothingMode(
      predictionSmoothingMode,
    );
    setPredictionSmoothingMode(nextMode);
    toast.success(
      `Predicted solar smoothing set to ${formatSolarPredictionSmoothingMode(nextMode)}.`,
    );
  }

  function handleToggleGeneratedAccuracyFiltering() {
    const nextEnabled = !generatedAccuracyFilteringEnabled;
    setGeneratedAccuracyFilteringEnabled(nextEnabled);
    toast.success(
      nextEnabled
        ? `Generated wattage accuracy filtering enabled with ${formatSolarPredictionSmoothingMode(predictionSmoothingMode)}.`
        : "Generated wattage accuracy filtering disabled.",
    );
  }

  function handleCyclePredictionAlgorithm() {
    const nextVersion = getNextSolarPredictionAlgorithmVersion(
      predictionAlgorithmVersion,
    );
    setPredictionAlgorithmVersion(nextVersion);
    toast.success(
      `Solar prediction algorithm set to ${formatSolarPredictionAlgorithmVersion(nextVersion)}.`,
    );
  }

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/40 to-transparent" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300/90">
            Solar
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            Solar generation and forecast for {site.name}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Compare measured, predicted, and forecast solar output.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <SectionSummaryCard title="Energy accuracy">
            <p className="text-2xl font-semibold text-white sm:text-3xl">
              {formatEnergyAccuracyHeadline(predictionAccuracySummary)}
            </p>
            <p className="mt-2 text-xs text-amber-100/80">
              {formatEnergyValue(predictionAccuracySummary.totalGeneratedWh)} actual
            </p>
          </SectionSummaryCard>
          <SectionSummaryCard title="Timing accuracy">
            <p className="text-2xl font-semibold text-white sm:text-3xl">
              {formatAccuracyPercentage(
                predictionAccuracySummary.timingAccuracyPercentage,
              ) ?? "Unavailable"}
            </p>
            <p className="mt-2 text-xs text-amber-100/80">
              {formatEnergyDeltaValue(predictionAccuracySummary.energyDeltaWh)} difference
            </p>
          </SectionSummaryCard>
          <SectionSummaryCard title="Current generating">
            <p className="text-2xl font-semibold text-white sm:text-3xl">
              {currentGeneratedPower === null
                ? "Unavailable"
                : formatAbsolutePowerValue(currentGeneratedPower)}
            </p>
          </SectionSummaryCard>
        </div>
      </div>

      {site.location.trim().length === 0 ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          Add a GPS location on the Site tab to load a solar forecast.
        </p>
      ) : source === null ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Save the site once to create the built-in forecast source.
        </p>
      ) : error ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </p>
      ) : (
        <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          {graphRefreshError ? (
            <RefreshWarning message={graphRefreshError} />
          ) : null}
          {currentRefreshError ? (
            <RefreshWarning message={currentRefreshError} />
          ) : null}
          <ForecastPredictionChart
            emptyMessage={
              forecast === null
                ? "Forecast data is not available yet."
                : "No forecast data for this day."
            }
            generatedAccuracyFilteringEnabled={
              generatedAccuracyFilteringEnabled
            }
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
            onToggleGeneratedAccuracyFiltering={
              handleToggleGeneratedAccuracyFiltering
            }
            onCyclePredictionSmoothing={handleCyclePredictionSmoothing}
            predictionAccuracyPercentage={
              predictionAccuracySummary.overallAccuracyPercentage
            }
            predictionSmoothingMode={predictionSmoothingMode}
            predictionAlgorithmVersion={predictionAlgorithmVersion}
            onCyclePredictionAlgorithm={handleCyclePredictionAlgorithm}
            forecastLabel={forecast?.metricLabel ?? "Solar Forecast"}
            forecastPoints={splitSingleValueSeriesByTime(
              selectedDayForecastSeries,
            )}
            forecastUnitLabel={forecast?.unitLabel ?? "W/m²"}
            generatedPoints={splitSingleValueSeriesByTime(
              selectedDayGeneratedSeries,
            )}
            predictedPoints={splitSingleValueSeriesByTime(
              selectedDayPredictedSeries,
            )}
          />
        </div>
      )}
    </section>
  );
}

function ForecastPredictionChart({
  emptyMessage,
  generatedAccuracyFilteringEnabled,
  forecastLabel,
  forecastPoints,
  forecastUnitLabel,
  generatedPoints,
  headerAccessory,
  nowMarkerPeriodStart,
  onToggleGeneratedAccuracyFiltering,
  onCyclePredictionSmoothing,
  predictionAccuracyPercentage,
  predictionSmoothingMode,
  predictionAlgorithmVersion,
  onCyclePredictionAlgorithm,
  predictedPoints,
}: {
  emptyMessage: string;
  generatedAccuracyFilteringEnabled: boolean;
  forecastLabel: string;
  forecastPoints: SplitSingleValuePoint[];
  forecastUnitLabel: string;
  generatedPoints: SplitSingleValuePoint[];
  headerAccessory?: ReactNode;
  nowMarkerPeriodStart: string | null;
  onToggleGeneratedAccuracyFiltering: () => void;
  onCyclePredictionSmoothing: () => void;
  predictionAccuracyPercentage: number | null;
  predictionSmoothingMode: SolarPredictionSmoothingMode;
  predictionAlgorithmVersion: SolarPredictionAlgorithmVersion;
  onCyclePredictionAlgorithm: () => void;
  predictedPoints: SplitSingleValuePoint[];
}) {
  const chartData = forecastPoints.map((forecastPoint, index) => {
    const generatedPoint = generatedPoints[index];
    const predictedPoint = predictedPoints[index];
    return {
      forecastCurrentValue: forecastPoint.currentValue,
      forecastFutureValue: forecastPoint.futureValue,
      generatedCurrentValue: generatedPoint?.currentValue ?? null,
      generatedFutureValue: generatedPoint?.futureValue ?? null,
      periodStart: forecastPoint.periodStart,
      predictedCurrentValue: predictedPoint?.currentValue ?? null,
      predictedFutureValue: predictedPoint?.futureValue ?? null,
    };
  });
  const hasValues = chartData.some(
    (point) =>
      typeof point.forecastCurrentValue === "number" ||
      typeof point.forecastFutureValue === "number" ||
      typeof point.generatedCurrentValue === "number" ||
      typeof point.generatedFutureValue === "number" ||
      typeof point.predictedCurrentValue === "number" ||
      typeof point.predictedFutureValue === "number",
  );
  const forecastAxis = buildMirroredYAxis(
    chartData.flatMap((point) => [
      point.forecastCurrentValue,
      point.forecastFutureValue,
    ]),
  );
  const predictedAxis = buildMirroredYAxis(
    chartData.flatMap((point) => [
      point.generatedCurrentValue,
      point.generatedFutureValue,
      point.predictedCurrentValue,
      point.predictedFutureValue,
    ]),
    [0, SOLAR_POWER_AXIS_MAX_W],
  );

  const forecastLegendLabel = `${forecastLabel} (${formatSolarPredictionAlgorithmVersion(predictionAlgorithmVersion)})`;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip
            color={UI_COLORS.solarEnergy}
            label={buildGeneratedSolarLegendLabel({
              generatedAccuracyFilteringEnabled,
              predictionSmoothingMode,
            })}
            onClick={onToggleGeneratedAccuracyFiltering}
            selected={generatedAccuracyFilteringEnabled}
          />
          <LegendChip
            color={UI_COLORS.solarEnergy}
            label={buildPredictedSolarLegendLabel({
              predictionAccuracyPercentage,
              predictionSmoothingMode,
            })}
            marker={<PredictedSolarLegendMarker />}
            onClick={onCyclePredictionSmoothing}
          />
          <LegendChip
            color={UI_COLORS.forecast}
            label={forecastLegendLabel}
            onClick={onCyclePredictionAlgorithm}
            selected
          />
        </div>
        {headerAccessory}
      </div>
      <div className="relative">
        <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
          {({ height, width }) => {
            const xAxisTicks = buildResponsiveDayTicks(
              chartData.map((point) => point.periodStart),
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
                  dataKey="periodStart"
                  interval={0}
                  minTickGap={28}
                  tick={UI_CHART_STYLES.axisTick}
                  tickFormatter={formatDayTick}
                  tickLine={false}
                  ticks={xAxisTicks}
                />
                <YAxis
                  axisLine={false}
                  domain={forecastAxis.domain}
                  label={buildYAxisLabel(forecastUnitLabel, "insideLeft")}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={formatShortForecastAxisValue}
                  tickLine={false}
                  tickMargin={8}
                  ticks={forecastAxis.ticks}
                  width={LEFT_Y_AXIS_WIDTH}
                  yAxisId="forecast"
                />
                <YAxis
                  axisLine={false}
                  domain={predictedAxis.domain}
                  label={buildYAxisLabel("Power (W)", "right")}
                  orientation="right"
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={formatShortPowerValue}
                  tickLine={false}
                  tickMargin={8}
                  ticks={predictedAxis.ticks}
                  width={RIGHT_Y_AXIS_WIDTH}
                  yAxisId="predicted"
                />
                <Tooltip
                  content={
                    <HistoryTooltip
                      entryLabelFormatter={formatForecastTooltipLabel}
                      formatter={(value, key) =>
                        key?.startsWith("predicted") ||
                        key?.startsWith("generated")
                          ? formatPowerValue(value)
                          : formatForecastValue(value, forecastUnitLabel)
                      }
                      labelFormatter={formatTooltipTimestamp}
                    />
                  }
                />
                {nowMarkerPeriodStart ? (
                  <ReferenceLine
                    label={buildNowLabel()}
                    stroke={UI_COLORS.textPrimary}
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                    x={nowMarkerPeriodStart}
                    yAxisId="forecast"
                  />
                ) : null}
                <Line
                  activeDot={false}
                  dataKey="forecastCurrentValue"
                  dot={false}
                  isAnimationActive={false}
                  name={forecastLabel}
                  stroke={UI_COLORS.forecast}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="forecast"
                />
                <Line
                  activeDot={false}
                  dataKey="forecastFutureValue"
                  dot={false}
                  isAnimationActive={false}
                  name={forecastLabel}
                  stroke={UI_COLORS.forecast}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="forecast"
                />
                <Line
                  activeDot={false}
                  dataKey="generatedCurrentValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Generated Wattage"
                  stroke={UI_COLORS.solarEnergy}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="predicted"
                />
                <Line
                  activeDot={false}
                  dataKey="generatedFutureValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Generated Wattage"
                  stroke={UI_COLORS.solarEnergy}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="predicted"
                />
                <Line
                  activeDot={false}
                  dataKey="predictedCurrentValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Predicted Solar Wattage"
                  stroke={UI_COLORS.solarEnergy}
                  strokeDasharray="1 6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="predicted"
                />
                <Line
                  activeDot={false}
                  dataKey="predictedFutureValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Predicted Solar Wattage"
                  stroke={UI_COLORS.solarEnergy}
                  strokeDasharray="1 6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="predicted"
                />
              </LineChart>
            );
          }}
        </MeasuredChartContainer>
        {!hasValues ? <EmptyChartMessage message={emptyMessage} /> : null}
      </div>
    </div>
  );
}

function EmptyChartMessage({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
      <p className="max-w-md text-sm leading-6 text-slate-400">{message}</p>
    </div>
  );
}

function getCurrentForecastPoint(
  points: WeatherForecastPointRecord[],
  now: number,
): WeatherForecastPointRecord | null {
  for (const point of points) {
    if (new Date(point.periodEnd).getTime() >= now) {
      return point;
    }
  }

  return points[points.length - 1] ?? null;
}

function getLatestValueAtOrBefore(
  points: Array<{ periodStart: string; value: number | null }>,
  periodStart: string,
): number | null {
  const periodStartMs = new Date(periodStart).getTime();

  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];

    if (!point || new Date(point.periodStart).getTime() > periodStartMs) {
      continue;
    }

    if (typeof point.value === "number") {
      return point.value;
    }
  }

  return null;
}

function getCurrentSolarPower(site: SiteSnapshot): number | null {
  return site.devices
    .filter((device) => device.kind === "solar-energy-provider")
    .reduce<number | null>((total, device) => {
      const powerW = device.telemetry?.powerW;

      if (typeof powerW !== "number") {
        return total;
      }

      return total === null ? powerW : total + powerW;
    }, null);
}

function applySolarSeriesSmoothing(
  series: Array<{ periodStart: string; value: number | null }>,
  smoothingMode: SolarPredictionSmoothingMode,
): Array<{ periodStart: string; value: number | null }> {
  const smoothingWeights = getSolarPredictionSmoothingWeights(smoothingMode);

  if (smoothingWeights === null) {
    return series;
  }

  return series.map((point, index) => ({
    periodStart: point.periodStart,
    value: buildWeightedPredictionValue(series, index, smoothingWeights),
  }));
}

function buildWeightedPredictionValue(
  series: Array<{ periodStart: string; value: number | null }>,
  index: number,
  smoothingWeights: Array<{ offset: number; weight: number }>,
): number | null {
  const referencePoint = series[index];

  if (!referencePoint) {
    return null;
  }

  let weightedTotal = 0;
  let totalWeight = 0;

  for (const weightedPoint of smoothingWeights) {
    const candidateIndex = index + weightedPoint.offset;
    const candidate = series[candidateIndex];

    if (!candidate || typeof candidate.value !== "number") {
      continue;
    }

    if (
      weightedPoint.offset !== 0 &&
      !isAdjacentPredictionBucket(
        referencePoint,
        candidate,
        weightedPoint.offset,
      )
    ) {
      continue;
    }

    weightedTotal += candidate.value * weightedPoint.weight;
    totalWeight += weightedPoint.weight;
  }

  if (totalWeight === 0) {
    return null;
  }

  return weightedTotal / totalWeight;
}

function getSolarPredictionSmoothingWeights(
  smoothingMode: SolarPredictionSmoothingMode,
): Array<{ offset: number; weight: number }> | null {
  switch (smoothingMode) {
    case "off":
      return null;
    case "weighted-3":
      return [
        { offset: -1, weight: 0.25 },
        { offset: 0, weight: 0.5 },
        { offset: 1, weight: 0.25 },
      ];
    case "average-3":
      return [
        { offset: -1, weight: 1 / 3 },
        { offset: 0, weight: 1 / 3 },
        { offset: 1, weight: 1 / 3 },
      ];
    case "average-5":
      return [
        { offset: -2, weight: 0.2 },
        { offset: -1, weight: 0.2 },
        { offset: 0, weight: 0.2 },
        { offset: 1, weight: 0.2 },
        { offset: 2, weight: 0.2 },
      ];
    case "weighted-5":
      return [
        { offset: -2, weight: 0.125 },
        { offset: -1, weight: 0.125 },
        { offset: 0, weight: 0.5 },
        { offset: 1, weight: 0.125 },
        { offset: 2, weight: 0.125 },
      ];
  }
}

function isAdjacentPredictionBucket(
  referencePoint: { periodStart: string; value: number | null },
  candidatePoint: { periodStart: string; value: number | null },
  offset: number,
): boolean {
  const referenceTimestampMs = new Date(referencePoint.periodStart).getTime();
  const candidateTimestampMs = new Date(candidatePoint.periodStart).getTime();

  if (
    Number.isNaN(referenceTimestampMs) ||
    Number.isNaN(candidateTimestampMs)
  ) {
    return false;
  }

  return (
    candidateTimestampMs - referenceTimestampMs ===
    offset * SOLAR_PREDICTION_BUCKET_MS
  );
}

function formatEnergyValue(valueWh: number): string {
  if (Math.abs(valueWh) > 999) {
    return `${(valueWh / 1000).toFixed(2)} kWh`;
  }

  return `${valueWh.toFixed(2)} Wh`;
}

function formatEnergyDeltaValue(valueWh: number): string {
  return `${formatEnergyValue(valueWh)}`;
}

function formatAccuracyPercentage(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`;
}

function formatEnergyAccuracyHeadline(input: {
  energyAccuracyPercentage: number | null;
  totalGeneratedWh: number;
  totalPredictedWh: number;
}): string {
  const accuracyLabel = formatAccuracyPercentage(input.energyAccuracyPercentage);

  if (accuracyLabel === null) {
    return "Unavailable";
  }

  return `${formatEnergyValue(input.totalPredictedWh)} vs ${formatEnergyValue(input.totalGeneratedWh)} (${accuracyLabel})`;
}

function buildPredictedSolarLegendLabel(input: {
  predictionAccuracyPercentage: number | null;
  predictionSmoothingMode: SolarPredictionSmoothingMode;
}): string {
  const parts = [
    `Predicted Solar Wattage (${formatSolarPredictionSmoothingMode(input.predictionSmoothingMode)})`,
  ];

  const accuracyLabel = formatAccuracyPercentage(
    input.predictionAccuracyPercentage,
  );

  if (accuracyLabel !== null) {
    parts.push(`Accuracy ${accuracyLabel}`);
  }

  return parts.join(" • ");
}

function buildGeneratedSolarLegendLabel(input: {
  generatedAccuracyFilteringEnabled: boolean;
  predictionSmoothingMode: SolarPredictionSmoothingMode;
}): string {
  if (!input.generatedAccuracyFilteringEnabled) {
    return "Generated Wattage (Accuracy uses raw samples)";
  }

  return `Generated Wattage (Accuracy uses ${formatSolarPredictionSmoothingMode(input.predictionSmoothingMode)})`;
}

function PredictedSolarLegendMarker() {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height="8"
      viewBox="0 0 18 8"
      width="18"
    >
      <line
        stroke={UI_COLORS.solarEnergy}
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

function formatSolarPredictionSmoothingMode(
  mode: SolarPredictionSmoothingMode,
): string {
  switch (mode) {
    case "off":
      return "No filter";
    case "weighted-3":
      return "25-50-25 filtering";
    case "average-3":
      return "Three-sample average";
    case "average-5":
      return "Five-sample average";
    case "weighted-5":
      return "Five-sample weighted average";
  }
}

function formatSolarPredictionAlgorithmVersion(
  version: SolarPredictionAlgorithmVersion,
): string {
  switch (version) {
    case "v0":
      return "v0 legacy";
    case "v1":
      return "v1 trimmed";
    case "v2":
      return "v2 winsorized";
  }
}

function getNextSolarPredictionAlgorithmVersion(
  currentVersion: SolarPredictionAlgorithmVersion,
): SolarPredictionAlgorithmVersion {
  const currentIndex = SOLAR_PREDICTION_ALGORITHM_VERSIONS.indexOf(
    currentVersion,
  );
  const nextIndex =
    (currentIndex + 1) % SOLAR_PREDICTION_ALGORITHM_VERSIONS.length;
  return SOLAR_PREDICTION_ALGORITHM_VERSIONS[nextIndex] ?? currentVersion;
}

function getNextSolarPredictionSmoothingMode(
  currentMode: SolarPredictionSmoothingMode,
): SolarPredictionSmoothingMode {
  const currentIndex = SOLAR_PREDICTION_SMOOTHING_MODES.indexOf(currentMode);
  const nextIndex =
    (currentIndex + 1) % SOLAR_PREDICTION_SMOOTHING_MODES.length;
  return SOLAR_PREDICTION_SMOOTHING_MODES[nextIndex] ?? currentMode;
}

function formatForecastSummaryValue(value: number, unitLabel: string): string {
  return `${Math.round(value)} ${unitLabel}`;
}

function formatForecastValue(value: number, unitLabel: string): string {
  return `${Math.round(value)} ${unitLabel}`;
}

function formatShortForecastAxisValue(value: number): string {
  return `${Math.round(value)}`;
}

function formatForecastTooltipLabel(_: number, key?: string): string {
  if (key?.startsWith("generated")) {
    return "Generated Wattage";
  }

  if (key?.startsWith("predicted")) {
    return "Predicted Solar Wattage";
  }

  return "Solar Forecast";
}
