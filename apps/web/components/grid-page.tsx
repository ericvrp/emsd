"use client";

import type { HistoryArchive } from "../lib/ems-bridge";
import {
  formatAbsolutePowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { UI_COLORS } from "../lib/ui-colors";
import {
  aggregatePowerSamples,
  fillSingleValueDay,
  getCurrentPeriodStart,
  getUtcDayKey,
  invertSingleValueSeries,
  SegmentedLineHistoryChart,
  splitSingleValueSeriesByTime,
} from "./history-page";

type GridPageProps = {
  archive: HistoryArchive;
  siteName: string;
};

export function GridPage({ archive, siteName }: GridPageProps) {
  const todayKey = getUtcDayKey(new Date());
  const currentPeriodStart = getCurrentPeriodStart();
  const currentPeriodMs = new Date(currentPeriodStart).getTime();
  const todayGridSeries = fillSingleValueDay(
    invertSingleValueSeries(aggregatePowerSamples(archive.p1MeterSamples)),
    todayKey,
  ).filter((point) => new Date(point.periodStart).getTime() <= currentPeriodMs);

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
        <p className="text-xs leading-5 text-slate-500">{formatTodayLabel(todayKey)}</p>
      </div>

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <SegmentedLineHistoryChart
            emptyMessage="No P1 meter samples have been collected for today yet."
            negativeColor={UI_COLORS.gridImport}
            negativeLabel="Take from grid"
            nowMarkerPeriodStart={currentPeriodStart}
            points={splitSingleValueSeriesByTime(todayGridSeries)}
            positiveColor={UI_COLORS.gridExport}
            positiveLabel="Return to grid"
            valueFormatter={formatAbsolutePowerValue}
            yAxisFormatter={formatShortPowerValue}
          />
      </div>
    </section>
  );
}

function formatTodayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "long",
  }).format(new Date(`${dayKey}T00:00:00.000Z`));
}
