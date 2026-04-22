import { expect, test } from "bun:test";
import type { BatteryStrategyPlanItem } from "@emsd/core/client";
import { applyStrategyAction } from "./battery-strategy-plan-logic";

test("applyStrategyAction keeps a high-price trigger when switching to self-consumption", () => {
  const item = createDailyItem({ triggerKind: "high-price" });

  const updated = applyStrategyAction(item, "self-consumption", 10);

  expect(updated.strategyMode).toBe("self-consumption");
  expect(updated.triggerKind).toBe("high-price");
});

test("applyStrategyAction keeps a low-price trigger when switching to self-consumption", () => {
  const item = createDailyItem({ triggerKind: "low-price" });

  const updated = applyStrategyAction(item, "self-consumption", 10);

  expect(updated.strategyMode).toBe("self-consumption");
  expect(updated.triggerKind).toBe("low-price");
});

test("applyStrategyAction clears strategy power when switching to manual discharge", () => {
  const item = createDailyItem({ manualPowerW: 2400 });

  const updated = applyStrategyAction(item, "discharging", 10);

  expect(updated.strategyMode).toBe("manual");
  expect(updated.manualPowerW).toBeNull();
});

function createDailyItem(
  overrides: Partial<BatteryStrategyPlanItem> = {},
): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "daily-1",
    kind: "daily",
    startTime: "08:00",
    triggerKind: "daily-time",
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
