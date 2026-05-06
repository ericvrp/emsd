import { expect, test } from "bun:test";
import {
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  type BatteryStrategyRuntimeRecord,
  BatteryStrategyTriggerKind,
} from "@emsd/core";
import {
  formatAutomaticStrategyAppliedSummary,
  describeCurrentBatteryStrategyHuman,
  describeStrategyPlanItemHuman,
  formatBatteryStrategyStatusSummary,
  formatFallbackStrategyRestoreSummary,
  formatManualStrategyAppliedSummary,
  formatScheduledStrategyCompletionSummary,
  formatScheduledStrategyStartedSummary,
  formatStrategyPlanAppliedSummary,
} from "./strategy-log";
import type { ScheduledItemCompletion } from "./strategy-scheduler";

test("describes self-consumption in human terms", () => {
  expect(describeCurrentBatteryStrategyHuman(buildBattery())).toBe(
    "self-consumption",
  );
});

test("describes manual discharge in human terms", () => {
  expect(describeStrategyPlanItemHuman(buildDailyItem())).toBe(
    "scheduled discharge to 80% at 2400W",
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
    "strategy plan updated for battery-1: default self-consumption with a 10% discharge floor; next the 19:30 schedule: scheduled discharge to 80% at 2400W",
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
    "strategy plan updated for battery-1: default self-consumption with a 10% discharge floor; next the 17:37 schedule: scheduled discharge to 20% at 2400W",
  );
});

test("summarizes the next enabled item when an earlier one is disabled", () => {
  const battery = buildBattery({
    strategyPlan: [
      buildDefaultItem(),
      buildMorningItem({ enabled: false }),
      buildDailyItem(),
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
      new Date("2026-04-12T07:35:00.000Z"),
    ),
  ).toBe(
    "strategy plan updated for battery-1: default self-consumption with a 10% discharge floor; next the 19:30 schedule: scheduled discharge to 80% at 2400W",
  );
});

test("summarizes a future export-surplus item later today", () => {
  const battery = buildBattery({
    strategyPlan: [
      buildDefaultItem(),
      buildDailyItem({
        id: "expensive",
        triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
        startTime: "08:00",
      }),
    ],
    strategyRuntime: {
      activeItemId: null,
      activeStartedAt: null,
      activeObservedAt: null,
      activeStartSocPercent: null,
      lastTriggeredAtByItemId: {
        expensive: "2026-04-18T10:00:00.000Z",
      },
    },
  });

  expect(
    formatStrategyPlanAppliedSummary(
      battery,
      new Date("2026-04-18T10:45:00.000Z"),
      [
        buildDynamicPriceSample("2026-04-18T06:00:00.000Z", 0.1),
        buildDynamicPriceSample("2026-04-18T10:00:00.000Z", 0.4),
        buildDynamicPriceSample("2026-04-18T14:00:00.000Z", 0.1),
        buildDynamicPriceSample("2026-04-18T18:00:00.000Z", 0.1),
        buildDynamicPriceSample("2026-04-18T21:00:00.000Z", 0.5),
        buildDynamicPriceSample("2026-04-18T23:00:00.000Z", 0.1),
      ],
    ),
  ).toBe(
    "strategy plan updated for battery-1: default self-consumption with a 10% discharge floor; next the export surplus schedule: scheduled discharge to 80% at 2400W",
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
    "the 19:30 schedule is now active for battery-1: scheduled discharge to 80% at 2400W",
  );
});

test("includes the dynamic target estimate in the scheduled start summary", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem({
        manualDischargeTargetSoc: null,
        manualTargetSoc: null,
        targetMethod: "auto",
      }),
      "",
      {
        reasoning: "overnight house load and predicted solar recovery",
        resolvedManualState: "discharging",
        targetSocPercent: 34,
        reserveSocPercent: 10,
        targetTime: "2026-04-13T08:15:00.000Z",
      },
    ),
  ).toBe(
    "the 19:30 schedule is now active for battery-1: scheduled discharge to 34% at 2400W; discharging to 34% to reserve 10% by 08:15 based on overnight house load and predicted solar recovery",
  );
});

test("uses the resolved runtime action in the scheduled start summary when delayed-charging auto discharges", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem({
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: null,
        manualState: "charging",
        manualTargetSoc: 100,
        targetMethod: "auto",
        triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
      }),
      "",
      {
        reasoning:
          "expected demand until the delayed charging marker, recent history, predicted solar contribution",
        resolvedManualState: "discharging",
        targetSocPercent: 38,
        reserveSocPercent: 15,
        targetTime: "2026-04-13T10:00:00.000Z",
      },
    ),
  ).toBe(
    "the delayed charging schedule is now active for battery-1: scheduled discharge to 38% at 2400W; discharging to 38% to reserve 15% by 10:00 based on expected demand until the delayed charging marker, recent history, predicted solar contribution",
  );
});

test("uses self-consumption wording in the scheduled start summary for delayed-charging auto self-consumption", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem({
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: null,
        manualState: "charging",
        manualTargetSoc: 100,
        targetMethod: "auto",
        triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
      }),
      "",
      {
        reasoning: "expected net solar fill power at the low-price marker",
        resolvedManualState: null,
        targetSocPercent: 100,
        reserveSocPercent: 100,
        targetTime: "2026-04-13T10:00:00.000Z",
      },
    ),
  ).toBe(
    "the delayed charging schedule is now active for battery-1: self-consumption with a dynamic target; switching to self-consumption ahead of 10:00 based on expected net solar fill power at the low-price marker",
  );
});

test("summarizes price-triggered strategy lifecycle with the trigger kind", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem({ triggerKind: BatteryStrategyTriggerKind.ExportSurplus }),
      "",
    ),
  ).toBe(
    "the export surplus schedule is now active for battery-1: scheduled discharge to 80% at 2400W",
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
    "the 19:30 schedule is now active for battery-1: hold the battery idle until 40%",
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
    "the 19:30 schedule is now active for battery-1: self-consumption until 55%",
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
    "the 19:30 schedule completed for battery-1: it reached 80%, returning to default self-consumption with a 10% discharge floor",
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
    "temporary manual override applied for battery-1: scheduled automation is paused; battery will discharge manually to 80% at 2400W until the override is cleared or its target is reached",
  );
});

test("summarizes a self-consumption manual override without a discharge target", () => {
  expect(
    formatManualStrategyAppliedSummary(
      buildBattery({
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualDischargeTargetSoc: 11,
        manualTargetSoc: 100,
        manualModeActive: true,
        }),
      ),
  ).toBe(
    "temporary manual override applied for battery-1: scheduled automation is paused; battery is now in self-consumption until the override is cleared",
  );
});

test("summarizes a resumed automatic strategy", () => {
  expect(
    formatAutomaticStrategyAppliedSummary(
      buildBattery({
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      }),
    ),
  ).toBe(
    "scheduled automation applied for battery-1: self-consumption",
  );
});

test("strategy status summary returns default strategy without active item", () => {
  expect(formatBatteryStrategyStatusSummary(buildBattery())).toBe(
    "Self-consumption",
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

test("strategy status summary reports self-consumption manual override duration", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyMode: "self-consumption",
        manualModeActive: true,
        manualTargetSoc: 55,
        strategyRuntime: buildRuntime({
          manualTargetMethod: "duration",
          manualTargetDurationMinutes: 6,
          manualTargetStartedAt: "2026-04-12T17:30:00.000Z",
        }),
      }),
      new Date("2026-04-12T17:31:10.000Z"),
    ),
  ).toBe("Self-consumption for 5 minutes");
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
  ).toBe("Discharging");
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
  ).toBe("Discharging for 5 minutes");
});

test("strategy status summary omits power for idle manual override", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyMode: "manual",
        manualState: "idle",
        manualPowerW: 2400,
        manualTargetSoc: 10,
        manualModeActive: true,
      }),
    ),
  ).toBe("Idle");
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

test("strategy status summary prefixes export-surplus trigger kind", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeStartedAt: "2026-04-21T19:45:00.000Z",
        }),
        strategyPlan: [
          buildDefaultItem(),
          buildDailyItem({
            id: "daily-2",
            triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
            manualState: "discharging",
            manualDischargeTargetSoc: 58,
            manualTargetSoc: 58,
            targetMethod: "auto",
          }),
        ],
      }),
      new Date("2026-04-21T19:45:08.000Z"),
    ),
  ).toBe("Export surplus: Discharging to 58%");
});

test("strategy status summary prefixes delayed-charging trigger kind", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeStartedAt: "2026-04-21T02:00:00.000Z",
        }),
        strategyPlan: [
          buildDefaultItem(),
          buildDailyItem({
            id: "daily-2",
            triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
            manualState: "charging",
            manualChargeTargetSoc: 100,
            manualTargetSoc: 100,
            targetMethod: "auto",
          }),
        ],
      }),
      new Date("2026-04-21T02:15:00.000Z"),
    ),
  ).toBe("Delayed charging: Charging");
});

test("strategy status summary reports delayed-charge prep as idle", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeStartedAt: "2026-04-21T16:00:00.000Z",
        }),
        strategyPlan: [
          buildDefaultItem(),
          buildDailyItem({
            id: "daily-2",
            triggerKind: BatteryStrategyTriggerKind.DelayedChargePrep,
            manualState: "idle",
            manualPowerW: null,
            manualChargeTargetSoc: null,
            manualDischargeTargetSoc: null,
            manualTargetSoc: null,
            targetMethod: "auto",
          }),
        ],
      }),
      new Date("2026-04-21T16:15:00.000Z"),
    ),
  ).toBe("Delayed-charge prep: Idle");
});

test("scheduled start summary names the delayed-charge prep schedule", () => {
  expect(
    formatScheduledStrategyStartedSummary(
      "battery-1",
      buildDailyItem({
        id: "prep-1",
        triggerKind: BatteryStrategyTriggerKind.DelayedChargePrep,
        manualState: "idle",
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: null,
        targetMethod: "auto",
      }),
      "",
      {
        reasoning: "paired delayed charging remains in the future",
        reserveSocPercent: 0,
        resolvedManualState: "idle",
        targetSocPercent: 0,
        targetTime: null,
      },
    ),
  ).toBe(
    "the delayed-charge prep schedule is now active for battery-1: hold the battery idle",
  );
});

test("strategy status summary omits a full-charge auto target even with a target time", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeResolvedManualState: "charging",
          activeTargetSocPercent: 100,
          activeTargetTime: "2026-04-21T07:00:00.000Z",
          activeStartedAt: "2026-04-21T02:00:00.000Z",
        }),
        strategyPlan: [
          buildDefaultItem(),
          buildDailyItem({
            id: "daily-2",
            manualState: "charging",
            manualChargeTargetSoc: null,
            manualTargetSoc: null,
            targetMethod: "auto",
          }),
        ],
      }),
      new Date("2026-04-21T02:15:00.000Z"),
    ),
  ).toBe("Charging");
});

test("strategy status summary keeps delayed-charging label when it resolves to self-consumption", () => {
  expect(
    formatBatteryStrategyStatusSummary(
      buildBattery({
        strategyRuntime: buildRuntime({
          activeItemId: "daily-2",
          activeResolvedManualState: null,
          activeTargetSocPercent: 100,
          activeStartedAt: "2026-04-30T10:35:14.000Z",
        }),
        strategyPlan: [
          buildDefaultItem(),
          buildDailyItem({
            id: "daily-2",
            triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
            manualState: "charging",
            manualChargeTargetSoc: null,
            manualTargetSoc: null,
            targetMethod: "auto",
          }),
        ],
      }),
      new Date("2026-04-30T10:40:00.000Z"),
    ),
  ).toBe("Delayed charging: Self-consumption");
});

function buildBattery(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  return {
    id: "battery-1",
    siteId: "home",
    name: "Battery",
    plugin: "indevolt-battery",
    model: "Indevolt Battery",
    ipAddress: "192.168.1.232",
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
    strategyPlan: [buildDefaultItem(), buildDailyItem()],
    strategyRuntime: buildRuntime(),
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...overrides,
  };
}

function buildDefaultItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
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

function buildDailyItem(
  overrides: Partial<BatteryStrategyPlanItem> = {},
): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "daily-2",
    kind: "daily",
    startTime: "19:30",
    triggerKind: BatteryStrategyTriggerKind.DailyTime,
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

function buildDynamicPriceSample(periodStart: string, importPrice: number) {
  return {
    siteId: "home",
    periodStart,
    generatedAt: "2026-04-18T09:50:00.000Z",
    currency: "EUR",
    importPrice,
  };
}
