import { formatManagedDeviceState } from "@emsd/core";
import { BatteryCharging, Zap } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../auth";
import {
  getDynamicPriceSnapshot,
  getBatteryNormalizedInfo,
  getLiveStatus,
  getWeatherForecast,
} from "../lib/ems-bridge";
import { AppShell } from "./app-shell";
import { BatteryStrategyDialog } from "./battery-strategy-dialog";
import { DaemonOfflineState } from "./daemon-offline-state";
import { SettingsDialog } from "./settings-dialog";
import { SettingsPanel } from "./settings-panel";
import { ToastOnSearchParams } from "./toast-on-search-params";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function StatusScreen({
  searchParams,
}: {
  searchParams: SearchParams | undefined;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const snapshot = await getLiveStatus();
  const resolvedSearchParams = (await searchParams) ?? {};

  if (!snapshot.daemon.running) {
    return <DaemonOfflineState />;
  }

  const currentSite = snapshot.sites[0] ?? null;
  let dynamicPriceSnapshot: Awaited<
    ReturnType<typeof getDynamicPriceSnapshot>
  > | null = null;
  let dynamicPriceSnapshotError: string | null = null;
  let weatherForecast: Awaited<ReturnType<typeof getWeatherForecast>> | null =
    null;
  let weatherForecastError: string | null = null;

  const batteries = currentSite
    ? currentSite.devices.filter((device) => device.kind === "battery")
    : [];
  const currentSiteId = currentSite?.id ?? null;

  const normalizedBatteryInfoById = new Map<
    string,
    Awaited<ReturnType<typeof getBatteryNormalizedInfo>>
  >(
    await Promise.all(
      batteries.map(
        async (battery) =>
          [
            battery.id,
            await getBatteryNormalizedInfo({
              id: battery.id,
              siteId: currentSiteId ?? "",
            }),
          ] as const,
      ),
    ),
  );

  if (currentSite) {
    try {
      if (currentSite.dynamicPriceSources[0]) {
        dynamicPriceSnapshot = await getDynamicPriceSnapshot({
          siteId: currentSite.id,
        });
      }
    } catch (error) {
      dynamicPriceSnapshotError = error instanceof Error ? error.message : String(error);
    }

    try {
      if (currentSite.weatherSources[0]) {
        weatherForecast = await getWeatherForecast({
          hours: 48,
          periodMinutes: 15,
          siteId: currentSite.id,
        });
      }
    } catch (error) {
      weatherForecastError = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <>
      <ToastOnSearchParams />
      <AppShell
        generatedAt={snapshot.generatedAt}
        headerActions={
          <SettingsDialog>
            <SettingsPanel
              currentSite={currentSite}
              dynamicPriceSnapshot={dynamicPriceSnapshot}
              dynamicPriceSnapshotError={dynamicPriceSnapshotError}
              weatherForecast={weatherForecast}
              weatherForecastError={weatherForecastError}
            />
          </SettingsDialog>
        }
      >
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
        <section className="flex w-full flex-col items-center gap-6">
          {batteries.map((battery) => {
            const currentState = battery.telemetry?.state ?? battery.state;
            const currentPower = battery.telemetry?.powerW ?? null;
            const socPercent = battery.telemetry?.socPercent ?? null;
            const capacityWh =
              normalizedBatteryInfoById.get(battery.id)?.capacityWh ?? null;

            return (
              <Card
                key={battery.id}
                className="mx-auto w-full max-w-3xl overflow-hidden border-white/12 bg-slate-950/70"
              >
                <CardHeader className="border-b border-white/8 px-6 py-5 sm:px-8">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                        {battery.name}
                      </CardTitle>
                    </div>
                    <BatteryStrategyDialog
                      batteryId={battery.id}
                      batteryName={battery.name}
                      capacityWh={capacityWh}
                      currentSocPercent={socPercent}
                      minimumDischargePercent={
                        battery.minimumDischargePercent ?? 10
                      }
                      siteId={currentSiteId ?? ""}
                      strategy={
                        battery.batteryStrategy ?? {
                          manualChargeTargetSoc: 100,
                          manualDischargeTargetSoc:
                            battery.minimumDischargePercent ?? 10,
                          strategyMode: "self-consumption",
                          manualPowerW: null,
                          manualState: "idle",
                          manualTargetSoc: 100,
                        }
                      }
                      nowModeActive={battery.batteryNowModeActive}
                      strategyPlan={battery.batteryStrategyPlan ?? []}
                    />
                  </div>
                </CardHeader>
                <CardContent className="px-6 py-6 sm:px-8 sm:py-8">
                  <div className="flex flex-col items-center justify-center gap-6">
                    <div className="flex flex-nowrap items-center justify-center gap-3 sm:gap-6">
                      <BatteryChargeGauge socPercent={socPercent} />
                      <PowerIndicator
                        state={currentState}
                        value={currentPower}
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Current state
                      </p>
                      <p className="mt-2 text-lg font-medium capitalize text-slate-200">
                        {formatManagedDeviceState(currentState)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </AppShell>
    </>
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

  const roundedValue = Math.round(Math.abs(value));

  if (roundedValue === 0) {
    return "0 W";
  }

  return `${roundedValue} W`;
}

function getBatteryFillClass(socPercent: number | null): string {
  if (socPercent === null) {
    return "bg-slate-500/70";
  }

  if (socPercent < 25) {
    return "bg-rose-500/85";
  }

  if (socPercent >= 80) {
    return "bg-emerald-400/85";
  }

  return "bg-sky-400/85";
}

function getPowerFillClass(state: string): string {
  if (state === "charging") {
    return "bg-emerald-400/85";
  }

  if (state === "discharging") {
    return "bg-sky-400/85";
  }

  return "bg-slate-500/70";
}
