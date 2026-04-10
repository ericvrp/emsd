"use client";

import type { HistoryArchive, LiveStatusSnapshot } from "../lib/ems-bridge";
import { UI_COLORS } from "../lib/ui-colors";
import {
  SingleValueHistoryChart,
  aggregatePowerSamples,
  fillSingleValueDay,
  formatPowerValue,
  formatShortPowerValue,
  getCurrentPeriodStart,
  getUtcDayKey,
  splitSingleValueSeriesByTime,
} from "./history-page";

type SolarEnergyPageProps = {
  archive: HistoryArchive;
  currentSite: LiveStatusSnapshot["sites"][number];
};

export function SolarEnergyPage({
  archive,
  currentSite,
}: SolarEnergyPageProps) {
  const providers = currentSite.devices.filter(
    (device) => device.kind === "solar-energy-provider",
  );
  const currentGeneratedWattage = providers.reduce<number | null>(
    (total, provider) => {
      const powerW = provider.telemetry?.powerW;

      if (typeof powerW !== "number") {
        return total;
      }

      return total === null ? powerW : total + powerW;
    },
    null,
  );
  const todayKey = getUtcDayKey(new Date());
  const currentPeriodStart = getCurrentPeriodStart();
  const currentPeriodMs = new Date(currentPeriodStart).getTime();
  const todaySolarSeries = fillSingleValueDay(
    aggregatePowerSamples(archive.solarEnergyProviderSamples),
    todayKey,
  ).filter((point) => new Date(point.periodStart).getTime() <= currentPeriodMs);

  if (providers.length === 0) {
    return (
      <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300/90">
          Solar Energy
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          No solar energy providers are currently connected. Add one from the
          discovery panel in Settings.
        </p>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300/90">
            Solar Energy
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            Generated wattage for {currentSite.name}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Measured production from the connected local solar energy provider.
          </p>
        </div>
        <div className="rounded-[1.4rem] border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100/80">
            Current generation
          </p>
          <p className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
            {currentGeneratedWattage === null
              ? "Unavailable"
              : formatPowerValue(currentGeneratedWattage)}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
        <SingleValueHistoryChart
          accentColor={UI_COLORS.solarEnergy}
          emptyMessage="No generated wattage samples have been collected for today yet."
          label="Generated Wattage"
          nowMarkerPeriodStart={currentPeriodStart}
          points={splitSingleValueSeriesByTime(todaySolarSeries)}
          showLegend={false}
          valueFormatter={formatPowerValue}
          yAxisLabel="Power (W)"
          yAxisFormatter={formatShortPowerValue}
        />
      </div>
    </section>
  );
}
