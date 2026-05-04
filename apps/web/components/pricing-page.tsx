"use client";

import type {
  DynamicPricePointRecord,
  DynamicPriceSnapshotRecord,
  HistoryArchive,
} from "@emsd/core/client";
import { useState } from "react";
import {
  computeExportPrice,
  formatPricePerKwh,
  getActivePricePointAtOrBefore,
} from "../lib/price-format";
import { UI_COLORS } from "../lib/ui-colors";
import {
  SingleValueHistoryChart,
  fillSingleValueDay,
  splitSingleValueSeriesByTime,
} from "./history";
import { TooltipCard, TooltipRow } from "./history/tooltips";
import { formatTooltipTimestamp } from "./history/utils";
import { PageRefreshButton } from "./page-refresh-button";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import type { SiteSnapshot } from "./settings-panel";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";
import { type PricesGraphResponse, useLiveJsonSWR } from "./use-live-json-swr";

const GRAPH_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;
const GRAPH_RETRY_INTERVAL_MS = 5_000;
const PRICE_CHART_VISIBILITY_STORAGE_KEY =
  "emsd:chart-visibility:prices:history";
const PRICE_CHART_SERIES_ID = "import-price";

export function PricingSection({
  archive: initialArchive,
  site,
  snapshot: initialSnapshot,
  error: initialError,
  highestMarkerPeriodStarts: initialHighestMarkerPeriodStarts,
  lowestMarkerPeriodStarts: initialLowestMarkerPeriodStarts,
  requestedDay,
}: {
  archive: HistoryArchive;
  site: SiteSnapshot;
  snapshot: DynamicPriceSnapshotRecord | null;
  error: string | null;
  highestMarkerPeriodStarts: string[];
  lowestMarkerPeriodStarts: string[];
  requestedDay: string | null;
}) {
  const [showExportPrice, setShowExportPrice] = useState(false);
  const { data: graphData, refreshError: graphRefreshError } =
    useLiveJsonSWR<PricesGraphResponse>(
      `/api/prices/graph?siteId=${encodeURIComponent(site.id)}`,
      {
        failureMessage:
          "Price graph updates are retrying. Showing last available data.",
        refreshIntervalMs: GRAPH_REFRESH_INTERVAL_MS,
        retryIntervalMs: GRAPH_RETRY_INTERVAL_MS,
      },
    );
  const archive = graphData?.archive ?? initialArchive;
  const snapshot = graphData?.dynamicPriceSnapshot ?? initialSnapshot;
  const error = graphData?.dynamicPriceSnapshotError ?? initialError;
  const highestMarkerPeriodStarts =
    graphData?.highestMarkerPeriodStarts ?? initialHighestMarkerPeriodStarts;
  const lowestMarkerPeriodStarts =
    graphData?.lowestMarkerPeriodStarts ?? initialLowestMarkerPeriodStarts;
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const selectedDayPricePoints = fillSingleValueDay(
    archive.dynamicPriceSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
    daySelection.selectedDay,
  );
  const coverageSummary = snapshot
    ? formatPriceCoverageSummary(snapshot.points)
    : null;
  const currentPricePoint =
    getActivePricePointAtOrBefore(
      snapshot?.points ?? [],
      Date.now(),
    ) ??
    snapshot?.points[0] ??
    null;
  const priceCurrency = snapshot?.currency ?? "EUR";
  const emptyMessage =
    snapshot === null
      ? "Dynamic price data is not available yet."
      : "No price data for this day.";
  const priceAxisDomain = buildPriceAxisDomain(selectedDayPricePoints);

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/40 to-transparent" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/90">
            Pricing
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            Dynamic electricity prices for {site.name}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Tibber provides the built-in dynamic price snapshot for this site.
          </p>
          {coverageSummary ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {coverageSummary}
            </p>
          ) : null}
        </div>
        <SectionSummaryCard
          onClick={() => setShowExportPrice((prev) => !prev)}
          title={
            showExportPrice ? "Current export price" : "Current import price"
          }
        >
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {currentPricePoint === null || snapshot === null
              ? "Unavailable"
              : formatPriceSummaryValue(
                  showExportPrice
                    ? computeExportPrice(
                        currentPricePoint.importPrice,
                        site.dynamicPriceSources[0]?.exportDeduction,
                      )
                    : currentPricePoint.importPrice,
                  priceCurrency,
                )}
          </p>
        </SectionSummaryCard>
      </div>

      {graphRefreshError ? (
        <RefreshWarning
          action={<PageRefreshButton />}
          className="mt-5"
          message={graphRefreshError}
        />
      ) : null}

      {error ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </p>
      ) : (
        <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <SingleValueHistoryChart
            accentColor={UI_COLORS.price}
            emptyMessage={emptyMessage}
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            label="Import price"
            lowestMarkerPeriodStarts={lowestMarkerPeriodStarts}
            highestMarkerPeriodStarts={highestMarkerPeriodStarts}
            nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
            points={splitSingleValueSeriesByTime(selectedDayPricePoints)}
            tooltipContent={
              <PriceTooltip
                currency={priceCurrency}
                exportDeduction={
                  site.dynamicPriceSources[0]?.exportDeduction ?? 0.13
                }
              />
            }
            valueFormatter={(value) =>
              formatPricePerKwh(value, priceCurrency)
            }
            visibilitySeriesId={PRICE_CHART_SERIES_ID}
            visibilityStorageKey={PRICE_CHART_VISIBILITY_STORAGE_KEY}
            {...(priceAxisDomain ? { yAxisDomain: priceAxisDomain } : {})}
            yAxisFormatter={formatShortPriceAxisValue}
            yAxisLabel={`${priceCurrency}/kWh`}
          />
        </div>
      )}
    </section>
  );
}

function formatPriceCoverageSummary(
  _points: DynamicPricePointRecord[],
): string | null {
  return null;
}

function PriceTooltip({
  active,
  currency,
  exportDeduction,
  label,
  payload,
}: {
  active?: boolean;
  currency: string;
  exportDeduction: number;
  label?: string;
  payload?: Array<{
    color?: string;
    dataKey?: string;
    name?: string;
    payload?: { periodStart: string };
    value?: number;
  }>;
}) {
  if (!active || !label || !payload || payload.length === 0) {
    return null;
  }

  const entry = payload.find((p) => typeof p.value === "number");

  if (!entry || typeof entry.value !== "number") {
    return null;
  }

  const importPrice = entry.value;
  const exportPrice = computeExportPrice(importPrice, exportDeduction);

  return (
    <TooltipCard>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {formatTooltipTimestamp(label)}
      </p>
      <div className="space-y-1.5">
        <TooltipRow
          color={UI_COLORS.price}
          label="Import price"
          strokeDasharray={undefined}
          value={formatPriceSummaryValue(importPrice, currency)}
        />
        <TooltipRow
          color={UI_COLORS.success}
          label="Export price"
          strokeDasharray={undefined}
          value={formatPriceSummaryValue(exportPrice, currency)}
        />
      </div>
    </TooltipCard>
  );
}

function formatPriceSummaryValue(value: number, currency: string): string {
  return formatPricePerKwh(value, currency);
}

function formatShortPriceAxisValue(value: number): string {
  return value.toFixed(2);
}

function buildPriceAxisDomain(
  points: Array<{ value: number | null }>,
): [number, number] | undefined {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return undefined;
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);

  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.1, 0.01);
    return [Math.max(0, minimum - padding), maximum + padding];
  }

  const padding = Math.max((maximum - minimum) * 0.12, 0.01);
  return [Math.max(0, minimum - padding), maximum + padding];
}
