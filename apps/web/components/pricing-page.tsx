"use client";

import type {
  DynamicPricePointRecord,
  DynamicPriceSnapshotRecord,
  HistoryArchive,
} from "@emsd/core/client";
import { useEffect, useState } from "react";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";
import { UI_COLORS } from "../lib/ui-colors";
import {
  SingleValueHistoryChart,
  fillSingleValueDay,
  splitSingleValueSeriesByTime,
} from "./history";
import { formatTooltipTimestamp } from "./history/utils";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import type { SiteSnapshot } from "./settings-panel";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

const GRAPH_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;

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
  const [archive, setArchive] = useState(initialArchive);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState(initialError);
  const [highestMarkerPeriodStarts, setHighestMarkerPeriodStarts] = useState(
    initialHighestMarkerPeriodStarts,
  );
  const [lowestMarkerPeriodStarts, setLowestMarkerPeriodStarts] = useState(
    initialLowestMarkerPeriodStarts,
  );
  const [graphRefreshError, setGraphRefreshError] = useState<string | null>(
    null,
  );
  const [showExportPrice, setShowExportPrice] = useState(false);
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
  const currentPricePoint = getCurrentPricePoint(
    snapshot?.points ?? [],
    Date.now(),
  );
  const priceCurrency = snapshot?.currency ?? "EUR";
  const emptyMessage =
    snapshot === null
      ? "Dynamic price data is not available yet."
      : "No price data for this day.";
  const priceAxisDomain = buildPriceAxisDomain(selectedDayPricePoints);

  useEffect(() => {
    setArchive(initialArchive);
    setSnapshot(initialSnapshot);
    setError(initialError);
    setHighestMarkerPeriodStarts(initialHighestMarkerPeriodStarts);
    setLowestMarkerPeriodStarts(initialLowestMarkerPeriodStarts);
  }, [
    initialArchive,
    initialError,
    initialHighestMarkerPeriodStarts,
    initialLowestMarkerPeriodStarts,
    initialSnapshot,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function refreshGraph() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/prices/graph?siteId=${encodeURIComponent(site.id)}`,
          { cache: "no-store" },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Prices graph request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          archive: HistoryArchive;
          dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null;
          dynamicPriceSnapshotError: string | null;
          highestMarkerPeriodStarts: string[];
          lowestMarkerPeriodStarts: string[];
        };

        if (!cancelled) {
          setGraphRefreshError(null);
          setArchive(payload.archive);
          setSnapshot(payload.dynamicPriceSnapshot);
          setError(payload.dynamicPriceSnapshotError);
          setHighestMarkerPeriodStarts(payload.highestMarkerPeriodStarts);
          setLowestMarkerPeriodStarts(payload.lowestMarkerPeriodStarts);
        }
      } catch {
        if (!cancelled) {
          setGraphRefreshError(
            "Price graph updates paused. Showing last available data.",
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

      {error ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </p>
      ) : (
        <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          {graphRefreshError ? (
            <RefreshWarning message={graphRefreshError} />
          ) : null}
          <SingleValueHistoryChart
            accentColor={UI_COLORS.price}
            emptyMessage={emptyMessage}
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            label="Price"
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
              `${value.toFixed(3)} ${priceCurrency}/kWh`
            }
            {...(priceAxisDomain ? { yAxisDomain: priceAxisDomain } : {})}
            yAxisFormatter={formatShortPriceAxisValue}
            yAxisLabel={`${priceCurrency}/kWh`}
          />
        </div>
      )}
    </section>
  );
}

function getCurrentPricePoint(
  points: DynamicPricePointRecord[],
  now: number,
): DynamicPricePointRecord | null {
  let currentPoint: DynamicPricePointRecord | null = null;

  for (const point of points) {
    if (new Date(point.startsAt).getTime() <= now) {
      currentPoint = point;
    } else {
      break;
    }
  }

  return currentPoint ?? points[0] ?? null;
}

function formatPriceCoverageSummary(
  _points: DynamicPricePointRecord[],
): string | null {
  return null;
}

function computeExportPrice(
  importPrice: number,
  exportDeduction: number | undefined,
): number {
  return importPrice - (exportDeduction ?? 0.13);
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
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {formatTooltipTimestamp(label)}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-slate-200">
            <svg
              aria-hidden="true"
              className="shrink-0"
              height="8"
              viewBox="0 0 18 8"
              width="18"
            >
              <line
                stroke={UI_COLORS.price}
                strokeLinecap="round"
                strokeWidth="2.8"
                x1="1.4"
                x2="16.6"
                y1="4"
                y2="4"
              />
            </svg>
            Import price
          </span>
          <span className="font-medium text-white">
            {formatPriceSummaryValue(importPrice, currency)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-slate-200">
            <svg
              aria-hidden="true"
              className="shrink-0"
              height="8"
              viewBox="0 0 18 8"
              width="18"
            >
              <line
                stroke={UI_COLORS.success}
                strokeLinecap="round"
                strokeWidth="2.8"
                x1="1.4"
                x2="16.6"
                y1="4"
                y2="4"
              />
            </svg>
            Export price
          </span>
          <span className="font-medium text-white">
            {formatPriceSummaryValue(exportPrice, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatPriceSummaryValue(value: number, currency: string): string {
  return `${value.toFixed(3)} ${currency}/kWh`;
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
