import { expect, test } from "bun:test";
import { getBatteryStrategyLegendItems } from "./strategy-legend";
import type { BatteryHistoryPoint } from "./types";

test("battery strategy legend uses automatic trigger reasons", () => {
  expect(
    getBatteryStrategyLegendItems([
      buildPoint({
        strategyDisplayLabel: "Delayed charging: Charge",
        strategyDisplayState: "charge",
        strategySource: "automatic",
      }),
      buildPoint({
        strategyDisplayLabel: "Export surplus: Discharge",
        strategyDisplayState: "discharge",
        strategySource: "automatic",
      }),
    ]),
  ).toMatchObject([
    { label: "Delayed charging", source: "automatic" },
    { label: "Export surplus", source: "automatic" },
  ]);
});

test("battery strategy legend keeps manual item labels", () => {
  expect(
    getBatteryStrategyLegendItems([
      buildPoint({
        strategyDisplayLabel: "Idle to 15%",
        strategyDisplayState: "idle",
        strategySource: "manual",
      }),
    ]),
  ).toMatchObject([{ label: "Idle to 15%", source: "manual" }]);
});

test("battery strategy legend falls back to the current state label", () => {
  expect(
    getBatteryStrategyLegendItems([
      buildPoint({
        strategyDisplayLabel: null,
        strategyDisplayState: "self-consumption",
        strategySource: "automatic",
      }),
      buildPoint({
        strategyDisplayLabel: null,
        strategyDisplayState: "idle",
        strategySource: "manual",
      }),
    ]),
  ).toMatchObject([
    { label: "Self-consumption", source: "automatic" },
    { label: "Idle", source: "manual" },
  ]);
});

function buildPoint(
  overrides: Partial<BatteryHistoryPoint>,
): BatteryHistoryPoint {
  return {
    currentChargePercent: null,
    currentChargingPower: null,
    currentDischargingPower: null,
    currentPower: null,
    futureChargePercent: null,
    futureChargingPower: null,
    futureDischargingPower: null,
    futurePower: null,
    overlayCharge: null,
    overlayColor: null,
    overlayDischarge: null,
    overlayIdle: null,
    overlaySelfConsumption: null,
    overlayStroke: null,
    overlayStrokeWidth: 0,
    overlayValue: null,
    periodStart: "2026-04-30T10:00:00.000Z",
    strategyActiveItemId: null,
    strategyDisplayLabel: null,
    strategyDisplayState: null,
    strategyItemLabel: null,
    strategySource: null,
    ...overrides,
  };
}
