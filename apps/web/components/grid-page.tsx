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
import {
  computeExportPrice,
  formatCurrencyAmount,
  getActivePricePointAtOrBefore,
} from "../lib/price-format";
import { UI_CHART_STYLES, UI_COLORS } from "../lib/ui-colors";
import {
  LegendChip,
  aggregatePowerSamples,
  buildMirroredYAxis,
  buildNowLabel,
  buildResponsiveDayTicks,
  buildYAxisLabel,
  fillSingleValueDay,
  formatDayTick,
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
import { TooltipCard, TooltipMarker, TooltipRow } from "./history/tooltips";
import type { TooltipPayloadEntry } from "./history/types";
import {
  deduplicateTooltipEntries,
  formatTooltipTimestamp,
} from "./history/utils";
import { MeasuredChartContainer } from "./measured-chart-container";
import { PageRefreshButton } from "./page-refresh-button";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";
import { useChartSeriesVisibility } from "./use-chart-series-visibility";
import { type SiteCurrentResponse, useLiveJsonSWR } from "./use-live-json-swr";

type GridPageProps = {
  archive: HistoryArchive;
  exportDeduction?: number;
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
  exportDeduction,
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
  const importPriceSamples = archive.dynamicPriceSamples.map((sample) => ({
    periodStart: sample.periodStart,
    value: sample.importPrice,
  }));
  const archiveCurrentGridPower = getLatestValueAtOrBefore(
    gridSeries,
    new Date().toISOString(),
  );
  const refreshError = graphRefreshError ?? currentRefreshError;
  const currentGridPower = currentData
    ? (currentData.currentGridPowerW ?? null)
    : archiveCurrentGridPower;
  const priceCurrency = archive.dynamicPriceSamples[0]?.currency ?? "EUR";

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
          importPricePoints={importPriceSamples}
          nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
          priceCurrency={priceCurrency}
          valueFormatter={formatAbsolutePowerValue}
          yAxisFormatter={formatShortPowerValue}
          yAxisLabel="Power"
          {...(typeof exportDeduction === "number" ? { exportDeduction } : {})}
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
  exportDeduction,
  gridPoints,
  headerAccessory,
  importPricePoints,
  nowMarkerPeriodStart,
  priceCurrency,
  valueFormatter,
  yAxisFormatter,
  yAxisLabel,
}: {
  actualSiteLoadPoints: ReturnType<typeof splitSingleValueSeriesByTime>;
  emptyMessage: string;
  expectedSiteLoadPoints: ReturnType<typeof splitSingleValueSeriesByTime>;
  exportDeduction?: number;
  gridPoints: ReturnType<typeof splitSingleValueSeriesByTime>;
  headerAccessory?: ReactNode;
  importPricePoints: Array<{ periodStart: string; value: number | null }>;
  nowMarkerPeriodStart: string | null;
  priceCurrency: string;
  valueFormatter: (value: number) => string;
  yAxisFormatter: (value: number) => string;
  yAxisLabel?: string;
}) {
  let cumulativeImportCost = 0;
  let cumulativeExportEarnings = 0;
  const chartData = gridPoints.map((gridPoint, index) => {
    const actualSiteLoadPoint = actualSiteLoadPoints[index];
    const expectedSiteLoadPoint = expectedSiteLoadPoints[index];
    const importPrice =
      getActivePricePointAtOrBefore(importPricePoints, gridPoint.periodStart)
        ?.value ?? null;

    if (
      typeof gridPoint.value === "number" &&
      typeof importPrice === "number"
    ) {
      const energyKwh =
        (Math.abs(gridPoint.value) * (HISTORY_STEP_MS / (60 * 60 * 1_000))) /
        1_000;

      if (gridPoint.value < 0) {
        cumulativeImportCost += energyKwh * importPrice;
      } else {
        cumulativeExportEarnings +=
          energyKwh * computeExportPrice(importPrice, exportDeduction);
      }
    }

    return {
      actualSiteLoadCurrentValue: actualSiteLoadPoint?.currentValue ?? null,
      actualSiteLoadFutureValue: actualSiteLoadPoint?.futureValue ?? null,
      cumulativeExportEarnings,
      cumulativeImportCost,
      cumulativeNetCost: cumulativeImportCost - cumulativeExportEarnings,
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
                  tickFormatter={formatDayTick}
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
                    <GridOverviewTooltip
                      entryLabelFormatter={formatGridOverviewTooltipLabel}
                      formatter={valueFormatter}
                      priceCurrency={priceCurrency}
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

type GridOverviewChartPoint = {
  actualSiteLoadCurrentValue: number | null;
  actualSiteLoadFutureValue: number | null;
  cumulativeExportEarnings: number;
  cumulativeImportCost: number;
  cumulativeNetCost: number;
  expectedSiteLoadCurrentValue: number | null;
  expectedSiteLoadFutureValue: number | null;
  gridCurrentValue: number | null;
  gridFutureValue: number | null;
  periodStart: string;
};

function GridOverviewTooltip({
  active,
  entryLabelFormatter,
  formatter,
  label,
  payload,
  priceCurrency,
}: {
  active?: boolean;
  entryLabelFormatter?: (value: number, key?: string) => string;
  formatter: (value: number, key?: string, payload?: unknown) => string;
  label?: string;
  payload?: TooltipPayloadEntry[];
  priceCurrency: string;
}) {
  if (!active || !label || !payload || payload.length === 0) return null;

  const numericEntries = payload.filter(
    (entry): entry is TooltipPayloadEntry & { value: number } =>
      typeof entry.value === "number",
  );
  const deduplicatedEntries = deduplicateTooltipEntries(numericEntries);
  const point = payload.find((entry) => entry.payload)?.payload as
    | GridOverviewChartPoint
    | undefined;

  if (deduplicatedEntries.length === 0 || !point) return null;

  return (
    <TooltipCard>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {formatTooltipTimestamp(label)}
      </p>
      <div className="space-y-1.5">
        {deduplicatedEntries.map((entry) => (
          <div
            key={`${entry.dataKey}-${entry.name}`}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-2 text-slate-200">
              <TooltipMarker
                color={entry.color ?? UI_COLORS.chartSeriesFallback}
                strokeDasharray={
                  entry.dataKey?.startsWith("expected") ? "1 6" : undefined
                }
              />
              {entryLabelFormatter?.(entry.value, entry.dataKey) ??
                entry.name ??
                entry.dataKey ??
                "Value"}
            </span>
            <span className="font-medium text-white">
              {formatter(entry.value, entry.dataKey, entry.payload)}
            </span>
          </div>
        ))}
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="space-y-1.5">
            <TooltipDetailRow
              label="Net Energy Earnings"
              value={formatCurrencyAmount(
                -point.cumulativeNetCost,
                priceCurrency,
              )}
            />
            <TooltipDetailRow
              label="Import Cost"
              value={formatCurrencyAmount(
                point.cumulativeImportCost,
                priceCurrency,
              )}
            />
            <TooltipDetailRow
              label="Export Earnings"
              value={formatCurrencyAmount(
                point.cumulativeExportEarnings,
                priceCurrency,
              )}
            />
          </div>
        </div>
      </div>
    </TooltipCard>
  );
}

function TooltipDetailRow({
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
