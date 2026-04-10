"use client";

import type { ReactNode } from "react";
import type { HistoryArchive } from "../lib/ems-bridge";
import { formatAbsolutePowerValue } from "../lib/power-format";
import { BatteryHistoryChart, buildBatteryHistoryPoints } from "./history-page";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

type HomeBatteryHistorySectionProps = {
  archive: HistoryArchive;
  children?: ReactNode;
  currentChargePercent: number | null;
  currentPowerW: number | null;
  currentState: string | null;
  requestedDay: string | null;
  siteName: string;
};

export function HomeBatteryHistorySection({
  archive,
  children,
  currentChargePercent,
  currentPowerW,
  currentState,
  requestedDay,
  siteName,
}: HomeBatteryHistorySectionProps) {
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const batteryHistoryPoints = buildBatteryHistoryPoints(
    archive.batteryPowerSamples,
    daySelection.selectedDay,
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
            Battery for {siteName}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Recent charging, discharging, and battery charge for the current
            day.
          </p>
        </div>
        <SectionSummaryCard title="Current battery">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {formatCharge(currentChargePercent)} •{" "}
            {formatPower(currentPowerW, currentState)}
          </p>
        </SectionSummaryCard>
      </div>

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
        <BatteryHistoryChart
          emptyMessage="No battery samples for this day."
          headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
          nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
          points={batteryHistoryPoints}
        />
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}

function formatCharge(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value)}%`;
}

function formatPower(value: number | null, state: string | null): string {
  if (value === null) return "Unavailable";

  if (state === "idle") {
    return "Idle";
  }

  const isCharging = value > 0;
  const direction = isCharging ? "Discharging" : "Charging";
  const absoluteValue = Math.abs(value);

  return `${direction} ${formatAbsolutePowerValue(absoluteValue)}`;
}
