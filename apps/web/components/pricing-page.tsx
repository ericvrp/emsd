"use client";

import type {
  DynamicPricePointRecord,
  DynamicPriceSnapshotRecord,
  HistoryArchive,
} from "@emsd/core";
import { UI_COLORS } from "../lib/ui-colors";
import {
  SingleValueHistoryChart,
  fillSingleValueDay,
  splitSingleValueSeriesByTime,
} from "./history-page";
import { SectionSummaryCard } from "./section-summary-card";
import type { SiteSnapshot } from "./settings-panel";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

export function PricingSection({
  archive,
  site,
  snapshot,
  error,
  requestedDay,
}: {
  archive: HistoryArchive;
  site: SiteSnapshot;
  snapshot: DynamicPriceSnapshotRecord | null;
  error: string | null;
  requestedDay: string | null;
}) {
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
        <SectionSummaryCard title="Current price">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {currentPricePoint === null || snapshot === null
              ? "Unavailable"
              : formatPriceSummaryValue(
                  currentPricePoint.importPrice,
                  snapshot.currency,
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
          <SingleValueHistoryChart
            accentColor={UI_COLORS.price}
            emptyMessage={emptyMessage}
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            label="Price"
            nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
            points={splitSingleValueSeriesByTime(selectedDayPricePoints)}
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
