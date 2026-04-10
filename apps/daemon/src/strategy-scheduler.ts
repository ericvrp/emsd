import type {
  BatteryRecord,
  BatteryStrategyPlanItem,
  BatteryStrategyRuntimeRecord,
  NormalizedBatteryInfo,
} from "@emsd/core";

export function formatDaemonLogTimestamp(date: Date = new Date()): string {
  return `${formatLocalDate(date)} ${formatLocalTime(date)}`;
}

export function getDaemonTimeZoneLabel(date: Date = new Date()): string {
  void date;
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";
}

export function isItemAlreadyTriggeredToday(input: {
  runtime: BatteryStrategyRuntimeRecord;
  itemId: string;
  triggerAt: Date;
}): boolean {
  const lastTriggeredAt = input.runtime.lastTriggeredAtByItemId[input.itemId];

  return (
    typeof lastTriggeredAt === "string" &&
    new Date(lastTriggeredAt).getTime() >= input.triggerAt.getTime()
  );
}

export function shouldCompleteScheduledItem(input: {
  battery: BatteryRecord;
  item: BatteryStrategyPlanItem;
  now: Date;
  runtime: BatteryStrategyRuntimeRecord;
  sample: NormalizedBatteryInfo;
}): boolean {
  const { battery, item, now, runtime, sample } = input;
  const startedAt = runtime.activeStartedAt;

  if (!startedAt) {
    return true;
  }

  if (item.targetMethod === "duration") {
    if (item.targetDurationMinutes === null) {
      return true;
    }

    return (
      now.getTime() >=
      new Date(startedAt).getTime() + item.targetDurationMinutes * 60000
    );
  }

  if (item.targetMethod === "end-time") {
    const endAt = getScheduledEndAt(item, startedAt);
    return endAt === null ? true : now.getTime() >= endAt.getTime();
  }

  if (item.strategyMode !== "manual") {
    return false;
  }

  if (item.manualState === "charging") {
    if (
      sample.socPercent !== null &&
      sample.socPercent >= (item.manualChargeTargetSoc ?? 100)
    ) {
      return true;
    }

    if (runtime.activeObservedAt === null) {
      return false;
    }

    return sample.status !== "charging";
  }

  if (item.manualState === "discharging") {
    if (
      sample.socPercent !== null &&
      sample.socPercent <=
        (item.manualDischargeTargetSoc ?? battery.minimumDischargePercent)
    ) {
      return true;
    }

    if (runtime.activeObservedAt === null) {
      return false;
    }

    return sample.status !== "discharging";
  }

  return false;
}

export function shouldSkipScheduledItem(
  item: BatteryStrategyPlanItem,
  triggerAt: Date,
  now: Date,
): boolean {
  if (item.targetMethod === "duration") {
    return (
      item.targetDurationMinutes !== null &&
      now.getTime() >= triggerAt.getTime() + item.targetDurationMinutes * 60000
    );
  }

  if (item.targetMethod === "end-time") {
    const endAt = getScheduledEndAt(item, triggerAt.toISOString());
    return endAt !== null && now.getTime() >= endAt.getTime();
  }

  return false;
}

export function shouldSkipDelayedSocItemBecauseLaterItemIsDue(input: {
  items: BatteryStrategyPlanItem[];
  currentIndex: number;
  currentTriggerAt: Date;
  now: Date;
  runtime: BatteryStrategyRuntimeRecord;
}): boolean {
  const currentItem = input.items[input.currentIndex];

  if (!currentItem || !isSocTargetItem(currentItem)) {
    return false;
  }

  for (const laterItem of input.items.slice(input.currentIndex + 1)) {
    const laterTriggerAt = getTodayTriggerAt(laterItem, input.now);

    if (
      laterTriggerAt === null ||
      laterTriggerAt.getTime() <= input.currentTriggerAt.getTime() ||
      input.now.getTime() < laterTriggerAt.getTime()
    ) {
      continue;
    }

    if (
      isItemAlreadyTriggeredToday({
        runtime: input.runtime,
        itemId: laterItem.id,
        triggerAt: laterTriggerAt,
      })
    ) {
      continue;
    }

    return true;
  }

  return false;
}

export function getTodayTriggerAt(
  item: BatteryStrategyPlanItem,
  now: Date,
): Date | null {
  if (
    item.kind !== "daily" ||
    item.triggerKind !== "daily-time" ||
    !item.startTime
  ) {
    return null;
  }

  const [hoursPart, minutesPart] = item.startTime.split(":");
  const triggerAt = new Date(now);
  triggerAt.setHours(
    Number(hoursPart ?? "0"),
    Number(minutesPart ?? "0"),
    0,
    0,
  );
  return triggerAt;
}

export function getScheduledEndAt(
  item: BatteryStrategyPlanItem,
  startedAt: string,
): Date | null {
  if (item.targetEndTime === null) {
    return null;
  }

  const [hoursPart, minutesPart] = item.targetEndTime.split(":");
  const startDate = new Date(startedAt);
  const endAt = new Date(startDate);
  endAt.setHours(Number(hoursPart ?? "0"), Number(minutesPart ?? "0"), 0, 0);

  if (endAt.getTime() <= startDate.getTime()) {
    endAt.setDate(endAt.getDate() + 1);
  }

  return endAt;
}

export function needsCompletionTracking(
  item: BatteryStrategyPlanItem,
): boolean {
  return (
    item.strategyMode === "manual" &&
    item.manualState !== null &&
    item.manualState !== "idle"
  );
}

export function describeStrategyPlanItem(
  item: BatteryStrategyPlanItem | null | undefined,
): string {
  if (!item) {
    return "<none>";
  }

  const parts = [
    `id=${item.id}`,
    `kind=${item.kind}`,
    `mode=${item.strategyMode}`,
  ];

  if (item.triggerKind) {
    parts.push(`trigger=${item.triggerKind}`);
  }

  if (item.startTime) {
    parts.push(`start=${item.startTime}`);
  }

  if (item.manualState) {
    parts.push(`state=${item.manualState}`);
  }

  if (item.targetMethod) {
    parts.push(`target=${item.targetMethod}`);
  }

  if (item.targetDurationMinutes !== null) {
    parts.push(`duration=${item.targetDurationMinutes}m`);
  }

  if (item.targetEndTime) {
    parts.push(`end=${item.targetEndTime}`);
  }

  if (item.manualChargeTargetSoc !== null) {
    parts.push(`chargeSoc=${item.manualChargeTargetSoc}`);
  }

  if (item.manualDischargeTargetSoc !== null) {
    parts.push(`dischargeSoc=${item.manualDischargeTargetSoc}`);
  }

  if (item.manualPowerW !== null) {
    parts.push(`powerW=${item.manualPowerW}`);
  }

  return parts.join(" ");
}

export function shouldMarkScheduledItemObserved(input: {
  item: BatteryStrategyPlanItem;
  runtime: BatteryStrategyRuntimeRecord;
  sample: NormalizedBatteryInfo;
}): boolean {
  if (
    input.runtime.activeObservedAt !== null ||
    input.item.strategyMode !== "manual"
  ) {
    return false;
  }

  return (
    (input.item.manualState === "charging" &&
      input.sample.status === "charging") ||
    (input.item.manualState === "discharging" &&
      input.sample.status === "discharging")
  );
}

function isSocTargetItem(item: BatteryStrategyPlanItem): boolean {
  return (
    item.strategyMode === "manual" &&
    (item.manualState === "charging" || item.manualState === "discharging") &&
    (item.targetMethod === null || item.targetMethod === "soc")
  );
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function formatLocalTime(date: Date): string {
  return [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
