"use client";

import type {
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
  ToggleLeft,
  ToggleRight,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { setHouseStrategyPlanAction } from "../app/actions";
import { UI_STYLES } from "../lib/ui-colors";
import {
  applyStrategyAction,
  type StrategyAction,
} from "./battery-strategy-plan-logic";
import { SubmitButton } from "./submit-button";
import { DialogPortal } from "./ui/dialog-portal";
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
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (pendingDeleteItemId === null) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      setPendingDeleteItemId(null);
    }

    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [pendingDeleteItemId]);

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
              const contentCellClass = `px-4 py-4${item.enabled ? "" : " opacity-55"}`;

              return (
                <tr
                  key={item.id}
                  className="border-b border-white/8 align-top last:border-b-0"
                >
                  <td className={contentCellClass}>
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
                            disabled={!item.enabled}
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
                              <SelectItem value="low-price">
                                Low price
                              </SelectItem>
                              <SelectItem value="high-price">
                                High price
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
                              disabled={!item.enabled}
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
                  <td className={contentCellClass}>
                    <div className="space-y-2">
                      <Label className="sr-only" htmlFor={`${item.id}-action`}>
                        {isDefault ? "Fallback action" : "Action"}
                      </Label>
                      <Select
                        disabled={!item.enabled}
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
                  <td className={contentCellClass}>
                    {action === "charging" || action === "discharging" ? (
                      <div className="flex min-w-[180px] flex-col gap-2 justify-end">
                        <Input
                          disabled={!item.enabled}
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
                        <Label className="text-xs text-slate-400" htmlFor={`${item.id}-power`}>
                          Power (W)
                        </Label>
                      </div>
                    ) : (
                      <div />
                    )}
                  </td>
                  <td className={contentCellClass}>
                    {!isDefault &&
                    (action === "charging" ||
                    action === "discharging" ||
                    action === "idle" ||
                    action === "self-consumption") ? (
                      <div className="grid min-w-[320px] items-end gap-3 md:grid-cols-2">
                        <div className="flex flex-col gap-2 justify-end">
                          <Select
                            disabled={!item.enabled}
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
                              <SelectItem value="auto">Dynamic</SelectItem>
                            </SelectContent>
                          </Select>
                          <Label
                            className="text-xs text-slate-400"
                            htmlFor={`${item.id}-target-method`}
                          >
                            Target method
                          </Label>
                        </div>
                        {targetMethod === "soc" ? (
                          <div className="flex flex-col gap-2 justify-end">
                            <Input
                              disabled={!item.enabled}
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
                            <Label
                              className="text-xs text-slate-400"
                              htmlFor={`${item.id}-target-soc`}
                            >
                              Target percentage
                            </Label>
                          </div>
                        ) : null}
                        {targetMethod === "duration" ? (
                          <div className="flex flex-col gap-2 justify-end xl:col-span-1">
                            <Input
                              disabled={!item.enabled}
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
                            <Label
                              className="text-xs text-slate-400"
                              htmlFor={`${item.id}-duration`}
                            >
                              Duration (minutes)
                            </Label>
                          </div>
                        ) : null}
                        {targetMethod === "end-time" ? (
                          <div className="flex flex-col gap-2 justify-end xl:col-span-1">
                            <Input
                              disabled={!item.enabled}
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
                            <Label
                              className="text-xs text-slate-400"
                              htmlFor={`${item.id}-end-time`}
                            >
                              End time
                            </Label>
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
                          aria-label={item.enabled ? "Disable item" : "Enable item"}
                          className="h-9 w-9 px-0"
                          onClick={() =>
                            updateItem(item.id, (currentItem) => ({
                              ...currentItem,
                              enabled: !currentItem.enabled,
                            }))
                          }
                          title={item.enabled ? "Disable item" : "Enable item"}
                          type="button"
                          variant="ghost"
                        >
                          {item.enabled ? (
                            <ToggleRight size={16} />
                          ) : (
                            <ToggleLeft size={16} />
                          )}
                        </Button>
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
                          onClick={() => setPendingDeleteItemId(item.id)}
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

      {pendingDeleteItemId ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[110] bg-slate-950/80 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-center justify-center">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-rose-300">
                  Confirm delete
                </p>
                <h3 className="mt-3 text-xl font-semibold text-white">
                  Delete this schedule item?
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {describePendingDeleteItem(items, pendingDeleteItemId)} will be
                  removed from the strategy plan.
                </p>
                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <Button
                    onClick={() => setPendingDeleteItemId(null)}
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      removeItem(pendingDeleteItemId);
                      setPendingDeleteItemId(null);
                    }}
                    type="button"
                    variant="danger"
                  >
                    Delete item
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogPortal>
      ) : null}
    </form>
  );
}

function describePendingDeleteItem(
  items: BatteryStrategyPlanItem[],
  itemId: string,
): string {
  const item = items.find((candidate) => candidate.id === itemId);

  if (!item) {
    return "This schedule item";
  }

  const triggerKind = getPersistedTriggerKind(item);

  if (triggerKind === "daily-time") {
    return `The ${item.startTime ?? "08:00"} schedule`;
  }

  return `The ${triggerKind} schedule`;
}

function createDailyPlanItem(
  minimumDischargePercent: number,
): BatteryStrategyPlanItem {
  return {
    enabled: true,
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

  if (targetMethod === "auto") {
    return {
      ...item,
      targetMethod,
      targetDurationMinutes: null,
      targetEndTime: null,
      manualChargeTargetSoc: null,
      manualDischargeTargetSoc: null,
      manualTargetSoc: null,
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
