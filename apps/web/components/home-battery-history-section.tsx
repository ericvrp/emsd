"use client";

import { deriveBatteryStatusFromPower } from "@emsd/core/client";
import type { HistoryArchive } from "@emsd/core/client";
import { type ReactNode, useEffect, useState } from "react";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";
import { formatAbsolutePowerValue } from "../lib/power-format";
import { BatteryHistoryChart, buildBatteryHistoryPoints } from "./history";
import { RefreshWarning } from "./refresh-warning";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

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
  const [archive, setArchive] = useState(initialArchive);
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const batteryHistoryPoints = buildBatteryHistoryPoints(
    archive.batteryPowerSamples,
    archive.batteryStrategyHistory,
    daySelection.selectedDay,
  );
  const [liveCurrentChargePercent, setLiveCurrentChargePercent] =
    useState(currentChargePercent);
  const [liveCurrentPowerW, setLiveCurrentPowerW] = useState(currentPowerW);
  const [graphRefreshError, setGraphRefreshError] = useState<string | null>(
    null,
  );
  const [currentRefreshError, setCurrentRefreshError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setLiveCurrentChargePercent(currentChargePercent);
    setLiveCurrentPowerW(currentPowerW);
  }, [currentChargePercent, currentPowerW]);

  useEffect(() => {
    setArchive(initialArchive);
  }, [initialArchive]);

  useEffect(() => {
    let cancelled = false;

    async function refreshGraph() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/history/archive?siteId=${encodeURIComponent(siteId)}`,
          { cache: "no-store" },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Battery graph request failed: ${response.status}`);
        }

        const payload = (await response.json()) as HistoryArchive;

        if (!cancelled) {
          setGraphRefreshError(null);
          setArchive(payload);
        }
      } catch {
        if (!cancelled) {
          setGraphRefreshError(
            "Battery graph updates paused. Showing last available data.",
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
  }, [siteId]);

  useEffect(() => {
    let cancelled = false;

    async function refreshCurrentBattery() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/site/current?siteId=${encodeURIComponent(siteId)}`,
          { cache: "no-store" },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Battery current request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          currentBatteryChargePercent?: number | null;
          currentBatteryPowerW?: number | null;
        };

        if (cancelled) {
          return;
        }

        setCurrentRefreshError(null);
        setLiveCurrentChargePercent(
          payload.currentBatteryChargePercent ?? null,
        );
        setLiveCurrentPowerW(payload.currentBatteryPowerW ?? null);
      } catch {
        if (!cancelled) {
          setCurrentRefreshError(
            "Battery current updates paused. Showing last available data.",
          );
          setLiveCurrentChargePercent(currentChargePercent);
          setLiveCurrentPowerW(currentPowerW);
        }
      }
    }

    void refreshCurrentBattery();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshCurrentBattery();
      }
    }

    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat("refresh current");
      void refreshCurrentBattery();
    }, LIVE_CURRENT_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentChargePercent, currentPowerW, siteId]);

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

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
        {graphRefreshError ? (
          <RefreshWarning message={graphRefreshError} />
        ) : null}
        {currentRefreshError ? (
          <RefreshWarning message={currentRefreshError} />
        ) : null}
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
