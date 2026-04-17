import { expect, test } from "bun:test";
import type { BatteryStrategyHistoryRecord } from "@emsd/core/client";
import { buildExactBatteryStrategySegments } from "./series";

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
