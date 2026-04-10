import { afterEach, expect, test } from "bun:test";
import {
  createBatteryStrategyRuntimeForPlanApply,
  discoverReportJsonSchema,
  getDatabasePath,
  parseGpsCoordinate,
} from "./index";

const originalPath = process.env.EMSD_DB_PATH;

afterEach(() => {
  if (originalPath === undefined) {
    process.env.EMSD_DB_PATH = undefined;
    return;
  }

  process.env.EMSD_DB_PATH = originalPath;
});

test("getDatabasePath resolves repo-relative paths", () => {
  process.env.EMSD_DB_PATH = "data/test.sqlite";

  expect(getDatabasePath()).toEndWith("data/test.sqlite");
});

test("discoverReportJsonSchema exposes the discover report contract", () => {
  expect(discoverReportJsonSchema.properties.schema.const).toBe(
    "emsd.discover.report.v1",
  );
  expect(discoverReportJsonSchema.properties.devices.items.required).toContain(
    "discoveryId",
  );
});

test("parseGpsCoordinate parses normalized latitude longitude pairs", () => {
  expect(parseGpsCoordinate("52.367600, 4.904100")).toEqual({
    latitude: 52.3676,
    longitude: 4.9041,
  });
  expect(parseGpsCoordinate("invalid")).toBeNull();
  expect(parseGpsCoordinate("91, 4.9")).toBeNull();
});

test("createBatteryStrategyRuntimeForPlanApply marks earlier same-day items as triggered", () => {
  const runtime = createBatteryStrategyRuntimeForPlanApply(
    [
      {
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      },
      {
        id: "morning",
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
      },
      {
        id: "evening",
        kind: "daily",
        startTime: "21:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 20,
        manualTargetSoc: 20,
      },
    ],
    new Date("2026-04-09T15:00:00.000Z"),
  );

  expect(runtime.activeItemId).toBeNull();
  expect(runtime.activeStartedAt).toBeNull();
  expect(runtime.activeObservedAt).toBeNull();
  expect(Object.keys(runtime.lastTriggeredAtByItemId)).toEqual(["morning"]);
  expect(runtime.lastTriggeredAtByItemId.morning).toContain("T07:00:00.000");
});

test("createBatteryStrategyRuntimeForPlanApply keeps same-time items pending", () => {
  const runtime = createBatteryStrategyRuntimeForPlanApply(
    [
      {
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      },
      {
        id: "start-now",
        kind: "daily",
        startTime: "15:00",
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
      },
    ],
    new Date("2026-04-09T15:00:00.000Z"),
  );

  expect(runtime.lastTriggeredAtByItemId).toEqual({});
});
