import { expect, test } from "bun:test";
import type { DynamicPriceTargetEstimate } from "../apps/daemon/src/dynamic-price-target";
import {
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  type DynamicPriceSampleRecord,
} from "../packages/core/src/index";
import {
  buildCurrentEstimateRows,
  buildEstimateSummaryRows,
  buildEnergyBucketRows,
  buildEnergyEstimateRows,
  buildEstimateSummaryLine,
  createReplayTime,
  parseArgs,
  resolveEvaluationReferenceTime,
} from "./evaluate-dynamic-price-target";

test("parseArgs accepts --strategy for export-surplus and delayed-charging", () => {
  expect(
    parseArgs(["--strategy=export-surplus,delayed-charging"])
      .strategyTriggerKinds,
  ).toEqual(["export-surplus", "delayed-charging"]);
});

test("parseArgs rejects unknown strategy names", () => {
  expect(() => parseArgs(["--strategy=high"])).toThrow(
    "--strategy only accepts 'export-surplus' and 'delayed-charging'; received: high.",
  );
});

test("resolveEvaluationReferenceTime keeps the explicit marker time for export-surplus items", () => {
  expect(
    resolveEvaluationReferenceTime({
      markerDate: "2026-04-19",
      dynamicPriceSamples: createDynamicPriceSamples([]),
      hasExplicitMarkerTime: true,
      item: createHighPriceItem(),
      markerTime: "17:30",
    }).toISOString(),
  ).toBe(createReplayTime("2026-04-19", "17:30").toISOString());
});

test("resolveEvaluationReferenceTime keeps the explicit low-price marker for delayed-charging items", () => {
  expect(
    resolveEvaluationReferenceTime({
      markerDate: "2026-04-19",
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T02:00:00.000Z", 20],
        ["2026-04-19T06:00:00.000Z", 30],
        ["2026-04-19T10:00:00.000Z", 10],
        ["2026-04-19T14:00:00.000Z", 18],
      ]),
      hasExplicitMarkerTime: true,
      item: createLowPriceAutoItem(),
      markerTime: "10:00",
    }).toISOString(),
  ).toBe("2026-04-19T10:00:00.000Z");
});

test("resolveEvaluationReferenceTime uses the next export-surplus marker by default", () => {
  expect(
    resolveEvaluationReferenceTime({
      markerDate: "2026-04-19",
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T04:00:00.000Z", 10],
        ["2026-04-19T08:00:00.000Z", 30],
        ["2026-04-19T12:00:00.000Z", 10],
      ]),
      hasExplicitMarkerTime: false,
      item: createHighPriceItem(),
      markerTime: "06:00",
    }).toISOString(),
  ).toBe("2026-04-19T08:00:00.000Z");
});

test("resolveEvaluationReferenceTime uses the next delayed-charging low-price marker by default", () => {
  expect(
    resolveEvaluationReferenceTime({
      markerDate: "2026-04-19",
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T02:00:00.000Z", 20],
        ["2026-04-19T06:00:00.000Z", 30],
        ["2026-04-19T10:00:00.000Z", 10],
        ["2026-04-19T14:00:00.000Z", 18],
      ]),
      hasExplicitMarkerTime: false,
      item: createLowPriceAutoItem(),
      markerTime: "01:00",
    }).toISOString(),
  ).toBe("2026-04-19T10:00:00.000Z");
});

test("resolveEvaluationReferenceTime uses the next day's delayed-charging low-price marker when today's low marker is gone", () => {
  expect(
    resolveEvaluationReferenceTime({
      markerDate: "2026-04-19",
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T16:00:00.000Z", 20],
        ["2026-04-19T18:00:00.000Z", 35],
        ["2026-04-19T20:00:00.000Z", 22],
        ["2026-04-19T22:00:00.000Z", 20],
        ["2026-04-20T08:00:00.000Z", 12],
        ["2026-04-20T10:00:00.000Z", 5],
        ["2026-04-20T12:00:00.000Z", 14],
        ["2026-04-20T14:00:00.000Z", 25],
      ]),
      hasExplicitMarkerTime: false,
      item: createLowPriceAutoItem(),
      markerTime: "23:30",
    }).toISOString(),
  ).toBe("2026-04-20T10:00:00.000Z");
});

test("buildCurrentEstimateRows shows start time and start-based duration", () => {
  const referenceTime = createReplayTime("2026-04-21", "19:45");

  expect(
    buildCurrentEstimateRows({
      batteryMinimumDischargePercent: 10,
      dynamicPriceTargetEstimate: createEstimate(),
      minimumSolarSurplusWOverride: 50,
      strategyTriggerKind: "export-surplus",
      referenceTime,
      reserveTargetPercent: 12,
    }),
  ).toEqual({
    Action: "discharge",
    Strategy: "export-surplus",
    "Start time": "2026-04-21 19:45",
    "Minimum solar surplus": "50 W",
    "Reserve at target": "18%",
    "Discharge target": "57%",
    "Target time": "2026-04-22 07:30",
    "Start to target duration": "11h 45m",
    Skip: "no",
  });
});

test("buildCurrentEstimateRows prefers the computed delayed-charging start time when available", () => {
  const referenceTime = createReplayTime("2026-04-21", "19:45");

  expect(
    buildCurrentEstimateRows({
      batteryMinimumDischargePercent: 10,
      dynamicPriceTargetEstimate: {
        ...createEstimate(),
        startTime: createReplayTime("2026-04-21", "18:30").toISOString(),
      },
      minimumSolarSurplusWOverride: 50,
      strategyTriggerKind: "delayed-charging",
      referenceTime,
      reserveTargetPercent: 12,
    }),
  ).toMatchObject({
    "Start time": "2026-04-21 18:30",
    "Start to target duration": "13h 0m",
  });
});

test("buildEstimateSummaryLine explains how delayed-charging start time was computed", () => {
  expect(
    buildEstimateSummaryLine({
      action: "charging",
      battery: {
        id: "battery-1",
        minimumDischargePercent: 10,
        name: "Battery 1",
      } as never,
      batteryId: "battery-1",
      candidateDays: [],
      capacityWh: 6000,
      dynamicPriceTargetEstimate: {
        ...createEstimate(),
        effectiveDischargePowerW: 2400,
        estimatedReservePercentAtTargetTime: 20,
        estimatedTargetPercent: 35,
        requiredDischargeMinutes: 75,
        startTime: createReplayTime("2026-04-21", "18:30").toISOString(),
        startTimeBasisSocPercent: 65,
        targetTime: createReplayTime("2026-04-22", "07:30").toISOString(),
      },
      minimumSolarSurplusWOverride: 50,
      referenceTime: createReplayTime("2026-04-21", "19:45"),
      reserveTargetPercent: 12,
      siteId: "site-1",
      siteName: "Home",
      strategyTriggerKind: "delayed-charging",
      verboseBlocks: new Set(),
    }),
  ).toContain("start computed from 65% to 35% at 2400 W over 1h 15m");
});

test("buildEstimateSummaryRows keeps delayed-charging output short and strategy-specific", () => {
  expect(
    buildEstimateSummaryRows({
      action: "charging",
      battery: {
        id: "battery-1",
        minimumDischargePercent: 10,
        name: "Battery 1",
      } as never,
      batteryId: "battery-1",
      candidateDays: [],
      capacityWh: 6000,
      dynamicPriceTargetEstimate: {
        ...createEstimate(),
        delayedChargingDetails: {
          actualWindowEnd: createReplayTime(
            "2026-04-22",
            "15:45",
          ).toISOString(),
          actualWindowEndPrice: -0.01,
          actualWindowStart: createReplayTime(
            "2026-04-22",
            "12:45",
          ).toISOString(),
          actualWindowStartPrice: -0.02,
          chargeStartSocPercent: 20,
          chargePowerW: 2400,
          currentSocBasisPercent: 21,
          latestFeasiblePreDischargeStartTime: createReplayTime(
            "2026-04-22",
            "12:43",
          ).toISOString(),
          lowestPrice: -0.11,
          lowPriceMargin: 0.104,
          lowPriceMarkerTime: createReplayTime(
            "2026-04-22",
            "13:45",
          ).toISOString(),
          minimumTimeToFullChargeMinutes: 120,
          normalizedImportExportSpread: 0.13,
          potentialWindowEnd: createReplayTime(
            "2026-04-22",
            "15:45",
          ).toISOString(),
          potentialWindowStart: createReplayTime(
            "2026-04-22",
            "11:45",
          ).toISOString(),
          preDischargeTargetSocPercent: 20,
        },
        effectiveDischargePowerW: 2400,
        estimatedReservePercentAtTargetTime: 20,
        estimatedTargetPercent: 20,
        requiredDischargeMinutes: 2,
        startTime: createReplayTime("2026-04-22", "12:43").toISOString(),
        startTimeBasisSocPercent: 21,
        targetTime: createReplayTime("2026-04-22", "12:45").toISOString(),
      },
      minimumSolarSurplusWOverride: 50,
      referenceTime: createReplayTime("2026-04-22", "11:00"),
      reserveTargetPercent: 12,
      siteId: "site-1",
      siteName: "Home",
      strategyTriggerKind: "delayed-charging",
      verboseBlocks: new Set(),
    }),
  ).toEqual([
    {
      label: "Current pre-window action",
      value:
        "discharge from 21% to 20% to reach the pre-discharge target before the low-price window",
    },
    {
      label: "Low Price Marker",
      value: "2026-04-22 13:45 at -0.11 EUR/kWh (+ 0.10 EUR/kWh margin -> max -0.01 EUR/kWh in window)",
    },
    { label: "Time to charge", value: "2h from 20% to 100% (4800 Wh at 2400 W)" },
    {
      label: "Low price window",
      value: "12:45 (-0.02 EUR/kWh) -> 15:45 (-0.01 EUR/kWh) (potential: 11:45 -> 15:45)",
    },
    {
      label: "Pre-discharge start",
      value: "2026-04-22 12:43 from 21% -> 20% (at 2400 W for 2m)",
    },
  ]);
});

test("buildEstimateSummaryRows keeps export-surplus output strategy-specific", () => {
  expect(
    buildEstimateSummaryRows({
      action: "discharging",
      battery: {
        id: "battery-1",
        minimumDischargePercent: 10,
        name: "Battery 1",
      } as never,
      batteryId: "battery-1",
      candidateDays: [],
      capacityWh: 6000,
      dynamicPriceTargetEstimate: createEstimate(),
      minimumSolarSurplusWOverride: 50,
      referenceTime: createReplayTime("2026-04-21", "19:45"),
      reserveTargetPercent: 12,
      siteId: "site-1",
      siteName: "Home",
      strategyTriggerKind: "export-surplus",
      verboseBlocks: new Set(),
    }),
  ).toEqual([
    { label: "Action", value: "discharge" },
    { label: "Recovery Target Time", value: "2026-04-22 07:30" },
    { label: "Predicted Solar", value: "300 W" },
    { label: "Expected Load", value: "200 W" },
    { label: "Solar Surplus", value: "+100 W" },
    { label: "Discharge Target", value: "discharge to 57%" },
    { label: "Start", value: "2026-04-21 19:45" },
    { label: "Reserve At Target", value: "18%" },
  ]);
});

test("buildEnergyEstimateRows explains the interval and target formula", () => {
  const referenceTime = createReplayTime("2026-04-21", "19:45");

  expect(
    buildEnergyEstimateRows({
      capacityWh: 6000,
      dynamicPriceTargetEstimate: createEstimate(),
      referenceTime,
      reserveTargetPercent: 12,
    }),
  ).toEqual({
    "Integration interval": "2026-04-21 19:45 -> 2026-04-22 07:30 (11h 45m)",
    "Expected house load before target time": "2637.77 Wh",
    "Predicted solar before target time": "288.73 Wh",
    "Net battery energy needed before target time":
      "2349.04 Wh = max(0, 2637.77 Wh - 288.73 Wh)",
    "Battery capacity basis": "6000 Wh",
    "Energy converted to target": "39% = ceil(2349.04 Wh / 6000 Wh * 100)",
    "Final target formula": "57% = 18% reserve at target + 39% interval energy",
  });
});

test("buildEnergyBucketRows formats cumulative energy buckets", () => {
  const buckets = [
    {
      time: "2026-04-21T19:45:00.000Z",
      durationMinutes: 15,
      expectedHouseLoadWh: 55,
      predictedSolarWh: 0,
      netBatteryEnergyNeededWh: 55,
      cumulativeExpectedHouseLoadWh: 55,
      cumulativePredictedSolarWh: 0,
      cumulativeNetBatteryEnergyNeededWh: 55,
    },
    {
      time: "2026-04-21T20:00:00.000Z",
      durationMinutes: 15,
      expectedHouseLoadWh: 57.5,
      predictedSolarWh: 0,
      netBatteryEnergyNeededWh: 57.5,
      cumulativeExpectedHouseLoadWh: 112.5,
      cumulativePredictedSolarWh: 0,
      cumulativeNetBatteryEnergyNeededWh: 112.5,
    },
    {
      time: "2026-04-22T07:15:00.000Z",
      durationMinutes: 15,
      expectedHouseLoadWh: 58.69,
      predictedSolarWh: 63.37,
      netBatteryEnergyNeededWh: 0,
      cumulativeExpectedHouseLoadWh: 2356.19,
      cumulativePredictedSolarWh: 281.58,
      cumulativeNetBatteryEnergyNeededWh: 2356.19,
    },
  ];

  expect(buildEnergyBucketRows(buckets)).toEqual([
    {
      time: "19:45",
      expectedHouseLoadWh: "55 Wh",
      cumulativeExpectedHouseLoadWh: "55 Wh",
      predictedSolarWh: "0 Wh",
      cumulativePredictedSolarWh: "0 Wh",
      cumulativeNetBatteryEnergyNeededWh: "55 Wh",
    },
    {
      time: "20:00",
      expectedHouseLoadWh: "57.50 Wh",
      cumulativeExpectedHouseLoadWh: "112.50 Wh",
      predictedSolarWh: "0 Wh",
      cumulativePredictedSolarWh: "0 Wh",
      cumulativeNetBatteryEnergyNeededWh: "112.50 Wh",
    },
    {
      time: "07:15",
      expectedHouseLoadWh: "58.69 Wh",
      cumulativeExpectedHouseLoadWh: "2356.19 Wh",
      predictedSolarWh: "63.37 Wh",
      cumulativePredictedSolarWh: "281.58 Wh",
      cumulativeNetBatteryEnergyNeededWh: "2356.19 Wh",
    },
  ]);
});

function createHighPriceItem(): BatteryStrategyPlanItem {
  return {
    ...createLowPriceAutoItem(),
    id: "export-surplus-item",
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: 10,
    manualState: "discharging",
    manualTargetSoc: 10,
    triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
  };
}

function createLowPriceAutoItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "delayed-charging-item",
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

function createDynamicPriceSamples(
  entries: Array<[string, number]>,
): DynamicPriceSampleRecord[] {
  return entries.map(([periodStart, importPrice]) => ({
    currency: "EUR",
    generatedAt: "2026-04-19T00:00:00.000Z",
    importPrice,
    periodStart,
    siteId: "site-1",
  }));
}

function createEstimate(): DynamicPriceTargetEstimate {
  return {
    availability: "full",
    breakEvenTrace: [],
    energyBuckets: [],
    estimatedRemainingEnergyWh: 2349.04,
    estimatedReservePercentAtTargetTime: 18,
    estimatedTargetPercent: 57,
    delayedChargingDetails: null,
    expectedHouseLoadWh: 2637.77,
    historyStats: {
      historicalPeriodsUsed: 10,
      sameWeekdayPeriodsUsed: 2,
      slotCount: 4,
    },
    predictedSolarGenerationWh: 288.73,
    reasoning: "recent history and predicted solar recovery",
    startTime: null,
    startTimeBasisSocPercent: null,
    effectiveDischargePowerW: null,
    requiredDischargeMinutes: null,
    resolvedManualState: "discharging",
    skipReason: null,
    targetTime: createReplayTime("2026-04-22", "07:30").toISOString(),
    targetTimeSignal: {
      expectedHouseLoadW: 200,
      predictedSolarW: 300,
      recoveryThresholdW: 250,
    },
    warning: null,
    windowKind: "evening-export-surplus",
  };
}
