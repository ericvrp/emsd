"use client";

import type {
  BatteryStrategyPlanRecord,
  BatteryStrategyRecord,
} from "@emsd/core";
import { CalendarClock, Hand, X } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  setHouseStrategyAction,
  setHouseStrategyPlanAction,
} from "../app/actions";
import { UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import { BatteryStrategyForm } from "./battery-strategy-form";
import { BatteryStrategyPlanForm } from "./battery-strategy-plan-form";
import { Button } from "./ui/button";
import { DialogPortal } from "./ui/dialog-portal";

const STRATEGY_REFRESH_INTERVAL_MS = 5_000;

interface HouseStrategyDialogProps {
  batteries: Array<{
    id: string;
    name: string;
    minimumDischargePercent: number;
    batteryStrategy: BatteryStrategyRecord | null;
    batteryStrategyPlan: BatteryStrategyPlanRecord;
    batteryStrategySummary: string | null;
    batteryManualTargetMethod: "soc" | "duration" | "end-time" | null;
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

function getModeIcon(
  manualModeActive: boolean,
): ComponentType<{ className?: string }> {
  return manualModeActive ? Hand : CalendarClock;
}

function ModeIcon({ manualModeActive }: { manualModeActive: boolean }) {
  const Icon = getModeIcon(manualModeActive);
  return <Icon className="h-4 w-4" />;
}

export function HouseStrategyDialog({
  batteries,
  siteId,
}: HouseStrategyDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const firstBattery = batteries[0];
  const manualModeActive = batteries.some((b) => b.batteryManualModeActive);
  const [selectedMode, setSelectedMode] = useState<"manual" | "strategy">(
    manualModeActive ? "manual" : "strategy",
  );
  const [liveStrategySummary, setLiveStrategySummary] = useState(
    firstBattery?.batteryStrategySummary ?? "Default strategy",
  );

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

  useEffect(() => {
    if (isOpen) {
      setSelectedMode(manualModeActive ? "manual" : "strategy");
    }
  }, [isOpen, manualModeActive]);

  useEffect(() => {
    setLiveStrategySummary(firstBattery?.batteryStrategySummary ?? "Default strategy");
  }, [firstBattery?.batteryStrategySummary]);

  useEffect(() => {
    let cancelled = false;

    async function refreshStrategySummary() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch(
          `/api/site/current?siteId=${encodeURIComponent(siteId)}`,
          {
            cache: "no-store",
          },
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Strategy current request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          currentStrategySummary?: string | null;
        };

        if (cancelled) {
          return;
        }

        setLiveStrategySummary(
          payload.currentStrategySummary ?? firstBattery?.batteryStrategySummary ?? "Default strategy",
        );
      } catch {
        if (!cancelled) {
          setLiveStrategySummary(firstBattery?.batteryStrategySummary ?? "Default strategy");
        }
      }
    }

    void refreshStrategySummary();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshStrategySummary();
      }
    }

    const interval = window.setInterval(() => {
      void refreshStrategySummary();
    }, STRATEGY_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [firstBattery?.batteryStrategySummary, siteId]);

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
  const currentSocPercent = firstBattery?.telemetry?.socPercent ?? null;
  const capacityWh = firstBattery?.telemetry?.capacityWh ?? null;
  const buttonLabel = liveStrategySummary ?? "Default strategy";

  return (
    <>
      <Button
        aria-label={`Strategy: ${buttonLabel}`}
        onClick={() => setIsOpen(true)}
        type="button"
        variant="ghost"
      >
        <ModeIcon manualModeActive={manualModeActive} />
        <span>{buttonLabel}</span>
      </Button>

      {isOpen ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-start justify-center py-6">
              <div className="flex h-[min(90vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-6">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                      Strategy
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
                            firstBattery?.batteryManualTargetDurationMinutes ?? null
                          }
                          manualTargetEndTime={
                            firstBattery?.batteryManualTargetEndTime ?? null
                          }
                          manualTargetMethod={
                            firstBattery?.batteryManualTargetMethod ?? null
                          }
                          showContextSummary={false}
                          minimumDischargePercent={minimumDischargePercent}
                          returnPath="/"
                          siteId={siteId}
                          strategy={strategy}
                          submitLabel="Save"
                        />
                      ) : (
                        <BatteryStrategyPlanForm
                          action={setHouseStrategyPlanAction}
                          batteryId="house"
                          batteryName="All batteries"
                          minimumDischargePercent={minimumDischargePercent}
                          returnPath="/"
                          siteId={siteId}
                          strategyPlan={strategyPlan}
                          submitLabel="Save"
                        />
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
