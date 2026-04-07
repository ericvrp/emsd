"use client";

import type { BatteryManualState, BatteryStrategyRecord } from "@emsd/core";
import { useState } from "react";
import { setBatteryStrategyAction } from "../app/actions";
import { SubmitButton } from "./submit-button";
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
  batteryId: string;
  returnPath?: string;
  siteId: string;
  strategy: BatteryStrategyRecord;
  submitLabel?: string;
}

export function BatteryStrategyForm({
  batteryId,
  returnPath,
  siteId,
  strategy,
  submitLabel = "Apply battery control",
}: BatteryStrategyFormProps) {
  const [strategyMode, setStrategyMode] = useState(strategy.strategyMode);
  const [manualState, setManualState] = useState<BatteryManualState>(
    strategy.manualState ?? "idle",
  );
  const [manualPowerW, setManualPowerW] = useState(
    String(strategy.manualPowerW ?? 0),
  );

  return (
    <form action={setBatteryStrategyAction} className="space-y-4">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="batteryId" value={batteryId} />
      <input type="hidden" name="returnPath" value={returnPath ?? "/"} />
      <input type="hidden" name="strategyMode" value={strategyMode} />
      <input type="hidden" name="manualState" value={manualState} />
      <input
        type="hidden"
        name="manualTargetSoc"
        value={strategy.manualTargetSoc ?? 100}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${batteryId}-strategy`}>Strategy</Label>
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
              <SelectItem value="self-consumption">Self-consumption</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem disabled value="auto">
                Auto (disabled)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {strategyMode === "manual" ? (
          <div className="space-y-2">
            <Label htmlFor={`${batteryId}-state`}>Manual state</Label>
            <Select
              onValueChange={(value: string) =>
                setManualState(value as BatteryManualState)
              }
              value={manualState}
            >
              <SelectTrigger id={`${batteryId}-state`}>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="idle">Idle</SelectItem>
                <SelectItem value="charging">Charging</SelectItem>
                <SelectItem value="discharging">Discharging</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {strategyMode === "manual" && manualState !== "idle" ? (
        <div className="space-y-2">
          <Label htmlFor={`${batteryId}-power`}>Manual power (W)</Label>
          <Input
            id={`${batteryId}-power`}
            max={2400}
            min={0}
            name="manualPowerW"
            onChange={(event) => setManualPowerW(event.target.value)}
            step={10}
            type="number"
            value={manualPowerW}
          />
          <p className="text-xs text-slate-500">Maximum 2400 W.</p>
        </div>
      ) : (
        <input
          type="hidden"
          name="manualPowerW"
          value={
            strategyMode === "manual" && manualState === "idle"
              ? "0"
              : manualPowerW
          }
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
