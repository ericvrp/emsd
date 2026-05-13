"use client";

import type {
  HistoryArchive,
  WeatherForecastPointRecord,
  WeatherForecastRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core/client";
import {
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  applySolarSeriesSmoothing,
  buildSolarPredictionAccuracySummary,
  findSolarSurplusBoundsFromSeries,
  formatSolarPredictionSmoothingMode,
} from "@emsd/core/client";
import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { resolveRelativeDayParam } from "../lib/day-utils";
import { formatEnergyValue } from "../lib/energy-format";
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
  HISTORY_STEP_MS,
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
import { PageRefreshButton } from "./page-refresh-button";
import { RefreshWarning } from "./refresh-warning";
import type { SiteSnapshot } from "./settings-panel";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";
import { useChartSeriesVisibility } from "./use-chart-series-visibility";
import {
  type SolarCurrentResponse,
  type SolarGraphResponse,
  useLiveJsonSWR,
} from "./use-live-json-swr";

const LIVE_SOLAR_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;
const SOLAR_POWER_AXIS_MAX_W = 4_000;
const SOLAR_CHART_VISIBILITY_STORAGE_KEY =
  "emsd:chart-visibility:solar:forecast";
const GENERATED_SOLAR_SERIES_ID = "generated";
const PREDICTED_SOLAR_SERIES_ID = "predicted";
const FORECAST_SERIES_ID = "forecast";

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
  const params = new URLSearchParams({ siteId: site.id });
  const resolvedRequestedDay = resolveRelativeDayParam(requestedDay);

  if (resolvedRequestedDay) {
    params.set("day", resolvedRequestedDay);
  }

  const { data: graphData, refreshError: graphRefreshError } =
    useLiveJsonSWR<SolarGraphResponse>(
      `/api/solar/graph?${params.toString()}`,
      {
        failureMessage:
          "Solar graph updates are retrying. Showing last available data.",
        refreshIntervalMs: GRAPH_REFRESH_INTERVAL_MS,
        retryIntervalMs: LIVE_SOLAR_REFRESH_INTERVAL_MS,
      },
    );
  const { data: currentData, refreshError: currentRefreshError } =
    useLiveJsonSWR<SolarCurrentResponse>(
      `/api/solar/current?siteId=${encodeURIComponent(site.id)}`,
      {
        failureMessage:
          "Solar current updates are retrying. Showing last available data.",
        refreshIntervalMs: LIVE_SOLAR_REFRESH_INTERVAL_MS,
      },
    );
  const archive = graphData?.archive ?? initialArchive;
  const forecast = graphData?.forecast ?? initialForecast;
  const error = graphData?.forecastError ?? initialError;
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
  const generatedAccuracySeries = applySolarSeriesSmoothing(
    generatedSeries,
    DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  );
  const selectedDayPredictedSeries = fillSingleValueDay(
    archive.solarPredictedGeneration,
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
  const selectedDayExpectedSiteLoadSeries =
    archive.selectedDayExpectedSiteLoadSamples;
  const solarSurplusBounds = findSolarSurplusBoundsFromSeries({
    expectedLoadSeries: selectedDayExpectedSiteLoadSeries,
    fallbackEndTime: selectedDayPredictedSeries.at(-1)?.periodStart ?? null,
    predictedSeries: selectedDayPredictedSeries,
    selectedDayKey: daySelection.selectedDay,
  });
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
  const refreshError = graphRefreshError ?? currentRefreshError;
  const currentGeneratedPower = currentData
    ? typeof currentData.currentGeneratedPower === "number"
      ? currentData.currentGeneratedPower
      : null
    : (liveCurrentGeneratedPower ?? archiveCurrentGeneratedPower);

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
          <div className="rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3 text-right shadow-[0_18px_60px_rgba(0,0,0,0.2)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-100/80">
              Current generating
            </p>
            <p className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
              {getCurrentSolarGenerationDisplay(site, currentGeneratedPower)}
            </p>
          </div>
        </div>
      </div>

      {refreshError ? (
        <RefreshWarning
          action={<PageRefreshButton />}
          className="mt-5"
          message={refreshError}
        />
      ) : null}

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
          <ForecastPredictionChart
            emptyMessage={
              forecast === null
                ? "Forecast data is not available yet."
                : "No forecast data for this day."
            }
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
            predictionAccuracyPercentage={
              predictionAccuracySummary.overallAccuracyPercentage
            }
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
            solarSurplusEndPeriodStart={solarSurplusBounds.finalEndTime}
            solarSurplusStartPeriodStart={solarSurplusBounds.firstStartTime}
          />
        </div>
      )}
    </section>
  );
}

function ForecastPredictionChart({
  emptyMessage,
  forecastLabel,
  forecastPoints,
  forecastUnitLabel,
  generatedPoints,
  headerAccessory,
  nowMarkerPeriodStart,
  predictionAccuracyPercentage,
  predictedPoints,
  solarSurplusEndPeriodStart,
  solarSurplusStartPeriodStart,
}: {
  emptyMessage: string;
  forecastLabel: string;
  forecastPoints: SplitSingleValuePoint[];
  forecastUnitLabel: string;
  generatedPoints: SplitSingleValuePoint[];
  headerAccessory?: ReactNode;
  nowMarkerPeriodStart: string | null;
  predictionAccuracyPercentage: number | null;
  predictedPoints: SplitSingleValuePoint[];
  solarSurplusEndPeriodStart: string | null;
  solarSurplusStartPeriodStart: string | null;
}) {
  let generatedCumulativeWh = 0;
  let predictedCumulativeWh = 0;
  const chartData = forecastPoints.map((forecastPoint, index) => {
    const generatedPoint = generatedPoints[index];
    const predictedPoint = predictedPoints[index];

    if (typeof generatedPoint?.value === "number") {
      generatedCumulativeWh +=
        generatedPoint.value * (HISTORY_STEP_MS / (60 * 60 * 1_000));
    }

    if (typeof predictedPoint?.value === "number") {
      predictedCumulativeWh +=
        predictedPoint.value * (HISTORY_STEP_MS / (60 * 60 * 1_000));
    }

    return {
      forecastCurrentValue: forecastPoint.currentValue,
      forecastFutureValue: forecastPoint.futureValue,
      generatedCumulativeWh,
      generatedCurrentValue: generatedPoint?.currentValue ?? null,
      generatedFutureValue: generatedPoint?.futureValue ?? null,
      periodStart: forecastPoint.periodStart,
      predictedCumulativeWh,
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
  const { isVisible, toggle } = useChartSeriesVisibility({
    seriesIds: [
      GENERATED_SOLAR_SERIES_ID,
      PREDICTED_SOLAR_SERIES_ID,
      FORECAST_SERIES_ID,
    ],
    storageKey: SOLAR_CHART_VISIBILITY_STORAGE_KEY,
  });

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip
            color={UI_COLORS.solarEnergy}
            label={buildGeneratedSolarLegendLabel()}
            onClick={() => toggle(GENERATED_SOLAR_SERIES_ID)}
            selected={isVisible(GENERATED_SOLAR_SERIES_ID)}
          />
          <LegendChip
            color={UI_COLORS.solarEnergy}
            label={buildPredictedSolarLegendLabel({
              predictionAccuracyPercentage,
            })}
            marker={<PredictedSolarLegendMarker />}
            onClick={() => toggle(PREDICTED_SOLAR_SERIES_ID)}
            selected={isVisible(PREDICTED_SOLAR_SERIES_ID)}
          />
          <LegendChip
            color={UI_COLORS.forecast}
            label={forecastLabel}
            onClick={() => toggle(FORECAST_SERIES_ID)}
            selected={isVisible(FORECAST_SERIES_ID)}
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
                      formatter={(value, key, payload) =>
                        key?.startsWith("predicted") ||
                        key?.startsWith("generated")
                          ? formatPowerTooltipWithRunningTotal(
                              value,
                              key,
                              payload,
                            )
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
                {solarSurplusStartPeriodStart ? (
                  <ReferenceLine
                    label={buildSolarSurplusLabel(
                      "Surplus start",
                      UI_COLORS.success,
                    )}
                    stroke={UI_COLORS.success}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                    x={solarSurplusStartPeriodStart}
                    yAxisId="forecast"
                  />
                ) : null}
                {solarSurplusEndPeriodStart ? (
                  <ReferenceLine
                    label={buildSolarSurplusLabel(
                      "Surplus end",
                      UI_COLORS.solarPrediction,
                    )}
                    stroke={UI_COLORS.solarPrediction}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                    x={solarSurplusEndPeriodStart}
                    yAxisId="forecast"
                  />
                ) : null}
                {isVisible(FORECAST_SERIES_ID) ? (
                  <>
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
                  </>
                ) : null}
                {isVisible(GENERATED_SOLAR_SERIES_ID) ? (
                  <>
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
                  </>
                ) : null}
                {isVisible(PREDICTED_SOLAR_SERIES_ID) ? (
                  <>
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
                  </>
                ) : null}
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

function getCurrentSolarGenerationDisplay(
  site: SiteSnapshot,
  currentGeneratedPower: number | null,
): string {
  const hasDisabledProvider = site.devices.some(
    (device) =>
      device.kind === "solar-energy-provider" &&
      device.telemetry?.productionControlStatus === "disabled",
  );

  if (hasDisabledProvider) {
    return "Disabled";
  }

  return currentGeneratedPower === null
    ? "Unavailable"
    : formatAbsolutePowerValue(currentGeneratedPower);
}

function formatAccuracyPercentage(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`;
}

function buildPredictedSolarLegendLabel(input: {
  predictionAccuracyPercentage: number | null;
}): string {
  const parts = ["Predicted Solar Wattage"];

  const accuracyLabel = formatAccuracyPercentage(
    input.predictionAccuracyPercentage,
  );

  if (accuracyLabel !== null) {
    parts.push(`Accuracy ${accuracyLabel}`);
  }

  return parts.join(" • ");
}

function buildGeneratedSolarLegendLabel(): string {
  return "Generated Wattage";
}

function buildSolarSurplusLabel(value: string, fill: string) {
  return {
    fill,
    fontSize: 11,
    position: "top" as const,
    value,
  };
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

function formatPowerTooltipWithRunningTotal(
  value: number,
  key?: string,
  payload?: unknown,
): string {
  const totalWh = getForecastTooltipRunningTotalWh(key, payload);

  if (totalWh === null) {
    return formatPowerValue(value);
  }

  return `${formatPowerValue(value)} • Total ${formatEnergyValue(totalWh)}`;
}

function getForecastTooltipRunningTotalWh(
  key?: string,
  payload?: unknown,
): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (key?.startsWith("generated")) {
    const totalWh = (payload as { generatedCumulativeWh?: unknown })
      .generatedCumulativeWh;
    return typeof totalWh === "number" ? totalWh : null;
  }

  if (key?.startsWith("predicted")) {
    const totalWh = (payload as { predictedCumulativeWh?: unknown })
      .predictedCumulativeWh;
    return typeof totalWh === "number" ? totalWh : null;
  }

  return null;
}
