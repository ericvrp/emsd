import { expect, test } from "bun:test";
import type { DynamicPriceTargetEstimate } from "../apps/daemon/src/dynamic-price-target";
import {
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  type DynamicPriceSampleRecord,
} from "../packages/core/src/index";
import {
  buildCurrentEstimateRows,
  buildEnergyBucketRows,
  buildEnergyEstimateRows,
  buildEstimateSummaryLine,
  buildEstimateSummaryRows,
  createReplayTime,
  parseArgs,
  resolveEvaluationReferenceTime,
  resolveEvaluationStrategyMarker,
} from "./evaluate-dynamic-price-target";

test("parseArgs accepts --strategy for built-in dynamic price strategies", () => {
  expect(
    parseArgs([
      "--strategy=export-surplus,delayed-charging-prep,delayed-charging,import-shortage",
    ]).strategyTriggerKinds,
  ).toEqual([
    "export-surplus",
    "delayed-charge-prep",
    "delayed-charging",
    "import-shortage",
  ]);
});

test("parseArgs rejects unknown strategy names", () => {
  expect(() => parseArgs(["--strategy=high"])).toThrow(
    "--strategy only accepts 'export-surplus', 'delayed-charge-prep' (or 'delayed-charging-prep'), 'delayed-charging', and 'import-shortage'; received: high.",
  );
});

test("parseArgs accepts --marker-percentage", () => {
  expect(parseArgs(["--marker-percentage=55.5"]).markerPercentage).toBe(55.5);
});

test("parseArgs accepts --date and --time with optional seconds", () => {
  expect(parseArgs(["--date=2026-05-19", "--time=02:19:20"])).toMatchObject({
    date: "2026-05-19",
    time: "02:19:20",
  });
  expect(parseArgs(["--time=02:19"]).time).toBe("02:19");
});

test("parseArgs rejects out-of-range marker percentages", () => {
  expect(() => parseArgs(["--marker-percentage=120"])).toThrow(
    "--marker-percentage must be between 0 and 100.",
  );
});

test("resolveEvaluationReferenceTime returns the requested as-of time", () => {
  expect(
    resolveEvaluationReferenceTime({
      date: "2026-04-19",
      time: "17:30:20",
    }).toISOString(),
  ).toBe(createReplayTime("2026-04-19", "17:30:20").toISOString());
});

test("resolveEvaluationStrategyMarker picks the next low-price marker for import-shortage", () => {
  expect(
    resolveEvaluationStrategyMarker({
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T02:00:00.000Z", 20],
        ["2026-04-19T06:00:00.000Z", 30],
        ["2026-04-19T10:00:00.000Z", 10],
        ["2026-04-19T14:00:00.000Z", 18],
      ]),
      item: createImportShortageItem(),
      referenceTime: createReplayTime("2026-04-19", "02:19:20"),
    })?.toISOString(),
  ).toBe("2026-04-19T10:00:00.000Z");
});

test("resolveEvaluationStrategyMarker uses the next export-surplus marker", () => {
  expect(
    resolveEvaluationStrategyMarker({
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T04:00:00.000Z", 10],
        ["2026-04-19T08:00:00.000Z", 30],
        ["2026-04-19T12:00:00.000Z", 10],
      ]),
      item: createHighPriceItem(),
      referenceTime: createReplayTime("2026-04-19", "06:00"),
    })?.toISOString(),
  ).toBe("2026-04-19T08:00:00.000Z");
});

test("resolveEvaluationStrategyMarker uses the next delayed-charging low-price marker", () => {
  expect(
    resolveEvaluationStrategyMarker({
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T02:00:00.000Z", 20],
        ["2026-04-19T06:00:00.000Z", 30],
        ["2026-04-19T10:00:00.000Z", 10],
        ["2026-04-19T14:00:00.000Z", 18],
      ]),
      item: createLowPriceAutoItem(),
      referenceTime: createReplayTime("2026-04-19", "01:00"),
    })?.toISOString(),
  ).toBe("2026-04-19T10:00:00.000Z");
});

test("resolveEvaluationStrategyMarker uses the next day's delayed-charging low-price marker when today's low marker is gone", () => {
  expect(
    resolveEvaluationStrategyMarker({
      dynamicPriceSamples: createDynamicPriceSamples([
        ["2026-04-19T16:00:00.000Z", 20],
        ["2026-04-19T18:00:00.000Z", 35],
        ["2026-04-19T20:00:00.000Z", 22],
        ["2026-04-19T22:00:00.000Z", 20],
        ["2026-04-20T06:00:00.000Z", 20],
        ["2026-04-20T08:00:00.000Z", 12],
        ["2026-04-20T10:00:00.000Z", 5],
        ["2026-04-20T12:00:00.000Z", 14],
        ["2026-04-20T14:00:00.000Z", 25],
      ]),
      item: createLowPriceAutoItem(),
      referenceTime: createReplayTime("2026-04-19", "23:30"),
    })?.toISOString(),
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
        delayedChargingDetails: {
          activationMode: "self-consumption",
          currentSocBasisPercent: 65,
          effectiveFillPowerW: 2400,
          energyToFullWh: 2100,
          expectedHouseLoadAtMarkerW: 300,
          expectedNetSolarFillPowerW: 2400,
          lowestPrice: 0.08,
          lowPriceMarkerTime: createReplayTime(
            "2026-04-22",
            "07:30",
          ).toISOString(),
          predictedSolarAtMarkerW: 2700,
          targetChargePercent: 100,
          timeToFullMinutes: 53,
          triggerLeadTimeMinutes: 32,
          triggerMarginFactor: 1.2,
        },
        estimatedReservePercentAtTargetTime: 100,
        estimatedTargetPercent: 100,
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
  ).toContain("delayed-charging self-consumption");
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
          activationMode: "charging",
          currentSocBasisPercent: 21,
          effectiveFillPowerW: 2400,
          energyToFullWh: 4740,
          expectedHouseLoadAtMarkerW: 250,
          expectedNetSolarFillPowerW: 1550,
          lowestPrice: -0.11,
          lowPriceMarkerTime: createReplayTime(
            "2026-04-22",
            "13:45",
          ).toISOString(),
          predictedSolarAtMarkerW: 1800,
          targetChargePercent: 100,
          timeToFullMinutes: 119,
          triggerLeadTimeMinutes: 72,
          triggerMarginFactor: 1.2,
        },
        estimatedReservePercentAtTargetTime: 100,
        estimatedTargetPercent: 100,
        startTime: createReplayTime("2026-04-22", "12:43").toISOString(),
        startTimeBasisSocPercent: 21,
        targetTime: createReplayTime("2026-04-22", "13:45").toISOString(),
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
    { label: "Evaluated At", value: "2026-04-22 11:00" },
    { label: "Selected Marker", value: "not available" },
    {
      label: "Low Price Marker",
      value: "2026-04-22 13:45 at -0.110 EUR/kWh",
    },
    {
      label: "Activation Mode",
      value: "full charge",
    },
    {
      label: "Time to full",
      value: "1h 59m from 21% to 100% (4740 Wh at 2400 W)",
    },
    {
      label: "Trigger lead time",
      value: "1h 12m = 1h 59m * 0.5 * 1.20",
    },
    {
      label: "Start",
      value: "2026-04-22 12:43",
    },
  ]);
});

test("buildEstimateSummaryRows keeps export-surplus output strategy-specific", () => {
  const referenceTime = createReplayTime("2026-04-21", "19:45");

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
      dynamicPriceSamples: createDynamicPriceSamples([
        [createReplayTime("2026-04-21", "15:45").toISOString(), 0.2],
        [referenceTime.toISOString(), 0.31],
        [createReplayTime("2026-04-21", "22:15").toISOString(), 0.18],
        [createReplayTime("2026-04-22", "00:15").toISOString(), 0.27],
        [createReplayTime("2026-04-22", "02:15").toISOString(), 0.19],
      ]),
      minimumSolarSurplusWOverride: 50,
      normalizedImportExportSpread: 0.13,
      referenceTime,
      reserveTargetPercent: 12,
      siteId: "site-1",
      siteName: "Home",
      strategyTriggerKind: "export-surplus",
      verboseBlocks: new Set(),
    }),
  ).toEqual([
    { label: "Evaluated At", value: "2026-04-21 19:45" },
    { label: "Selected Marker", value: "not available" },
    { label: "Action", value: "discharge" },
    {
      label: "High Price Marker",
      value: "2026-04-21 19:45 at 0.180 EUR/kWh export",
    },
    {
      label: "Next High Price Marker",
      value: "2026-04-22 00:15 at 0.140 EUR/kWh export",
    },
    { label: "Recovery Target Time", value: "2026-04-22 07:30" },
    { label: "Predicted Solar", value: "300 W" },
    { label: "Expected Load", value: "200 W" },
    { label: "Solar Surplus", value: "+100 W" },
    { label: "Target", value: "discharge to 57%" },
    { label: "Reserve At Target", value: "18%" },
  ]);
});

test("buildEstimateSummaryRows explains delayed-charge-prep markers", () => {
  const referenceTime = createReplayTime("2026-04-21", "08:00");
  const rows = buildEstimateSummaryRows({
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
      resolvedManualState: "idle",
    },
    dynamicPriceSamples: createDynamicPriceSamples([
      [createReplayTime("2026-04-21", "05:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "06:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "07:00").toISOString(), 0.3],
      [createReplayTime("2026-04-21", "08:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "09:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "10:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "11:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "12:00").toISOString(), 0.1],
      [createReplayTime("2026-04-21", "13:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "14:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "15:00").toISOString(), 0.2],
      [createReplayTime("2026-04-21", "16:00").toISOString(), 0.2],
    ]),
    currentExpectedSolarSurplus: {
      eligible: false,
      expectedHouseLoadW: 500,
      minimumSolarSurplusW: 50,
      periodStart: createReplayTime("2026-04-21", "08:00").toISOString(),
      predictedSolarW: 0,
      skipReason:
        "skipped: delayed-charge prep needs current expected solar above expected house load by 50W, but predicted solar is 0W and expected house load is 500W",
      surplusW: -500,
    },
    minimumSolarSurplusWOverride: 50,
    normalizedImportExportSpread: 0.13,
    referenceTime,
    reserveTargetPercent: 12,
    selectedMarkerTime: createReplayTime("2026-04-21", "08:00"),
    siteId: "site-1",
    siteName: "Home",
    strategyTriggerKind: "delayed-charge-prep",
    verboseBlocks: new Set(),
  });

  expect(rows).toContainEqual({
    label: "Prep Trigger",
    value: "2026-04-21 08:00",
  });
  expect(rows).toContainEqual({
    label: "Paired Low Price Marker",
    value: "2026-04-21 11:00 at 0.200 EUR/kWh",
  });
  expect(rows).toContainEqual({
    label: "Prep Status",
    value: "blocked",
  });
  expect(rows).toContainEqual({
    label: "Prep Block Reason",
    value:
      "skipped: delayed-charge prep needs current expected solar above expected house load by 50W, but predicted solar is 0W and expected house load is 500W",
  });
});

test("buildEstimateSummaryRows keeps import-shortage output concise and strategy-specific", () => {
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
        estimatedRemainingEnergyWh: 1800,
        estimatedReservePercentAtTargetTime: 40,
        estimatedTargetPercent: 70,
        importShortageDetails: {
          bufferPercent: 12,
          currentSocPercent: 40,
          effectiveChargePowerW: 1200,
          energyToImportWh: 1800,
          expectedHouseLoadBeforeSurplusWh: 400,
          expectedHouseLoadDuringSurplusWh: 1380,
          expectedHouseLoadUntilSurplusEndWh: 1780,
          expectedNetDemandBeforeSurplusPercent: 5,
          expectedNetDemandBeforeSurplusWh: 300,
          expectedNetSolarRecoveryPercent: 47,
          expectedNetSolarRecoveryWh: 2820,
          expectedNetSolarSurplusPercent: 42,
          expectedNetSolarSurplusWh: 2520,
          expectedSolarGenerationBeforeSurplusWh: 100,
          expectedSolarGenerationDuringSurplusWh: 4200,
          expectedSolarGenerationUntilSurplusEndWh: 4300,
          lowPriceMarkerTime: createReplayTime(
            "2026-04-22",
            "07:00",
          ).toISOString(),
          projectedEndSocWithoutImportPercent: 82,
          projectedSurplusStartSocPercent: 35,
          requiredChargeMinutes: 90,
          baseTargetSocPercent: 58,
          shortageToFullPercent: 18,
          solarSurplusStartTime: createReplayTime(
            "2026-04-22",
            "09:00",
          ).toISOString(),
          solarSurplusEndTime: createReplayTime(
            "2026-04-22",
            "17:00",
          ).toISOString(),
          targetSocPercent: 70,
          triggerLeadTimeMinutes: 108,
          triggerMarginFactor: 1.2,
        },
        resolvedManualState: "charging",
        startTime: createReplayTime("2026-04-22", "05:12").toISOString(),
        targetTime: createReplayTime("2026-04-22", "07:00").toISOString(),
      },
      minimumSolarSurplusWOverride: 50,
      referenceTime: createReplayTime("2026-04-22", "07:00"),
      reserveTargetPercent: 12,
      siteId: "site-1",
      siteName: "Home",
      strategyTriggerKind: "import-shortage",
      verboseBlocks: new Set(),
    }),
  ).toEqual([
    { label: "Evaluated At", value: "2026-04-22 07:00" },
    { label: "Selected Marker", value: "not available" },
    {
      label: "Import Price Marker",
      value:
        "2026-04-22 07:00 low import-price marker used to schedule any cheap grid top-up",
    },
    {
      label: "Solar Surplus Window",
      value: "2026-04-22 09:00 -> 2026-04-22 17:00",
    },
    {
      label: "Projection",
      value:
        "40% now -> 35% by solar surplus start after 300 Wh (5%) house-load gap; then +47% solar recovery to 82% by surplus end",
    },
    {
      label: "Decision",
      value:
        "need 18% more; target = 40% current + 18% shortage + 12% buffer = 70%",
    },
    { label: "Energy To Import", value: "1800 Wh at 1200 W" },
    { label: "Start", value: "2026-04-22 05:12 (1h 48m before marker)" },
  ]);
});

test("buildEstimateSummaryRows shows skipped export-surplus status", () => {
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
      dynamicPriceTargetEstimate: {
        ...createEstimate(),
        skipReason:
          "skipped: next morning high-price marker 2026-04-22 08:00 has higher export price 0.180 EUR/kWh than afternoon high-price marker 2026-04-21 19:45 at 0.150 EUR/kWh",
      },
      minimumSolarSurplusWOverride: 50,
      referenceTime: createReplayTime("2026-04-21", "19:45"),
      reserveTargetPercent: 12,
      siteId: "site-1",
      siteName: "Home",
      strategyTriggerKind: "export-surplus",
      verboseBlocks: new Set(),
    }),
  ).toEqual([
    { label: "Evaluated At", value: "2026-04-21 19:45" },
    { label: "Selected Marker", value: "not available" },
    { label: "Action", value: "discharge" },
    { label: "Status", value: "skipped" },
    {
      label: "Reason",
      value:
        "skipped: next morning high-price marker 2026-04-22 08:00 has higher export price 0.180 EUR/kWh than afternoon high-price marker 2026-04-21 19:45 at 0.150 EUR/kWh",
    },
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

function createImportShortageItem(): BatteryStrategyPlanItem {
  return {
    ...createLowPriceAutoItem(),
    id: "import-shortage-item",
    triggerKind: BatteryStrategyTriggerKind.ImportShortage,
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
