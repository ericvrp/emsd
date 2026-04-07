"use client";

import type {
  BatteryStrategyPlanRecord,
  BatteryStrategyRecord,
} from "@emsd/core";
import { ChevronDown, ChevronUp, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { setBatteryStrategyAction } from "../app/actions";
import { BatteryStrategyForm } from "./battery-strategy-form";
import { BatteryStrategyPlanForm } from "./battery-strategy-plan-form";
import { SubmitButton } from "./submit-button";
import { Button } from "./ui/button";
import { DialogPortal } from "./ui/dialog-portal";

export function BatteryStrategyDialog({
  batteryId,
  batteryName,
  capacityWh,
  currentSocPercent,
  minimumDischargePercent,
  nowModeActive,
  siteId,
  strategy,
  strategyPlan,
}: {
  batteryId: string;
  batteryName: string;
  capacityWh: number | null;
  currentSocPercent: number | null;
  minimumDischargePercent: number;
  nowModeActive: boolean;
  siteId: string;
  strategy: BatteryStrategyRecord;
  strategyPlan: BatteryStrategyPlanRecord;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isNowModeOpen, setIsNowModeOpen] = useState(nowModeActive);
  const defaultStrategy = getDefaultStrategy(
    strategyPlan[0],
    minimumDischargePercent,
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
      setIsNowModeOpen(nowModeActive);
    }
  }, [isOpen, nowModeActive]);

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="ghost">
        <Settings2 size={16} />
        {formatStrategyLabel({ nowModeActive, strategy, strategyPlan })}
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
                    <div className="rounded-3xl border border-white/10 bg-white/4 px-5 py-4">
                      <button
                        className="flex w-full items-center justify-between gap-4 text-left"
                        onClick={() => setIsNowModeOpen((value) => !value)}
                        type="button"
                      >
                        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                          Now Mode
                        </p>
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-slate-950/50 p-2 text-slate-200">
                          {isNowModeOpen ? (
                            <ChevronUp size={16} />
                          ) : (
                            <ChevronDown size={16} />
                          )}
                        </span>
                      </button>

                      {isNowModeOpen ? (
                        <div className="mt-5 max-w-2xl space-y-4">
                          <BatteryStrategyForm
                            batteryId={batteryId}
                            batteryName={batteryName}
                            capacityWh={capacityWh}
                            currentSocPercent={currentSocPercent}
                            hideStrategySelector
                            manualOnly
                            nowModeActive
                            showContextSummary={false}
                            minimumDischargePercent={minimumDischargePercent}
                            returnPath="/"
                            siteId={siteId}
                            strategy={strategy}
                            submitLabel="Apply manual override"
                          />
                          <form
                            action={setBatteryStrategyAction}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-slate-950/40 p-4"
                          >
                            <input type="hidden" name="siteId" value={siteId} />
                            <input
                              type="hidden"
                              name="batteryId"
                              value={batteryId}
                            />
                            <input
                              type="hidden"
                              name="batteryName"
                              value={batteryName}
                            />
                            <input type="hidden" name="returnPath" value="/" />
                            <input
                              type="hidden"
                              name="nowModeActive"
                              value="false"
                            />
                            <input
                              type="hidden"
                              name="strategyMode"
                              value={defaultStrategy.strategyMode}
                            />
                            <input
                              type="hidden"
                              name="manualState"
                              value={defaultStrategy.manualState ?? ""}
                            />
                            <input
                              type="hidden"
                              name="manualPowerW"
                              value={defaultStrategy.manualPowerW ?? ""}
                            />
                            <input
                              type="hidden"
                              name="manualTargetSoc"
                              value={defaultStrategy.manualTargetSoc ?? ""}
                            />
                            <input
                              type="hidden"
                              name="manualChargeTargetSoc"
                              value={
                                defaultStrategy.manualChargeTargetSoc ?? ""
                              }
                            />
                            <input
                              type="hidden"
                              name="manualDischargeTargetSoc"
                              value={
                                defaultStrategy.manualDischargeTargetSoc ?? ""
                              }
                            />
                            <div>
                              <p className="text-sm font-medium text-white">
                                Return to default
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                Apply the fallback strategy immediately.
                              </p>
                            </div>
                            <SubmitButton variant="ghost">
                              Resume default now
                            </SubmitButton>
                          </form>
                        </div>
                      ) : null}
                    </div>

                    <BatteryStrategyPlanForm
                      batteryId={batteryId}
                      batteryName={batteryName}
                      minimumDischargePercent={minimumDischargePercent}
                      returnPath="/"
                      siteId={siteId}
                      strategyPlan={strategyPlan}
                    />
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

function formatStrategyLabel(input: {
  nowModeActive: boolean;
  strategy: BatteryStrategyRecord;
  strategyPlan: BatteryStrategyPlanRecord;
}): string {
  if (input.nowModeActive) {
    if (input.strategy.manualState === "charging") {
      return "Now: Charging";
    }

    if (input.strategy.manualState === "discharging") {
      return "Now: Discharging";
    }

    return "Now Mode";
  }

  const value = input.strategyPlan[0] ?? null;

  if (!value) {
    return "Strategy";
  }

  if (value.strategyMode === "self-consumption") {
    return "Strategy: Self-consumption";
  }

  if (value.manualState === "idle") {
    return "Strategy: Idle";
  }

  return "Strategy: Scheduled";
}

function getDefaultStrategy(
  item: BatteryStrategyPlanRecord[number] | null | undefined,
  minimumDischargePercent: number,
): BatteryStrategyRecord {
  if (!item || item.strategyMode === "self-consumption") {
    return {
      strategyMode: "self-consumption",
      manualState: null,
      manualPowerW: null,
      manualTargetSoc: 100,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: minimumDischargePercent,
    };
  }

  return {
    strategyMode: "manual",
    manualState: item.manualState ?? "idle",
    manualPowerW:
      item.manualState === "idle" ? null : (item.manualPowerW ?? 2400),
    manualTargetSoc:
      item.manualState === "discharging"
        ? (item.manualDischargeTargetSoc ?? minimumDischargePercent)
        : (item.manualChargeTargetSoc ?? 100),
    manualChargeTargetSoc: item.manualChargeTargetSoc ?? 100,
    manualDischargeTargetSoc:
      item.manualDischargeTargetSoc ?? minimumDischargePercent,
  };
}
