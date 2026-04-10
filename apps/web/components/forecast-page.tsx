"use client";

import type {
  HistoryArchive,
  WeatherForecastPointRecord,
  WeatherForecastRecord,
  WeatherForecastSourceRecord,
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

export function WeatherForecastSection({
  archive,
  site,
  forecast,
  error,
  requestedDay,
  source,
}: {
  archive: HistoryArchive;
  site: SiteSnapshot;
  forecast: WeatherForecastRecord | null;
  error: string | null;
  requestedDay: string | null;
  source: WeatherForecastSourceRecord | null;
}) {
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const selectedDayForecastSeries = fillSingleValueDay(
    archive.solarForecastSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.value,
    })),
    daySelection.selectedDay,
  );
  const currentForecastPoint = getCurrentForecastPoint(
    forecast?.points ?? [],
    Date.now(),
  );

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/40 to-transparent" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300/90">
            Forecast
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            Solar forecast for {site.name}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Open-Meteo provides the built-in ground sunlight forecast for this
            site.
          </p>
        </div>
        <SectionSummaryCard title="Current forecast">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {currentForecastPoint === null ||
            currentForecastPoint.value === null
              ? "Unavailable"
              : formatForecastSummaryValue(
                  currentForecastPoint.value,
                  forecast?.unitLabel ?? "",
                )}
          </p>
        </SectionSummaryCard>
      </div>

      {site.location.trim().length === 0 ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          Add a GPS location on the Site tab to load a solar forecast.
        </p>
      ) : source === null ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Save the site once to create the built-in forecast source.
        </p>
      ) : error ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </p>
      ) : forecast === null ? (
        <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <SingleValueHistoryChart
            accentColor={UI_COLORS.forecast}
            emptyMessage="Forecast data is not available yet."
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            label="Solar Forecast"
            nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
            points={splitSingleValueSeriesByTime(selectedDayForecastSeries)}
            valueFormatter={(value) => `${value}`}
            yAxisLabel="Forecast"
            yAxisFormatter={formatShortForecastAxisValue}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <SingleValueHistoryChart
            accentColor={UI_COLORS.forecast}
            emptyMessage="No forecast data for this day."
            headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
            label={forecast.metricLabel}
            nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
            points={splitSingleValueSeriesByTime(selectedDayForecastSeries)}
            valueFormatter={(value) => `${value} ${forecast.unitLabel}`}
            yAxisLabel={forecast.unitLabel}
            yAxisFormatter={formatShortForecastAxisValue}
          />
        </div>
      )}
    </section>
  );
}

function getCurrentForecastPoint(
  points: WeatherForecastPointRecord[],
  now: number,
): WeatherForecastPointRecord | null {
  for (const point of points) {
    if (new Date(point.periodEnd).getTime() >= now) {
      return point;
    }
  }

  return points[points.length - 1] ?? null;
}

function formatForecastSummaryValue(value: number, unitLabel: string): string {
  return `${Math.round(value)} ${unitLabel}`;
}

function formatShortForecastAxisValue(value: number): string {
  return `${Math.round(value)}`;
}
