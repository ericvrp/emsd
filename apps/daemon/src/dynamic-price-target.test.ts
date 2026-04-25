import { expect, test } from "bun:test";
import {
  type BatteryPowerSampleRecord,
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  type DynamicPriceSampleRecord,
  type NormalizedBatteryInfo,
  type P1MeterSampleRecord,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
} from "@emsd/core";
import { estimateDynamicPriceTarget } from "./dynamic-price-target";

test("evening auto discharge targets tomorrow morning and keeps a reserve above backup", () => {
  const now = new Date("2026-04-19T20:25:00");
  const battery = createBattery();
  const item = createAutoDischargeItem();
  const solarForecastSamples = createZeroSolarForecastSamples(
    "2026-04-19T20:30:00",
    "2026-04-20T09:00:00",
  );
  const history = createOvernightUsageHistory();

  const estimate = estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    dynamicPriceSamples: [],
    item,
    items: [createDefaultItem(), item],
    now,
    normalizedImportExportSpread: 0.13,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample({ capacityWh: 5000, socPercent: 90 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples,
  });

  const targetTime = new Date(estimate.targetTime ?? "");

  expect(Number.isNaN(targetTime.getTime())).toBe(false);
  expect(targetTime.getDate()).toBe(new Date("2026-04-20T08:30:00").getDate());
  expect(targetTime.getHours()).toBe(8);
  expect(targetTime.getMinutes()).toBe(30);
  // 10% minimum + 1% backup margin + round(12.08 hours * 0.2%/hour) = 13%
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(13);
  expect(estimate.estimatedTargetPercent).toBeGreaterThan(13);
  expect(estimate.estimatedRemainingEnergyWh).toBeGreaterThan(0);
  expect(estimate.resolvedManualState).toBe("discharging");
  expect(estimate.skipReason).toBeNull();
  expect(estimate.energyBuckets.length).toBeGreaterThan(0);
  const lastBucket = estimate.energyBuckets[estimate.energyBuckets.length - 1];
  if (!lastBucket) {
    throw new Error("lastBucket should exist");
  }
  expect(lastBucket.cumulativeNetBatteryEnergyNeededWh).toBe(
    estimate.estimatedRemainingEnergyWh,
  );
  expect(estimate.windowKind).toBe("evening-export-surplus");
});

test("evening export-surplus ignores same-day solar blips and targets next-morning recovery", () => {
  const now = new Date("2026-04-19T18:45:00.000Z");
  const battery = createBattery();
  const item = createAutoDischargeItem();
  const history = createOvernightUsageHistory();
  const estimate = estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    dynamicPriceSamples: [],
    item,
    items: [createDefaultItem(), item],
    now,
    normalizedImportExportSpread: 0.13,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample({ capacityWh: 5000, socPercent: 90 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createEveningCarryoverSolarForecastSamples(),
  });

  expect(estimate.targetTime).toBe("2026-04-20T08:30:00.000Z");
  expect(new Date(estimate.targetTime ?? "").getTime()).toBeGreaterThan(
    new Date("2026-04-20T00:00:00.000Z").getTime(),
  );
  expect(estimate.estimatedTargetPercent).toBeGreaterThan(
    estimate.estimatedReservePercentAtTargetTime,
  );
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(14);
});

test("delayed-charging auto reserves daytime headroom from the low-price window", () => {
  const now = new Date("2026-04-19T06:00:00.000Z");
  const battery = createBattery();
  const item = createAutoLowPriceItem();
  const solarForecastSamples = createDaytimeSolarForecastSamples(3000);
  const history = createDaytimeUsageHistory(250);
  const estimate = estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    backupReserveMarginOverride: 2,
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T02:00:00.000Z", 20],
      ["2026-04-19T06:00:00.000Z", 30],
      ["2026-04-19T10:00:00.000Z", 10],
      ["2026-04-19T14:00:00.000Z", 28],
      ["2026-04-19T18:00:00.000Z", 18],
    ]),
    item,
    items: [createDefaultItem(), item],
    now,
    normalizedImportExportSpread: 0.13,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample(),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples,
  });

  expect(estimate.targetTime).toBe("2026-04-19T10:00:00.000Z");
  expect(estimate.expectedHouseLoadWh).toBeGreaterThan(0);
  expect(estimate.predictedSolarGenerationWh).toBeGreaterThan(
    estimate.expectedHouseLoadWh,
  );
  expect(estimate.skipReason).toBeNull();
  expect(estimate.targetTimeSignal?.predictedSolarW).toBeGreaterThan(0);
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(20);
  expect(estimate.estimatedTargetPercent).toBeLessThan(100);
  expect(estimate.startTime).not.toBeNull();
  expect(estimate.effectiveDischargePowerW).toBe(2400);
  expect(estimate.delayedChargingDetails).toMatchObject({
    actualWindowEnd: "2026-04-19T11:15:00.000Z",
    actualWindowEndPrice: 10,
    actualWindowStart: "2026-04-19T10:00:00.000Z",
    actualWindowStartPrice: 10,
    chargePowerW: 2400,
    chargeStartSocPercent: 70,
    currentSocBasisPercent: 70,
    latestFeasiblePreDischargeStartTime: "2026-04-19T06:00:00.000Z",
    lowestPrice: 10,
    lowPriceMargin: 0.39,
    lowPriceMarkerTime: "2026-04-19T10:00:00.000Z",
    minimumTimeToFullChargeMinutes: 75,
    normalizedImportExportSpread: 0.13,
    potentialWindowEnd: "2026-04-19T11:15:00.000Z",
    potentialWindowStart: "2026-04-19T08:45:00.000Z",
    preDischargeTargetSocPercent: 93,
  });
  expect(
    new Date(estimate.startTime ?? "").getTime() +
      (estimate.requiredDischargeMinutes ?? 0) * 60_000,
  ).toBeLessThanOrEqual(new Date(estimate.targetTime ?? "").getTime());
  expect(estimate.reasoning).toContain("delayed charging window");
});

test("delayed-charging auto idles when the battery is already at the target", () => {
  const now = new Date("2026-04-19T06:00:00.000Z");
  const battery = createBattery();
  const item = createAutoLowPriceItem();
  const history = createDaytimeUsageHistory(250);
  const estimate = estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    backupReserveMarginOverride: 2,
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T02:00:00.000Z", 20],
      ["2026-04-19T06:00:00.000Z", 30],
      ["2026-04-19T10:00:00.000Z", 10],
      ["2026-04-19T14:00:00.000Z", 28],
      ["2026-04-19T18:00:00.000Z", 18],
    ]),
    item,
    items: [createDefaultItem(), item],
    now,
    normalizedImportExportSpread: 0.13,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample({ socPercent: 35 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createDaytimeSolarForecastSamples(1600),
  });

  expect(estimate.resolvedManualState).toBe("idle");
  expect(estimate.skipReason).toBeNull();
});

test("delayed-charging auto is skipped when no net solar charge is expected", () => {
  const now = new Date("2026-04-19T06:00:00.000Z");
  const battery = createBattery();
  const item = createAutoLowPriceItem();
  const history = createDaytimeUsageHistory(700);
  const estimate = estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    backupReserveMarginOverride: 2,
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T02:00:00.000Z", 20],
      ["2026-04-19T06:00:00.000Z", 30],
      ["2026-04-19T10:00:00.000Z", 10],
      ["2026-04-19T14:00:00.000Z", 28],
      ["2026-04-19T18:00:00.000Z", 18],
    ]),
    item,
    items: [createDefaultItem(), item],
    now,
    normalizedImportExportSpread: 0.13,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample(),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createZeroSolarForecastSamples(
      "2026-04-19T06:00:00.000Z",
      "2026-04-19T14:00:00.000Z",
    ),
  });

  expect(estimate.skipReason).toContain("no net solar charge expected");
});

function createAutoLowPriceItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "auto-delayed-charging",
    kind: "daily",
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: null,
    manualPowerW: 2400,
    manualState: "charging",
    manualTargetSoc: 100,
    startTime: null,
    strategyMode: "manual",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
  };
}

function createDaytimeSolarForecastSamples(
  daytimePowerW: number,
): SolarForecastSampleRecord[] {
  const basePeriods = createPeriodRange(
    "2026-04-19T06:00:00.000Z",
    "2026-04-19T14:00:00.000Z",
  );

  return Array.from({ length: 8 }, (_, dayOffset) => dayOffset).flatMap(
    (dayOffset) =>
      basePeriods.map((periodStart) => {
        const shiftedPeriodStart = shiftDateTime(periodStart, -dayOffset);
        const isDaytimeWindow =
          shiftedPeriodStart.slice(11, 16) >= "10:00" &&
          shiftedPeriodStart.slice(11, 16) < "14:00";

        return {
          airTempC: null,
          cloudOpacityPercent: null,
          generatedAt: shiftDateTime("2026-04-19T05:50:00.000Z", -dayOffset),
          ghiWm2: isDaytimeWindow ? 700 : 100,
          periodStart: shiftedPeriodStart,
          siteId: "site-1",
          value: isDaytimeWindow ? daytimePowerW : 100,
        };
      }),
  );
}

function createDaytimeUsageHistory(siteLoadW: number): {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
} {
  const batteryPowerSamples: BatteryPowerSampleRecord[] = [];
  const p1MeterSamples: P1MeterSampleRecord[] = [];
  const solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[] = [];

  for (let dayOffset = 1; dayOffset <= 7; dayOffset += 1) {
    const start = shiftDateTime("2026-04-19T06:00:00.000Z", -dayOffset);
    const end = shiftDateTime("2026-04-19T14:00:00.000Z", -dayOffset);

    for (const periodStart of createPeriodRange(start, end)) {
      const solarPowerW =
        periodStart >= shiftDateTime("2026-04-19T10:00:00.000Z", -dayOffset) &&
        periodStart < shiftDateTime("2026-04-19T14:00:00.000Z", -dayOffset)
          ? 900
          : 0;

      batteryPowerSamples.push({
        batteryId: "battery-1",
        observedAt: periodStart,
        periodStart,
        powerW: 0,
        siteId: "site-1",
        socPercent: 70,
      });
      p1MeterSamples.push({
        meterId: "meter-1",
        observedAt: periodStart,
        periodStart,
        powerW: siteLoadW - solarPowerW,
        siteId: "site-1",
      });
      solarEnergyProviderSamples.push({
        observedAt: periodStart,
        periodStart,
        powerW: solarPowerW,
        providerId: "solar-1",
        siteId: "site-1",
      });
    }
  }

  return { batteryPowerSamples, p1MeterSamples, solarEnergyProviderSamples };
}

function createDynamicPriceSamples(
  entries: Array<[string, number]>,
): DynamicPriceSampleRecord[] {
  return entries.map(([periodStart, importPrice]) => ({
    currency: "EUR",
    generatedAt: "2026-04-19T05:50:00.000Z",
    importPrice,
    periodStart,
    siteId: "site-1",
  }));
}

function createBattery(): BatteryRecord {
  return {
    connected: true,
    enabled: true,
    id: "battery-1",
    ipAddress: "192.168.1.10",
    maximumChargePowerW: 800,
    maximumDischargePowerW: 800,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualModeActive: false,
    manualModeStarted: false,
    manualPowerW: null,
    manualState: null,
    manualTargetSoc: 100,
    minimumDischargePercent: 10,
    model: "test-battery",
    name: "Battery 1",
    plugin: "test",
    siteId: "site-1",
    status: "idle",
    strategyMode: "self-consumption",
    strategyPlan: [createDefaultItem()],
    strategyRuntime: {
      activeItemId: null,
      activeObservedAt: null,
      activeStartSocPercent: null,
      activeStartedAt: null,
      activeTargetSocPercent: null,
      activeTargetTime: null,
      lastTriggeredAtByItemId: {},
    },
    updatedAt: "2026-04-19T20:25:00.000Z",
  };
}

function createDefaultItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "default",
    kind: "default",
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualPowerW: null,
    manualState: null,
    manualTargetSoc: 100,
    startTime: null,
    strategyMode: "self-consumption",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: null,
    triggerKind: null,
  };
}

function createAutoDischargeItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "auto-export-surplus",
    kind: "daily",
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualPowerW: 2400,
    manualState: "discharging",
    manualTargetSoc: null,
    startTime: "20:00",
    strategyMode: "manual",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
  };
}

function createSample(
  overrides: Partial<NormalizedBatteryInfo> = {},
): NormalizedBatteryInfo {
  return {
    capacityWh: 10000,
    currentW: 0,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualPowerW: null,
    manualState: null,
    manualTargetSoc: 100,
    model: "test-battery",
    name: "Battery 1",
    socPercent: 70,
    status: "idle",
    strategyMode: "self-consumption",
    ...overrides,
  };
}

function createZeroSolarForecastSamples(
  start: string,
  end: string,
): SolarForecastSampleRecord[] {
  return createPeriodRange(start, end).map((periodStart) => ({
    airTempC: null,
    cloudOpacityPercent: null,
    generatedAt: "2026-04-19T20:20:00.000Z",
    ghiWm2: 0,
    periodStart,
    siteId: "site-1",
    value: 0,
  }));
}

function createEveningCarryoverSolarForecastSamples(): SolarForecastSampleRecord[] {
  return createPeriodRange(
    "2026-04-19T18:45:00.000Z",
    "2026-04-20T09:00:00.000Z",
  ).map((periodStart) => {
    const clockTime = periodStart.slice(11, 16);
    const value =
      clockTime >= "18:45" && clockTime < "19:15"
        ? 900
        : clockTime >= "08:30" && clockTime < "09:00"
          ? 1000
          : 0;

    return {
      airTempC: null,
      cloudOpacityPercent: null,
      generatedAt: "2026-04-19T18:40:00.000Z",
      ghiWm2: value,
      periodStart,
      siteId: "site-1",
      value,
    };
  });
}

function createOvernightUsageHistory(): {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
} {
  const batteryPowerSamples: BatteryPowerSampleRecord[] = [];
  const p1MeterSamples: P1MeterSampleRecord[] = [];
  const solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[] = [];

  for (let dayOffset = 1; dayOffset <= 7; dayOffset += 1) {
    const start = shiftDateTime("2026-04-19T20:30:00", -dayOffset);
    const end = shiftDateTime("2026-04-20T08:30:00", -dayOffset);

    for (const periodStart of createPeriodRange(start, end)) {
      const periodDate = new Date(periodStart);
      const periodIndex = Math.floor(
        (periodDate.getTime() - new Date(start).getTime()) / (15 * 60 * 1000),
      );

      batteryPowerSamples.push({
        batteryId: "battery-1",
        observedAt: periodStart,
        periodStart,
        powerW: 200,
        siteId: "site-1",
        socPercent: 60 - periodIndex * 0.2,
      });
      p1MeterSamples.push({
        meterId: "meter-1",
        observedAt: periodStart,
        periodStart,
        powerW: 300,
        siteId: "site-1",
      });
      solarEnergyProviderSamples.push({
        observedAt: periodStart,
        periodStart,
        powerW: 0,
        providerId: "solar-1",
        siteId: "site-1",
      });
    }
  }

  return { batteryPowerSamples, p1MeterSamples, solarEnergyProviderSamples };
}

function createPeriodRange(start: string, end: string): string[] {
  const range: string[] = [];
  const current = new Date(start);
  const endAt = new Date(end);

  while (current.getTime() < endAt.getTime()) {
    range.push(current.toISOString());
    current.setMinutes(current.getMinutes() + 15);
  }

  return range;
}

function shiftDateTime(value: string, dayOffset: number): string {
  const date = new Date(value);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}
