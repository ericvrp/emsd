import type {
  BatteryManualState,
  BatteryStrategyPlanItem,
  BatteryStrategyTargetMethod,
} from "@emsd/core/client";

export type StrategyAction = "self-consumption" | BatteryManualState;

export function applyStrategyAction(
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
      triggerKind: item.kind === "daily" ? item.triggerKind : null,
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

function getPersistedTargetMethod(
  item: BatteryStrategyPlanItem,
): BatteryStrategyTargetMethod {
  return item.targetMethod ?? "soc";
}
