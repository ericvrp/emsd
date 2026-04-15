import type {
  BatteryRecord,
  BatteryStrategyPlanItem,
  BatteryStrategyRecord,
} from "@emsd/core";
import type { ScheduledItemCompletion } from "./strategy-scheduler";
import {
  formatDaemonLogTimestamp,
  getTodayTriggerAt,
  isItemAlreadyTriggeredToday,
} from "./strategy-scheduler";

export function describeStrategyPlanItemHuman(
  item: BatteryStrategyPlanItem | null | undefined,
): string {
  if (!item) {
    return "no strategy";
  }

  if (item.strategyMode === "self-consumption") {
    const summary = item.manualDischargeTargetSoc !== null
      ? `self-consumption with a ${item.manualDischargeTargetSoc}% discharge floor`
      : "self-consumption";

    return joinHumanParts([summary, describeScheduledTargetHuman(item)]);
  }

  if (item.strategyMode === "auto") {
    return "automatic control";
  }

  const summary = describeManualStrategyHuman(item);

  if (item.manualState === "idle") {
    return joinHumanParts([summary, describeScheduledTargetHuman(item)]);
  }

  return summary;
}

export function describeCurrentBatteryStrategyHuman(
  battery: Pick<
    BatteryRecord,
    | "strategyMode"
    | "manualState"
    | "manualPowerW"
    | "manualChargeTargetSoc"
    | "manualDischargeTargetSoc"
    | "manualTargetSoc"
    | "manualModeActive"
  >,
): string {
  if (battery.strategyMode === "self-consumption") {
    return battery.manualDischargeTargetSoc !== null
      ? `self-consumption with a ${battery.manualDischargeTargetSoc}% discharge floor`
      : "self-consumption";
  }

  if (battery.strategyMode === "auto") {
    return "automatic control";
  }

  const summary = describeManualStrategyHuman(battery);

  return summary;
}

export function formatStrategyPlanAppliedSummary(
  battery: Pick<BatteryRecord, "id" | "strategyPlan" | "strategyRuntime">,
  now: Date,
): string {
  const fallback = describeStrategyPlanItemHuman(battery.strategyPlan[0]);
  const nextItem = getNextStrategyItemForToday(battery, now);
  const nextSummary = nextItem
    ? `${describeStrategyScheduleHuman(nextItem)}: ${describeStrategyPlanItemHuman(nextItem)}`
    : "none today";

  return `strategy plan updated for ${battery.id}: default ${fallback}; next ${nextSummary}`;
}

export function formatScheduledStrategyStartedSummary(
  batteryId: string,
  item: BatteryStrategyPlanItem,
  observedDelay: string,
): string {
  const delay = observedDelay ? ` (${observedDelay.trim()})` : "";
  return `${describeStrategyScheduleHuman(item)} is now active for ${batteryId}: ${describeStrategyPlanItemHuman(item)}${delay}`;
}

export function formatScheduledStrategyCompletionSummary(input: {
  batteryId: string;
  item: BatteryStrategyPlanItem;
  completion: ScheduledItemCompletion;
  fallbackItem: BatteryStrategyPlanItem;
}): string {
  return `${describeStrategyScheduleHuman(input.item)} completed for ${input.batteryId}: ${describeCompletionReasonHuman(input.completion)}, returning to default ${describeStrategyPlanItemHuman(input.fallbackItem)}`;
}

export function formatFallbackStrategyRestoreSummary(
  batteryId: string,
  fallbackItem: BatteryStrategyPlanItem,
): string {
  return `restoring the default strategy for ${batteryId}: ${describeStrategyPlanItemHuman(fallbackItem)}`;
}

export function formatManualStrategyAppliedSummary(
  battery: Pick<
    BatteryRecord,
    | "id"
    | "strategyMode"
    | "manualState"
    | "manualPowerW"
    | "manualChargeTargetSoc"
    | "manualDischargeTargetSoc"
    | "manualTargetSoc"
    | "manualModeActive"
  >,
): string {
  const prefix = battery.manualModeActive
    ? "temporary manual override applied"
    : "manual strategy applied";

  return `${prefix} for ${battery.id}: ${describeCurrentBatteryStrategyHuman(battery)}`;
}

function describeManualStrategyHuman(
  strategy: Pick<
    BatteryStrategyRecord,
    | "manualState"
    | "manualPowerW"
    | "manualChargeTargetSoc"
    | "manualDischargeTargetSoc"
    | "manualTargetSoc"
  >,
): string {
  switch (strategy.manualState) {
    case "charging":
      return joinHumanParts([
        "charge manually",
        describeChargeTarget(strategy),
        describePower(strategy.manualPowerW),
      ]);
    case "discharging":
      return joinHumanParts([
        "discharge manually",
        describeDischargeTarget(strategy),
        describePower(strategy.manualPowerW),
      ]);
    case "idle":
      return "hold the battery idle";
    default:
      return "manual control";
  }
}

function describeChargeTarget(
  strategy: Pick<
    BatteryStrategyRecord,
    "manualChargeTargetSoc" | "manualTargetSoc"
  >,
): string | null {
  const targetSoc = strategy.manualChargeTargetSoc ?? strategy.manualTargetSoc;
  return targetSoc === null ? null : `to ${targetSoc}%`;
}

function describeDischargeTarget(
  strategy: Pick<
    BatteryStrategyRecord,
    "manualDischargeTargetSoc" | "manualTargetSoc"
  >,
): string | null {
  const targetSoc =
    strategy.manualDischargeTargetSoc ?? strategy.manualTargetSoc;
  return targetSoc === null ? null : `to ${targetSoc}%`;
}

function describePower(powerW: number | null): string | null {
  return powerW === null ? null : `at ${powerW}W`;
}

function describeScheduledTargetHuman(item: BatteryStrategyPlanItem): string | null {
  if (item.targetMethod === "duration") {
    return item.targetDurationMinutes === null
      ? null
      : `for ${item.targetDurationMinutes} minute(s)`;
  }

  if (item.targetMethod === "end-time") {
    return item.targetEndTime === null ? null : `until ${item.targetEndTime}`;
  }

  if (item.targetMethod === "soc") {
    return item.manualTargetSoc === null ? null : `until ${item.manualTargetSoc}%`;
  }

  return null;
}

function describeStrategyScheduleHuman(item: BatteryStrategyPlanItem): string {
  if (item.kind === "default") {
    return "the default strategy";
  }

  if (item.kind === "daily" && item.startTime) {
    return `the ${item.startTime} daily schedule`;
  }

  return `${item.kind} schedule`;
}

function describeCompletionReasonHuman(
  completion: ScheduledItemCompletion,
): string {
  switch (completion.reason) {
    case "charge-target-reached":
    case "discharge-target-reached":
    case "idle-target-reached":
    case "self-consumption-target-reached":
      return completion.targetSoc !== undefined
        ? `it reached ${completion.targetSoc}%`
        : "it reached its target";
    case "duration-elapsed":
      return completion.targetDurationMinutes === null
        ? "its duration completed"
        : `${completion.targetDurationMinutes} minute(s) elapsed`;
    case "end-time-reached":
      return completion.endAt
        ? `it reached its cutoff at ${formatLocalCutoffTimestamp(completion.endAt)}`
        : "it reached its cutoff time";
    case "missing-start-time":
      return "its runtime state was incomplete";
  }
}

function formatLocalCutoffTimestamp(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return `${formatDaemonLogTimestamp(parsed)} (local)`;
}

function getNextStrategyItemForToday(
  battery: Pick<BatteryRecord, "strategyPlan" | "strategyRuntime">,
  now: Date,
): BatteryStrategyPlanItem | null {
  let nextItem: BatteryStrategyPlanItem | null = null;
  let nextTriggerAt: Date | null = null;

  for (const item of battery.strategyPlan.slice(1)) {
    const triggerAt = getTodayTriggerAt(item, now);

    if (
      triggerAt === null ||
      triggerAt.getTime() < now.getTime() ||
      isItemAlreadyTriggeredToday({
        runtime: battery.strategyRuntime,
        itemId: item.id,
        triggerAt,
      })
    ) {
      continue;
    }

    if (nextTriggerAt === null || triggerAt.getTime() < nextTriggerAt.getTime()) {
      nextItem = item;
      nextTriggerAt = triggerAt;
    }
  }

  return nextItem;
}

function joinHumanParts(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(" ");
}
