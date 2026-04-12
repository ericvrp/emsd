"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  HistoryArchive,
  PredictedSolarGenerationPoint,
  WeatherForecastPointRecord,
  WeatherForecastRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatAbsolutePowerValue,
  formatPowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";
import { UI_CHART_STYLES, UI_COLORS } from "../lib/ui-colors";
import { MeasuredChartContainer } from "./measured-chart-container";
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
import { SectionSummaryCard } from "./section-summary-card";
import type { SiteSnapshot } from "./settings-panel";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

const LIVE_SOLAR_REFRESH_INTERVAL_MS = 5_000;

export function WeatherForecastSection({
  archive,
  site,
  forecast,
  predictedSolarGeneration,
  error,
  requestedDay,
  source,
}: {
  archive: HistoryArchive;
  site: SiteSnapshot;
  forecast: WeatherForecastRecord | null;
  predictedSolarGeneration: PredictedSolarGenerationPoint[];
  error: string | null;
  requestedDay: string | null;
  source: WeatherForecastSourceRecord | null;
}) {
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
  const selectedDayPredictedSeries = fillSingleValueDay(
    predictedSolarGeneration,
    daySelection.selectedDay,
  );
  const selectedDayGeneratedSeries = fillSingleValueDay(
    generatedSeries,
    daySelection.selectedDay,
  );
  const predictionAccuracySummary = buildSolarPredictionAccuracySummary({
    dayKey: daySelection.selectedDay,
    generatedSeries: selectedDayGeneratedSeries,
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

        if (!response.ok) {
          throw new Error(`Solar current request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          currentGeneratedPower?: number | null;
        };

        if (cancelled) {
          return;
        }

        setCurrentGeneratedPower(
          typeof payload.currentGeneratedPower === "number"
            ? payload.currentGeneratedPower
            : archiveCurrentGeneratedPower,
        );
      } catch {
        if (!cancelled) {
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

  useEffect(() => {
    console.table([
      {
        date: predictionAccuracySummary.date,
        scoringPercentage:
          formatAccuracyPercentage(
            predictionAccuracySummary.scoringPercentage,
          ) ?? "Unavailable",
        totalAbsoluteError: formatEnergyValue(
          predictionAccuracySummary.totalAbsoluteErrorWh,
        ),
        totalGeneratedEnergy: formatEnergyValue(
          predictionAccuracySummary.totalGeneratedWh,
        ),
        totalPredictedEnergy: formatEnergyValue(
          predictionAccuracySummary.totalPredictedWh,
        ),
        usedSamples: predictionAccuracySummary.usedSamples,
      },
    ]);
  }, [
    predictionAccuracySummary.date,
    predictionAccuracySummary.scoringPercentage,
    predictionAccuracySummary.totalAbsoluteErrorWh,
    predictionAccuracySummary.totalGeneratedWh,
    predictionAccuracySummary.totalPredictedWh,
    predictionAccuracySummary.usedSamples,
  ]);

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
        <SectionSummaryCard title="Current generating">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {currentGeneratedPower === null
              ? "Unavailable"
              : formatAbsolutePowerValue(currentGeneratedPower)}
          </p>
        </SectionSummaryCard>
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
          <ForecastPredictionChart
            emptyMessage={
              forecast === null
                ? "Forecast data is not available yet."
                : "No forecast data for this day."
            }
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
            predictionAccuracyPercentage={
              predictionAccuracySummary.scoringPercentage
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
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip color={UI_COLORS.solarEnergy} label="Generated Wattage" />
          <LegendChip
            color={UI_COLORS.solarPrediction}
            label={buildPredictedSolarLegendLabel({
              predictionAccuracyPercentage,
            })}
          />
          <LegendChip color={UI_COLORS.forecast} label={forecastLabel} />
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
                  stroke={UI_COLORS.solarPrediction}
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
                  stroke={UI_COLORS.solarPrediction}
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

function buildSolarPredictionAccuracySummary(input: {
  dayKey: string;
  generatedSeries: Array<{ periodStart: string; value: number | null }>;
  nowMarkerPeriodStart: string | null;
  predictedSeries: Array<{ periodStart: string; value: number | null }>;
}): {
  date: string;
  scoringPercentage: number | null;
  totalAbsoluteErrorWh: number;
  totalGeneratedWh: number;
  totalPredictedWh: number;
  usedSamples: number;
} {
  let totalAbsoluteError = 0;
  let totalGeneratedW = 0;
  let totalPredictedW = 0;
  let denominator = 0;
  let usedSamples = 0;
  const nowMarkerMs = input.nowMarkerPeriodStart
    ? new Date(input.nowMarkerPeriodStart).getTime()
    : null;

  for (let index = 0; index < input.predictedSeries.length; index += 1) {
    const predictedPoint = input.predictedSeries[index];
    const generatedPoint = input.generatedSeries[index];

    if (!predictedPoint || !generatedPoint) {
      continue;
    }

    const periodStartMs = new Date(predictedPoint.periodStart).getTime();

    if (
      nowMarkerMs !== null &&
      !Number.isNaN(periodStartMs) &&
      periodStartMs > nowMarkerMs
    ) {
      continue;
    }

    if (
      typeof predictedPoint.value !== "number" ||
      typeof generatedPoint.value !== "number"
    ) {
      continue;
    }

    totalPredictedW += predictedPoint.value;
    totalGeneratedW += generatedPoint.value;
    totalAbsoluteError += Math.abs(predictedPoint.value - generatedPoint.value);
    denominator += Math.max(predictedPoint.value, generatedPoint.value);
    usedSamples += 1;
  }

  const scoringPercentage =
    usedSamples === 0
      ? null
      : denominator === 0
        ? 100
        : Math.max(0, 100 * (1 - totalAbsoluteError / denominator));

  return {
    date: input.dayKey,
    scoringPercentage:
      scoringPercentage === null ? null : Number(scoringPercentage.toFixed(2)),
    totalAbsoluteErrorWh: convertWattSampleSumToWh(totalAbsoluteError),
    totalGeneratedWh: convertWattSampleSumToWh(totalGeneratedW),
    totalPredictedWh: convertWattSampleSumToWh(totalPredictedW),
    usedSamples,
  };
}

function convertWattSampleSumToWh(totalWattSamples: number): number {
  return Number((totalWattSamples * 0.25).toFixed(2));
}

function formatEnergyValue(valueWh: number): string {
  if (Math.abs(valueWh) > 999) {
    return `${(valueWh / 1000).toFixed(2)} kWh`;
  }

  return `${valueWh.toFixed(2)} Wh`;
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
    parts.push(accuracyLabel);
  }

  return parts.join(" • ");
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
