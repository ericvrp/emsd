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
import { BatteryStrategyForm } from "./battery-strategy-form";
import { BatteryStrategyPlanForm } from "./battery-strategy-plan-form";
import { Button } from "./ui/button";
import { DialogPortal } from "./ui/dialog-portal";

interface HouseStrategyDialogProps {
  batteries: Array<{
    id: string;
    name: string;
    minimumDischargePercent: number;
    batteryStrategy: BatteryStrategyRecord | null;
    batteryStrategyPlan: BatteryStrategyPlanRecord;
    batteryManualModeActive: boolean;
    telemetry: {
      socPercent: number | null;
      capacityWh: number | null;
    } | null;
  }>;
  siteId: string;
  siteName: string;
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

function formatStrategyLabel(
  manualModeActive: boolean,
  strategy: BatteryStrategyRecord,
  strategyPlan: BatteryStrategyPlanRecord,
): string {
  if (manualModeActive) {
    if (strategy.strategyMode === "self-consumption") {
      return "Self-consumption";
    }

    if (strategy.manualState === "charging") {
      return "Charge";
    }

    if (strategy.manualState === "discharging") {
      return "Discharge";
    }

    return "Idle";
  }

  const value = strategyPlan[0] ?? null;

  if (!value) {
    return "Scheduled";
  }

  if (value.strategyMode === "self-consumption") {
    return "Self-consumption";
  }

  return "Manual";
}

export function HouseStrategyDialog({
  batteries,
  siteId,
  siteName,
}: HouseStrategyDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const firstBattery = batteries[0];
  const manualModeActive = batteries.some((b) => b.batteryManualModeActive);
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
  const buttonLabel = formatStrategyLabel(
    manualModeActive,
    strategy,
    strategyPlan,
  );

  return (
    <>
      <Button
        aria-label={buttonLabel}
        onClick={() => setIsOpen(true)}
        type="button"
        variant="ghost"
      >
        <ModeIcon manualModeActive={manualModeActive} />
        <span className="hidden sm:inline">{buttonLabel}</span>
      </Button>

      {isOpen ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-start justify-center py-6">
              <div className="flex h-[min(90vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-6">
                <div className="mb-6 flex items-start justify-between gap-4">
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
                  <div className="space-y-6">
                    <div className="rounded-t-2xl border-b border-white/10 bg-white/5 px-4 pb-1">
                      <div className="flex items-center justify-center gap-6">
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

                    {selectedMode === "manual" ? (
                      <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                        <div className="space-y-4">
                          <BatteryStrategyForm
                            action={setHouseStrategyAction}
                            batteryId="house"
                            batteryName="All batteries"
                            capacityWh={capacityWh}
                            currentSocPercent={currentSocPercent}
                            hideStrategySelector
                            manualOnly
                            manualModeActive={true}
                            showContextSummary={false}
                            minimumDischargePercent={minimumDischargePercent}
                            returnPath="/"
                            siteId={siteId}
                            strategy={strategy}
                            submitLabel="Save"
                          />
                        </div>
                      </div>
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
      className={`inline-flex flex-1 items-center justify-center gap-2 border-b-2 border-transparent px-1 py-2 text-sm font-medium transition ${
        active
          ? "border-white text-white"
          : "text-slate-200 hover:border-white/25 hover:text-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-[15px] w-[15px]" />
      {label}
    </button>
  );
}
