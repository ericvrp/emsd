import { expect, test } from "bun:test";
import {
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  type DynamicPriceSampleRecord,
  type NormalizedBatteryInfo,
} from "@emsd/core";
import {
  formatDaemonLogTimestamp,
  formatScheduledItemCompletion,
  getDelayedChargePrepSkipReason,
  getLowPriceAutoTriggerAtForMarker,
  getScheduledItemCompletion,
  getStrategyTriggerAt,
  getTodayTriggerAt,
  needsCompletionTracking,
  shouldCompleteScheduledItem,
  shouldMarkScheduledItemObserved,
  shouldSkipDelayedSocItemBecauseLaterItemIsDue,
  shouldSkipScheduledItem,
  shouldWaitForObservedStart,
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

test("getStrategyTriggerAt uses the latest due delayed-charging and export-surplus markers for today", () => {
  const now = new Date("2026-04-09T14:30:00.000Z");
  const dynamicPriceSamples = createDynamicPriceSamples([
    ["2026-04-09T00:00:00.000Z", 20],
    ["2026-04-09T04:00:00.000Z", 10],
    ["2026-04-09T08:00:00.000Z", 30],
    ["2026-04-09T12:00:00.000Z", 10],
    ["2026-04-09T16:00:00.000Z", 20],
  ]);

  const lowPriceTriggerAt = getStrategyTriggerAt({
    item: createDailyItem({
      triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    }),
    now,
    dynamicPriceSamples,
  });
  const highPriceTriggerAt = getStrategyTriggerAt({
    item: createDailyItem({
      triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
    }),
    now,
    dynamicPriceSamples,
  });

  expect(lowPriceTriggerAt?.toISOString()).toBe("2026-04-09T12:00:00.000Z");
  expect(highPriceTriggerAt?.toISOString()).toBe("2026-04-09T08:00:00.000Z");
});

test("getStrategyTriggerAt returns the next upcoming price marker when none are due yet", () => {
  const triggerAt = getStrategyTriggerAt({
    item: createDailyItem({
      triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    }),
    now: new Date("2026-04-09T01:00:00.000Z"),
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-09T00:00:00.000Z", 20],
      ["2026-04-09T04:00:00.000Z", 10],
      ["2026-04-09T08:00:00.000Z", 30],
    ]),
  });

  expect(triggerAt?.toISOString()).toBe("2026-04-09T04:00:00.000Z");
});

test("getStrategyTriggerAt uses the low-price marker for delayed-charging auto items", () => {
  const item = createDailyItem({
    manualState: "charging",
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  });
  const dynamicPriceSamples = createDynamicPriceSamples([
    ["2026-04-09T00:00:00.000Z", 20],
    ["2026-04-09T04:00:00.000Z", 30],
    ["2026-04-09T08:00:00.000Z", 10],
    ["2026-04-09T12:00:00.000Z", 25],
    ["2026-04-09T16:00:00.000Z", 5],
  ]);

  expect(
    getStrategyTriggerAt({
      item,
      now: new Date("2026-04-09T07:00:00.000Z"),
      dynamicPriceSamples,
    })?.toISOString(),
  ).toBe("2026-04-09T08:00:00.000Z");

  expect(
    getTodayTriggerAt(item, new Date("2026-04-09T07:00:00.000Z")),
  ).toBeNull();
});

test("getStrategyTriggerAt carries delayed-charging auto into the next day's low-price window", () => {
  const item = createDailyItem({
    manualState: "charging",
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  });
  const dynamicPriceSamples = createDynamicPriceSamples([
    ["2026-04-09T16:00:00.000Z", 20],
    ["2026-04-09T18:00:00.000Z", 35],
    ["2026-04-09T20:00:00.000Z", 22],
    ["2026-04-09T22:00:00.000Z", 20],
    ["2026-04-10T08:00:00.000Z", 12],
    ["2026-04-10T10:00:00.000Z", 5],
    ["2026-04-10T12:00:00.000Z", 14],
    ["2026-04-10T14:00:00.000Z", 25],
  ]);

  expect(
    getStrategyTriggerAt({
      item,
      now: new Date("2026-04-09T19:00:00.000Z"),
      dynamicPriceSamples,
    })?.toISOString(),
  ).toBe("2026-04-10T10:00:00.000Z");
});

test("getLowPriceAutoTriggerAtForMarker returns the selected low-price marker", () => {
  expect(
    getLowPriceAutoTriggerAtForMarker({
      markerAt: new Date("2026-04-09T16:00:00.000Z"),
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-09T00:00:00.000Z", 20],
        ["2026-04-09T04:00:00.000Z", 30],
        ["2026-04-09T08:00:00.000Z", 10],
        ["2026-04-09T12:00:00.000Z", 25],
        ["2026-04-09T16:00:00.000Z", 5],
      ]),
    })?.toISOString(),
  ).toBe("2026-04-09T16:00:00.000Z");
});

test("getLowPriceAutoTriggerAtForMarker keeps a next-day delayed-charging marker unchanged", () => {
  expect(
    getLowPriceAutoTriggerAtForMarker({
      markerAt: new Date("2026-04-10T10:00:00.000Z"),
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-09T16:00:00.000Z", 20],
        ["2026-04-09T18:00:00.000Z", 35],
        ["2026-04-09T20:00:00.000Z", 22],
        ["2026-04-09T22:00:00.000Z", 20],
        ["2026-04-10T08:00:00.000Z", 12],
        ["2026-04-10T10:00:00.000Z", 5],
        ["2026-04-10T12:00:00.000Z", 14],
        ["2026-04-10T14:00:00.000Z", 25],
      ]),
    })?.toISOString(),
  ).toBe("2026-04-10T10:00:00.000Z");
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
      activeStartSocPercent: 50,
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

test("shouldCompleteScheduledItem uses the computed dynamic target while an auto item is active", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeResolvedManualState: "discharging",
      activeStartedAt: "2026-04-09T07:00:00.000Z",
      activeObservedAt: "2026-04-09T07:00:05.000Z",
      activeStartSocPercent: 50,
      activeTargetSocPercent: 34,
      activeTargetTime: "2026-04-10T08:15:00.000Z",
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T07:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    manualDischargeTargetSoc: null,
    manualState: "discharging",
    manualTargetSoc: null,
    targetMethod: "auto",
  });
  const sample = createSample({ socPercent: 33, status: "discharging" });

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

test("shouldCompleteScheduledItem keeps delayed-charging active until 100% is reached", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeObservedAt: "2026-04-09T07:00:05.000Z",
      activeResolvedManualState: null,
      activeStartSocPercent: 60,
      activeStartedAt: "2026-04-09T07:00:00.000Z",
      activeTargetSocPercent: 100,
      activeTargetTime: "2026-04-09T10:00:00.000Z",
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T07:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    manualState: "charging",
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  });

  expect(
    getScheduledItemCompletion({
      battery,
      item,
      now: new Date("2026-04-09T09:00:00.000Z"),
      runtime: battery.strategyRuntime,
      sample: createSample({ socPercent: 95, status: "idle" }),
    }),
  ).toBeNull();
});

test("shouldCompleteScheduledItem completes delayed-charging when it reaches 100%", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeObservedAt: "2026-04-09T07:00:05.000Z",
      activeResolvedManualState: null,
      activeStartSocPercent: 60,
      activeStartedAt: "2026-04-09T07:00:00.000Z",
      activeTargetSocPercent: 100,
      activeTargetTime: "2026-04-09T10:00:00.000Z",
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T07:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    manualState: "charging",
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  });

  expect(
    getScheduledItemCompletion({
      battery,
      item,
      now: new Date("2026-04-09T10:00:00.000Z"),
      runtime: battery.strategyRuntime,
      sample: createSample({ socPercent: 100, status: "idle" }),
    }),
  ).toMatchObject({
    reason: "charge-target-reached",
    targetSoc: 100,
  });
});

test("shouldMarkScheduledItemObserved uses the resolved runtime state for delayed-charging auto items", () => {
  const item = createDailyItem({
    id: "daily-1",
    manualState: "charging",
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  });

  expect(
    shouldMarkScheduledItemObserved({
      item,
      runtime: {
        activeItemId: "daily-1",
        activeObservedAt: null,
        activeResolvedManualState: "discharging",
        activeStartSocPercent: 60,
        activeStartedAt: "2026-04-09T07:00:00.000Z",
        lastTriggeredAtByItemId: { "daily-1": "2026-04-09T07:00:00.000Z" },
      },
      sample: createSample({ status: "discharging" }),
    }),
  ).toBe(true);
});

test("shouldMarkScheduledItemObserved does not wait for delayed-charging self-consumption mode", () => {
  const item = createDailyItem({
    id: "daily-1",
    manualState: "charging",
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  });

  expect(
    shouldMarkScheduledItemObserved({
      item,
      runtime: {
        activeItemId: "daily-1",
        activeObservedAt: null,
        activeResolvedManualState: null,
        activeStartSocPercent: 60,
        activeStartedAt: "2026-04-09T07:00:00.000Z",
        activeTargetSocPercent: 100,
        lastTriggeredAtByItemId: { "daily-1": "2026-04-09T07:00:00.000Z" },
      },
      sample: createSample({ status: "idle" }),
    }),
  ).toBe(false);
});

test("shouldCompleteScheduledItem waits until a scheduled discharge is observed", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T09:00:00.000Z",
      activeObservedAt: null,
      activeStartSocPercent: 50,
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
      activeStartSocPercent: 50,
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
      activeStartSocPercent: 50,
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

test("shouldCompleteScheduledItem completes idle mode when SOC drops to target", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T09:00:00.000Z",
      activeObservedAt: null,
      activeStartSocPercent: 65,
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T09:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    strategyMode: "manual",
    manualState: "idle",
    manualPowerW: null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: 45,
    targetMethod: "soc",
  });

  expect(
    shouldCompleteScheduledItem({
      battery,
      item,
      now: new Date("2026-04-09T09:10:00.000Z"),
      runtime: battery.strategyRuntime,
      sample: createSample({ socPercent: 45, status: "idle" }),
    }),
  ).toBe(true);
});

test("shouldCompleteScheduledItem completes self-consumption when SOC rises to target", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T09:00:00.000Z",
      activeObservedAt: null,
      activeStartSocPercent: 40,
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T09:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: 55,
    targetMethod: "soc",
  });

  expect(
    shouldCompleteScheduledItem({
      battery,
      item,
      now: new Date("2026-04-09T09:10:00.000Z"),
      runtime: battery.strategyRuntime,
      sample: createSample({ socPercent: 55, status: "charging" }),
    }),
  ).toBe(true);
});

test("shouldCompleteScheduledItem completes self-consumption when SOC falls to target", () => {
  const battery = createBattery({
    strategyRuntime: {
      activeItemId: "daily-1",
      activeStartedAt: "2026-04-09T09:00:00.000Z",
      activeObservedAt: null,
      activeStartSocPercent: 80,
      lastTriggeredAtByItemId: { "daily-1": "2026-04-09T09:00:00.000Z" },
    },
  });
  const item = createDailyItem({
    id: "daily-1",
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: 60,
    targetMethod: "soc",
  });

  expect(
    shouldCompleteScheduledItem({
      battery,
      item,
      now: new Date("2026-04-09T09:10:00.000Z"),
      runtime: battery.strategyRuntime,
      sample: createSample({ socPercent: 60, status: "discharging" }),
    }),
  ).toBe(true);
});

test("needsCompletionTracking includes idle and self-consumption SOC targets", () => {
  expect(
    needsCompletionTracking(
      createDailyItem({
        strategyMode: "manual",
        manualState: "idle",
        targetMethod: "soc",
      }),
    ),
  ).toBe(true);

  expect(
    needsCompletionTracking(
      createDailyItem({
        strategyMode: "self-consumption",
        manualState: null,
        manualTargetSoc: 50,
        targetMethod: "soc",
      }),
    ),
  ).toBe(true);
});

test("shouldWaitForObservedStart only waits for charging or discharging", () => {
  expect(
    shouldWaitForObservedStart(
      createDailyItem({ strategyMode: "manual", manualState: "charging" }),
    ),
  ).toBe(true);
  expect(
    shouldWaitForObservedStart(
      createDailyItem({ strategyMode: "manual", manualState: "discharging" }),
    ),
  ).toBe(true);
  expect(
    shouldWaitForObservedStart(
      createDailyItem({ strategyMode: "manual", manualState: "idle" }),
    ),
  ).toBe(false);
  expect(
    shouldWaitForObservedStart(
      createDailyItem({ strategyMode: "self-consumption", manualState: null }),
    ),
  ).toBe(false);
  expect(
    shouldWaitForObservedStart(
      createDailyItem({ strategyMode: "manual", manualState: "charging" }),
      "idle",
    ),
  ).toBe(false);
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
        activeStartSocPercent: 50,
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
        activeStartSocPercent: null,
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
        activeStartSocPercent: null,
        lastTriggeredAtByItemId: {},
      },
    }),
  ).toBe(false);
});

test("shouldSkipScheduledItem expires price-triggered items after 30 minutes", () => {
  const item = createDailyItem({
    triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
  });
  const triggerAt = new Date("2026-04-09T10:00:00.000Z");

  expect(
    shouldSkipScheduledItem(
      item,
      triggerAt,
      new Date("2026-04-09T10:29:59.000Z"),
    ),
  ).toBe(false);
  expect(
    shouldSkipScheduledItem(
      item,
      triggerAt,
      new Date("2026-04-09T10:30:00.000Z"),
    ),
  ).toBe(true);
});

test("getDelayedChargePrepSkipReason reuses the paired delayed-charging skip reason", () => {
  expect(
    getDelayedChargePrepSkipReason({
      delayedChargingItemId: "delayed-charging-1",
      delayedChargingSkipReason:
        "skipped: low-price marker 2026-04-10T02:00:00.000Z needs expected solar above expected house load, but predicted solar is 0W and expected house load is 181W for item delayed-charging-1",
      delayedChargingStartTime: null,
      now: new Date("2026-04-09T13:58:15.000Z"),
      prepItemId: "prep-1",
      runtime: createBattery().strategyRuntime,
    }),
  ).toContain("needs expected solar above expected house load");
});

test("getDelayedChargePrepSkipReason blocks prep when the paired delayed charging already triggered", () => {
  expect(
    getDelayedChargePrepSkipReason({
      delayedChargingItemId: "delayed-charging-1",
      delayedChargingSkipReason: null,
      delayedChargingStartTime: "2026-04-09T13:45:00.000Z",
      now: new Date("2026-04-09T13:58:15.000Z"),
      prepItemId: "prep-1",
      runtime: {
        ...createBattery().strategyRuntime,
        lastTriggeredAtByItemId: {
          "delayed-charging-1": "2026-04-09T13:45:00.000Z",
        },
      },
    }),
  ).toBe(
    "skipped: delayed charging item delayed-charging-1 already triggered for 2026-04-09T13:45:00.000Z while evaluating delayed-charge prep item prep-1",
  );
});

function createBattery(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  return {
    id: "battery-1",
    siteId: "home",
    name: "Battery",
    plugin: "indevolt-battery",
    model: "indevolt-battery",
    ipAddress: "192.168.1.10",
    maximumChargePowerW: 800,
    maximumDischargePowerW: 800,
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
      activeStartSocPercent: null,
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
    enabled: true,
    id: "daily-1",
    kind: "daily",
    startTime: "07:00",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "soc",
    triggerKind: BatteryStrategyTriggerKind.DailyTime,
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

function createDynamicPriceSamples(
  values: Array<[periodStart: string, importPrice: number]>,
): DynamicPriceSampleRecord[] {
  return values.map(([periodStart, importPrice]) => ({
    siteId: "home",
    periodStart,
    generatedAt: "2026-04-09T00:00:00.000Z",
    currency: "EUR",
    importPrice,
  }));
}
