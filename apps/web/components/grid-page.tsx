"use client";

import type { HistoryArchive } from "@emsd/core";
import { useEffect, useState } from "react";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";
import {
  formatAbsolutePowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { UI_COLORS } from "../lib/ui-colors";
import { RefreshWarning } from "./refresh-warning";
import {
  SingleValueHistoryChart,
  aggregatePowerSamples,
  fillSingleValueDay,
  invertSingleValueSeries,
  splitSingleValueSeriesByTime,
} from "./history";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

type GridPageProps = {
  archive: HistoryArchive;
  requestedDay: string | null;
  siteId: string;
  siteName: string;
};

const LIVE_CURRENT_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;

export function GridPage({
  archive: initialArchive,
  requestedDay,
  siteId,
  siteName,
}: GridPageProps) {
  const [archive, setArchive] = useState(initialArchive);
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const gridSeries = invertSingleValueSeries(
    aggregatePowerSamples(archive.p1MeterSamples),
  );
  const selectedDayGridSeries = fillSingleValueDay(
    gridSeries,
    daySelection.selectedDay,
  );
  const archiveCurrentGridPower = getLatestValueAtOrBefore(
    gridSeries,
    new Date().toISOString(),
  );
  const [currentGridPower, setCurrentGridPower] = useState<number | null>(
    archiveCurrentGridPower,
  );
  const [graphRefreshError, setGraphRefreshError] = useState<string | null>(
    null,
  );
  const [currentRefreshError, setCurrentRefreshError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setCurrentGridPower(archiveCurrentGridPower);
  }, [archiveCurrentGridPower]);

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
          throw new Error(`Grid graph request failed: ${response.status}`);
        }

        const payload = (await response.json()) as HistoryArchive;

        if (!cancelled) {
          setGraphRefreshError(null);
          setArchive(payload);
        }
      } catch {
        if (!cancelled) {
          setGraphRefreshError(
            "Grid graph updates paused. Showing last available data.",
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

    async function refreshCurrentGrid() {
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
          throw new Error(`Grid current request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          currentGridPowerW?: number | null;
        };

        if (cancelled) {
          return;
        }

        setCurrentRefreshError(null);
        setCurrentGridPower(
          payload.currentGridPowerW ?? archiveCurrentGridPower,
        );
      } catch {
        if (!cancelled) {
          setCurrentRefreshError(
            "Grid current updates paused. Showing last available data.",
          );
          setCurrentGridPower(archiveCurrentGridPower);
        }
      }
    }

    void refreshCurrentGrid();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshCurrentGrid();
      }
    }

    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat("refresh current");
      void refreshCurrentGrid();
    }, LIVE_CURRENT_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [archiveCurrentGridPower, siteId]);

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
        {graphRefreshError ? (
          <RefreshWarning message={graphRefreshError} />
        ) : null}
        {currentRefreshError ? (
          <RefreshWarning message={currentRefreshError} />
        ) : null}
        <SingleValueHistoryChart
          accentColor={UI_COLORS.gridExport}
          emptyMessage="No grid samples for this day."
          entryLabelFormatter={(value) =>
            value < 0 ? "Grid Import Power" : "Grid Export Power"
          }
          headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
          label="Power"
          nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
          points={splitSingleValueSeriesByTime(selectedDayGridSeries)}
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

  if (Math.abs(value) <= 10) {
    return "Idle";
  }

  const isImporting = value < 0;
  const direction = isImporting ? "Importing" : "Exporting";
  const absoluteValue = Math.abs(value);

  return `${direction} ${formatAbsolutePowerValue(absoluteValue)}`;
}
