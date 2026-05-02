import {
  BatteryStrategyTriggerKind,
  formatBatteryStrategyTriggerKindLabel,
  isBatteryStrategyPriceTrigger,
} from "./battery-strategy-shared";
import type {
  BatteryManualState,
  BatteryStrategyHistoryDisplayState,
  BatteryStrategyPlanItem,
  BatteryStrategyRecord,
  BatteryStrategyRuntimeRecord,
} from "./index";

export function isDelayedChargingAutoDischargeItem(
  item: Pick<
    BatteryStrategyPlanItem,
    "manualState" | "strategyMode" | "targetMethod" | "triggerKind"
  >,
): boolean {
  return (
    item.strategyMode === "manual" &&
    item.manualState === "charging" &&
    item.targetMethod === "auto" &&
    item.triggerKind === BatteryStrategyTriggerKind.DelayedCharging
  );
}

export function resolveActiveManualState(input: {
  fallbackManualState: BatteryManualState | null;
  resolvedManualState: BatteryManualState | null | undefined;
  targetMethod: BatteryStrategyPlanItem["targetMethod"] | undefined;
}): BatteryManualState | null {
  return input.targetMethod === "auto"
    ? (input.resolvedManualState ?? input.fallbackManualState)
    : input.fallbackManualState;
}

export function resolveEstimatedManualState(input: {
  fallbackManualState: BatteryManualState | null;
  resolvedManualState: BatteryManualState | null | undefined;
  targetMethod: BatteryStrategyPlanItem["targetMethod"] | undefined;
}): BatteryManualState | null {
  return input.targetMethod === "auto"
    ? input.resolvedManualState === undefined
      ? input.fallbackManualState
      : input.resolvedManualState
    : input.fallbackManualState;
}

export function getBatteryStrategyDisplayState(
  battery: Pick<BatteryStrategyRecord, "manualState" | "strategyMode">,
): BatteryStrategyHistoryDisplayState {
  if (battery.strategyMode === "self-consumption") {
    return "self-consumption";
  }

  if (battery.manualState === "charging") {
    return "charge";
  }

  if (battery.manualState === "discharging") {
    return "discharge";
  }

  return "idle";
}

export function formatBatteryStrategyDisplayState(
  displayState: BatteryStrategyHistoryDisplayState,
): string {
  switch (displayState) {
    case "self-consumption":
      return "Self-consumption";
    case "charge":
      return "Charge";
    case "discharge":
      return "Discharge";
    case "idle":
      return "Idle";
  }
}

export function getBatteryStrategyDisplayLabel(
  battery: Pick<BatteryStrategyRecord, "manualState" | "strategyMode"> & {
    strategyPlan: Array<Pick<BatteryStrategyPlanItem, "id" | "triggerKind">>;
    strategyRuntime: Pick<BatteryStrategyRuntimeRecord, "activeItemId">;
  },
): string {
  const displayState = getBatteryStrategyDisplayState(battery);
  const baseLabel = formatBatteryStrategyDisplayState(displayState);
  const activeItem = getActiveBatteryStrategyPlanItem({
    strategyPlan: battery.strategyPlan,
    strategyRuntime: battery.strategyRuntime,
  });

  if (
    activeItem?.triggerKind &&
    isBatteryStrategyPriceTrigger(activeItem.triggerKind)
  ) {
    return `${formatBatteryStrategyTriggerKindLabel(activeItem.triggerKind)}: ${baseLabel}`;
  }

  return baseLabel;
}

export function getBatteryStrategyItemLabel(battery: {
  manualModeActive: boolean;
  strategyPlan: Array<Pick<BatteryStrategyPlanItem, "id" | "name">>;
  strategyRuntime: Pick<
    BatteryStrategyRuntimeRecord,
    "activeItemId" | "manualLabel"
  >;
}): string | null {
  if (battery.manualModeActive) {
    return battery.strategyRuntime.manualLabel ?? null;
  }

  const activeItem = getActiveBatteryStrategyPlanItem({
    strategyPlan: battery.strategyPlan,
    strategyRuntime: battery.strategyRuntime,
  });

  return activeItem?.name ?? null;
}

function getActiveBatteryStrategyPlanItem<
  T extends Pick<BatteryStrategyPlanItem, "id">,
>(input: {
  strategyPlan: T[];
  strategyRuntime: Pick<BatteryStrategyRuntimeRecord, "activeItemId">;
}): T | null {
  return input.strategyRuntime.activeItemId
    ? (input.strategyPlan.find(
        (item) => item.id === input.strategyRuntime.activeItemId,
      ) ?? null)
    : null;
}
