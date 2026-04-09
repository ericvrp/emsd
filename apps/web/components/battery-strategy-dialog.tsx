"use client";

import type {
  BatteryStrategyPlanRecord,
  BatteryStrategyRecord,
} from "@emsd/core";
import { CalendarClock, Hand, X } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { UI_STYLES } from "../lib/ui-colors";
import { BatteryStrategyForm } from "./battery-strategy-form";
import { BatteryStrategyPlanForm } from "./battery-strategy-plan-form";
import { Button } from "./ui/button";
import { DialogPortal } from "./ui/dialog-portal";

export function BatteryStrategyDialog({
  batteryId,
  batteryName,
  className,
  capacityWh,
  currentSocPercent,
  minimumDischargePercent,
  manualModeActive,
  siteId,
  strategy,
  strategyPlan,
}: {
  batteryId: string;
  batteryName: string;
  className?: string;
  capacityWh: number | null;
  currentSocPercent: number | null;
  minimumDischargePercent: number;
  manualModeActive: boolean;
  siteId: string;
  strategy: BatteryStrategyRecord;
  strategyPlan: BatteryStrategyPlanRecord;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"manual" | "strategy">(
    manualModeActive ? "manual" : "strategy",
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

  return (
    <>
      <Button
        aria-label={formatStrategyLabel({ manualModeActive, strategy, strategyPlan })}
        className={className}
        onClick={() => setIsOpen(true)}
        variant="ghost"
      >
        <CurrentModeIcon manualModeActive={manualModeActive} />
        <span className="hidden sm:inline">
          {formatStrategyLabel({ manualModeActive, strategy, strategyPlan })}
        </span>
      </Button>

      {isOpen ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-start justify-center py-6">
              <div className="flex h-[min(90vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                      Strategy
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold text-white">
                      {batteryName}
                    </h2>
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

                <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-6">
                    <div className={UI_STYLES.tabBar}>
                      <ModeSwitchButton
                        active={selectedMode === "manual"}
                        icon={Hand}
                        label="Manual Mode"
                        onClick={() => setSelectedMode("manual")}
                      />
                      <ModeSwitchButton
                        active={selectedMode === "strategy"}
                        icon={CalendarClock}
                        label="Strategy Mode"
                        onClick={() => setSelectedMode("strategy")}
                      />
                    </div>

                    {selectedMode === "manual" ? (
                      <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                        <div className="space-y-4">
                          <BatteryStrategyForm
                            batteryId={batteryId}
                            batteryName={batteryName}
                            capacityWh={capacityWh}
                            currentSocPercent={currentSocPercent}
                            hideStrategySelector
                            manualOnly
                            manualModeActive
                            showContextSummary={false}
                            minimumDischargePercent={minimumDischargePercent}
                            returnPath="/"
                            siteId={siteId}
                            strategy={strategy}
                            submitLabel="Apply"
                          />
                        </div>
                      </div>
                    ) : (
                      <BatteryStrategyPlanForm
                        batteryId={batteryId}
                        batteryName={batteryName}
                        minimumDischargePercent={minimumDischargePercent}
                        returnPath="/"
                        siteId={siteId}
                        strategyPlan={strategyPlan}
                      />
                    )}
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
      className={`${UI_STYLES.tabItem} px-3 py-2 ${active ? UI_STYLES.tabItemActive : UI_STYLES.tabItemInactive}`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function CurrentModeIcon({
  manualModeActive,
}: {
  manualModeActive: boolean;
}) {
  const Icon = manualModeActive ? Hand : CalendarClock;
  return <Icon size={16} />;
}

function formatStrategyLabel(input: {
  manualModeActive: boolean;
  strategy: BatteryStrategyRecord;
  strategyPlan: BatteryStrategyPlanRecord;
}): string {
  if (input.manualModeActive) {
    if (input.strategy.strategyMode === "self-consumption") {
      return "Self-consumption";
    }

    if (input.strategy.manualState === "charging") {
      return "Charging";
    }

    if (input.strategy.manualState === "discharging") {
      return "Discharging";
    }

    return "Idle";
  }

  const value = input.strategyPlan[0] ?? null;

  if (!value) {
    return "Scheduled";
  }

  if (value.strategyMode === "self-consumption") {
    return "Self-consumption";
  }

  if (value.manualState === "idle") {
    return "Idle";
  }

  return "Scheduled";
}
