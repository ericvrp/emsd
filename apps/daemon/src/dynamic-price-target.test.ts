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
  estimateImportShortage,
  estimateImportShortageDynamicTarget,
  resolveCurrentExpectedSolarSurplus,
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
  // 10% minimum + 2% backup margin + round(12.08 hours * 0.25%/hour) = 15%
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(15);
  expect(estimate.estimatedTargetPercent).toBeGreaterThan(15);
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
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(15);
});

test("export-surplus is skipped when the next morning high-price marker is higher", () => {
  const estimate = estimateExportSurplusWithPriceMarkers({
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T16:00:00.000Z", 0.1],
      ["2026-04-19T19:45:00.000Z", 0.28],
      ["2026-04-19T23:00:00.000Z", 0.1],
      ["2026-04-20T04:00:00.000Z", 0.1],
      ["2026-04-20T08:00:00.000Z", 0.31],
      ["2026-04-20T12:00:00.000Z", 0.1],
    ]),
    now: new Date("2026-04-19T19:45:00.000Z"),
  });

  expect(estimate.skipReason).toContain(
    "skipped: next morning high-price marker",
  );
  expect(estimate.skipReason).toContain("higher export price 0.180 EUR/kWh");
  expect(estimate.skipReason).toContain("afternoon high-price marker");
  expect(estimate.skipReason).toContain("0.150 EUR/kWh");
});

test("export-surplus is not skipped when there is no next high-price marker", () => {
  const estimate = estimateExportSurplusWithPriceMarkers({
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T16:00:00.000Z", 0.1],
      ["2026-04-19T19:45:00.000Z", 0.28],
      ["2026-04-19T23:00:00.000Z", 0.1],
    ]),
    now: new Date("2026-04-19T19:45:00.000Z"),
  });

  expect(estimate.skipReason).toBeNull();
});

test("current expected solar surplus blocks delayed-charge prep when house load needs power", () => {
  const now = new Date("2026-04-19T20:30:00.000Z");
  const history = createOvernightUsageHistory();

  const surplus = resolveCurrentExpectedSolarSurplus({
    batteryPowerSamples: history.batteryPowerSamples,
    now,
    p1MeterSamples: history.p1MeterSamples,
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createZeroSolarForecastSamples(
      "2026-04-19T20:30:00.000Z",
      "2026-04-19T21:00:00.000Z",
    ),
  });

  expect(surplus.eligible).toBe(false);
  expect(surplus.predictedSolarW).toBe(0);
  expect(surplus.expectedHouseLoadW).toBeGreaterThan(0);
  expect(surplus.skipReason).toContain(
    "delayed-charge prep needs current expected solar above expected house load",
  );
});

test("current expected solar surplus allows delayed-charge prep when solar covers house load", () => {
  const now = new Date("2026-04-19T20:30:00.000Z");
  const history = createOvernightUsageHistory();

  const surplus = resolveCurrentExpectedSolarSurplus({
    batteryPowerSamples: history.batteryPowerSamples,
    now,
    p1MeterSamples: history.p1MeterSamples,
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createSolarForecastSamples({
      end: "2026-04-19T21:00:00.000Z",
      start: "2026-04-19T20:30:00.000Z",
      value: 700,
    }),
  });

  expect(surplus.eligible).toBe(true);
  expect(surplus.skipReason).toBeNull();
  expect(surplus.surplusW).toBeGreaterThan(surplus.minimumSolarSurplusW);
});

test("export-surplus is not skipped when the next morning high-price marker is not higher", () => {
  const estimate = estimateExportSurplusWithPriceMarkers({
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T16:00:00.000Z", 0.1],
      ["2026-04-19T19:45:00.000Z", 0.28],
      ["2026-04-19T23:00:00.000Z", 0.1],
      ["2026-04-20T04:00:00.000Z", 0.1],
      ["2026-04-20T08:00:00.000Z", 0.27],
      ["2026-04-20T12:00:00.000Z", 0.1],
    ]),
    now: new Date("2026-04-19T19:45:00.000Z"),
  });

  expect(estimate.skipReason).toBeNull();
});

test("export-surplus is not skipped when the current high-price marker is before midday", () => {
  const estimate = estimateExportSurplusWithPriceMarkers({
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T04:00:00.000Z", 0.1],
      ["2026-04-19T08:00:00.000Z", 0.28],
      ["2026-04-19T12:00:00.000Z", 0.1],
      ["2026-04-20T04:00:00.000Z", 0.1],
      ["2026-04-20T08:00:00.000Z", 0.31],
      ["2026-04-20T12:00:00.000Z", 0.1],
    ]),
    now: new Date("2026-04-19T08:00:00.000Z"),
  });

  expect(estimate.skipReason).toBeNull();
});

test("export-surplus is not skipped when the next high-price marker is not before midday", () => {
  const estimate = estimateExportSurplusWithPriceMarkers({
    dynamicPriceSamples: createDynamicPriceSamples([
      ["2026-04-19T09:00:00.000Z", 0.1],
      ["2026-04-19T13:00:00.000Z", 0.28],
      ["2026-04-19T16:00:00.000Z", 0.1],
      ["2026-04-19T19:45:00.000Z", 0.31],
      ["2026-04-19T23:00:00.000Z", 0.1],
    ]),
    now: new Date("2026-04-19T13:00:00.000Z"),
  });

  expect(estimate.skipReason).toBeNull();
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

test("delayed-charging auto is skipped when current charge is at least 100%", () => {
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
    sample: createSample({ socPercent: 100 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createDaytimeSolarForecastSamples(3000),
  });

  expect(estimate.targetTime).toBe("2026-04-19T10:00:00.000Z");
  expect(estimate.startTime).toBeNull();
  expect(estimate.skipReason).toBe(
    "skipped: current charge is already 100% for delayed charging item auto-delayed-charging",
  );
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

test("estimateImportShortage projects solar surplus and shortage from a low-price trigger", () => {
  const history = createConstantUsageHistory({
    end: "2026-04-19T03:00:00.000Z",
    siteLoadW: 200,
    start: "2026-04-12T00:00:00.000Z",
  });

  const estimate = estimateImportShortage({
    battery: createBattery(),
    batteryPowerSamples: history.batteryPowerSamples,
    now: new Date("2026-04-19T03:00:00.000Z"),
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample({ capacityWh: 10000, socPercent: 40 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createSolarWindowForecastSamples({
      daytimePowerW: 600,
      end: "2026-04-19T21:00:00.000Z",
      solarEnd: "2026-04-19T19:00:00.000Z",
      solarStart: "2026-04-19T07:00:00.000Z",
      start: "2026-04-19T03:00:00.000Z",
    }),
    triggerAt: new Date("2026-04-19T03:00:00.000Z"),
  });

  expect(estimate.currentSocPercent).toBe(40);
  expect(estimate.chargeStartTime).toBe("2026-04-19T07:00:00.000Z");
  expect(estimate.surplusEndTime).toBe("2026-04-19T19:00:00.000Z");
  expect(estimate.expectedSolarGenerationWh).toBe(7200);
  expect(estimate.expectedHouseLoadDuringSurplusWh).toBe(2400);
  expect(estimate.expectedSurplusEnergyWh).toBe(4800);
  expect(estimate.expectedHouseLoadUntilChargeStartWh).toBe(800);
  expect(estimate.projectedChargeStartSocPercent).toBe(32);
  expect(estimate.projectedEndSocPercent).toBe(80);
  expect(estimate.shortageToFullPercent).toBe(20);
  expect(estimate.expectedFullAt).toBeNull();
});

test("estimateImportShortageDynamicTarget charges to the required marker SoC plus hourly buffer", () => {
  const history = createConstantUsageHistory({
    end: "2026-04-19T05:00:00.000Z",
    siteLoadW: 200,
    start: "2026-04-12T00:00:00.000Z",
  });

  const estimate = estimateImportShortageDynamicTarget({
    battery: createBattery(),
    batteryPowerSamples: history.batteryPowerSamples,
    lowPriceMarkerTime: new Date("2026-04-19T12:00:00.000Z"),
    now: new Date("2026-04-19T05:00:00.000Z"),
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample({ capacityWh: 10000, socPercent: 40 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createSolarWindowForecastSamples({
      daytimePowerW: 600,
      end: "2026-04-19T21:00:00.000Z",
      solarEnd: "2026-04-19T19:00:00.000Z",
      solarStart: "2026-04-19T09:00:00.000Z",
      start: "2026-04-19T05:00:00.000Z",
    }),
  });

  expect(estimate.resolvedManualState).toBe("charging");
  expect(estimate.estimatedTargetPercent).toBe(70.8);
  expect(estimate.estimatedRemainingEnergyWh).toBe(3080);
  expect(estimate.importShortageDetails?.expectedNetSolarSurplusPercent).toBe(
    32,
  );
  expect(estimate.importShortageDetails?.expectedNetSolarRecoveryPercent).toBe(
    40,
  );
  expect(estimate.importShortageDetails?.expectedNetDemandBeforeSurplusWh).toBe(
    800,
  );
  expect(estimate.importShortageDetails?.expectedNetSolarRecoveryWh).toBe(4000);
  expect(
    estimate.importShortageDetails?.projectedEndSocWithoutImportPercent,
  ).toBe(72);
  expect(estimate.importShortageDetails?.shortageToFullPercent).toBe(28);
  expect(estimate.importShortageDetails?.baseTargetSocPercent).toBe(68);
  expect(estimate.importShortageDetails?.bufferPercent).toBe(2.8);
  expect(estimate.importShortageDetails?.solarSurplusStartTime).toBe(
    "2026-04-19T09:00:00.000Z",
  );
  expect(estimate.importShortageDetails?.solarSurplusEndTime).toBe(
    "2026-04-19T19:00:00.000Z",
  );
  expect(estimate.startTime).toBe("2026-04-19T07:22:00.000Z");
  expect(estimate.targetTime).toBe("2026-04-19T12:00:00.000Z");
  expect(estimate.skipReason).toBeNull();
});

test("estimateImportShortageDynamicTarget explains skipped no-shortage decisions", () => {
  const history = createConstantUsageHistory({
    end: "2026-04-19T03:00:00.000Z",
    siteLoadW: 200,
    start: "2026-04-12T00:00:00.000Z",
  });

  const estimate = estimateImportShortageDynamicTarget({
    battery: createBattery(),
    batteryPowerSamples: history.batteryPowerSamples,
    lowPriceMarkerTime: new Date("2026-04-19T12:00:00.000Z"),
    now: new Date("2026-04-19T03:00:00.000Z"),
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample({ capacityWh: 10000, socPercent: 90 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createSolarWindowForecastSamples({
      daytimePowerW: 3000,
      end: "2026-04-19T21:00:00.000Z",
      solarEnd: "2026-04-19T19:00:00.000Z",
      solarStart: "2026-04-19T07:00:00.000Z",
      start: "2026-04-19T03:00:00.000Z",
    }),
  });

  expect(estimate.skipReason).toContain(
    "current charge already meets import-shortage target",
  );
  expect(estimate.skipReason).toContain("marker=");
  expect(estimate.skipReason).toContain("currentSoc=90%");
  expect(estimate.skipReason).toContain("solarSurplusEnd=");
  expect(estimate.skipReason).toContain("solarSurplusStart=");
  expect(estimate.skipReason).toContain("netUntilEnd=32.8kWh");
  expect(estimate.skipReason).toContain("preSurplusDemand=0.8kWh");
  expect(estimate.skipReason).toContain("solarRecovery=33.6kWh");
  expect(estimate.skipReason).toContain("projectedEndSoc=100%");
  expect(estimate.skipReason).toContain("shortageToFull=0%");
  expect(estimate.skipReason).toContain("baseTarget=90%");
  expect(estimate.skipReason).toContain("buffer=3.2%");
  expect(estimate.skipReason).toContain("targetSoc=90%");
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

function estimateExportSurplusWithPriceMarkers(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  now: Date;
}): ReturnType<typeof estimateDynamicPriceTarget> {
  const battery = createBattery();
  const item = createAutoDischargeItem();
  const history = createOvernightUsageHistory();

  return estimateDynamicPriceTarget({
    battery,
    batteryPowerSamples: history.batteryPowerSamples,
    dynamicPriceSamples: input.dynamicPriceSamples,
    item,
    items: [createDefaultItem(), item],
    now: input.now,
    normalizedImportExportSpread: 0.13,
    p1MeterSamples: history.p1MeterSamples,
    sample: createSample({ capacityWh: 5000, socPercent: 90 }),
    solarEnergyProviderSamples: history.solarEnergyProviderSamples,
    solarForecastSamples: createZeroSolarForecastSamples(
      input.now.toISOString(),
      "2026-04-20T12:00:00.000Z",
    ),
  });
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

function createSolarWindowForecastSamples(input: {
  daytimePowerW: number;
  end: string;
  solarEnd: string;
  solarStart: string;
  start: string;
}): SolarForecastSampleRecord[] {
  return createPeriodRange(input.start, input.end).map((periodStart) => {
    const value =
      periodStart >= input.solarStart && periodStart < input.solarEnd
        ? input.daytimePowerW
        : 0;

    return {
      airTempC: null,
      cloudOpacityPercent: null,
      generatedAt: "2026-04-19T02:50:00.000Z",
      ghiWm2: value,
      periodStart,
      siteId: "site-1",
      value,
    };
  });
}

function createConstantUsageHistory(input: {
  end: string;
  siteLoadW: number;
  start: string;
}): {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
} {
  const batteryPowerSamples: BatteryPowerSampleRecord[] = [];
  const p1MeterSamples: P1MeterSampleRecord[] = [];
  const solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[] = [];

  for (const periodStart of createPeriodRange(input.start, input.end)) {
    batteryPowerSamples.push({
      batteryId: "battery-1",
      observedAt: periodStart,
      periodStart,
      powerW: 0,
      siteId: "site-1",
      socPercent: 40,
    });
    p1MeterSamples.push({
      meterId: "meter-1",
      observedAt: periodStart,
      periodStart,
      powerW: input.siteLoadW,
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
  return createSolarForecastSamples({ end, start, value: 0 });
}

function createSolarForecastSamples(input: {
  end: string;
  start: string;
  value: number;
}): SolarForecastSampleRecord[] {
  return createPeriodRange(input.start, input.end).map((periodStart) => ({
    airTempC: null,
    cloudOpacityPercent: null,
    generatedAt: "2026-04-19T20:20:00.000Z",
    ghiWm2: input.value,
    periodStart,
    siteId: "site-1",
    value: input.value,
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
