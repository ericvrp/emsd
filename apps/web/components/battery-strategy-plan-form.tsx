"use client";

import type {
  BatteryManualState,
  BatteryStrategyPlanItem,
  BatteryStrategyPlanRecord,
  BatteryStrategyTargetMethod,
} from "@emsd/core";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { setBatteryStrategyPlanAction } from "../app/actions";
import { SubmitButton } from "./submit-button";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type StrategyAction = "self-consumption" | BatteryManualState;

interface BatteryStrategyPlanFormProps {
  batteryId: string;
  minimumDischargePercent: number;
  returnPath?: string;
  siteId: string;
  strategyPlan: BatteryStrategyPlanRecord;
}

export function BatteryStrategyPlanForm({
  batteryId,
  minimumDischargePercent,
  returnPath,
  siteId,
  strategyPlan,
}: BatteryStrategyPlanFormProps) {
  const [items, setItems] = useState(strategyPlan);

  function updateItem(
    itemId: string,
    updater: (item: BatteryStrategyPlanItem) => BatteryStrategyPlanItem,
  ) {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === itemId ? updater(item) : item)),
    );
  }

  function addDailyItem() {
    const nextItem = createDailyPlanItem(minimumDischargePercent);

    setItems((currentItems) => [...currentItems, nextItem]);
  }

  function removeItem(itemId: string) {
    setItems((currentItems) =>
      currentItems.filter((item) => item.id !== itemId),
    );
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    setItems((currentItems) => {
      const index = currentItems.findIndex((item) => item.id === itemId);

      if (index < 1) {
        return currentItems;
      }

      const nextIndex = index + direction;

      if (nextIndex < 1 || nextIndex >= currentItems.length) {
        return currentItems;
      }

      const nextItems = [...currentItems];
      const [movedItem] = nextItems.splice(index, 1);

      if (!movedItem) {
        return currentItems;
      }

      nextItems.splice(nextIndex, 0, movedItem);
      return nextItems;
    });
  }

  return (
    <form action={setBatteryStrategyPlanAction} className="space-y-4">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="batteryId" value={batteryId} />
      <input type="hidden" name="returnPath" value={returnPath ?? "/"} />
      <input
        type="hidden"
        name="minimumDischargePercent"
        value={minimumDischargePercent}
      />
      <input
        type="hidden"
        name="strategyPlanJson"
        value={JSON.stringify(items)}
      />

      <div className="rounded-2xl border border-white/8 bg-white/4 p-4 text-sm text-slate-300">
        <p className="font-medium text-white">Strategy schedule</p>
        <p className="mt-1 text-slate-400">
          The first entry is the fallback strategy. Daily entries run in order
          and can be rearranged.
        </p>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => {
          const action = getStrategyAction(item);
          const isDefault = index === 0;
          const targetMethod = getPersistedTargetMethod(item);
          return (
            <Card key={item.id} className="border-white/10 bg-slate-950/50">
              <CardHeader className="border-b border-white/8 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-lg">
                    {isDefault ? "Default strategy" : `Daily item ${index}`}
                  </CardTitle>
                  {!isDefault ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => moveItem(item.id, -1)}
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUp size={14} />
                        Up
                      </Button>
                      <Button
                        onClick={() => moveItem(item.id, 1)}
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDown size={14} />
                        Down
                      </Button>
                      <Button
                        onClick={() => removeItem(item.id)}
                        type="button"
                        variant="danger"
                      >
                        <Trash2 size={14} />
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-4">
                {!isDefault ? (
                  <div className="space-y-2">
                    <Label htmlFor={`${item.id}-start-time`}>Start time</Label>
                    <Input
                      id={`${item.id}-start-time`}
                      onChange={(event) =>
                        updateItem(item.id, (currentItem) => ({
                          ...currentItem,
                          startTime: event.target.value,
                        }))
                      }
                      type="time"
                      value={item.startTime ?? "08:00"}
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor={`${item.id}-action`}>
                    {isDefault ? "Fallback action" : "Action"}
                  </Label>
                  <Select
                    onValueChange={(value: string) =>
                      updateItem(item.id, (currentItem) =>
                        applyStrategyAction(
                          currentItem,
                          value as StrategyAction,
                          minimumDischargePercent,
                        ),
                      )
                    }
                    value={action}
                  >
                    <SelectTrigger id={`${item.id}-action`}>
                      <SelectValue placeholder="Select action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self-consumption">
                        Self-consumption
                      </SelectItem>
                      <SelectItem value="idle">Idle</SelectItem>
                      {!isDefault ? (
                        <SelectItem value="charging">Charge</SelectItem>
                      ) : null}
                      {!isDefault ? (
                        <SelectItem value="discharging">Discharge</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>

                {action === "charging" || action === "discharging" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor={`${item.id}-power`}>Power (W)</Label>
                      <Input
                        id={`${item.id}-power`}
                        max={2400}
                        min={0}
                        onChange={(event) =>
                          updateItem(item.id, (currentItem) => ({
                            ...currentItem,
                            manualPowerW: parseNumber(event.target.value),
                          }))
                        }
                        step={10}
                        type="number"
                        value={String(item.manualPowerW ?? 2400)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${item.id}-target-method`}>
                        Target method
                      </Label>
                      <Select
                        onValueChange={(value: string) =>
                          updateItem(item.id, (currentItem) =>
                            updateTargetMethod(
                              currentItem,
                              action,
                              value as BatteryStrategyTargetMethod,
                              minimumDischargePercent,
                            ),
                          )
                        }
                        value={targetMethod}
                      >
                        <SelectTrigger id={`${item.id}-target-method`}>
                          <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="soc">Percentage</SelectItem>
                          <SelectItem value="duration">Duration</SelectItem>
                          <SelectItem value="end-time">End time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {targetMethod === "soc" ? (
                      <div className="space-y-2">
                        <Label htmlFor={`${item.id}-target-soc`}>
                          Target percentage
                        </Label>
                        <Input
                          id={`${item.id}-target-soc`}
                          max={100}
                          min={
                            action === "discharging"
                              ? minimumDischargePercent
                              : 5
                          }
                          onChange={(event) =>
                            updateItem(item.id, (currentItem) =>
                              updateManualTarget(
                                currentItem,
                                action,
                                parseNumber(event.target.value),
                                minimumDischargePercent,
                              ),
                            )
                          }
                          step={1}
                          type="number"
                          value={String(
                            getTargetSocValue(item, minimumDischargePercent),
                          )}
                        />
                      </div>
                    ) : null}
                    {targetMethod === "duration" ? (
                      <div className="space-y-2">
                        <Label htmlFor={`${item.id}-duration`}>
                          Duration (minutes)
                        </Label>
                        <Input
                          id={`${item.id}-duration`}
                          min={1}
                          onChange={(event) =>
                            updateItem(item.id, (currentItem) => ({
                              ...currentItem,
                              targetDurationMinutes: parseNumber(
                                event.target.value,
                              ),
                            }))
                          }
                          type="number"
                          value={String(item.targetDurationMinutes ?? "")}
                        />
                      </div>
                    ) : null}
                    {targetMethod === "end-time" ? (
                      <div className="space-y-2">
                        <Label htmlFor={`${item.id}-end-time`}>End time</Label>
                        <Input
                          id={`${item.id}-end-time`}
                          onChange={(event) =>
                            updateItem(item.id, (currentItem) => ({
                              ...currentItem,
                              targetEndTime: event.target.value,
                            }))
                          }
                          type="time"
                          value={item.targetEndTime ?? ""}
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button onClick={addDailyItem} type="button" variant="ghost">
          <Plus size={14} />
          Add daily item
        </Button>
        <SubmitButton>
          <Save size={14} />
          Save schedule
        </SubmitButton>
      </div>
    </form>
  );
}

function createDailyPlanItem(
  minimumDischargePercent: number,
): BatteryStrategyPlanItem {
  return {
    id: createLocalStrategyPlanId(),
    kind: "daily",
    startTime: "08:00",
    triggerKind: "daily-time",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: null,
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: minimumDischargePercent,
    manualTargetSoc: 100,
  };
}

function getStrategyAction(item: BatteryStrategyPlanItem): StrategyAction {
  if (item.strategyMode === "self-consumption") {
    return "self-consumption";
  }

  return item.manualState ?? "idle";
}

function applyStrategyAction(
  item: BatteryStrategyPlanItem,
  action: StrategyAction,
  minimumDischargePercent: number,
): BatteryStrategyPlanItem {
  if (action === "self-consumption") {
    return {
      ...item,
      strategyMode: "self-consumption",
      manualState: null,
      manualPowerW: null,
      triggerKind: item.kind === "daily" ? "daily-time" : null,
      targetDurationMinutes: null,
      targetEndTime: null,
      targetMethod: null,
    };
  }

  return {
    ...item,
    strategyMode: "manual",
    manualState: action,
    manualPowerW: action === "idle" ? null : (item.manualPowerW ?? 2400),
    manualChargeTargetSoc:
      action === "charging" ? (item.manualChargeTargetSoc ?? 100) : null,
    manualDischargeTargetSoc:
      action === "discharging"
        ? (item.manualDischargeTargetSoc ?? minimumDischargePercent)
        : null,
    manualTargetSoc:
      action === "idle"
        ? null
        : action === "discharging"
          ? (item.manualDischargeTargetSoc ?? minimumDischargePercent)
          : (item.manualChargeTargetSoc ?? 100),
    triggerKind:
      item.kind === "daily" ? (item.triggerKind ?? "daily-time") : null,
    targetDurationMinutes:
      action === "idle" ? null : (item.targetDurationMinutes ?? null),
    targetEndTime: action === "idle" ? null : (item.targetEndTime ?? null),
    targetMethod: action === "idle" ? null : getPersistedTargetMethod(item),
  };
}

function createLocalStrategyPlanId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getPersistedTargetMethod(
  item: BatteryStrategyPlanItem,
): BatteryStrategyTargetMethod {
  return item.targetMethod ?? "soc";
}

function updateTargetMethod(
  item: BatteryStrategyPlanItem,
  action: "charging" | "discharging",
  targetMethod: BatteryStrategyTargetMethod,
  minimumDischargePercent: number,
): BatteryStrategyPlanItem {
  if (targetMethod === "soc") {
    return {
      ...item,
      targetMethod,
      targetDurationMinutes: null,
      targetEndTime: null,
      manualChargeTargetSoc:
        action === "charging" ? (item.manualChargeTargetSoc ?? 100) : null,
      manualDischargeTargetSoc:
        action === "discharging"
          ? (item.manualDischargeTargetSoc ?? minimumDischargePercent)
          : null,
      manualTargetSoc:
        action === "discharging"
          ? (item.manualDischargeTargetSoc ?? minimumDischargePercent)
          : (item.manualChargeTargetSoc ?? 100),
    };
  }

  return {
    ...item,
    targetMethod,
    targetDurationMinutes:
      targetMethod === "duration" ? item.targetDurationMinutes : null,
    targetEndTime: targetMethod === "end-time" ? item.targetEndTime : null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: null,
  };
}

function updateManualTarget(
  item: BatteryStrategyPlanItem,
  action: "charging" | "discharging",
  value: number | null,
  minimumDischargePercent: number,
): BatteryStrategyPlanItem {
  const nextValue =
    value === null
      ? action === "discharging"
        ? minimumDischargePercent
        : 100
      : Math.max(
          action === "discharging" ? minimumDischargePercent : 5,
          Math.min(100, Math.round(value)),
        );

  return {
    ...item,
    manualChargeTargetSoc:
      action === "charging" ? nextValue : item.manualChargeTargetSoc,
    manualDischargeTargetSoc:
      action === "discharging" ? nextValue : item.manualDischargeTargetSoc,
    manualTargetSoc: nextValue,
  };
}

function getTargetSocValue(
  item: BatteryStrategyPlanItem,
  minimumDischargePercent: number,
): number {
  if (item.manualState === "discharging") {
    return item.manualDischargeTargetSoc ?? minimumDischargePercent;
  }

  return item.manualChargeTargetSoc ?? 100;
}

function parseNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
