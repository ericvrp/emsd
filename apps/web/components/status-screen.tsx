import { formatManagedDeviceState } from "@emsd/core";
import { BatteryCharging, Zap } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../auth";
import { AppShell } from "./app-shell";
import { BatteryStrategyDialog } from "./battery-strategy-dialog";
import { DaemonOfflineState } from "./daemon-offline-state";
import { SettingsDialog } from "./settings-dialog";
import { SettingsPanel } from "./settings-panel";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { getBatteryNormalizedInfo, getLiveStatus } from "../lib/ems-bridge";

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
  const notice = getSingleValue(resolvedSearchParams.notice);
  const tone =
    getSingleValue(resolvedSearchParams.tone) === "error" ? "error" : "success";

  if (!snapshot.daemon.running) {
    return <DaemonOfflineState />;
  }

  const currentSite = snapshot.sites[0] ?? null;

  const batteries = currentSite
    ? currentSite.devices.filter((device) => device.kind === "battery")
    : [];
  const currentSiteId = currentSite?.id ?? null;
  const initialSettingsTab =
    currentSite === null ? "site" : batteries.length === 0 ? "discover" : null;

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

  return (
    <AppShell
      generatedAt={snapshot.generatedAt}
      headerActions={
        <SettingsDialog>
          <SettingsPanel
            currentSite={currentSite}
            initialTab={initialSettingsTab}
            notice={notice}
            tone={tone}
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
        <section className="grid gap-6 2xl:grid-cols-2">
          {batteries.map((battery) => {
            const currentState = battery.telemetry?.state ?? battery.state;
            const currentPower = battery.telemetry?.powerW ?? null;
            const socPercent = battery.telemetry?.socPercent ?? null;
            const capacityWh =
              normalizedBatteryInfoById.get(battery.id)?.capacityWh ?? null;

            return (
              <Card
                key={battery.id}
                className="overflow-hidden border-white/12 bg-slate-950/70"
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
                    />
                  </div>
                </CardHeader>
                <CardContent className="px-6 py-6 sm:px-8 sm:py-8">
                  <div className="flex flex-col items-center justify-center gap-6">
                    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-6">
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
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return value?.[0] ?? null;
}

function BatteryChargeGauge({ socPercent }: { socPercent: number | null }) {
  const value =
    socPercent === null ? 0 : Math.max(0, Math.min(100, socPercent));
  const fillHeight = 136 * (value / 100);

  return (
    <div className="flex w-[220px] flex-col items-center justify-center">
      <div
        aria-label={`Battery charge ${formatSocPercent(socPercent)}`}
        className="relative h-[184px] w-[112px] rounded-[28px] border-4 border-white/15 bg-slate-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
        role="img"
      >
        <div className="absolute left-1/2 top-[-12px] h-3 w-14 -translate-x-1/2 rounded-t-xl border-4 border-b-0 border-white/15 bg-slate-950" />
        <div className="absolute inset-[10px] overflow-hidden rounded-[20px] bg-white/5">
          <div
            className={`absolute inset-x-0 bottom-0 transition-[height] duration-500 ${getBatteryFillClass(socPercent)}`}
            style={{ height: `${fillHeight}px` }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center text-center">
          <BatteryCharging className="h-10 w-10 text-white/80" />
        </div>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        Charge
      </p>
      <p className="mt-2 whitespace-nowrap text-4xl font-semibold text-white">
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
  const fillHeight = 136 * (normalizedValue / maxPower);

  return (
    <div className="flex w-[220px] flex-col items-center justify-center">
      <div
        aria-label={`Current power ${formatPower(value)}`}
        className="relative h-[184px] w-[112px] rounded-[24px] border-4 border-white/15 bg-slate-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
        role="img"
      >
        <div className="absolute inset-[10px] overflow-hidden rounded-[18px] bg-white/5">
          <div
            className={`absolute inset-x-0 bottom-0 transition-[height] duration-500 ${getPowerFillClass(state)}`}
            style={{ height: `${fillHeight}px` }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
          <Zap className="h-10 w-10 text-white/80" />
        </div>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        Power
      </p>
      <p className="mt-2 whitespace-nowrap text-4xl font-semibold text-white">
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
