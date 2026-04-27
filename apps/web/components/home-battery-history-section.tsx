"use client";

import { deriveBatteryStatusFromPower } from "@emsd/core/client";
import type { HistoryArchive } from "@emsd/core/client";
import type { ReactNode } from "react";
import { formatAbsolutePowerValue } from "../lib/power-format";
import { BatteryHistoryChart, buildBatteryHistoryPoints } from "./history";
import { PageRefreshButton } from "./page-refresh-button";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";
import {
  type SiteCurrentResponse,
  useLiveJsonSWR,
} from "./use-live-json-swr";

const LIVE_CURRENT_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;

type HomeBatteryHistorySectionProps = {
  archive: HistoryArchive;
  children?: ReactNode;
  currentChargePercent: number | null;
  currentPowerW: number | null;
  requestedDay: string | null;
  siteId: string;
  siteName: string;
};

export function HomeBatteryHistorySection({
  archive: initialArchive,
  children,
  currentChargePercent,
  currentPowerW,
  requestedDay,
  siteId,
  siteName,
}: HomeBatteryHistorySectionProps) {
  const { data: archiveData, refreshError: graphRefreshError } = useLiveJsonSWR<HistoryArchive>(
    `/api/history/archive?siteId=${encodeURIComponent(siteId)}`,
    {
      failureMessage:
        "Battery graph updates are retrying. Showing last available data.",
      refreshIntervalMs: GRAPH_REFRESH_INTERVAL_MS,
      retryIntervalMs: LIVE_CURRENT_REFRESH_INTERVAL_MS,
    },
  );
  const {
    data: currentData,
    refreshError: currentRefreshError,
  } = useLiveJsonSWR<SiteCurrentResponse>(
    `/api/site/current?siteId=${encodeURIComponent(siteId)}`,
    {
      failureMessage:
        "Battery current updates are retrying. Showing last available data.",
      refreshIntervalMs: LIVE_CURRENT_REFRESH_INTERVAL_MS,
    },
  );
  const archive = archiveData ?? initialArchive;
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const batteryHistoryPoints = buildBatteryHistoryPoints(
    archive.batteryPowerSamples,
    archive.batteryStrategyHistory,
    daySelection.selectedDay,
  );
  const refreshError = graphRefreshError ?? currentRefreshError;
  const liveCurrentChargePercent = currentData
    ? (currentData.currentBatteryChargePercent ?? null)
    : currentChargePercent;
  const liveCurrentPowerW = currentData
    ? (currentData.currentBatteryPowerW ?? null)
    : currentPowerW;

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
            Charging, discharging, and charge for the selected day.
          </p>
        </div>
        <SectionSummaryCard title="Current battery">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {formatCharge(liveCurrentChargePercent)} •{" "}
            {formatPower(liveCurrentPowerW)}
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

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 pb-4 pl-6 pr-4 pt-4">
        <BatteryHistoryChart
          emptyMessage="No battery samples for this day."
          headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
          nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
          points={batteryHistoryPoints}
          strategyHistory={archive.batteryStrategyHistory}
        />
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}

function formatCharge(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value)}%`;
}

function formatPower(value: number | null): string {
  if (value === null) return "Unavailable";

  const state = deriveBatteryStatusFromPower(value);

  if (state === "idle") {
    return "Idle";
  }

  const direction = state === "charging" ? "Charging" : "Discharging";
  const absoluteValue = Math.abs(value);

  return `${direction} ${formatAbsolutePowerValue(absoluteValue)}`;
}
