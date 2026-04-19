import { expect, test } from "bun:test";
import type {
  BatteryPowerSampleRecord,
  BatteryRecord,
  BatteryStrategyPlanItem,
  NormalizedBatteryInfo,
  P1MeterSampleRecord,
  SolarEnergyProviderSampleRecord,
  SolarForecastSampleRecord,
} from "@emsd/core";
import { estimateStrategyTarget } from "./strategy-estimate";

test("evening auto discharge targets tomorrow morning and keeps a reserve above backup", () => {
  const now = new Date("2026-04-19T20:25:00");
  const battery = createBattery();
  const item = createAutoDischargeItem();
  const solarForecastSamples = createZeroSolarForecastSamples(
    "2026-04-19T20:30:00",
    "2026-04-20T09:00:00",
  );
  const history = createOvernightUsageHistory();

  const estimate = estimateStrategyTarget({
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
  expect(estimate.estimatedReservePercentAtTargetTime).toBe(11);
  expect(estimate.estimatedTargetPercent).toBeGreaterThan(11);
  expect(estimate.estimatedRemainingEnergyWh).toBeGreaterThan(0);
  expect(estimate.windowKind).toBe("evening-high-price");
});

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
