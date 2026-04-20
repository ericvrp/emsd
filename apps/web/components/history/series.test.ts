import { expect, test } from "bun:test";
import type { BatteryStrategyHistoryRecord } from "@emsd/core/client";
import {
  buildBatteryHistoryPoints,
  buildExactBatteryStrategySegments,
} from "./series";

test("buildExactBatteryStrategySegments preserves exact mid-bucket strategy boundaries", () => {
  const strategyHistory: BatteryStrategyHistoryRecord[] = [
    {
      activeItemId: "default",
      batteryId: "battery-1",
      displayLabel: "Self-consumption",
      displayState: "self-consumption",
      endedAt: "2026-04-17T19:45:05.000Z",
      manualState: null,
      observedAt: "2026-04-17T19:30:00.000Z",
      siteId: "site-1",
      source: "automatic",
      startedAt: "2026-04-17T19:30:00.000Z",
      strategyMode: "self-consumption",
    },
    {
      activeItemId: "evening-discharge",
      batteryId: "battery-1",
      displayLabel: "Discharging",
      displayState: "discharge",
      endedAt: "2026-04-17T20:10:00.000Z",
      manualState: "discharging",
      observedAt: "2026-04-17T19:45:05.000Z",
      siteId: "site-1",
      source: "manual",
      startedAt: "2026-04-17T19:45:05.000Z",
      strategyMode: "manual",
    },
    {
      activeItemId: "other-battery",
      batteryId: "battery-2",
      displayLabel: "Charging",
      displayState: "charge",
      endedAt: null,
      manualState: "charging",
      observedAt: "2026-04-17T19:30:00.000Z",
      siteId: "site-1",
      source: "manual",
      startedAt: "2026-04-17T19:30:00.000Z",
      strategyMode: "manual",
    },
  ];

  expect(
    buildExactBatteryStrategySegments({
      chartEndMs: new Date("2026-04-17T21:00:00.000Z").getTime(),
      chartStartMs: new Date("2026-04-17T19:00:00.000Z").getTime(),
      cutoffMs: null,
      strategyHistory,
    }),
  ).toEqual([
    {
      endMs: new Date("2026-04-17T19:45:05.000Z").getTime(),
      startMs: new Date("2026-04-17T19:30:00.000Z").getTime(),
      state: "self-consumption",
    },
    {
      endMs: new Date("2026-04-17T20:10:00.000Z").getTime(),
      startMs: new Date("2026-04-17T19:45:05.000Z").getTime(),
      state: "discharge",
    },
  ]);
});

test("buildExactBatteryStrategySegments clips active strategy segments at now", () => {
  const strategyHistory: BatteryStrategyHistoryRecord[] = [
    {
      activeItemId: "evening-discharge",
      batteryId: "battery-1",
      displayLabel: "Discharging",
      displayState: "discharge",
      endedAt: null,
      manualState: "discharging",
      observedAt: "2026-04-17T19:45:05.000Z",
      siteId: "site-1",
      source: "manual",
      startedAt: "2026-04-17T19:45:05.000Z",
      strategyMode: "manual",
    },
  ];

  expect(
    buildExactBatteryStrategySegments({
      chartEndMs: new Date("2026-04-17T21:00:00.000Z").getTime(),
      chartStartMs: new Date("2026-04-17T19:00:00.000Z").getTime(),
      cutoffMs: new Date("2026-04-17T20:00:00.000Z").getTime(),
      strategyHistory,
    }),
  ).toEqual([
    {
      endMs: new Date("2026-04-17T20:00:00.000Z").getTime(),
      startMs: new Date("2026-04-17T19:45:05.000Z").getTime(),
      state: "discharge",
    },
  ]);
});

test("buildBatteryHistoryPoints keeps signed battery power direction", () => {
  const points = buildBatteryHistoryPoints(
    [
      {
        periodStart: "2026-04-17T19:30:00.000Z",
        powerW: 850,
        socPercent: 62,
      },
      {
        periodStart: "2026-04-17T19:45:00.000Z",
        powerW: -950,
        socPercent: 60,
      },
      {
        periodStart: "2026-04-17T20:00:00.000Z",
        powerW: 0,
        socPercent: 60,
      },
    ],
    [],
    "2026-04-17",
  );

  expect(
    points.find((point) => point.periodStart === "2026-04-17T19:30:00.000Z"),
  ).toMatchObject({
    currentChargingPower: null,
    currentDischargingPower: 850,
    currentPower: 850,
  });
  expect(
    points.find((point) => point.periodStart === "2026-04-17T19:45:00.000Z"),
  ).toMatchObject({
    currentChargingPower: -950,
    currentDischargingPower: null,
    currentPower: -950,
  });
  expect(
    points.find((point) => point.periodStart === "2026-04-17T20:00:00.000Z"),
  ).toMatchObject({
    currentChargingPower: null,
    currentDischargingPower: 0,
    currentPower: 0,
  });
});
