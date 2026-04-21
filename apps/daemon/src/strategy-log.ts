import type {
  BatteryRecord,
  BatteryStrategyPlanItem,
  BatteryStrategyRecord,
  DynamicPriceSampleRecord,
} from "@emsd/core";
import type { ScheduledItemCompletion } from "./strategy-scheduler";
import {
  formatDaemonLogTimestamp,
  getNextStrategyTriggerAt,
  getStrategyTriggerAt,
  isItemAlreadyTriggeredToday,
} from "./strategy-scheduler";

export function describeStrategyPlanItemHuman(
  item: BatteryStrategyPlanItem | null | undefined,
): string {
  if (!item) {
    return "no strategy";
  }

  if (item.strategyMode === "self-consumption") {
    const summary =
      item.manualDischargeTargetSoc !== null
        ? `self-consumption with a ${item.manualDischargeTargetSoc}% discharge floor`
        : "self-consumption";

    return joinHumanParts([summary, describeScheduledTargetHuman(item)]);
  }

  if (item.strategyMode === "auto") {
    return "automatic control";
  }

  const summary = describeScheduledStrategyHuman(item);

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
    return "self-consumption";
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
  dynamicPriceSamples: DynamicPriceSampleRecord[] = [],
): string {
  const fallback = describeStrategyPlanItemHuman(battery.strategyPlan[0]);
  const nextItem = getNextStrategyItemForToday(
    battery,
    now,
    dynamicPriceSamples,
  );
  const nextSummary = nextItem
    ? `${describeStrategyScheduleHuman(nextItem)}: ${describeStrategyPlanItemHuman(nextItem)}`
    : "none today";

  return `strategy plan updated for ${battery.id}: default ${fallback}; next ${nextSummary}`;
}

export function formatScheduledStrategyStartedSummary(
  batteryId: string,
  item: BatteryStrategyPlanItem,
  observedDelay: string,
  estimate?: {
    targetSocPercent: number;
    reserveSocPercent: number;
    targetTime: string | null;
    reasoning: string;
  } | null,
): string {
  void observedDelay;
  const base = `${describeStrategyScheduleHuman(item)} is now active for ${batteryId}: ${describeStrategyPlanItemHuman(item)}`;

  if (!estimate) {
    return base;
  }

  const targetTimeLabel =
    estimate.targetTime === null
      ? ""
      : ` by ${formatHumanClockTime(estimate.targetTime)}`;

  return `${base}; discharging to ${estimate.targetSocPercent}% to reserve ${estimate.reserveSocPercent}%${targetTimeLabel} based on ${estimate.reasoning}`;
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

export function formatBatteryStrategyStatusSummary(
  battery: Pick<
    BatteryRecord,
    | "strategyMode"
    | "manualState"
    | "manualPowerW"
    | "manualChargeTargetSoc"
    | "manualDischargeTargetSoc"
    | "manualTargetSoc"
    | "manualModeActive"
    | "minimumDischargePercent"
    | "strategyPlan"
    | "strategyRuntime"
  >,
  now: Date = new Date(),
): string {
  if (battery.manualModeActive) {
    return summarizeActiveStrategy({
      strategyMode: battery.strategyMode,
      manualState: battery.manualState,
      manualPowerW: battery.manualPowerW,
      manualChargeTargetSoc: battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
      manualTargetSoc: battery.manualTargetSoc,
      minimumDischargePercent: battery.minimumDischargePercent,
      resolvedTargetSoc:
        battery.strategyRuntime.manualTargetMethod === "auto"
          ? (battery.strategyRuntime.activeTargetSocPercent ?? null)
          : null,
      targetDurationMinutes:
        battery.strategyRuntime.manualTargetDurationMinutes ?? null,
      targetEndTime: battery.strategyRuntime.manualTargetEndTime ?? null,
      targetTime: battery.strategyRuntime.activeTargetTime ?? null,
      activeStartedAt: battery.strategyRuntime.manualTargetStartedAt ?? null,
      targetMethod: battery.strategyRuntime.manualTargetMethod ?? null,
      preferPowerWhenAvailable: true,
      now,
    });
  }

  const activeItemId = battery.strategyRuntime.activeItemId;
  const fallbackItem = battery.strategyPlan[0] ?? null;

  const defaultSummary = fallbackItem
    ? summarizeActiveStrategy({
        strategyMode: fallbackItem.strategyMode,
        manualState: fallbackItem.manualState,
        manualPowerW: fallbackItem.manualPowerW,
        manualChargeTargetSoc: fallbackItem.manualChargeTargetSoc,
        manualDischargeTargetSoc: fallbackItem.manualDischargeTargetSoc,
        manualTargetSoc: fallbackItem.manualTargetSoc,
        minimumDischargePercent: battery.minimumDischargePercent,
        resolvedTargetSoc:
          fallbackItem.targetMethod === "auto"
            ? (battery.strategyRuntime.activeTargetSocPercent ?? null)
            : null,
        targetMethod: fallbackItem.targetMethod,
        targetDurationMinutes: fallbackItem.targetDurationMinutes,
        targetEndTime: fallbackItem.targetEndTime,
        targetTime: battery.strategyRuntime.activeTargetTime ?? null,
        activeStartedAt: null,
        preferPowerWhenAvailable: false,
        now,
      })
    : summarizeActiveStrategy({
        strategyMode: battery.strategyMode,
        manualState: battery.manualState,
        manualPowerW: battery.manualPowerW,
        manualChargeTargetSoc: battery.manualChargeTargetSoc,
        manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
        manualTargetSoc: battery.manualTargetSoc,
        minimumDischargePercent: battery.minimumDischargePercent,
        resolvedTargetSoc: null,
        targetMethod: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetTime: null,
        activeStartedAt: null,
        preferPowerWhenAvailable: false,
        now,
      });

  if (!activeItemId) {
    return defaultSummary;
  }

  const activeItem =
    battery.strategyPlan.find((item) => item.id === activeItemId) ?? null;

  if (!activeItem) {
    return defaultSummary;
  }

  return summarizeActiveStrategy({
    strategyMode: activeItem.strategyMode,
    manualState: activeItem.manualState,
    manualPowerW: activeItem.manualPowerW,
    manualChargeTargetSoc: activeItem.manualChargeTargetSoc,
    manualDischargeTargetSoc: activeItem.manualDischargeTargetSoc,
    manualTargetSoc: activeItem.manualTargetSoc,
    minimumDischargePercent: battery.minimumDischargePercent,
    resolvedTargetSoc:
      activeItem.targetMethod === "auto"
        ? (battery.strategyRuntime.activeTargetSocPercent ?? null)
        : null,
    targetMethod: activeItem.targetMethod,
    targetDurationMinutes: activeItem.targetDurationMinutes,
    targetEndTime: activeItem.targetEndTime,
    targetTime: battery.strategyRuntime.activeTargetTime ?? null,
    activeStartedAt: battery.strategyRuntime.activeStartedAt,
    preferPowerWhenAvailable: false,
    now,
  });
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

function describeScheduledStrategyHuman(
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
        "scheduled charge",
        describeChargeTarget(strategy),
        describePower(strategy.manualPowerW),
      ]);
    case "discharging":
      return joinHumanParts([
        "scheduled discharge",
        describeDischargeTarget(strategy),
        describePower(strategy.manualPowerW),
      ]);
    case "idle":
      return "hold the battery idle";
    default:
      return "scheduled control";
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

function summarizeActiveStrategy(input: {
  strategyMode: BatteryStrategyRecord["strategyMode"];
  manualState: BatteryStrategyRecord["manualState"];
  manualPowerW: BatteryStrategyRecord["manualPowerW"];
  manualChargeTargetSoc: BatteryStrategyRecord["manualChargeTargetSoc"];
  manualDischargeTargetSoc: BatteryStrategyRecord["manualDischargeTargetSoc"];
  manualTargetSoc: BatteryStrategyRecord["manualTargetSoc"];
  minimumDischargePercent: number;
  resolvedTargetSoc: number | null;
  targetMethod: BatteryStrategyPlanItem["targetMethod"];
  targetDurationMinutes: BatteryStrategyPlanItem["targetDurationMinutes"];
  targetEndTime: BatteryStrategyPlanItem["targetEndTime"];
  targetTime: string | null;
  activeStartedAt: string | null;
  preferPowerWhenAvailable: boolean;
  now: Date;
}): string {
  if (input.strategyMode === "self-consumption") {
    return "Self-consumption";
  }

  if (input.strategyMode === "auto") {
    return "Automatic strategy";
  }

  if (input.manualState === "charging") {
    return describeActionWithTarget("Charging", {
      powerW: input.manualPowerW,
      preferPowerWhenAvailable: input.preferPowerWhenAvailable,
      defaultTargetSoc:
        input.resolvedTargetSoc ??
        input.manualChargeTargetSoc ??
        input.manualTargetSoc,
      targetMethod: input.targetMethod,
      targetDurationMinutes: input.targetDurationMinutes,
      targetEndTime: input.targetEndTime,
      targetTime: input.targetTime,
      activeStartedAt: input.activeStartedAt,
      now: input.now,
    });
  }

  if (input.manualState === "discharging") {
    return describeActionWithTarget("Discharging", {
      powerW: input.manualPowerW,
      preferPowerWhenAvailable: input.preferPowerWhenAvailable,
      defaultTargetSoc:
        input.resolvedTargetSoc ??
        input.manualDischargeTargetSoc ??
        input.manualTargetSoc ??
        input.minimumDischargePercent,
      targetMethod: input.targetMethod,
      targetDurationMinutes: input.targetDurationMinutes,
      targetEndTime: input.targetEndTime,
      targetTime: input.targetTime,
      activeStartedAt: input.activeStartedAt,
      now: input.now,
    });
  }

  if (input.manualState === "idle") {
    return describeActionWithTarget("Idle", {
      powerW: input.manualPowerW,
      preferPowerWhenAvailable: input.preferPowerWhenAvailable,
      defaultTargetSoc: input.resolvedTargetSoc ?? input.manualTargetSoc,
      targetMethod: input.targetMethod,
      targetDurationMinutes: input.targetDurationMinutes,
      targetEndTime: input.targetEndTime,
      targetTime: input.targetTime,
      activeStartedAt: input.activeStartedAt,
      now: input.now,
    });
  }

  return "Manual strategy";
}

function describeActionWithTarget(
  action: "Charging" | "Discharging" | "Idle",
  input: {
    powerW: number | null;
    preferPowerWhenAvailable: boolean;
    defaultTargetSoc: number | null;
    targetMethod: BatteryStrategyPlanItem["targetMethod"];
    targetDurationMinutes: BatteryStrategyPlanItem["targetDurationMinutes"];
    targetEndTime: BatteryStrategyPlanItem["targetEndTime"];
    targetTime: string | null;
    activeStartedAt: string | null;
    now: Date;
  },
): string {
  let targetLabel: string | null = null;

  if (input.targetMethod === "auto") {
    targetLabel =
      input.defaultTargetSoc === null
        ? "with a dynamic target"
        : `to ${input.defaultTargetSoc}%`;

    if (input.targetTime) {
      targetLabel = `${targetLabel} by ${formatHumanClockTime(input.targetTime)}`;
    }
  }

  if (input.targetMethod === "duration") {
    const durationLabel = formatDurationTargetLabel({
      targetDurationMinutes: input.targetDurationMinutes,
      activeStartedAt: input.activeStartedAt,
      now: input.now,
    });

    targetLabel = durationLabel ? `for ${durationLabel}` : null;
  }

  if (targetLabel === null && input.targetMethod === "end-time") {
    targetLabel = input.targetEndTime ? `until ${input.targetEndTime}` : null;
  }

  if (
    targetLabel === null &&
    !(
      action === "Idle" &&
      input.defaultTargetSoc !== null &&
      input.defaultTargetSoc <= 0
    )
  ) {
    targetLabel =
      input.defaultTargetSoc === null ? null : `to ${input.defaultTargetSoc}%`;
  }

  if (
    input.preferPowerWhenAvailable &&
    input.powerW !== null &&
    input.powerW > 0
  ) {
    return targetLabel
      ? `${action} at ${input.powerW}W ${targetLabel}`
      : `${action} at ${input.powerW}W`;
  }

  return targetLabel ? `${action} ${targetLabel}` : action;
}

function formatDurationTargetLabel(input: {
  targetDurationMinutes: number | null;
  activeStartedAt: string | null;
  now: Date;
}): string | null {
  if (
    input.targetDurationMinutes === null ||
    input.targetDurationMinutes <= 0
  ) {
    return null;
  }

  if (input.activeStartedAt === null) {
    return formatMinuteCount(input.targetDurationMinutes);
  }

  const startedAt = new Date(input.activeStartedAt).getTime();

  if (Number.isNaN(startedAt)) {
    return formatMinuteCount(input.targetDurationMinutes);
  }

  const remainingMinutes = Math.max(
    1,
    Math.ceil(
      (startedAt + input.targetDurationMinutes * 60_000 - input.now.getTime()) /
        60_000,
    ),
  );

  return formatMinuteCount(remainingMinutes);
}

function formatMinuteCount(value: number): string {
  return value === 1 ? "1 minute" : `${value} minutes`;
}

function describeScheduledTargetHuman(
  item: BatteryStrategyPlanItem,
): string | null {
  if (item.targetMethod === "auto") {
    return "with a dynamic target";
  }

  if (item.targetMethod === "duration") {
    return item.targetDurationMinutes === null
      ? null
      : `for ${item.targetDurationMinutes} minute(s)`;
  }

  if (item.targetMethod === "end-time") {
    return item.targetEndTime === null ? null : `until ${item.targetEndTime}`;
  }

  if (item.targetMethod === "soc") {
    return item.manualTargetSoc === null
      ? null
      : `until ${item.manualTargetSoc}%`;
  }

  return null;
}

function formatHumanClockTime(value: string): string {
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function describeStrategyScheduleHuman(item: BatteryStrategyPlanItem): string {
  if (item.kind === "default") {
    return "the default strategy";
  }

  if (
    item.kind === "daily" &&
    item.triggerKind === "daily-time" &&
    item.startTime
  ) {
    return `the ${item.startTime} schedule`;
  }

  if (item.triggerKind === "low-price") {
    return "the low-price schedule";
  }

  if (item.triggerKind === "high-price") {
    return "the high-price schedule";
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
  dynamicPriceSamples: DynamicPriceSampleRecord[] = [],
): BatteryStrategyPlanItem | null {
  let nextItem: BatteryStrategyPlanItem | null = null;
  let nextTriggerAt: Date | null = null;

  for (const item of battery.strategyPlan.slice(1)) {
    if (!item.enabled) {
      continue;
    }

    const triggerAt = getNextStrategyTriggerAt({
      item,
      now,
      dynamicPriceSamples,
    });

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

    if (
      nextTriggerAt === null ||
      triggerAt.getTime() < nextTriggerAt.getTime()
    ) {
      nextItem = item;
      nextTriggerAt = triggerAt;
    }
  }

  return nextItem;
}

function joinHumanParts(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(" ");
}
