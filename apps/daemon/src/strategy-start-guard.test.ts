import { expect, test } from "bun:test";
import {
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  type ManagedDeviceTelemetryRecord,
} from "@emsd/core";
import {
  getCurrentSiteSolarPowerW,
  getScheduledStartSkipReason,
} from "./strategy-start-guard";

test("getCurrentSiteSolarPowerW sums current site solar telemetry", () => {
  expect(
    getCurrentSiteSolarPowerW({
      siteId: "home",
      telemetry: [
        createTelemetry({
          deviceId: "solar-1",
          kind: "solar-energy-provider",
          powerW: 320,
        }),
        createTelemetry({
          deviceId: "solar-2",
          kind: "solar-energy-provider",
          powerW: 260,
        }),
        createTelemetry({ deviceId: "meter-1", kind: "meter", powerW: 900 }),
      ],
    }),
  ).toBe(580);
});

test("getScheduledStartSkipReason skips delayed-charging when solar is not above threshold", () => {
  expect(
    getScheduledStartSkipReason({
      batteryId: "battery-1",
      item: createPlanItem(),
      siteCurrentSolarPowerW: 500,
    }),
  ).toContain("below 500W");

  expect(
    getScheduledStartSkipReason({
      batteryId: "battery-1",
      item: createPlanItem(),
      siteCurrentSolarPowerW: null,
    }),
  ).toContain("unavailable");

  expect(
    getScheduledStartSkipReason({
      batteryId: "battery-1",
      item: createPlanItem(),
      siteCurrentSolarPowerW: 501,
    }),
  ).toBeNull();
});

test("getScheduledStartSkipReason does not apply the live solar guard to delayed-charging auto items", () => {
  expect(
    getScheduledStartSkipReason({
      batteryId: "battery-1",
      item: createPlanItem({ targetMethod: "auto" }),
      siteCurrentSolarPowerW: 0,
    }),
  ).toBeNull();
});

function createTelemetry(
  overrides: Partial<ManagedDeviceTelemetryRecord>,
): ManagedDeviceTelemetryRecord {
  return {
    deviceId: "device-1",
    siteId: "home",
    kind: "solar-energy-provider",
    capacityWh: null,
    powerW: 100,
    productionControlStatus: null,
    socPercent: null,
    state: null,
    observedAt: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

function createPlanItem(
  overrides: Partial<BatteryStrategyPlanItem> = {},
): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "item-1",
    kind: "daily",
    startTime: null,
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "soc",
    strategyMode: "manual",
    manualState: "charging",
    manualPowerW: 2400,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: null,
    manualTargetSoc: 100,
    ...overrides,
  };
}
