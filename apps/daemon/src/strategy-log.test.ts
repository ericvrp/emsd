import { expect, test } from "bun:test";
import type {
  BatteryRecord,
  BatteryStrategyPlanItem,
  BatteryStrategyRuntimeRecord,
} from "@emsd/core";
import type { ScheduledItemCompletion } from "./strategy-scheduler";
import {
  describeCurrentBatteryStrategyHuman,
  describeStrategyPlanItemHuman,
  formatFallbackStrategyRestoreSummary,
  formatManualStrategyAppliedSummary,
  formatScheduledStrategyCompletionSummary,
  formatScheduledStrategyStartedSummary,
  formatStrategyPlanAppliedSummary,
} from "./strategy-log";

test("describes self-consumption in human terms", () => {
  expect(describeCurrentBatteryStrategyHuman(buildBattery())).toBe(
    "self-consumption with a 10% discharge floor",
  );
});

test("describes manual discharge in human terms", () => {
  expect(describeStrategyPlanItemHuman(buildDailyItem())).toBe(
    "discharge manually to 80% at 2400W",
  );
});

test("summarizes a strategy plan update with the next item", () => {
  const battery = buildBattery({
    strategyPlan: [buildDefaultItem(), buildMorningItem(), buildDailyItem()],
    strategyRuntime: {
      activeItemId: null,
      activeStartedAt: null,
      activeObservedAt: null,
      lastTriggeredAtByItemId: {
        [buildMorningItem().id]: "2026-04-12T06:00:00.000Z",
      },
    },
  });

  expect(
    formatStrategyPlanAppliedSummary(
      battery,
      new Date("2026-04-12T17:35:00.000Z"),
    ),
  ).toBe(
    "strategy plan updated for battery-1: default self-consumption with a 10% discharge floor; next the 19:30 daily schedule: discharge manually to 80% at 2400W",
  );
});

test("summarizes scheduled strategy lifecycle in plain English", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem(),
      " after 11s",
    ),
  ).toBe(
    "the 19:30 daily schedule is now active for battery-1: discharge manually to 80% at 2400W (after 11s)",
  );
});

test("summarizes schedule completion and fallback", () => {
  const completion: ScheduledItemCompletion = {
    reason: "discharge-target-reached",
    nowAt: "2026-04-12T17:49:50.082Z",
    observedAt: "2026-04-12T17:30:15.206Z",
    startedAt: "2026-04-12T17:30:04.700Z",
    state: "discharging",
    status: "discharging",
    socPercent: 80,
    targetSoc: 80,
  };

  expect(
    formatScheduledStrategyCompletionSummary({
      batteryId: "battery-1",
      item: buildDailyItem(),
      completion,
      fallbackItem: buildDefaultItem(),
    }),
  ).toBe(
    "the 19:30 daily schedule completed for battery-1: it reached 80%, returning to default self-consumption with a 10% discharge floor",
  );

  expect(
    formatFallbackStrategyRestoreSummary("battery-1", buildDefaultItem()),
  ).toBe(
    "restoring the default strategy for battery-1: self-consumption with a 10% discharge floor",
  );
});

test("summarizes a temporary manual override", () => {
  expect(
    formatManualStrategyAppliedSummary(
      buildBattery({
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualDischargeTargetSoc: 80,
        manualTargetSoc: 80,
        manualModeActive: true,
      }),
    ),
  ).toBe(
    "temporary manual override applied for battery-1: discharge manually to 80% at 2400W",
  );
});

function buildBattery(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  return {
    id: "battery-1",
    siteId: "home",
    name: "Battery",
    plugin: "indevolt-battery",
    model: "Indevolt Battery",
    ipAddress: "192.168.1.232",
    enabled: true,
    status: "idle",
    connected: true,
    minimumDischargePercent: 10,
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualTargetSoc: 100,
    manualModeActive: false,
    manualModeStarted: false,
    strategyPlan: [buildDefaultItem(), buildDailyItem()],
    strategyRuntime: buildRuntime(),
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...overrides,
  };
}

function buildDefaultItem(): BatteryStrategyPlanItem {
  return {
    id: "default-1",
    kind: "default",
    startTime: null,
    triggerKind: null,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: null,
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualTargetSoc: 100,
  };
}

function buildMorningItem(): BatteryStrategyPlanItem {
  return {
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
  };
}

function buildDailyItem(): BatteryStrategyPlanItem {
  return {
    id: "daily-2",
    kind: "daily",
    startTime: "19:30",
    triggerKind: "daily-time",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "soc",
    strategyMode: "manual",
    manualState: "discharging",
    manualPowerW: 2400,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: 80,
    manualTargetSoc: 80,
  };
}

function buildRuntime(
  overrides: Partial<BatteryStrategyRuntimeRecord> = {},
): BatteryStrategyRuntimeRecord {
  return {
    activeItemId: null,
    activeStartedAt: null,
    activeObservedAt: null,
    lastTriggeredAtByItemId: {},
    ...overrides,
  };
}
