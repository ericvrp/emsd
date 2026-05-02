import {
  PRICE_SELECTION_WINDOW_MS,
  BatteryStrategyTriggerKind,
  findPriceSelections,
  isBatteryStrategyPriceTrigger,
  isDelayedChargingAutoDischargeItem,
  resolveActiveManualState,
} from "@emsd/core";
import type {
  BatteryRecord,
  BatteryStrategyPlanItem,
  BatteryStrategyRuntimeRecord,
  DynamicPriceSampleRecord,
  NormalizedBatteryInfo,
} from "@emsd/core";

const PRICE_TRIGGER_ELIGIBILITY_WINDOW_MS = 30 * 60 * 1000;

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
  return getScheduledItemCompletion(input) !== null;
}

export interface ScheduledItemCompletion {
  reason:
    | "missing-start-time"
    | "duration-elapsed"
    | "end-time-reached"
    | "idle-target-reached"
    | "self-consumption-target-reached"
    | "charge-target-reached"
    | "discharge-target-reached";
  nowAt: string;
  observedAt: string | null;
  startedAt: string | null;
  state: BatteryStrategyPlanItem["manualState"];
  status: NormalizedBatteryInfo["status"];
  socPercent: number | null;
  targetDurationMinutes?: number | null;
  targetSoc?: number;
  endAt?: string;
}

export function getScheduledItemCompletion(input: {
  battery: BatteryRecord;
  item: BatteryStrategyPlanItem;
  now: Date;
  runtime: BatteryStrategyRuntimeRecord;
  sample: NormalizedBatteryInfo;
}): ScheduledItemCompletion | null {
  const { battery, item, now, runtime, sample } = input;

  if (isDelayedChargePrepItem(item)) {
    return null;
  }

  const startedAt = runtime.activeStartedAt;
  const activeManualState = resolveActiveManualState({
    fallbackManualState: item.manualState,
    resolvedManualState: runtime.activeResolvedManualState,
    targetMethod: item.targetMethod,
  });
  const activeTargetSoc =
    item.targetMethod === "auto" ? runtime.activeTargetSocPercent : null;

  if (!startedAt) {
    return {
      reason: "missing-start-time",
      nowAt: now.toISOString(),
      observedAt: runtime.activeObservedAt,
      startedAt: null,
      state: activeManualState,
      status: sample.status,
      socPercent: sample.socPercent,
    };
  }

  if (item.targetMethod === "duration") {
    if (item.targetDurationMinutes === null) {
      return {
        reason: "duration-elapsed",
        nowAt: now.toISOString(),
        observedAt: runtime.activeObservedAt,
        startedAt,
        state: activeManualState,
        status: sample.status,
        socPercent: sample.socPercent,
        targetDurationMinutes: null,
      };
    }

    return now.getTime() >=
      new Date(startedAt).getTime() + item.targetDurationMinutes * 60000
      ? {
          reason: "duration-elapsed",
          nowAt: now.toISOString(),
          observedAt: runtime.activeObservedAt,
          startedAt,
          state: activeManualState,
          status: sample.status,
          socPercent: sample.socPercent,
          targetDurationMinutes: item.targetDurationMinutes,
        }
      : null;
  }

  if (item.targetMethod === "end-time") {
    const endAt = getScheduledEndAt(item, startedAt);

    if (endAt === null) {
      return {
        reason: "end-time-reached",
        nowAt: now.toISOString(),
        observedAt: runtime.activeObservedAt,
        startedAt,
        state: activeManualState,
        status: sample.status,
        socPercent: sample.socPercent,
      };
    }

    return now.getTime() >= endAt.getTime()
      ? {
          reason: "end-time-reached",
          nowAt: now.toISOString(),
          observedAt: runtime.activeObservedAt,
          startedAt,
          state: activeManualState,
          status: sample.status,
          socPercent: sample.socPercent,
          endAt: endAt.toISOString(),
        }
      : null;
  }

  if (item.strategyMode === "manual" && activeManualState === "charging") {
    const targetSoc = activeTargetSoc ?? item.manualChargeTargetSoc ?? 100;

    if (sample.socPercent !== null && sample.socPercent >= targetSoc) {
      return {
        reason: "charge-target-reached",
        nowAt: now.toISOString(),
        observedAt: runtime.activeObservedAt,
        startedAt,
        state: activeManualState,
        status: sample.status,
        socPercent: sample.socPercent,
        targetSoc,
      };
    }

    return null;
  }

  if (item.strategyMode === "manual" && activeManualState === "discharging") {
    const targetSoc =
      activeTargetSoc ??
      item.manualDischargeTargetSoc ??
      battery.minimumDischargePercent;

    if (sample.socPercent !== null && sample.socPercent <= targetSoc) {
      return {
        reason: "discharge-target-reached",
        nowAt: now.toISOString(),
        observedAt: runtime.activeObservedAt,
        startedAt,
        state: activeManualState,
        status: sample.status,
        socPercent: sample.socPercent,
        targetSoc,
      };
    }

    return null;
  }

  if (item.strategyMode === "manual" && activeManualState === "idle") {
    const targetSoc =
      activeTargetSoc ??
      item.manualTargetSoc ??
      battery.minimumDischargePercent;

    if (sample.socPercent !== null && sample.socPercent <= targetSoc) {
      return {
        reason: "idle-target-reached",
        nowAt: now.toISOString(),
        observedAt: runtime.activeObservedAt,
        startedAt,
        state: activeManualState,
        status: sample.status,
        socPercent: sample.socPercent,
        targetSoc,
      };
    }

    return null;
  }

  if (item.strategyMode === "self-consumption") {
    const targetSoc = activeTargetSoc ?? item.manualTargetSoc;

    if (targetSoc === null || sample.socPercent === null) {
      return null;
    }

    const startSoc = runtime.activeStartSocPercent;
    const reachedTarget =
      startSoc !== null
        ? startSoc <= targetSoc
          ? sample.socPercent >= targetSoc
          : sample.socPercent <= targetSoc
        : sample.socPercent === targetSoc;

    if (!reachedTarget) {
      return null;
    }

    return {
      reason: "self-consumption-target-reached",
      nowAt: now.toISOString(),
      observedAt: runtime.activeObservedAt,
      startedAt,
      state: activeManualState,
      status: sample.status,
      socPercent: sample.socPercent,
      targetSoc,
    };
  }

  return null;
}

export function formatScheduledItemCompletion(
  completion: ScheduledItemCompletion,
): string {
  const parts = [
    `reason=${completion.reason}`,
    `state=${completion.state ?? "none"}`,
    `status=${completion.status}`,
    `soc=${formatNullableNumber(completion.socPercent)}`,
  ];

  if (completion.targetSoc !== undefined) {
    parts.push(`targetSoc=${formatNullableNumber(completion.targetSoc)}`);
  }

  if (completion.targetDurationMinutes !== undefined) {
    parts.push(
      `duration=${completion.targetDurationMinutes === null ? "none" : `${completion.targetDurationMinutes}m`}`,
    );
  }

  if (completion.startedAt !== null) {
    parts.push(`startedAt=${completion.startedAt}`);
  }

  if (completion.observedAt !== null) {
    parts.push(`observedAt=${completion.observedAt}`);
  }

  if (completion.endAt !== undefined) {
    parts.push(`endAt=${completion.endAt}`);
  }

  parts.push(`nowAt=${completion.nowAt}`);

  return parts.join(" ");
}

export function shouldSkipScheduledItem(
  item: BatteryStrategyPlanItem,
  triggerAt: Date,
  now: Date,
): boolean {
  if (
    isBatteryStrategyPriceTrigger(item.triggerKind) &&
    now.getTime() >= triggerAt.getTime() + PRICE_TRIGGER_ELIGIBILITY_WINDOW_MS
  ) {
    return true;
  }

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
  dynamicPriceSamples?: DynamicPriceSampleRecord[];
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
    const laterTriggerAt = getStrategyTriggerAt({
      item: laterItem,
      now: input.now,
      ...(input.dynamicPriceSamples
        ? { dynamicPriceSamples: input.dynamicPriceSamples }
        : {}),
    });

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
    item.triggerKind !== BatteryStrategyTriggerKind.DailyTime ||
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

export function getStrategyTriggerAt(input: {
  item: BatteryStrategyPlanItem;
  now: Date;
  dynamicPriceSamples?: DynamicPriceSampleRecord[];
}): Date | null {
  const { item, now, dynamicPriceSamples = [] } = input;

  if (item.triggerKind === BatteryStrategyTriggerKind.DailyTime) {
    return getTodayTriggerAt(item, now);
  }

  if (item.triggerKind === BatteryStrategyTriggerKind.DelayedChargePrep) {
    return getDelayedChargePrepTriggerAt({ now, dynamicPriceSamples });
  }

  if (!isBatteryStrategyPriceTrigger(item.triggerKind)) {
    return null;
  }

  if (isDelayedChargingAutoDischargeItem(item)) {
    return getLowPriceAutoTriggerAt({ now, dynamicPriceSamples });
  }

  return getPriceMarkerTriggerAt({
    triggerKind: item.triggerKind,
    now,
    dynamicPriceSamples,
  });
}

export function getNextStrategyTriggerAt(input: {
  item: BatteryStrategyPlanItem;
  now: Date;
  dynamicPriceSamples?: DynamicPriceSampleRecord[];
}): Date | null {
  const { item, now, dynamicPriceSamples = [] } = input;

  if (item.triggerKind === BatteryStrategyTriggerKind.DailyTime) {
    return getTodayTriggerAt(item, now);
  }

  if (item.triggerKind === BatteryStrategyTriggerKind.DelayedChargePrep) {
    return getDelayedChargePrepTriggerAt({ now, dynamicPriceSamples });
  }

  if (!isBatteryStrategyPriceTrigger(item.triggerKind)) {
    return null;
  }

  if (isDelayedChargingAutoDischargeItem(item)) {
    return getNextLowPriceAutoTriggerAt({ now, dynamicPriceSamples });
  }

  return getNextPriceMarkerTriggerAt({
    triggerKind: item.triggerKind,
    now,
    dynamicPriceSamples,
  });
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
  if (item.targetMethod === "duration" || item.targetMethod === "end-time") {
    return true;
  }

  if (item.strategyMode === "self-consumption") {
    return item.manualTargetSoc !== null;
  }

  return (
    item.strategyMode === "manual" &&
    item.manualState !== null &&
    (item.manualState === "idle" ||
      item.manualState === "charging" ||
      item.manualState === "discharging")
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
    isDelayedChargingAutoDischargeItem(input.item) &&
    input.runtime.activeResolvedManualState === null
  ) {
    return false;
  }

  const activeManualState = resolveActiveManualState({
    fallbackManualState: input.item.manualState,
    resolvedManualState: input.runtime.activeResolvedManualState,
    targetMethod: input.item.targetMethod,
  });

  if (
    input.runtime.activeObservedAt !== null ||
    !shouldWaitForObservedStart(input.item, activeManualState)
  ) {
    return false;
  }

  return (
    (activeManualState === "charging" && input.sample.status === "charging") ||
    (activeManualState === "discharging" &&
      input.sample.status === "discharging")
  );
}

export function shouldWaitForObservedStart(
  item: BatteryStrategyPlanItem,
  activeManualState: BatteryStrategyPlanItem["manualState"] = item.manualState,
): boolean {
  return (
    item.strategyMode === "manual" &&
    (activeManualState === "charging" || activeManualState === "discharging")
  );
}

function isSocTargetItem(item: BatteryStrategyPlanItem): boolean {
  return (
    item.strategyMode === "manual" &&
    (item.manualState === "charging" || item.manualState === "discharging") &&
    (item.targetMethod === null ||
      item.targetMethod === "soc" ||
      item.targetMethod === "auto")
  );
}

function getLowPriceAutoTriggerAt(input: {
  now: Date;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date | null {
  const triggerMarkers = getPriceMarkersOnOrAfterDay({
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    now: input.now,
    dynamicPriceSamples: input.dynamicPriceSamples,
  });
  let latestDueMarker: Date | null = null;

  for (const markerAt of triggerMarkers) {
    if (markerAt.getTime() <= input.now.getTime()) {
      latestDueMarker = markerAt;
    }
  }

  if (latestDueMarker !== null) {
    return latestDueMarker;
  }

  return triggerMarkers[0] ?? null;
}

function getNextLowPriceAutoTriggerAt(input: {
  now: Date;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date | null {
  for (const markerAt of getPriceMarkersOnOrAfterDay({
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    now: input.now,
    dynamicPriceSamples: input.dynamicPriceSamples,
  })) {
    if (markerAt.getTime() >= input.now.getTime()) {
      return markerAt;
    }
  }

  return null;
}

function getPriceMarkerTriggerAt(input: {
  triggerKind:
    | BatteryStrategyTriggerKind.DelayedCharging
    | BatteryStrategyTriggerKind.ExportSurplus;
  now: Date;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date | null {
  const todayMarkers = getPriceMarkersForToday(input);

  if (todayMarkers.length === 0) {
    return null;
  }

  let latestDueMarker: Date | null = null;

  for (const markerAt of todayMarkers) {
    if (markerAt.getTime() <= input.now.getTime()) {
      latestDueMarker = markerAt;
    }
  }

  if (latestDueMarker !== null) {
    return latestDueMarker;
  }

  return todayMarkers[0] ?? null;
}

export function getNextPriceMarkerTriggerAt(input: {
  triggerKind:
    | BatteryStrategyTriggerKind.DelayedCharging
    | BatteryStrategyTriggerKind.ExportSurplus;
  now: Date;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date | null {
  const upcomingMarkers =
    input.triggerKind === BatteryStrategyTriggerKind.DelayedCharging
      ? getPriceMarkersOnOrAfterDay(input)
      : getPriceMarkersForToday(input);

  for (const markerAt of upcomingMarkers) {
    if (markerAt.getTime() >= input.now.getTime()) {
      return markerAt;
    }
  }

  return null;
}

export function getLowPriceAutoTriggerAtForMarker(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  markerAt: Date;
}): Date | null {
  void input.dynamicPriceSamples;
  return input.markerAt;
}

export function getPriceMarkersForToday(input: {
  triggerKind:
    | BatteryStrategyTriggerKind.DelayedCharging
    | BatteryStrategyTriggerKind.ExportSurplus;
  now: Date;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date[] {
  const selections = findPriceSelections(
    input.dynamicPriceSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
    PRICE_SELECTION_WINDOW_MS,
  );
  const markerPeriodStarts =
    input.triggerKind === BatteryStrategyTriggerKind.DelayedCharging
      ? selections.lowest.map((point) => point.periodStart)
      : selections.highest.map((point) => point.periodStart);

  return markerPeriodStarts
    .map((periodStart) => new Date(periodStart))
    .filter(
      (markerAt) =>
        !Number.isNaN(markerAt.getTime()) &&
        formatLocalDate(markerAt) === formatLocalDate(input.now),
    )
    .sort((left, right) => left.getTime() - right.getTime());
}

function getPriceMarkersOnOrAfterDay(input: {
  triggerKind:
    | BatteryStrategyTriggerKind.DelayedCharging
    | BatteryStrategyTriggerKind.ExportSurplus;
  now: Date;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date[] {
  const minimumDay = formatLocalDate(input.now);

  return getAllPriceMarkers(input).filter(
    (markerAt) => formatLocalDate(markerAt) >= minimumDay,
  );
}

function getAllPriceMarkers(input: {
  triggerKind:
    | BatteryStrategyTriggerKind.DelayedCharging
    | BatteryStrategyTriggerKind.ExportSurplus;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date[] {
  const selections = findPriceSelections(
    input.dynamicPriceSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
    PRICE_SELECTION_WINDOW_MS,
  );
  const markerPeriodStarts =
    input.triggerKind === BatteryStrategyTriggerKind.DelayedCharging
      ? selections.lowest.map((point) => point.periodStart)
      : selections.highest.map((point) => point.periodStart);

  return markerPeriodStarts
    .map((periodStart) => new Date(periodStart))
    .filter((markerAt) => !Number.isNaN(markerAt.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
}

export function isDelayedChargePrepItem(
  item: Pick<
    BatteryStrategyPlanItem,
    "manualState" | "strategyMode" | "targetMethod" | "triggerKind"
  >,
): boolean {
  return (
    item.strategyMode === "manual" &&
    item.manualState === "idle" &&
    item.targetMethod === "auto" &&
    item.triggerKind === BatteryStrategyTriggerKind.DelayedChargePrep
  );
}

function getDelayedChargePrepTriggerAt(input: {
  now: Date;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
}): Date | null {
  const lowMarkers = getPriceMarkersOnOrAfterDay({
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    now: input.now,
    dynamicPriceSamples: input.dynamicPriceSamples,
  });
  const upcomingLowMarker = lowMarkers.find(
    (markerAt) => markerAt.getTime() >= input.now.getTime(),
  );
  if (!upcomingLowMarker) {
    return null;
  }
  const highMarkers = getPriceMarkersOnOrAfterDay({
    triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
    now: input.now,
    dynamicPriceSamples: input.dynamicPriceSamples,
  });
  let priorHighMarker: Date | null = null;
  for (const markerAt of highMarkers) {
    if (markerAt.getTime() < upcomingLowMarker.getTime()) {
      priorHighMarker = markerAt;
    }
  }
  if (priorHighMarker === null) {
    return null;
  }
  return new Date(priorHighMarker.getTime() + 60 * 60 * 1000);
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

function formatNullableNumber(value: number | null): string {
  return value === null ? "unknown" : String(value);
}
