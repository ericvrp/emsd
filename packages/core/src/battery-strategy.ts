import { BatteryStrategyTriggerKind } from "./battery-strategy-shared";
import type { BatteryManualState, BatteryStrategyPlanItem } from "./index";

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
