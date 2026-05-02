"use client";

import type { HistoryArchive } from "@emsd/core/client";
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
import {
  formatAbsolutePowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { UI_CHART_STYLES, UI_COLORS } from "../lib/ui-colors";
import {
  LEFT_Y_AXIS_WIDTH,
  RIGHT_Y_AXIS_WIDTH,
  STANDARD_LEFT_AXIS_MARGIN,
  STANDARD_RIGHT_AXIS_MARGIN,
} from "./history/constants";
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
import { PageRefreshButton } from "./page-refresh-button";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";
import { type SiteCurrentResponse, useLiveJsonSWR } from "./use-live-json-swr";
import { useChartSeriesVisibility } from "./use-chart-series-visibility";

type GridPageProps = {
  archive: HistoryArchive;
  requestedDay: string | null;
  siteId: string;
  siteName: string;
};

const LIVE_CURRENT_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;
const GRID_CHART_VISIBILITY_STORAGE_KEY = "emsd:chart-visibility:grid:overview";
const GRID_POWER_SERIES_ID = "grid-power";
const INFERRED_SITE_LOAD_SERIES_ID = "inferred-site-load";
const EXPECTED_SITE_LOAD_SERIES_ID = "expected-site-load";

export function GridPage({
  archive: initialArchive,
  requestedDay,
  siteId,
  siteName,
}: GridPageProps) {
  const requestedDayParam = requestedDay
    ? `&day=${encodeURIComponent(requestedDay)}`
    : "";
  const { data: archiveData, refreshError: graphRefreshError } =
    useLiveJsonSWR<HistoryArchive>(
      `/api/history/archive?siteId=${encodeURIComponent(siteId)}${requestedDayParam}`,
      {
        failureMessage:
          "Grid graph updates are retrying. Showing last available data.",
        refreshIntervalMs: GRAPH_REFRESH_INTERVAL_MS,
        retryIntervalMs: LIVE_CURRENT_REFRESH_INTERVAL_MS,
      },
    );
  const { data: currentData, refreshError: currentRefreshError } =
    useLiveJsonSWR<SiteCurrentResponse>(
      `/api/site/current?siteId=${encodeURIComponent(siteId)}`,
      {
        failureMessage:
          "Grid current updates are retrying. Showing last available data.",
        refreshIntervalMs: LIVE_CURRENT_REFRESH_INTERVAL_MS,
      },
    );
  const archive = archiveData ?? initialArchive;
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
  const refreshError = graphRefreshError ?? currentRefreshError;
  const currentGridPower = currentData
    ? (currentData.currentGridPowerW ?? null)
    : archiveCurrentGridPower;

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

      {refreshError ? (
        <RefreshWarning
          action={<PageRefreshButton />}
          className="mt-5"
          message={refreshError}
        />
      ) : null}

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
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
  const { isVisible, toggle } = useChartSeriesVisibility({
    seriesIds: [
      GRID_POWER_SERIES_ID,
      INFERRED_SITE_LOAD_SERIES_ID,
      EXPECTED_SITE_LOAD_SERIES_ID,
    ],
    storageKey: GRID_CHART_VISIBILITY_STORAGE_KEY,
  });

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip
            color={UI_COLORS.gridExport}
            label="Grid Power"
            onClick={() => toggle(GRID_POWER_SERIES_ID)}
            selected={isVisible(GRID_POWER_SERIES_ID)}
          />
          <LegendChip
            color={UI_COLORS.gridImport}
            label="Inferred Site Load"
            onClick={() => toggle(INFERRED_SITE_LOAD_SERIES_ID)}
            selected={isVisible(INFERRED_SITE_LOAD_SERIES_ID)}
          />
          <LegendChip
            color={UI_COLORS.solarPrediction}
            label="Expected Site Load"
            marker={<ExpectedLegendMarker />}
            onClick={() => toggle(EXPECTED_SITE_LOAD_SERIES_ID)}
            selected={isVisible(EXPECTED_SITE_LOAD_SERIES_ID)}
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
                  width={LEFT_Y_AXIS_WIDTH}
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
                  width={RIGHT_Y_AXIS_WIDTH}
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
                {isVisible(GRID_POWER_SERIES_ID) ? (
                  <>
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
                  </>
                ) : null}
                {isVisible(INFERRED_SITE_LOAD_SERIES_ID) ? (
                  <>
                    <Line
                      activeDot={false}
                      dataKey="actualSiteLoadCurrentValue"
                      dot={false}
                      isAnimationActive={false}
                      name="Inferred Site Load"
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
                      name="Inferred Site Load"
                      stroke={UI_COLORS.gridImport}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity={0.35}
                      strokeWidth={2.8}
                      type="monotone"
                      yAxisId="left"
                    />
                  </>
                ) : null}
                {isVisible(EXPECTED_SITE_LOAD_SERIES_ID) ? (
                  <>
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
                  </>
                ) : null}
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

  return "Inferred Site Load";
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
