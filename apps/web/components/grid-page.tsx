"use client";

import type { HistoryArchive } from "@emsd/core/client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";
import {
  formatAbsolutePowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { UI_CHART_STYLES, UI_COLORS } from "../lib/ui-colors";
import {
  LegendChip,
  aggregatePowerSamples,
  buildMirroredYAxis,
  buildNowLabel,
  buildResponsiveDayTicks,
  buildYAxisLabel,
  fillSingleValueDay,
  invertSingleValueSeries,
  splitSingleValueSeriesByTime,
} from "./history";
import { HistoryTooltip } from "./history/tooltips";
import { MeasuredChartContainer } from "./measured-chart-container";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

type GridPageProps = {
  archive: HistoryArchive;
  requestedDay: string | null;
  siteId: string;
  siteName: string;
};

const LIVE_CURRENT_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;

export function GridPage({
  archive: initialArchive,
  requestedDay,
  siteId,
  siteName,
}: GridPageProps) {
  const [archive, setArchive] = useState(initialArchive);
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const gridSeries = invertSingleValueSeries(
    aggregatePowerSamples(archive.p1MeterSamples),
  );
  const selectedDayGridSeries = fillSingleValueDay(
    gridSeries,
    daySelection.selectedDay,
  );
  const selectedDaySiteLoadSeries = archive.selectedDaySiteLoadSamples;
  const selectedDayExpectedSiteLoadSeries =
    archive.selectedDayExpectedSiteLoadSamples;
  const archiveCurrentGridPower = getLatestValueAtOrBefore(
    gridSeries,
    new Date().toISOString(),
  );
  const [currentGridPower, setCurrentGridPower] = useState<number | null>(
    archiveCurrentGridPower,
  );
  const [graphRefreshError, setGraphRefreshError] = useState<string | null>(
    null,
  );
  const [currentRefreshError, setCurrentRefreshError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setCurrentGridPower(archiveCurrentGridPower);
  }, [archiveCurrentGridPower]);

  useEffect(() => {
    setArchive(initialArchive);
  }, [initialArchive]);

  useEffect(() => {
    let cancelled = false;

    async function refreshGraph() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/history/archive?siteId=${encodeURIComponent(siteId)}&day=${encodeURIComponent(daySelection.selectedDay)}`,
          { cache: "no-store" },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Grid graph request failed: ${response.status}`);
        }

        const payload = (await response.json()) as HistoryArchive;

        if (!cancelled) {
          setGraphRefreshError(null);
          setArchive(payload);
        }
      } catch {
        if (!cancelled) {
          setGraphRefreshError(
            "Grid graph updates paused. Showing last available data.",
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
  }, [daySelection.selectedDay, siteId]);

  useEffect(() => {
    let cancelled = false;

    async function refreshCurrentGrid() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/site/current?siteId=${encodeURIComponent(siteId)}`,
          { cache: "no-store" },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Grid current request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          currentGridPowerW?: number | null;
        };

        if (cancelled) {
          return;
        }

        setCurrentRefreshError(null);
        setCurrentGridPower(
          payload.currentGridPowerW ?? archiveCurrentGridPower,
        );
      } catch {
        if (!cancelled) {
          setCurrentRefreshError(
            "Grid current updates paused. Showing last available data.",
          );
          setCurrentGridPower(archiveCurrentGridPower);
        }
      }
    }

    void refreshCurrentGrid();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshCurrentGrid();
      }
    }

    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat("refresh current");
      void refreshCurrentGrid();
    }, LIVE_CURRENT_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [archiveCurrentGridPower, siteId]);

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            Grid
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            P1 values for {siteName}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Compare measured grid power with inferred and expected site load.
          </p>
        </div>
        <SectionSummaryCard title="Current grid">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {formatGridPower(currentGridPower)}
          </p>
        </SectionSummaryCard>
      </div>

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
        {graphRefreshError ? (
          <RefreshWarning message={graphRefreshError} />
        ) : null}
        {currentRefreshError ? (
          <RefreshWarning message={currentRefreshError} />
        ) : null}
        <GridOverviewChart
          actualSiteLoadPoints={splitSingleValueSeriesByTime(
            selectedDaySiteLoadSeries,
          )}
          emptyMessage="No grid or site load samples for this day."
          expectedSiteLoadPoints={splitSingleValueSeriesByTime(
            selectedDayExpectedSiteLoadSeries,
          )}
          headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
          gridPoints={splitSingleValueSeriesByTime(selectedDayGridSeries)}
          nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
          valueFormatter={formatAbsolutePowerValue}
          yAxisFormatter={formatShortPowerValue}
          yAxisLabel="Power"
        />
      </div>
    </section>
  );
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

function formatGridPower(value: number | null): string {
  if (value === null) return "Unavailable";

  if (Math.abs(value) <= 10) {
    return "Idle";
  }

  const isImporting = value < 0;
  const direction = isImporting ? "Importing" : "Exporting";
  const absoluteValue = Math.abs(value);

  return `${direction} ${formatAbsolutePowerValue(absoluteValue)}`;
}

function GridOverviewChart({
  actualSiteLoadPoints,
  emptyMessage,
  expectedSiteLoadPoints,
  gridPoints,
  headerAccessory,
  nowMarkerPeriodStart,
  valueFormatter,
  yAxisFormatter,
  yAxisLabel,
}: {
  actualSiteLoadPoints: ReturnType<typeof splitSingleValueSeriesByTime>;
  emptyMessage: string;
  expectedSiteLoadPoints: ReturnType<typeof splitSingleValueSeriesByTime>;
  gridPoints: ReturnType<typeof splitSingleValueSeriesByTime>;
  headerAccessory?: ReactNode;
  nowMarkerPeriodStart: string | null;
  valueFormatter: (value: number) => string;
  yAxisFormatter: (value: number) => string;
  yAxisLabel?: string;
}) {
  const chartData = gridPoints.map((gridPoint, index) => {
    const actualSiteLoadPoint = actualSiteLoadPoints[index];
    const expectedSiteLoadPoint = expectedSiteLoadPoints[index];

    return {
      actualSiteLoadCurrentValue: actualSiteLoadPoint?.currentValue ?? null,
      actualSiteLoadFutureValue: actualSiteLoadPoint?.futureValue ?? null,
      expectedSiteLoadCurrentValue: expectedSiteLoadPoint?.currentValue ?? null,
      expectedSiteLoadFutureValue: expectedSiteLoadPoint?.futureValue ?? null,
      gridCurrentValue: gridPoint.currentValue,
      gridFutureValue: gridPoint.futureValue,
      periodStart: gridPoint.periodStart,
    };
  });
  const hasValues = chartData.some(
    (point) =>
      typeof point.gridCurrentValue === "number" ||
      typeof point.gridFutureValue === "number" ||
      typeof point.actualSiteLoadCurrentValue === "number" ||
      typeof point.actualSiteLoadFutureValue === "number" ||
      typeof point.expectedSiteLoadCurrentValue === "number" ||
      typeof point.expectedSiteLoadFutureValue === "number",
  );
  const axisConfig = buildMirroredYAxis(
    chartData.flatMap((point) => [
      point.gridCurrentValue,
      point.gridFutureValue,
      point.actualSiteLoadCurrentValue,
      point.actualSiteLoadFutureValue,
      point.expectedSiteLoadCurrentValue,
      point.expectedSiteLoadFutureValue,
    ]),
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip color={UI_COLORS.gridExport} label="Grid Power" />
          <LegendChip color={UI_COLORS.gridImport} label="Measured Site Load" />
          <LegendChip
            color={UI_COLORS.solarPrediction}
            label="Expected Site Load"
            marker={<ExpectedLegendMarker />}
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
                margin={{ top: 12, right: 56, bottom: 0, left: 56 }}
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
                  tickFormatter={formatGridChartTime}
                  tickLine={false}
                  ticks={xAxisTicks}
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  label={buildYAxisLabel(yAxisLabel ?? "", "insideLeft")}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={56}
                  yAxisId="left"
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  orientation="right"
                  {...(yAxisLabel
                    ? { label: buildYAxisLabel(yAxisLabel, "right") }
                    : {})}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={56}
                  yAxisId="right"
                />
                <ReferenceLine
                  stroke={UI_COLORS.chartZeroLine}
                  strokeDasharray="4 6"
                  y={0}
                  yAxisId="left"
                />
                <Tooltip
                  content={
                    <HistoryTooltip
                      entryLabelFormatter={formatGridOverviewTooltipLabel}
                      formatter={valueFormatter}
                      labelFormatter={formatGridChartTooltipTime}
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
                    yAxisId="left"
                  />
                ) : null}
                <Line
                  activeDot={false}
                  dataKey="gridCurrentValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Grid Power"
                  stroke={UI_COLORS.gridExport}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  dataKey="gridFutureValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Grid Power"
                  stroke={UI_COLORS.gridExport}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  dataKey="actualSiteLoadCurrentValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Measured Site Load"
                  stroke={UI_COLORS.gridImport}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  dataKey="actualSiteLoadFutureValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Measured Site Load"
                  stroke={UI_COLORS.gridImport}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  dataKey="expectedSiteLoadCurrentValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Expected Site Load"
                  stroke={UI_COLORS.solarPrediction}
                  strokeDasharray="1 6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  dataKey="expectedSiteLoadFutureValue"
                  dot={false}
                  isAnimationActive={false}
                  name="Expected Site Load"
                  stroke={UI_COLORS.solarPrediction}
                  strokeDasharray="1 6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="left"
                />
              </LineChart>
            );
          }}
        </MeasuredChartContainer>
        {!hasValues ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="max-w-md text-sm leading-6 text-slate-400">
              {emptyMessage}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExpectedLegendMarker() {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height="8"
      viewBox="0 0 18 8"
      width="18"
    >
      <line
        stroke={UI_COLORS.solarPrediction}
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

function formatGridOverviewTooltipLabel(value: number, key?: string): string {
  if (key?.startsWith("grid")) {
    return value < 0 ? "Grid Import Power" : "Grid Export Power";
  }

  if (key?.startsWith("expectedSiteLoad")) {
    return "Expected Site Load";
  }

  return "Measured Site Load";
}

function formatGridChartTime(value: string | number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatGridChartTooltipTime(value: string | number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}
