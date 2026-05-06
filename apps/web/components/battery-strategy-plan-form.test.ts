import { expect, test } from "bun:test";
import {
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
} from "@emsd/core/client";
import { applyStrategyAction } from "./battery-strategy-plan-logic";

test("applyStrategyAction keeps an export-surplus trigger when switching to self-consumption", () => {
  const item = createDailyItem({
    triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
  });

  const updated = applyStrategyAction(item, "self-consumption", 10);

  expect(updated.strategyMode).toBe("self-consumption");
  expect(updated.triggerKind).toBe(BatteryStrategyTriggerKind.ExportSurplus);
});

test("applyStrategyAction keeps a delayed-charging trigger when switching to self-consumption", () => {
  const item = createDailyItem({
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  });

  const updated = applyStrategyAction(item, "self-consumption", 10);

  expect(updated.strategyMode).toBe("self-consumption");
  expect(updated.triggerKind).toBe(BatteryStrategyTriggerKind.DelayedCharging);
});

test("applyStrategyAction clears strategy power when switching to manual discharge", () => {
  const item = createDailyItem({ manualPowerW: 2400 });

  const updated = applyStrategyAction(item, "discharging", 10);

  expect(updated.strategyMode).toBe("manual");
  expect(updated.manualPowerW).toBeNull();
});

test("applyStrategyAction keeps target method details when switching to idle", () => {
  const item = createDailyItem({
    targetDurationMinutes: 45,
    targetMethod: "duration",
  });

  const updated = applyStrategyAction(item, "idle", 10);

  expect(updated.strategyMode).toBe("manual");
  expect(updated.manualState).toBe("idle");
  expect(updated.targetMethod).toBe("duration");
  expect(updated.targetDurationMinutes).toBe(45);
});

test("applyStrategyAction keeps target method details when switching to self-consumption", () => {
  const item = createDailyItem({
    targetEndTime: "13:30",
    targetMethod: "end-time",
  });

  const updated = applyStrategyAction(item, "self-consumption", 10);

  expect(updated.strategyMode).toBe("self-consumption");
  expect(updated.manualState).toBeNull();
  expect(updated.targetMethod).toBe("end-time");
  expect(updated.targetEndTime).toBe("13:30");
});

function createDailyItem(
  overrides: Partial<BatteryStrategyPlanItem> = {},
): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "daily-1",
    kind: "daily",
    startTime: "08:00",
    triggerKind: BatteryStrategyTriggerKind.DailyTime,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "soc",
    strategyMode: "manual",
    manualState: "discharging",
    manualPowerW: 2400,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: 20,
    manualTargetSoc: 20,
    ...overrides,
  };
}
