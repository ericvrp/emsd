"use client";

import type { HistoryArchive, LiveStatusSnapshot } from "../lib/ems-bridge";
import { formatPowerValue, formatShortPowerValue } from "../lib/power-format";
import { UI_COLORS } from "../lib/ui-colors";
import {
  SingleValueHistoryChart,
  aggregatePowerSamples,
  fillSingleValueDay,
  splitSingleValueSeriesByTime,
} from "./history-page";
import { SectionSummaryCard } from "./section-summary-card";
import {
  TopLevelDaySelect,
  useTopLevelDaySelection,
} from "./top-level-day-select";

type SolarEnergyPageProps = {
  archive: HistoryArchive;
  currentSite: LiveStatusSnapshot["sites"][number];
  requestedDay: string | null;
};

export function SolarEnergyPage({
  archive,
  currentSite,
  requestedDay,
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
  const daySelection = useTopLevelDaySelection({ archive, requestedDay });
  const selectedDaySolarSeries = fillSingleValueDay(
    aggregatePowerSamples(archive.solarEnergyProviderSamples),
    daySelection.selectedDay,
  );

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
        <SectionSummaryCard title="Current generation">
          <p className="text-2xl font-semibold text-white sm:text-3xl">
            {currentGeneratedWattage === null
              ? "Unavailable"
              : formatPowerValue(currentGeneratedWattage)}
          </p>
        </SectionSummaryCard>
      </div>

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
        <SingleValueHistoryChart
          accentColor={UI_COLORS.solarEnergy}
          emptyMessage="No solar energy samples for this day."
          headerAccessory={<TopLevelDaySelect daySelection={daySelection} />}
          label="Generated Wattage"
          nowMarkerPeriodStart={daySelection.nowMarkerPeriodStart}
          points={splitSingleValueSeriesByTime(selectedDaySolarSeries)}
          valueFormatter={formatPowerValue}
          yAxisLabel="Power (W)"
          yAxisFormatter={formatShortPowerValue}
        />
      </div>
    </section>
  );
}
