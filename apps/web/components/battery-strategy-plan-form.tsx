"use client";

import type {
  BatteryManualState,
  BatteryStrategyPlanItem,
  BatteryStrategyPlanRecord,
  BatteryStrategyTargetMethod,
  BatteryStrategyTriggerKind,
} from "@emsd/core/client";
import {
  ArrowDown,
  ArrowUp,
  Battery,
  BatteryCharging,
  BatteryIcon,
  Plus,
  Save,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { setHouseStrategyPlanAction } from "../app/actions";
import { UI_STYLES } from "../lib/ui-colors";
import { SubmitButton } from "./submit-button";
import { Button } from "./ui/button";
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
  action?: typeof setHouseStrategyPlanAction;
  batteryId: string;
  batteryName?: string;
  minimumDischargePercent: number;
  returnPath?: string;
  siteId: string;
  strategyPlan: BatteryStrategyPlanRecord;
  submitLabel?: string;
}

export function BatteryStrategyPlanForm({
  action = setHouseStrategyPlanAction,
  batteryId,
  batteryName,
  minimumDischargePercent,
  returnPath,
  siteId,
  strategyPlan,
  submitLabel = "Apply",
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
    <form action={action} className="space-y-4">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="batteryId" value={batteryId} />
      {batteryName ? (
        <input type="hidden" name="batteryName" value={batteryName} />
      ) : null}
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

      <div className="overflow-x-auto rounded-2xl border border-white/8 bg-slate-950/40">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-xs uppercase tracking-[0.18em] text-slate-400">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Set</th>
              <th className="px-4 py-3 font-medium">Settings</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const action = getStrategyAction(item);
              const isDefault = index === 0;
              const triggerKind = getPersistedTriggerKind(item);
              const targetMethod = getPersistedTargetMethod(item);

              return (
                <tr
                  key={item.id}
                  className="border-b border-white/8 align-top last:border-b-0"
                >
                  <td className="px-4 py-4">
                    {isDefault ? null : (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label
                            className="sr-only"
                            htmlFor={`${item.id}-trigger-kind`}
                          >
                            Start method
                          </Label>
                          <Select
                            onValueChange={(value: string) =>
                              updateItem(item.id, (currentItem) => ({
                                ...currentItem,
                                triggerKind:
                                  value as BatteryStrategyTriggerKind,
                              }))
                            }
                            value={triggerKind}
                          >
                            <SelectTrigger id={`${item.id}-trigger-kind`}>
                              <SelectValue placeholder="Select start method" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="daily-time">
                                Scheduled time
                              </SelectItem>
                              <SelectItem disabled value="dynamic-price">
                                Dynamic price signal
                              </SelectItem>
                              <SelectItem disabled value="weather">
                                Weather forecast
                              </SelectItem>
                              <SelectItem disabled value="expected-solar">
                                Expected solar output
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {triggerKind === "daily-time" ? (
                          <div className="space-y-2">
                            <Label
                              className="sr-only"
                              htmlFor={`${item.id}-start-time`}
                            >
                              Start time
                            </Label>
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
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      <Label className="sr-only" htmlFor={`${item.id}-action`}>
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
                            <SelectItem value="discharging">
                              Discharge
                            </SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {action === "charging" || action === "discharging" ? (
                      <div className="min-w-[180px] space-y-2">
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
                      </div>
                    ) : (
                      <div />
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {action === "charging" ||
                    action === "discharging" ||
                    action === "idle" ||
                    action === "self-consumption" ? (
                      <div className="grid min-w-[320px] gap-3 md:grid-cols-2">
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
                                action === "discharging" || action === "idle"
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
                                getTargetSocValue(
                                  item,
                                  action,
                                  minimumDischargePercent,
                                ),
                              )}
                            />
                          </div>
                        ) : null}
                        {targetMethod === "duration" ? (
                          <div className="space-y-2 xl:col-span-1">
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
                          <div className="space-y-2 xl:col-span-1">
                            <Label htmlFor={`${item.id}-end-time`}>
                              End time
                            </Label>
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
                      </div>
                    ) : (
                      <div />
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {isDefault ? null : (
                      <div className="flex justify-end gap-2">
                        <Button
                          aria-label={`Move daily item ${index} up`}
                          className="h-9 w-9 px-0"
                          disabled={index === 1}
                          onClick={() => moveItem(item.id, -1)}
                          title="Move up"
                          type="button"
                          variant="ghost"
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          aria-label={`Move daily item ${index} down`}
                          className="h-9 w-9 px-0"
                          disabled={index === items.length - 1}
                          onClick={() => moveItem(item.id, 1)}
                          title="Move down"
                          type="button"
                          variant="ghost"
                        >
                          <ArrowDown size={14} />
                        </Button>
                        <Button
                          aria-label={`Delete daily item ${index}`}
                          className="h-9 w-9 px-0"
                          onClick={() => removeItem(item.id)}
                          title="Delete item"
                          type="button"
                          variant="danger"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button onClick={addDailyItem} type="button" variant="ghost">
          <Plus size={14} />
          Add item
        </Button>
        <SubmitButton>
          <Save size={14} />
          {submitLabel}
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
      manualChargeTargetSoc: null,
      manualDischargeTargetSoc: null,
      manualTargetSoc: item.manualTargetSoc ?? 100,
      triggerKind: item.kind === "daily" ? "daily-time" : null,
      targetDurationMinutes:
        getPersistedTargetMethod(item) === "duration"
          ? item.targetDurationMinutes
          : null,
      targetEndTime:
        getPersistedTargetMethod(item) === "end-time"
          ? item.targetEndTime
          : null,
      targetMethod: getPersistedTargetMethod(item),
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
        ? (item.manualTargetSoc ?? minimumDischargePercent)
        : action === "discharging"
          ? (item.manualDischargeTargetSoc ?? minimumDischargePercent)
          : (item.manualChargeTargetSoc ?? 100),
    triggerKind:
      item.kind === "daily" ? (item.triggerKind ?? "daily-time") : null,
    targetDurationMinutes:
      getPersistedTargetMethod(item) === "duration"
        ? (item.targetDurationMinutes ?? null)
        : null,
    targetEndTime:
      getPersistedTargetMethod(item) === "end-time"
        ? (item.targetEndTime ?? null)
        : null,
    targetMethod: getPersistedTargetMethod(item),
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

function getPersistedTriggerKind(
  item: BatteryStrategyPlanItem,
): BatteryStrategyTriggerKind {
  return item.triggerKind ?? "daily-time";
}

function updateTargetMethod(
  item: BatteryStrategyPlanItem,
  action: StrategyAction,
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
          : action === "charging"
            ? (item.manualChargeTargetSoc ?? 100)
            : action === "idle"
              ? (item.manualTargetSoc ?? minimumDischargePercent)
              : (item.manualTargetSoc ?? 100),
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
  action: StrategyAction,
  value: number | null,
  minimumDischargePercent: number,
): BatteryStrategyPlanItem {
  const nextValue =
    value === null
      ? action === "discharging" || action === "idle"
        ? minimumDischargePercent
        : 100
      : Math.max(
          action === "discharging" || action === "idle"
            ? minimumDischargePercent
            : 5,
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
  action: StrategyAction,
  minimumDischargePercent: number,
): number {
  if (action === "discharging") {
    return item.manualDischargeTargetSoc ?? minimumDischargePercent;
  }

  if (action === "charging") {
    return item.manualChargeTargetSoc ?? 100;
  }

  if (action === "idle") {
    return item.manualTargetSoc ?? minimumDischargePercent;
  }

  return item.manualTargetSoc ?? 100;
}

function parseNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
