import type { BatteryManualState, BatteryStrategyPlanItem } from "./index";

export function isLowPriceAutoDischargeItem(
  item: Pick<
    BatteryStrategyPlanItem,
    "manualState" | "strategyMode" | "targetMethod" | "triggerKind"
  >,
): boolean {
  return (
    item.strategyMode === "manual" &&
    item.manualState === "charging" &&
    item.targetMethod === "auto" &&
    item.triggerKind === "low-price"
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
