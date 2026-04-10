"use client";

import type { HistoryArchive } from "../lib/ems-bridge";
import { formatAbsolutePowerValue } from "../lib/power-format";
import { SectionSummaryCard } from "./section-summary-card";
import {
  BatteryHistoryChart,
  buildBatteryHistoryPoints,
  getCurrentPeriodStart,
  getUtcDayKey,
} from "./history-page";

type HomeBatteryHistorySectionProps = {
  archive: HistoryArchive;
  currentChargePercent: number | null;
  currentPowerW: number | null;
  siteName: string;
};

export function HomeBatteryHistorySection({
  archive,
  currentChargePercent,
  currentPowerW,
  siteName,
}: HomeBatteryHistorySectionProps) {
  const todayKey = getUtcDayKey(new Date());
  const nowMarkerPeriodStart = getCurrentPeriodStart();
  const batteryHistoryPoints = buildBatteryHistoryPoints(
    archive.batteryPowerSamples,
    todayKey,
  );

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            Battery
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            Battery history for {siteName}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Recent charging, discharging, and battery charge for the current day.
          </p>
        </div>
        <SectionSummaryCard title="Current battery">
          <p className="text-lg font-semibold text-white sm:text-xl">
            Charge: {formatCharge(currentChargePercent)}
          </p>
          <p className="mt-1 text-lg font-semibold text-white sm:text-xl">
            Power: {formatPower(currentPowerW)}
          </p>
        </SectionSummaryCard>
      </div>

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
        <BatteryHistoryChart
          emptyMessage="No battery power or charge samples have been collected for today yet."
          nowMarkerPeriodStart={nowMarkerPeriodStart}
          points={batteryHistoryPoints}
        />
      </div>
    </section>
  );
}

function formatCharge(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value)}%`;
}

function formatPower(value: number | null): string {
  return value === null ? "Unavailable" : formatAbsolutePowerValue(value);
}
