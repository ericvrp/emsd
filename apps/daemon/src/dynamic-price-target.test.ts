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
import {
  estimateDynamicPriceTarget,
  resolveDelayedChargingLowPriceMarkerEligibility,
} from "./dynamic-price-target";

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

test("delayed-charging auto switches to self-consumption before a positive low-price marker", () => {
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
  expect(estimate.skipReason).toBeNull();
  expect(estimate.targetTimeSignal).toMatchObject({
    expectedHouseLoadW: 250,
  });
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(100);
  expect(estimate.estimatedTargetPercent).toBe(100);
  expect(estimate.estimatedRemainingEnergyWh).toBe(3000);
  expect(estimate.resolvedManualState).toBeNull();
  expect(estimate.delayedChargingDetails).toMatchObject({
    activationMode: "self-consumption",
    currentSocBasisPercent: 70,
    energyToFullWh: 3000,
    expectedHouseLoadAtMarkerW: 250,
    lowestPrice: 10,
    lowPriceMarkerTime: "2026-04-19T10:00:00.000Z",
    targetChargePercent: 100,
  });
  expect(estimate.delayedChargingDetails?.effectiveFillPowerW).toBeGreaterThan(
    0,
  );
  expect(
    estimate.delayedChargingDetails?.expectedNetSolarFillPowerW,
  ).toBeGreaterThan(0);
  expect(
    estimate.delayedChargingDetails?.predictedSolarAtMarkerW,
  ).toBeGreaterThan(0);
  expect(estimate.delayedChargingDetails?.timeToFullMinutes).toBeGreaterThan(0);
  expect(
    estimate.delayedChargingDetails?.triggerLeadTimeMinutes,
  ).toBeGreaterThan(0);
  expect(estimate.startTime).not.toBeNull();
  expect(
    new Date(estimate.startTime ?? "").getTime() +
      (estimate.delayedChargingDetails?.triggerLeadTimeMinutes ?? 0) * 60_000,
  ).toBe(new Date(estimate.targetTime ?? "").getTime());
  expect(estimate.reasoning).toContain("low-price marker");
});

test("delayed-charging auto charges to full before a non-positive low-price marker", () => {
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
      ["2026-04-19T10:00:00.000Z", -2],
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
    solarForecastSamples: createDaytimeSolarForecastSamples(3000),
  });

  expect(estimate.targetTime).toBe("2026-04-19T10:00:00.000Z");
  expect(estimate.startTime).toBe("2026-04-19T07:45:00.000Z");
  expect(estimate.resolvedManualState).toBe("charging");
  expect(estimate.skipReason).toBeNull();
  expect(estimate.delayedChargingDetails).toMatchObject({
    activationMode: "charging",
    effectiveFillPowerW: 800,
    targetChargePercent: 100,
    timeToFullMinutes: 225,
    triggerLeadTimeMinutes: 135,
  });
});

test("delayed-charging auto is skipped when the marker price is non-positive but marker solar does not beat load", () => {
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
      ["2026-04-19T10:00:00.000Z", -2],
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

  expect(estimate.startTime).toBeNull();
  expect(estimate.skipReason).toContain(
    "needs expected solar above expected house load",
  );
});

test("delayed-charging auto is skipped when the marker price is positive but net solar fill power is not", () => {
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

  expect(estimate.startTime).toBeNull();
  expect(estimate.skipReason).toContain(
    "needs expected solar above expected house load",
  );
});

test("delayed-charge prep uses the same low-price marker solar-surplus gate", () => {
  const now = new Date("2026-04-19T06:00:00.000Z");
  const lowSolarHistory = createDaytimeUsageHistory(700);
  const blocked = resolveDelayedChargingLowPriceMarkerEligibility({
    batteryPowerSamples: lowSolarHistory.batteryPowerSamples,
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T02:00:00.000Z", 20],
      ["2026-04-19T06:00:00.000Z", 30],
      ["2026-04-19T10:00:00.000Z", -2],
      ["2026-04-19T14:00:00.000Z", 28],
      ["2026-04-19T18:00:00.000Z", 18],
    ]),
    now,
    p1MeterSamples: lowSolarHistory.p1MeterSamples,
    solarEnergyProviderSamples: lowSolarHistory.solarEnergyProviderSamples,
    solarForecastSamples: createZeroSolarForecastSamples(
      "2026-04-19T06:00:00.000Z",
      "2026-04-19T14:00:00.000Z",
    ),
  });
  const surplusHistory = createDaytimeUsageHistory(250);
  const allowed = resolveDelayedChargingLowPriceMarkerEligibility({
    batteryPowerSamples: surplusHistory.batteryPowerSamples,
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T02:00:00.000Z", 20],
      ["2026-04-19T06:00:00.000Z", 30],
      ["2026-04-19T10:00:00.000Z", -2],
      ["2026-04-19T14:00:00.000Z", 28],
      ["2026-04-19T18:00:00.000Z", 18],
    ]),
    now,
    p1MeterSamples: surplusHistory.p1MeterSamples,
    solarEnergyProviderSamples: surplusHistory.solarEnergyProviderSamples,
    solarForecastSamples: createDaytimeSolarForecastSamples(3000),
  });

  expect(blocked.lowPriceMarkerTime?.toISOString()).toBe(
    "2026-04-19T10:00:00.000Z",
  );
  expect(blocked.eligible).toBe(false);
  expect(blocked.predictedSolarW).toBe(0);
  expect(blocked.expectedHouseLoadW).toBe(700);
  expect(allowed.eligible).toBe(true);
  expect(allowed.predictedSolarW).toBeGreaterThan(allowed.expectedHouseLoadW);
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
