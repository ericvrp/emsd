"use client";

import type { HistoryArchive } from "../lib/ems-bridge";
import {
  formatAbsolutePowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { UI_COLORS } from "../lib/ui-colors";
import {
  SegmentedLineHistoryChart,
  aggregatePowerSamples,
  fillSingleValueDay,
  invertSingleValueSeries,
  splitSingleValueSeriesByTime,
} from "./history-page";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

type GridPageProps = {
  archive: HistoryArchive;
  requestedDay: string | null;
  siteName: string;
};

export function GridPage({ archive, requestedDay, siteName }: GridPageProps) {
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const selectedDayGridSeries = fillSingleValueDay(
    invertSingleValueSeries(aggregatePowerSamples(archive.p1MeterSamples)),
    daySelection.selectedDay,
  );
  const currentGridPower = getLatestValueAtOrBefore(
    selectedDayGridSeries,
    daySelection.nowMarkerPeriodStart ??
      selectedDayGridSeries.at(-1)?.periodStart ??
      "",
  );

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
            Measured import and export power from the connected P1 meter.
          </p>
        </div>
        <SectionSummaryCard title="Current grid">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {formatGridPower(currentGridPower)}
          </p>
        </SectionSummaryCard>
      </div>

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
        <SegmentedLineHistoryChart
          emptyMessage="No grid samples for this day."
          headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
          negativeColor={UI_COLORS.gridImport}
          negativeLabel="Import"
          nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
          points={splitSingleValueSeriesByTime(selectedDayGridSeries)}
          positiveColor={UI_COLORS.gridExport}
          positiveLabel="Export"
          valueFormatter={formatAbsolutePowerValue}
          yAxisLabel="Power"
          yAxisFormatter={formatShortPowerValue}
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

  const isImporting = value < 0;
  const direction = isImporting ? "Importing" : "Exporting";
  const absoluteValue = Math.abs(value);

  return `${direction} ${formatAbsolutePowerValue(absoluteValue)}`;
}
