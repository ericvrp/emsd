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
  formatBatteryStrategyStatusSummary,
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
      activeStartSocPercent: null,
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

test("summarizes the nearest upcoming item even when plan order is unsorted", () => {
  const battery = buildBattery({
    strategyPlan: [
      buildDefaultItem(),
      buildDailyItem(),
      buildMorningItem({ id: "daily-idle", startTime: "17:37" }),
    ],
    strategyRuntime: {
      activeItemId: null,
      activeStartedAt: null,
      activeObservedAt: null,
      activeStartSocPercent: null,
      lastTriggeredAtByItemId: {},
    },
  });

  expect(
    formatStrategyPlanAppliedSummary(
      battery,
      new Date("2026-04-12T17:35:00.000Z"),
    ),
  ).toBe(
    "strategy plan updated for battery-1: default self-consumption with a 10% discharge floor; next the 17:37 daily schedule: discharge manually to 20% at 2400W",
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

test("includes idle target criteria in scheduled start summary", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem({
        manualState: "idle",
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: 40,
      }),
      "",
    ),
  ).toBe(
    "the 19:30 daily schedule is now active for battery-1: hold the battery idle until 40%",
  );
});

test("includes self-consumption target criteria in scheduled start summary", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem({
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: 55,
      }),
      "",
    ),
  ).toBe(
    "the 19:30 daily schedule is now active for battery-1: self-consumption until 55%",
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

test("summarizes end-time completion with a local cutoff timestamp", () => {
  const summary = formatScheduledStrategyCompletionSummary({
    batteryId: "battery-1",
    item: buildDailyItem({ targetMethod: "end-time", targetEndTime: "12:59" }),
    completion: {
      reason: "end-time-reached",
      nowAt: "2026-04-15T11:00:02.000Z",
      observedAt: null,
      startedAt: "2026-04-15T10:59:00.000Z",
      state: "idle",
      status: "idle",
      socPercent: 52,
      endAt: "2026-04-15T11:00:00.000Z",
    },
    fallbackItem: buildDefaultItem(),
  });

  expect(summary).toContain("it reached its cutoff at ");
  expect(summary).toContain(" (local)");
  expect(summary).not.toContain("T11:00:00.000Z");
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

test("strategy status summary returns default strategy without active item", () => {
  expect(formatBatteryStrategyStatusSummary(buildBattery())).toBe(
    "Default: Self-consumption",
  );
});

test("strategy status summary reports remaining duration for an active item", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeStartedAt: "2026-04-12T17:30:00.000Z",
        }),
        strategyPlan: [
          buildDefaultItem(),
          buildDailyItem({
            id: "daily-2",
            manualState: "charging",
            targetMethod: "duration",
            targetDurationMinutes: 30,
            manualChargeTargetSoc: 95,
            manualTargetSoc: 95,
          }),
        ],
      }),
      new Date("2026-04-12T17:37:00.000Z"),
    ),
  ).toBe("Charging for 23 minutes");
});

test("strategy status summary reports discharging target", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeStartedAt: "2026-04-12T17:30:00.000Z",
        }),
      }),
    ),
  ).toBe("Discharging to 80%");
});

test("strategy status summary reports self-consumption for manual override", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyMode: "self-consumption",
        manualModeActive: true,
      }),
    ),
  ).toBe("Self-consumption");
});

test("strategy status summary prefers power for manual discharging override", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 10,
        manualModeActive: true,
      }),
    ),
  ).toBe("Discharging at 2400W to 10%");
});

test("strategy status summary reports manual override duration", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 10,
        manualModeActive: true,
        strategyRuntime: buildRuntime({
          manualTargetMethod: "duration",
          manualTargetDurationMinutes: 6,
          manualTargetStartedAt: "2026-04-12T17:30:00.000Z",
        }),
      }),
      new Date("2026-04-12T17:31:10.000Z"),
    ),
  ).toBe("Discharging at 2400W for 5 minutes");
});

test("strategy status summary reports idle without zero target", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeStartedAt: "2026-04-12T17:30:00.000Z",
        }),
        strategyPlan: [
          buildDefaultItem(),
          buildDailyItem({
            id: "daily-2",
            manualState: "idle",
            manualPowerW: null,
            targetMethod: "soc",
            manualTargetSoc: 0,
            manualChargeTargetSoc: null,
            manualDischargeTargetSoc: null,
          }),
        ],
      }),
    ),
  ).toBe("Idle");
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

function buildMorningItem(
  overrides: Partial<BatteryStrategyPlanItem> = {},
): BatteryStrategyPlanItem {
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
    ...overrides,
  };
}

function buildDailyItem(
  overrides: Partial<BatteryStrategyPlanItem> = {},
): BatteryStrategyPlanItem {
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
    ...overrides,
  };
}

function buildRuntime(
  overrides: Partial<BatteryStrategyRuntimeRecord> = {},
): BatteryStrategyRuntimeRecord {
  return {
    activeItemId: null,
    activeStartedAt: null,
    activeObservedAt: null,
    activeStartSocPercent: null,
    lastTriggeredAtByItemId: {},
    ...overrides,
  };
}
