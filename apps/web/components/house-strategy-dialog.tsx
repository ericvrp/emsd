"use client";

import type {
  BatteryStrategyPlanRecord,
  BatteryStrategyRecord,
  BatteryStrategyTargetMethod,
} from "@emsd/core/client";
import { CalendarClock, FileText, Hand, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  setHouseStrategyAction,
  setHouseStrategyPlanAction,
} from "../app/actions";
import { formatLocalDayKey, resolveRelativeDayParam } from "../lib/day-utils";
import { UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import { BatteryStrategyForm } from "./battery-strategy-form";
import { BatteryStrategyPlanForm } from "./battery-strategy-plan-form";
import { Button } from "./ui/button";
import { DialogPortal } from "./ui/dialog-portal";
import { type SiteCurrentResponse, useLiveJsonSWR } from "./use-live-json-swr";

const STRATEGY_REFRESH_INTERVAL_MS = 5_000;

interface DaemonLogRecord {
  id: number;
  level: "info" | "warn" | "error" | "verbose";
  message: string;
  loggedAt: string;
}

interface HouseStrategyDialogProps {
  batteries: Array<{
    id: string;
    name: string;
    maximumChargePowerW: number;
    maximumDischargePowerW: number;
    minimumDischargePercent: number;
    batteryStrategy: BatteryStrategyRecord | null;
    batteryStrategyPlan: BatteryStrategyPlanRecord;
    batteryStrategySummary: string | null;
    batteryManualTargetMethod: BatteryStrategyTargetMethod | null;
    batteryManualTargetDurationMinutes: number | null;
    batteryManualTargetEndTime: string | null;
    batteryManualModeActive: boolean;
    telemetry: {
      socPercent: number | null;
      capacityWh: number | null;
    } | null;
  }>;
  siteId: string;
}

export function HouseStrategyDialog({
  batteries,
  siteId,
}: HouseStrategyDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstBattery = batteries[0];
  const manualModeActive = batteries.some((b) => b.batteryManualModeActive);
  const [selectedMode, setSelectedMode] = useState<
    "manual" | "strategy" | "logs"
  >(manualModeActive ? "manual" : "strategy");
  const returnPath = buildReturnPath(pathname, searchParams);
  const selectedDay =
    resolveRelativeDayParam(searchParams.get("day")) ?? formatLocalDayKey(new Date());
  const { data: currentData } = useLiveJsonSWR<SiteCurrentResponse>(
    `/api/site/current?siteId=${encodeURIComponent(siteId)}`,
    {
      failureMessage:
        "Strategy updates are retrying. Showing last available data.",
      refreshIntervalMs: STRATEGY_REFRESH_INTERVAL_MS,
    },
  );
  const effectiveManualModeActive =
    currentData?.currentManualModeActive ?? manualModeActive;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const strategy = firstBattery?.batteryStrategy ?? {
    strategyMode: "self-consumption",
    manualPowerW: null,
    manualState: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: firstBattery?.minimumDischargePercent ?? 10,
    manualTargetSoc: 100,
  };

  const strategyPlan = firstBattery?.batteryStrategyPlan ?? [];
  const minimumDischargePercent = firstBattery?.minimumDischargePercent ?? 10;
  const maximumChargePowerW = firstBattery?.maximumChargePowerW ?? 800;
  const maximumDischargePowerW = firstBattery?.maximumDischargePowerW ?? 800;
  const currentSocPercent = firstBattery?.telemetry?.socPercent ?? null;
  const capacityWh = firstBattery?.telemetry?.capacityWh ?? null;
  const liveStrategySummary =
    currentData?.currentStrategySummary ??
    firstBattery?.batteryStrategySummary ??
    "Default strategy";
  const buttonLabel = liveStrategySummary ?? "Default strategy";

  return (
    <>
      <Button
        aria-label={`Strategy: ${buttonLabel}`}
        onClick={() => {
          setSelectedMode(effectiveManualModeActive ? "manual" : "strategy");
          setIsOpen(true);
        }}
        type="button"
        variant="ghost"
      >
        {effectiveManualModeActive ? (
          <Hand className="h-4 w-4" />
        ) : (
          <CalendarClock className="h-4 w-4" />
        )}
        <span className="hidden md:inline">{buttonLabel}</span>
      </Button>

      {isOpen ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-start justify-center py-6">
              <div className="flex h-[min(90vh,960px)] w-full max-w-[96rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-6">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                      Strategy
                    </p>
                    <p className="mt-2 text-base text-slate-400">
                      Current: {liveStrategySummary ?? "Default strategy"}
                    </p>
                  </div>
                  <Button
                    aria-label="Close strategy dialog"
                    className="h-9 w-9 px-0"
                    onClick={() => setIsOpen(false)}
                    type="button"
                    variant="ghost"
                  >
                    <X size={18} />
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="overflow-hidden rounded-2xl bg-white/5">
                    <div className="pt-2.5 sm:pt-3">
                      <div className={UI_STYLES.tabBar}>
                        <ModeSwitchButton
                          active={selectedMode === "manual"}
                          icon={Hand}
                          label="Manual"
                          onClick={() => setSelectedMode("manual")}
                        />
                        <ModeSwitchButton
                          active={selectedMode === "strategy"}
                          icon={CalendarClock}
                          label="Automatic"
                          onClick={() => setSelectedMode("strategy")}
                        />
                        <ModeSwitchButton
                          active={selectedMode === "logs"}
                          icon={FileText}
                          label="Logs"
                          onClick={() => setSelectedMode("logs")}
                        />
                      </div>
                    </div>

                    <div className="px-4 py-5">
                      {selectedMode === "manual" ? (
                        <BatteryStrategyForm
                          action={setHouseStrategyAction}
                          batteryId="house"
                          batteryName="All batteries"
                          capacityWh={capacityWh}
                          currentSocPercent={currentSocPercent}
                          hideStrategySelector
                          manualOnly
                          manualModeActive={true}
                          manualTargetDurationMinutes={
                            firstBattery?.batteryManualTargetDurationMinutes ??
                            null
                          }
                          manualTargetEndTime={
                            firstBattery?.batteryManualTargetEndTime ?? null
                          }
                          manualTargetMethod={
                            firstBattery?.batteryManualTargetMethod ?? null
                          }
                          maximumChargePowerW={maximumChargePowerW}
                          maximumDischargePowerW={maximumDischargePowerW}
                          showContextSummary={false}
                          minimumDischargePercent={minimumDischargePercent}
                          onSuccess={() => setIsOpen(false)}
                          returnPath={returnPath}
                          siteId={siteId}
                          strategy={strategy}
                          submitLabel="Save"
                        />
                      ) : selectedMode === "strategy" ? (
                        <BatteryStrategyPlanForm
                          action={setHouseStrategyPlanAction}
                          batteryId="house"
                          batteryName="All batteries"
                          minimumDischargePercent={minimumDischargePercent}
                          onSuccess={() => setIsOpen(false)}
                          returnPath={returnPath}
                          siteId={siteId}
                          strategyPlan={strategyPlan}
                          submitLabel="Save"
                        />
                      ) : (
                        <DaemonLogsPanel day={selectedDay} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogPortal>
      ) : null}
    </>
  );
}

function DaemonLogsPanel({ day }: { day: string }) {
  const { data: logs, refreshError } = useLiveJsonSWR<DaemonLogRecord[]>(
    `/api/daemon/logs?day=${encodeURIComponent(day)}&limit=300`,
    {
      failureMessage: "Daemon logs are temporarily unavailable.",
      refreshIntervalMs: 10_000,
    },
  );
  const entries = logs ? [...logs].reverse() : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Daemon logs</h3>
          <p className="mt-1 text-sm text-slate-400">
            Messages recorded on {day}, newest logs refresh automatically.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
          {entries.length} entries
        </span>
      </div>

      {refreshError ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {refreshError}
        </div>
      ) : null}

      <div className="max-h-[50vh] overflow-auto rounded-2xl border border-white/10 bg-slate-950/70">
        {entries.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">
            No daemon logs found for this day.
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {entries.map((log) => (
              <div
                className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[10rem_5rem_1fr]"
                key={log.id}
              >
                <time className="font-mono text-xs text-slate-400">
                  {formatLogTime(log.loggedAt)}
                </time>
                <span className={cn("text-xs font-semibold uppercase", getLogLevelClassName(log.level))}>
                  {log.level}
                </span>
                <p className="break-words text-slate-200">{log.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatLogTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getLogLevelClassName(level: DaemonLogRecord["level"]): string {
  if (level === "error") {
    return "text-rose-300";
  }

  if (level === "warn") {
    return "text-amber-300";
  }

  if (level === "verbose") {
    return "text-cyan-300";
  }

  return "text-emerald-300";
}

function ModeSwitchButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        UI_STYLES.tabItem,
        active ? UI_STYLES.tabItemActive : UI_STYLES.tabItemInactive,
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-[15px] w-[15px]" />
      {label}
    </button>
  );
}

function buildReturnPath(
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
): string {
  const params = new URLSearchParams(searchParams.toString());

  params.delete("notice");
  params.delete("tone");

  const search = params.toString();

  return search ? `${pathname}?${search}` : pathname;
}
