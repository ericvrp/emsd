"use client";

import type {
  BatteryManualState,
  BatteryStrategyRecord,
} from "@emsd/core/client";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ActionResult } from "../app/actions";
import { setHouseStrategyAction } from "../app/actions";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";
import { SubmitButton } from "./submit-button";
import { useFormActionToast } from "./use-form-action-toast";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BatteryStrategyFormProps {
  action?: (formData: FormData) => Promise<ActionResult>;
  batteryId: string;
  batteryName?: string;
  capacityWh: number | null;
  currentSocPercent: number | null;
  hideStrategySelector?: boolean;
  manualOnly?: boolean;
  manualModeActive?: boolean;
  manualTargetDurationMinutes?: number | null;
  manualTargetEndTime?: string | null;
  manualTargetMethod?: TargetMethod | null;
  maximumChargePowerW: number;
  maximumDischargePowerW: number;
  showContextSummary?: boolean;
  minimumDischargePercent: number;
  returnPath?: string;
  siteId: string;
  strategy: BatteryStrategyRecord;
  submitLabel?: string;
  onSuccess?: () => void;
}

type TargetMethod = "soc" | "duration" | "end-time" | "auto";
type ManualModeAction = "self-consumption" | BatteryManualState;

export function BatteryStrategyForm({
  action = setHouseStrategyAction,
  batteryId,
  batteryName,
  capacityWh,
  currentSocPercent,
  hideStrategySelector = false,
  manualOnly = false,
  manualModeActive,
  manualTargetDurationMinutes,
  manualTargetEndTime,
  manualTargetMethod,
  maximumChargePowerW,
  maximumDischargePowerW,
  showContextSummary = true,
  minimumDischargePercent,
  returnPath,
  siteId,
  strategy,
  submitLabel = "Apply battery control",
  onSuccess,
}: BatteryStrategyFormProps) {
  const [strategyMode, setStrategyMode] = useState(
    manualOnly && strategy.strategyMode === "self-consumption"
      ? "self-consumption"
      : manualOnly
        ? "manual"
        : strategy.strategyMode,
  );
  const [manualState, setManualState] = useState<BatteryManualState>(
    strategy.strategyMode === "manual"
      ? (strategy.manualState ?? "idle")
      : strategy.manualState === "discharging"
        ? "discharging"
        : "charging",
  );
  const [manualChargeTargetSocInput, setManualChargeTargetSocInput] = useState(
    String(strategy.manualChargeTargetSoc ?? 100),
  );
  const [manualLabel, setManualLabel] = useState("");
  const [manualDischargeTargetSocInput, setManualDischargeTargetSocInput] =
    useState(
      String(strategy.manualDischargeTargetSoc ?? minimumDischargePercent),
    );
  const [manualTargetSocInput, setManualTargetSocInput] = useState(
    String(strategy.manualTargetSoc ?? 100),
  );
  const [durationMinutes, setDurationMinutes] = useState(
    String(manualTargetDurationMinutes ?? 60),
  );
  const [targetMethod, setTargetMethod] = useState<TargetMethod>(
    manualTargetMethod ?? "soc",
  );
  const [endTime, setEndTime] = useState(
    manualTargetEndTime ?? getDefaultEndTimeValue(),
  );
  const [now, setNow] = useState(() => new Date());
  const submitAction = useFormActionToast(action, {
    onSuccess: () => {
      onSuccess?.();
    },
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat("tick clock");
      setNow(new Date());
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (
      manualOnly &&
      strategyMode !== "manual" &&
      strategyMode !== "self-consumption"
    ) {
      setStrategyMode("manual");
    }
  }, [manualOnly, strategyMode]);

  useEffect(() => {
    setTargetMethod(manualTargetMethod ?? "soc");
    setDurationMinutes(String(manualTargetDurationMinutes ?? 60));
    setEndTime(manualTargetEndTime ?? getDefaultEndTimeValue());
  }, [manualTargetDurationMinutes, manualTargetEndTime, manualTargetMethod]);

  const parsedManualChargeTargetSoc = parseOptionalNumber(
    manualChargeTargetSocInput,
  );
  const parsedManualDischargeTargetSoc = parseOptionalNumber(
    manualDischargeTargetSocInput,
  );
  const parsedManualTargetSoc = parseOptionalNumber(manualTargetSocInput);
  const parsedDurationMinutes = parseOptionalNumber(durationMinutes);
  const endTimeDurationMinutes = getDurationMinutesUntilEndTime(endTime, now);
  const selectedAction = getManualModeAction(strategyMode, manualState);
  const resolvedManualPowerW =
    selectedAction === "charging"
      ? maximumChargePowerW
      : selectedAction === "discharging"
        ? maximumDischargePowerW
        : null;
  const canEstimateTarget =
    capacityWh !== null &&
    currentSocPercent !== null &&
    resolvedManualPowerW !== null &&
    resolvedManualPowerW > 0 &&
    (selectedAction === "charging" || selectedAction === "discharging");
  const storedManualTargetSoc = clampTargetSoc(
    getCurrentStoredTargetSoc({
      action: selectedAction,
      minimumDischargePercent,
      parsedManualChargeTargetSoc,
      parsedManualDischargeTargetSoc,
      parsedManualTargetSoc,
    }),
    selectedAction,
    minimumDischargePercent,
  );

  const effectiveManualTargetSoc = useMemo(() => {
    if (strategyMode !== "manual" && strategyMode !== "self-consumption") {
      return strategy.manualTargetSoc ?? 100;
    }

    if (targetMethod === "soc") {
      return storedManualTargetSoc;
    }

    if (targetMethod === "auto") {
      return null;
    }

    if (selectedAction !== "charging" && selectedAction !== "discharging") {
      return storedManualTargetSoc;
    }

    const estimatedTargetSoc = estimateTargetSoc({
      capacityWh,
      currentSocPercent,
      direction: selectedAction,
      durationMinutes:
        targetMethod === "duration"
          ? parsedDurationMinutes
          : endTimeDurationMinutes,
      minimumDischargePercent,
      powerW: resolvedManualPowerW,
    });

    return estimatedTargetSoc;
  }, [
    capacityWh,
    currentSocPercent,
    endTimeDurationMinutes,
    minimumDischargePercent,
    parsedDurationMinutes,
    parsedManualChargeTargetSoc,
    parsedManualDischargeTargetSoc,
    parsedManualTargetSoc,
    resolvedManualPowerW,
    selectedAction,
    storedManualTargetSoc,
    strategy.manualTargetSoc,
    strategyMode,
    targetMethod,
  ]);

  const estimatedDurationMinutes = useMemo(() => {
    if (strategyMode !== "manual" && strategyMode !== "self-consumption") {
      return null;
    }

    if (targetMethod === "duration") {
      return parsedDurationMinutes;
    }

    if (targetMethod === "end-time") {
      return endTimeDurationMinutes;
    }

    if (targetMethod === "auto") {
      return null;
    }

    if (selectedAction !== "charging" && selectedAction !== "discharging") {
      return null;
    }

    return estimateDurationMinutes({
      capacityWh,
      currentSocPercent,
      direction: selectedAction,
      powerW: resolvedManualPowerW,
      targetSoc: effectiveManualTargetSoc,
    });
  }, [
    capacityWh,
    currentSocPercent,
    effectiveManualTargetSoc,
    endTimeDurationMinutes,
    parsedDurationMinutes,
    resolvedManualPowerW,
    selectedAction,
    strategyMode,
    targetMethod,
  ]);

  const estimatedEndTime = useMemo(() => {
    if (targetMethod === "end-time") {
      return formatClockTime(endTime);
    }

    return formatFutureTime(estimatedDurationMinutes, now);
  }, [endTime, estimatedDurationMinutes, now, targetMethod]);

  return (
    <form
      action={async (formData) => {
        await submitAction(formData);
      }}
      className="space-y-4"
    >
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="batteryId" value={batteryId} />
      {batteryName ? (
        <input type="hidden" name="batteryName" value={batteryName} />
      ) : null}
      <input type="hidden" name="returnPath" value={returnPath ?? "/"} />
      <input type="hidden" name="strategyMode" value={strategyMode} />
      <input type="hidden" name="manualLabel" value={manualLabel} />
      <input type="hidden" name="manualState" value={manualState} />
      {manualModeActive !== undefined ? (
        <input
          type="hidden"
          name="manualModeActive"
          value={String(manualModeActive)}
        />
      ) : null}
      <input
        type="hidden"
        name="manualTargetSoc"
        value={
          targetMethod === "auto"
            ? ""
            : String(effectiveManualTargetSoc ?? storedManualTargetSoc)
        }
      />
      <input type="hidden" name="targetMethod" value={targetMethod} />
      <input
        type="hidden"
        name="targetDurationMinutes"
        value={
          targetMethod === "duration" && parsedDurationMinutes !== null
            ? String(parsedDurationMinutes)
            : ""
        }
      />
      <input
        type="hidden"
        name="targetEndTime"
        value={targetMethod === "end-time" ? endTime : ""}
      />
      <input
        type="hidden"
        name="manualChargeTargetSoc"
        value={
          targetMethod === "auto"
            ? ""
            : clampTargetSoc(
                parsedManualChargeTargetSoc ?? 100,
                "charging",
                minimumDischargePercent,
              )
        }
      />
      <input
        type="hidden"
        name="manualDischargeTargetSoc"
        value={
          targetMethod === "auto"
            ? ""
            : clampTargetSoc(
                parsedManualDischargeTargetSoc ?? minimumDischargePercent,
                "discharging",
                minimumDischargePercent,
              )
        }
      />

      <div
        className={
          hideStrategySelector
            ? "grid gap-3 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:items-end"
            : "grid gap-4 md:grid-cols-2"
        }
      >
        {!hideStrategySelector ? (
          <div className="space-y-2">
            <Label htmlFor={`${batteryId}-strategy`}>Action</Label>
            <Select
              onValueChange={(value: string) =>
                setStrategyMode(value as "auto" | "manual" | "self-consumption")
              }
              value={strategyMode}
            >
              <SelectTrigger id={`${batteryId}-strategy`}>
                <SelectValue placeholder="Select strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="self-consumption">
                  Self-consumption
                </SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem disabled value="auto">
                  Auto (disabled)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {strategyMode === "manual" ||
        strategyMode === "self-consumption" ||
        manualOnly ? (
          <div className="space-y-2">
            <Label className="sr-only" htmlFor={`${batteryId}-state`}>
              {manualOnly ? "Manual mode selection" : "Manual state"}
            </Label>
            <Select
              onValueChange={(value: string) =>
                applyManualModeAction({
                  action: value as ManualModeAction,
                  setManualState,
                  setStrategyMode,
                })
              }
              value={getManualModeAction(strategyMode, manualState)}
            >
              <SelectTrigger id={`${batteryId}-state`}>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {manualOnly ? (
                  <SelectItem value="self-consumption">
                    Self-consumption
                  </SelectItem>
                ) : null}
                <SelectItem value="idle">Idle</SelectItem>
                <SelectItem value="charging">Charge</SelectItem>
                <SelectItem value="discharging">Discharge</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {strategyMode === "manual" || strategyMode === "self-consumption" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${batteryId}-manual-label`}>Name</Label>
            <Input
              id={`${batteryId}-manual-label`}
              onChange={(event) => setManualLabel(event.target.value)}
              placeholder="Optional strategy name"
              value={manualLabel}
            />
          </div>

          {showContextSummary ? (
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4 text-sm text-slate-300">
              <p>Current charge: {formatSoc(currentSocPercent)}</p>
              {capacityWh !== null ? (
                <p className="mt-1">
                  Known capacity: {formatCapacity(capacityWh)}
                </p>
              ) : null}
              <p className="mt-1">
                Minimum discharge: {minimumDischargePercent}%
              </p>
            </div>
          ) : null}

          {selectedAction !== "charging" && selectedAction !== "discharging" ? (
            <input type="hidden" name="manualPowerW" value="" />
          ) : null}

          <>
            {selectedAction === "charging" ||
            selectedAction === "discharging" ? (
              <div className="grid gap-3 xl:grid-cols-3">
                <div className="space-y-2 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Power limit
                  </p>
                  <p className="text-sm font-medium text-slate-100">
                    {resolvedManualPowerW === null
                      ? "No power limit"
                      : `${resolvedManualPowerW} W`}
                  </p>
                  <p className="text-xs text-slate-500">
                    Set on the device page.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${batteryId}-target-method`}>
                    Target method
                  </Label>
                  <Select
                    onValueChange={(value: string) =>
                      setTargetMethod(value as TargetMethod)
                    }
                    value={targetMethod}
                  >
                    <SelectTrigger id={`${batteryId}-target-method`}>
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="soc">Percentage</SelectItem>
                      <SelectItem value="duration">Duration</SelectItem>
                      <SelectItem value="end-time">End time</SelectItem>
                      <SelectItem value="auto">Dynamic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-3">
              {selectedAction !== "charging" &&
              selectedAction !== "discharging" ? (
                <div className="space-y-2 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Target method
                  </p>
                  <Select
                    onValueChange={(value: string) =>
                      setTargetMethod(value as TargetMethod)
                    }
                    value={targetMethod}
                  >
                    <SelectTrigger id={`${batteryId}-target-method`}>
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="soc">Percentage</SelectItem>
                      <SelectItem value="duration">Duration</SelectItem>
                      <SelectItem value="end-time">End time</SelectItem>
                      <SelectItem value="auto">Dynamic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {targetMethod === "soc" ? (
                <div className="space-y-2">
                  <Label htmlFor={`${batteryId}-target-soc`}>
                    {getTargetSocLabel(selectedAction)}
                  </Label>
                  <Input
                    id={`${batteryId}-target-soc`}
                    max={100}
                    min={getTargetSocMinimum(
                      selectedAction,
                      minimumDischargePercent,
                    )}
                    onChange={(event) => {
                      if (selectedAction === "charging") {
                        setManualChargeTargetSocInput(event.target.value);
                        return;
                      }

                      if (selectedAction === "discharging") {
                        setManualDischargeTargetSocInput(event.target.value);
                        return;
                      }

                      setManualTargetSocInput(event.target.value);
                    }}
                    step={1}
                    type="number"
                    value={getTargetSocInputValue({
                      action: selectedAction,
                      manualChargeTargetSocInput,
                      manualDischargeTargetSocInput,
                      manualTargetSocInput,
                    })}
                  />
                </div>
              ) : null}

              {targetMethod === "duration" ? (
                <div className="space-y-2">
                  <Label htmlFor={`${batteryId}-duration`}>
                    Duration (minutes)
                  </Label>
                  <Input
                    id={`${batteryId}-duration`}
                    min={1}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                    step={5}
                    type="number"
                    value={durationMinutes}
                  />
                </div>
              ) : null}

              {targetMethod === "end-time" ? (
                <div className="space-y-2">
                  <Label htmlFor={`${batteryId}-end-time`}>End time</Label>
                  <Input
                    id={`${batteryId}-end-time`}
                    onChange={(event) => setEndTime(event.target.value)}
                    type="time"
                    value={endTime}
                  />
                </div>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <StrategyStatCard
                label="Target"
                value={
                  targetMethod === "auto"
                    ? "Dynamic"
                    : formatSoc(effectiveManualTargetSoc)
                }
              />
              <StrategyStatCard
                label="Duration"
                value={
                  targetMethod === "auto"
                    ? "Dynamic"
                    : formatDuration(estimatedDurationMinutes)
                }
              />
              <StrategyStatCard
                label="Ends"
                value={targetMethod === "auto" ? "Dynamic" : estimatedEndTime}
              />
            </div>
            <div className="space-y-1 text-xs text-slate-500">
              {targetMethod === "auto" ? (
                <p>
                  Dynamic targeting is computed when the manual strategy is
                  applied, based on recent usage and predicted solar recovery.
                </p>
              ) : null}
              {!canEstimateTarget &&
              (selectedAction === "charging" ||
                selectedAction === "discharging") ? (
                <p>
                  Time-based targeting becomes available when the battery has a
                  known capacity, a current charge level, and a manual power
                  target.
                </p>
              ) : null}
            </div>
          </>
        </>
      ) : (
        <input type="hidden" name="manualPowerW" value="" />
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <SubmitButton showPendingText={false}>
          <Save size={14} />
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

function parseOptionalNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function StrategyStatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}

function getManualModeAction(
  strategyMode: "auto" | "manual" | "self-consumption",
  manualState: BatteryManualState,
): ManualModeAction {
  if (strategyMode === "self-consumption") {
    return "self-consumption";
  }

  return manualState;
}

function applyManualModeAction(input: {
  action: ManualModeAction;
  setManualState: (value: BatteryManualState) => void;
  setStrategyMode: (value: "auto" | "manual" | "self-consumption") => void;
}): void {
  if (input.action === "self-consumption") {
    input.setStrategyMode("self-consumption");
    return;
  }

  input.setStrategyMode("manual");
  input.setManualState(input.action);
}

function estimateTargetSoc(input: {
  capacityWh: number | null;
  currentSocPercent: number | null;
  direction: "charging" | "discharging";
  durationMinutes: number | null;
  minimumDischargePercent: number;
  powerW: number | null;
}): number {
  if (
    input.capacityWh === null ||
    input.currentSocPercent === null ||
    input.durationMinutes === null ||
    input.powerW === null ||
    input.powerW <= 0
  ) {
    return getDefaultTargetSoc(input.direction, input.minimumDischargePercent);
  }

  const energyWh = input.powerW * (input.durationMinutes / 60);
  const deltaSoc = (energyWh / input.capacityWh) * 100;
  const nextSoc =
    input.direction === "charging"
      ? input.currentSocPercent + deltaSoc
      : input.currentSocPercent - deltaSoc;

  return clampTargetSoc(
    nextSoc,
    input.direction,
    input.minimumDischargePercent,
  );
}

function getCurrentStoredTargetSoc(input: {
  action: ManualModeAction;
  minimumDischargePercent: number;
  parsedManualChargeTargetSoc: number | null;
  parsedManualDischargeTargetSoc: number | null;
  parsedManualTargetSoc: number | null;
}): number {
  if (input.action === "charging") {
    return input.parsedManualChargeTargetSoc ?? 100;
  }

  if (input.action === "discharging") {
    return (
      input.parsedManualDischargeTargetSoc ?? input.minimumDischargePercent
    );
  }

  if (input.action === "idle") {
    return input.parsedManualTargetSoc ?? input.minimumDischargePercent;
  }

  return input.parsedManualTargetSoc ?? 100;
}

function estimateDurationMinutes(input: {
  capacityWh: number | null;
  currentSocPercent: number | null;
  direction: "charging" | "discharging";
  powerW: number | null;
  targetSoc: number | null;
}): number | null {
  if (
    input.capacityWh === null ||
    input.currentSocPercent === null ||
    input.powerW === null ||
    input.powerW <= 0 ||
    input.targetSoc === null
  ) {
    return null;
  }

  const deltaSoc =
    input.direction === "charging"
      ? input.targetSoc - input.currentSocPercent
      : input.currentSocPercent - input.targetSoc;

  if (deltaSoc <= 0) {
    return 0;
  }

  const energyWh = (deltaSoc / 100) * input.capacityWh;
  return Math.round((energyWh / input.powerW) * 60);
}

function clampTargetSoc(
  value: number,
  direction: ManualModeAction,
  minimumDischargePercent: number,
): number {
  const minimum = getTargetSocMinimum(direction, minimumDischargePercent);
  return Math.max(minimum, Math.min(100, Math.round(value)));
}

function getTargetSocMinimum(
  action: ManualModeAction,
  minimumDischargePercent: number,
): number {
  return action === "discharging" || action === "idle"
    ? minimumDischargePercent
    : 5;
}

function getTargetSocLabel(action: ManualModeAction): string {
  switch (action) {
    case "charging":
      return "Charge target percentage (%)";
    case "discharging":
      return "Discharge target percentage (%)";
    case "idle":
      return "Idle target percentage (%)";
    case "self-consumption":
      return "Self-consumption target percentage (%)";
  }
}

function getTargetSocInputValue(input: {
  action: ManualModeAction;
  manualChargeTargetSocInput: string;
  manualDischargeTargetSocInput: string;
  manualTargetSocInput: string;
}): string {
  if (input.action === "charging") {
    return input.manualChargeTargetSocInput;
  }

  if (input.action === "discharging") {
    return input.manualDischargeTargetSocInput;
  }

  return input.manualTargetSocInput;
}

function getDefaultTargetSoc(
  state: "charging" | "discharging",
  minimumDischargePercent: number,
): number {
  return state === "discharging" ? minimumDischargePercent : 100;
}

function getDurationMinutesUntilEndTime(
  endTime: string,
  now: Date,
): number | null {
  if (!/^\d{2}:\d{2}$/.test(endTime)) {
    return null;
  }

  const [hoursPart, minutesPart] = endTime.split(":");
  const hours = Number(hoursPart ?? "0");
  const minutes = Number(minutesPart ?? "0");
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 60000));
}

function formatFutureTime(durationMinutes: number | null, now: Date): string {
  if (durationMinutes === null) {
    return "Unavailable";
  }

  const target = new Date(now.getTime() + durationMinutes * 60000);
  return formatClockTime(
    target.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  );
}

function formatDuration(durationMinutes: number | null): string {
  if (durationMinutes === null) {
    return "Unavailable";
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
}

function formatClockTime(value: string | null): string {
  if (!value) {
    return "Unavailable";
  }

  return value;
}

function getDefaultEndTimeValue(): string {
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  return `${String(nextHour.getHours()).padStart(2, "0")}:${String(nextHour.getMinutes()).padStart(2, "0")}`;
}

function formatCapacity(capacityWh: number | null): string {
  if (capacityWh === null) {
    return "Unavailable";
  }

  return `${(capacityWh / 1000).toFixed(1)} kWh`;
}

function formatSoc(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${Math.round(value)}%`;
}
