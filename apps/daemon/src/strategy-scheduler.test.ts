import { expect, test } from "bun:test";
import type {
  BatteryRecord,
  BatteryStrategyPlanItem,
  NormalizedBatteryInfo,
} from "@emsd/core";
import {
  formatScheduledItemCompletion,
  formatDaemonLogTimestamp,
  getScheduledItemCompletion,
  getTodayTriggerAt,
  shouldCompleteScheduledItem,
  shouldMarkScheduledItemObserved,
  shouldSkipDelayedSocItemBecauseLaterItemIsDue,
} from "./strategy-scheduler";

test("formatDaemonLogTimestamp uses local wall-clock formatting", () => {
  expect(
    formatDaemonLogTimestamp(new Date("2026-04-09T18:45:30.000Z")),
  ).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("getTodayTriggerAt keeps the configured local clock time", () => {
  const now = new Date("2026-04-09T18:45:30.000Z");
  const triggerAt = getTodayTriggerAt(
    createDailyItem({ startTime: "20:00" }),
    now,
  );

  expect(triggerAt).not.toBeNull();
  expect(triggerAt?.getHours()).toBe(20);
  expect(triggerAt?.getMinutes()).toBe(0);
});

test("shouldCompleteScheduledItem uses the active plan item rather than the persisted battery strategy", () => {
  const battery = createBattery({
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualTargetSoc: 100,
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T07:00:00.000Z",
      activeObservedAt: "2026-04-09T07:00:05.000Z",
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T07:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    manualState: "discharging",
    manualDischargeTargetSoc: 40,
    manualTargetSoc: 40,
    targetMethod: "soc",
  });
  const sample = createSample({ socPercent: 35, status: "idle" });

  expect(
    shouldCompleteScheduledItem({
      battery,
      item,
      now: new Date("2026-04-09T12:00:00.000Z"),
      runtime: battery.strategyRuntime,
      sample,
    }),
  ).toBe(true);
});

test("shouldCompleteScheduledItem waits until a scheduled discharge is observed", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T09:00:00.000Z",
      activeObservedAt: null,
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T09:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    manualState: "discharging",
    manualDischargeTargetSoc: 40,
    manualTargetSoc: 40,
    targetMethod: "soc",
  });
  const sample = createSample({ socPercent: 55, status: "idle" });

  expect(
    shouldCompleteScheduledItem({
      battery,
      item,
      now: new Date("2026-04-09T09:05:00.000Z"),
      runtime: battery.strategyRuntime,
      sample,
    }),
  ).toBe(false);
});

test("shouldCompleteScheduledItem does not stop a scheduled discharge just because status changed", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T09:00:00.000Z",
      activeObservedAt: "2026-04-09T09:00:15.000Z",
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T09:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    manualState: "discharging",
    manualDischargeTargetSoc: 15,
    manualTargetSoc: 15,
    targetMethod: "soc",
  });
  const sample = createSample({ socPercent: 18, status: "idle" });

  expect(
    shouldCompleteScheduledItem({
      battery,
      item,
      now: new Date("2026-04-09T09:05:00.000Z"),
      runtime: battery.strategyRuntime,
      sample,
    }),
  ).toBe(false);
});

test("getScheduledItemCompletion returns discharge target details when the target is reached", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T09:00:00.000Z",
      activeObservedAt: "2026-04-09T09:00:15.000Z",
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T09:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    manualState: "discharging",
    manualDischargeTargetSoc: 15,
    manualTargetSoc: 15,
    targetMethod: "soc",
  });
  const completion = getScheduledItemCompletion({
    battery,
    item,
    now: new Date("2026-04-09T09:04:14.000Z"),
    runtime: battery.strategyRuntime,
    sample: createSample({ socPercent: 15, status: "discharging" }),
  });

  if (completion === null) {
    throw new Error("expected completion details");
  }

  expect(completion.reason).toBe("discharge-target-reached");
  expect(formatScheduledItemCompletion(completion)).toContain("targetSoc=15");
});

test("shouldMarkScheduledItemObserved when the scheduled state is active", () => {
  const item = createDailyItem({ id: "daily-1", manualState: "discharging" });

  expect(
    shouldMarkScheduledItemObserved({
      item,
      runtime: {
        activeItemId: "daily-1",
        activeStartedAt: "2026-04-09T09:00:00.000Z",
        activeObservedAt: null,
        lastTriggeredAtByItemId: { "daily-1": "2026-04-09T09:00:00.000Z" },
      },
      sample: createSample({ status: "discharging" }),
    }),
  ).toBe(true);
});

test("shouldSkipDelayedSocItemBecauseLaterItemIsDue skips older delayed percentage items", () => {
  const items = [
    createDailyItem({ id: "morning", startTime: "07:00" }),
    createDailyItem({ id: "evening", startTime: "20:00" }),
  ];
  const now = new Date("2026-04-09T21:00:00.000Z");
  const currentItem = items[0];

  if (!currentItem) {
    throw new Error("expected a current item");
  }

  const currentTriggerAt = getTodayTriggerAt(currentItem, now);

  if (!currentTriggerAt) {
    throw new Error("expected a current trigger time");
  }

  expect(
    shouldSkipDelayedSocItemBecauseLaterItemIsDue({
      items,
      currentIndex: 0,
      currentTriggerAt,
      now,
      runtime: {
        activeItemId: null,
        activeStartedAt: null,
        activeObservedAt: null,
        lastTriggeredAtByItemId: {},
      },
    }),
  ).toBe(true);
});

test("shouldSkipDelayedSocItemBecauseLaterItemIsDue keeps same-time items in array order", () => {
  const items = [
    createDailyItem({ id: "first", startTime: "20:00" }),
    createDailyItem({ id: "second", startTime: "20:00" }),
  ];
  const now = new Date("2026-04-09T20:05:00.000Z");
  const currentItem = items[0];

  if (!currentItem) {
    throw new Error("expected a current item");
  }

  const currentTriggerAt = getTodayTriggerAt(currentItem, now);

  if (!currentTriggerAt) {
    throw new Error("expected a current trigger time");
  }

  expect(
    shouldSkipDelayedSocItemBecauseLaterItemIsDue({
      items,
      currentIndex: 0,
      currentTriggerAt,
      now,
      runtime: {
        activeItemId: null,
        activeStartedAt: null,
        activeObservedAt: null,
        lastTriggeredAtByItemId: {},
      },
    }),
  ).toBe(false);
});

function createBattery(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  return {
    id: "battery-1",
    siteId: "home",
    name: "Battery",
    plugin: "indevolt-battery",
    model: "indevolt-battery",
    ipAddress: "192.168.1.10",
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
    strategyPlan: [],
    strategyRuntime: {
      activeItemId: null,
      activeStartedAt: null,
      activeObservedAt: null,
      lastTriggeredAtByItemId: {},
    },
    updatedAt: "2026-04-09T00:00:00.000Z",
    ...overrides,
  };
}

function createDailyItem(
  overrides: Partial<BatteryStrategyPlanItem> = {},
): BatteryStrategyPlanItem {
  return {
    id: "daily-1",
    kind: "daily",
    startTime: "07:00",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "soc",
    triggerKind: "daily-time",
    strategyMode: "manual",
    manualState: "discharging",
    manualPowerW: 2400,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: 40,
    manualTargetSoc: 40,
    ...overrides,
  };
}

function createSample(
  overrides: Partial<NormalizedBatteryInfo> = {},
): NormalizedBatteryInfo {
  return {
    capacityWh: 10000,
    currentW: 0,
    model: "indevolt-battery",
    name: "Battery",
    socPercent: 50,
    status: "idle",
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualTargetSoc: 100,
    ...overrides,
  };
}
