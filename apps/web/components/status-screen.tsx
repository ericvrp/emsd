import { BatteryCharging, Zap } from "lucide-react";
import { getHistoryArchive } from "../lib/ems-bridge";
import { formatAbsolutePowerValue } from "../lib/power-format";
import { getSearchParamValue } from "../lib/search-params";
import { UI_STYLES } from "../lib/ui-colors";
import { DaemonOfflineState } from "./daemon-offline-state";
import {
  type SearchParams,
  loadDashboardPageData,
} from "./dashboard-page-data";
import { DashboardPageFrame } from "./dashboard-page-frame";
import { HomeBatteryHistorySection } from "./home-battery-history-section";
import { Card, CardContent } from "./ui/card";

export async function StatusScreen({
  searchParams,
}: {
  searchParams: SearchParams | undefined;
}) {
  const dashboardData = await loadDashboardPageData(searchParams);

  if (dashboardData.offline) {
    return <DaemonOfflineState />;
  }

  const { currentSite, generatedAt } = dashboardData;
  const requestedDay = getSearchParamValue(
    dashboardData.resolvedSearchParams.day,
  );

  const batteries = currentSite
    ? currentSite.devices.filter((device) => device.kind === "battery")
    : [];
  const currentSiteId = currentSite?.id ?? null;
  const currentBatteryPower = batteries.reduce<number | null>(
    (total, battery) => {
      const powerW = battery.telemetry?.powerW;

      if (typeof powerW !== "number") {
        return total;
      }

      return total === null ? powerW : total + powerW;
    },
    null,
  );
  const batteryChargeValues = batteries
    .map((battery) => battery.telemetry?.socPercent)
    .filter((value): value is number => typeof value === "number");
  const currentBatteryCharge =
    batteryChargeValues.length > 0
      ? batteryChargeValues.reduce((total, value) => total + value, 0) /
        batteryChargeValues.length
      : null;
  const currentBatteryState =
    batteries.length > 0
      ? (batteries.find((b) => b.telemetry?.state)?.telemetry?.state ??
        batteries[0]?.state ??
        null)
      : null;
  let historyArchive = null;
  let historyArchiveError: string | null = null;

  if (currentSite) {
    try {
      historyArchive = await getHistoryArchive({ siteId: currentSite.id });
    } catch (error) {
      historyArchiveError =
        error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <DashboardPageFrame currentSite={currentSite} generatedAt={generatedAt}>
      {currentSite === null ? (
        <Card className="border-white/12 bg-slate-950/70">
          <CardContent className="px-6 py-10 text-center sm:px-8 sm:py-12">
            <p className="text-xl font-medium text-white">
              To get started, please go to Settings and create a new site and
              assign devices to it.
            </p>
          </CardContent>
        </Card>
      ) : batteries.length === 0 ? (
        <Card className="border-white/12 bg-slate-950/70">
          <CardContent className="px-6 py-10 text-center sm:px-8 sm:py-12">
            <p className="text-xl font-medium text-white">
              No devices are currently connected. Please go to Settings and
              assigned devices to your site.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="flex w-full flex-col gap-6">
          {historyArchiveError ? (
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
              <p className="rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                {historyArchiveError}
              </p>
            </section>
          ) : historyArchive ? (
            <HomeBatteryHistorySection
              archive={historyArchive}
              currentChargePercent={currentBatteryCharge}
              currentPowerW={currentBatteryPower}
              currentState={currentBatteryState}
              requestedDay={requestedDay}
              siteName={currentSite.name}
            />
          ) : null}
        </section>
      )}
    </DashboardPageFrame>
  );
}

function BatteryChargeGauge({ socPercent }: { socPercent: number | null }) {
  const value =
    socPercent === null ? 0 : Math.max(0, Math.min(100, socPercent));

  return (
    <div className="flex w-[148px] flex-col items-center justify-center sm:w-[220px]">
      <div
        aria-label={`Battery charge ${formatSocPercent(socPercent)}`}
        className="relative h-[150px] w-[90px] rounded-[24px] border-4 border-white/15 bg-slate-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] sm:h-[184px] sm:w-[112px] sm:rounded-[28px]"
        role="img"
      >
        <div className="absolute left-1/2 top-[-12px] h-3 w-12 -translate-x-1/2 rounded-t-xl border-4 border-b-0 border-white/15 bg-slate-950 sm:w-14" />
        <div className="absolute inset-[8px] overflow-hidden rounded-[18px] bg-white/5 sm:inset-[10px] sm:rounded-[20px]">
          <div
            className={`absolute inset-x-0 bottom-0 transition-[height] duration-500 ${getBatteryFillClass(socPercent)}`}
            style={{ height: `${value}%` }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center text-center">
          <BatteryCharging className="h-8 w-8 text-white/80 sm:h-10 sm:w-10" />
        </div>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        Charge
      </p>
      <p className="mt-2 whitespace-nowrap text-3xl font-semibold text-white sm:text-4xl">
        {formatSocPercent(socPercent)}
      </p>
    </div>
  );
}

function PowerIndicator({
  state,
  value,
}: {
  state: string;
  value: number | null;
}) {
  const maxPower = 2400;
  const normalizedValue =
    value === null ? 0 : Math.min(maxPower, Math.abs(value));
  const fillPercent = (normalizedValue / maxPower) * 100;

  return (
    <div className="flex w-[148px] flex-col items-center justify-center sm:w-[220px]">
      <div
        aria-label={`Current power ${formatPower(value)}`}
        className="relative h-[150px] w-[90px] rounded-[20px] border-4 border-white/15 bg-slate-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] sm:h-[184px] sm:w-[112px] sm:rounded-[24px]"
        role="img"
      >
        <div className="absolute inset-[8px] overflow-hidden rounded-[14px] bg-white/5 sm:inset-[10px] sm:rounded-[18px]">
          <div
            className={`absolute inset-x-0 bottom-0 transition-[height] duration-500 ${getPowerFillClass(state)}`}
            style={{ height: `${fillPercent}%` }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
          <Zap className="h-8 w-8 text-white/80 sm:h-10 sm:w-10" />
        </div>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        Power
      </p>
      <p className="mt-2 whitespace-nowrap text-3xl font-semibold text-white sm:text-4xl">
        {formatPower(value)}
      </p>
    </div>
  );
}

function formatSocPercent(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Unavailable"
    : `${Math.round(value)}%`;
}

function formatPower(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unavailable";
  }

  return formatAbsolutePowerValue(value);
}

function getBatteryFillClass(socPercent: number | null): string {
  if (socPercent === null) {
    return UI_STYLES.batteryFillUnknown;
  }

  if (socPercent < 25) {
    return UI_STYLES.batteryFillLow;
  }

  if (socPercent >= 80) {
    return UI_STYLES.batteryFillHigh;
  }

  return UI_STYLES.batteryFillMid;
}

function getPowerFillClass(state: string): string {
  if (state === "charging") {
    return UI_STYLES.powerFillCharging;
  }

  if (state === "discharging") {
    return UI_STYLES.powerFillDischarging;
  }

  return UI_STYLES.powerFillUnknown;
}
