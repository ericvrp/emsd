import { expect, test } from "bun:test";
import type { HistoryArchive } from "@emsd/core";
import { computeDerivedMarkers } from "./local-current";

test("computeDerivedMarkers returns today's price and solar surplus markers", () => {
  const now = new Date(2026, 3, 19, 10, 0, 0);
  const archive: HistoryArchive = {
    batteryPowerSamples: [],
    batteryStrategyPlansByBatteryId: {},
    batteryStrategyHistory: [],
    dynamicPriceSamples: [
      dynamicPriceSample(6, 0.3),
      dynamicPriceSample(7, 0.2),
      dynamicPriceSample(8, 0.14),
      dynamicPriceSample(9, 0.1),
      dynamicPriceSample(10, 0.06),
      dynamicPriceSample(11, 0.12),
      dynamicPriceSample(12, 0.18),
      dynamicPriceSample(13, 0.25),
      dynamicPriceSample(14, 0.22),
    ],
    p1MeterSamples: [],
    selectedDayExpectedSiteLoadSamples: [
      { periodStart: localIso(8), value: 200 },
      { periodStart: localIso(9), value: 200 },
      { periodStart: localIso(10), value: 200 },
      { periodStart: localIso(11), value: 200 },
      { periodStart: localIso(12), value: 200 },
      { periodStart: localIso(13), value: 200 },
      { periodStart: localIso(14), value: 200 },
    ],
    selectedDayKey: "2026-04-19",
    selectedDaySiteLoadSamples: [],
    siteId: "home",
    solarEnergyProviderSamples: [],
    solarForecastSamples: [],
    solarPredictedGeneration: [
      { periodStart: localIso(8), value: 100 },
      { periodStart: localIso(9), value: 200 },
      { periodStart: localIso(10), value: 400 },
      { periodStart: localIso(11), value: 500 },
      { periodStart: localIso(12), value: 300 },
      { periodStart: localIso(13), value: 100 },
      { periodStart: localIso(14), value: 0 },
    ],
    solarPredictionAlgorithmVersion: "v2",
  };

  const markers = computeDerivedMarkers({ archive, now });

  expect(markers.todayLowPriceMarkerStartsAt).toBe(localIso(10));
  expect(markers.todayLowPriceMarkerImportPrice).toBe(0.06);
  expect(markers.todayHighPriceMarkerStartsAt).toBe(localIso(13));
  expect(markers.todayHighPriceMarkerImportPrice).toBe(0.25);
  expect(markers.solarSurplusStartAt).toBe(localIso(10));
  expect(markers.solarSurplusEndAt).toBe(localIso(13));
});

function localIso(hour: number): string {
  return new Date(2026, 3, 19, hour, 0, 0).toISOString();
}

function dynamicPriceSample(hour: number, importPrice: number) {
  return {
    siteId: "home",
    periodStart: localIso(hour),
    generatedAt: localIso(0),
    currency: "EUR",
    importPrice,
  };
}
