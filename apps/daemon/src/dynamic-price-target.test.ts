import { expect, test } from "bun:test";
import type {
  BatteryPowerSampleRecord,
  BatteryRecord,
  BatteryStrategyPlanItem,
  DynamicPriceSampleRecord,
  NormalizedBatteryInfo,
  P1MeterSampleRecord,
  SolarEnergyProviderSampleRecord,
  SolarForecastSampleRecord,
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
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample(),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples,
  });

  const targetTime = new Date(estimate.targetTime ?? "");

  expect(Number.isNaN(targetTime.getTime())).toBe(false);
  expect(targetTime.getDate()).toBe(new Date("2026-04-20T08:30:00").getDate());
  expect(targetTime.getHours()).toBe(8);
  expect(targetTime.getMinutes()).toBe(30);
  // 10% minimum + 2% backup margin + round(12.08 hours * 0.5%/hour) = 18%
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(18);
  expect(estimate.estimatedTargetPercent).toBeGreaterThan(18);
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
  expect(estimate.windowKind).toBe("evening-high-price");
});

test("low-price auto resolves to a pre-discharge target when solar is expected at the low marker", () => {
  const now = new Date("2026-04-19T06:00:00.000Z");
  const battery = createBattery();
  const item = createAutoLowPriceItem();
  const solarForecastSamples = createMorningSolarForecastSamples();
  const history = createMorningUsageHistory();
  const estimate = estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    backupReserveMarginOverride: 2,
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T02:00:00.000Z", 20],
      ["2026-04-19T06:00:00.000Z", 30],
      ["2026-04-19T10:00:00.000Z", 10],
      ["2026-04-19T14:00:00.000Z", 18],
    ]),
    item,
    items: [createDefaultItem(), item],
    now,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample(),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples,
  });

  expect(estimate.targetTime).toBe("2026-04-19T10:00:00.000Z");
  expect(estimate.resolvedManualState).toBe("discharging");
  expect(estimate.skipReason).toBeNull();
  expect(estimate.targetTimeSignal?.predictedSolarW).toBe(900);
  expect(estimate.targetTimeSignal?.recoveryThresholdW).toBeGreaterThan(0);
  expect(estimate.estimatedReservePercentAtTargetTime).toBeGreaterThan(12);
});

test("low-price auto is skipped when solar is not expected at the low marker", () => {
  const now = new Date("2026-04-19T06:00:00.000Z");
  const battery = createBattery();
  const item = createAutoLowPriceItem();
  const history = createMorningUsageHistory();
  const estimate = estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    backupReserveMarginOverride: 2,
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T02:00:00.000Z", 20],
      ["2026-04-19T06:00:00.000Z", 30],
      ["2026-04-19T10:00:00.000Z", 10],
      ["2026-04-19T14:00:00.000Z", 18],
    ]),
    item,
    items: [createDefaultItem(), item],
    now,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample(),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createZeroSolarForecastSamples(
      "2026-04-19T06:00:00.000Z",
      "2026-04-19T11:00:00.000Z",
    ),
  });

  expect(estimate.resolvedManualState).toBe("discharging");
  expect(estimate.skipReason).toContain("below threshold");
});

function createAutoLowPriceItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "auto-low-price",
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
    triggerKind: "low-price",
  };
}

function createMorningSolarForecastSamples(): SolarForecastSampleRecord[] {
  return createPeriodRange(
    "2026-04-19T06:00:00.000Z",
    "2026-04-19T11:00:00.000Z",
  ).map((periodStart) => ({
    airTempC: null,
    cloudOpacityPercent: null,
    generatedAt: "2026-04-19T05:50:00.000Z",
    ghiWm2: periodStart === "2026-04-19T10:00:00.000Z" ? 700 : 200,
    periodStart,
    siteId: "site-1",
    value: periodStart === "2026-04-19T10:00:00.000Z" ? 900 : 200,
  }));
}

function createMorningUsageHistory(): {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
} {
  const batteryPowerSamples: BatteryPowerSampleRecord[] = [];
  const p1MeterSamples: P1MeterSampleRecord[] = [];
  const solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[] = [];

  for (let dayOffset = 1; dayOffset <= 7; dayOffset += 1) {
    const start = shiftDateTime("2026-04-19T06:00:00.000Z", -dayOffset);
    const end = shiftDateTime("2026-04-19T10:15:00.000Z", -dayOffset);

    for (const periodStart of createPeriodRange(start, end)) {
      const periodDate = new Date(periodStart);
      const hour = periodDate.getUTCHours();
      const minute = periodDate.getUTCMinutes();
      const solarPowerW =
        hour < 9 ? 0 : hour === 9 ? 300 : minute === 0 ? 750 : 500;

      batteryPowerSamples.push({
        batteryId: "battery-1",
        observedAt: periodStart,
        periodStart,
        powerW: 120,
        siteId: "site-1",
        socPercent: 65 - (hour - 6) * 1.5 - minute / 60,
      });
      p1MeterSamples.push({
        meterId: "meter-1",
        observedAt: periodStart,
        periodStart,
        powerW: 250,
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
    id: "auto-high-price",
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
    triggerKind: "high-price",
  };
}

function createSample(): NormalizedBatteryInfo {
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
