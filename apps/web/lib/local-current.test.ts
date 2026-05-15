import { expect, test } from "bun:test";
import type { HistoryArchive } from "@emsd/core";
import { computeDerivedMarkers } from "./local-current";

test("computeDerivedMarkers returns today's price and solar surplus markers", () => {
  const now = new Date(2026, 3, 19, 12, 0, 0);
  const archive: HistoryArchive = {
    batteryPowerSamples: [],
    batteryStrategyPlansByBatteryId: {},
    batteryStrategyHistory: [],
    dynamicPriceSamples: [
      dynamicPriceSample(8, 0.2),
      dynamicPriceSample(10, 0.05),
      dynamicPriceSample(12, 0.18),
      dynamicPriceSample(14, 0.25),
      dynamicPriceSample(16, 0.12),
    ],
    p1MeterSamples: [],
    selectedDayExpectedSiteLoadSamples: [
      { periodStart: localIso(9), value: 200 },
      { periodStart: localIso(10), value: 200 },
      { periodStart: localIso(11), value: 200 },
      { periodStart: localIso(12), value: 200 },
      { periodStart: localIso(13), value: 200 },
    ],
    selectedDayKey: "2026-04-19",
    selectedDaySiteLoadSamples: [],
    siteId: "home",
    solarEnergyProviderSamples: [],
    solarForecastSamples: [],
    solarPredictedGeneration: [
      { periodStart: localIso(9), value: 100 },
      { periodStart: localIso(10), value: 300 },
      { periodStart: localIso(11), value: 500 },
      { periodStart: localIso(12), value: 200 },
      { periodStart: localIso(13), value: 50 },
    ],
    solarPredictionAlgorithmVersion: "v2",
  };

  const markers = computeDerivedMarkers({ archive, now });

  expect(markers.todayLowPriceMarkerStartsAt).toBe(localIso(10));
  expect(markers.todayLowPriceMarkerImportPrice).toBe(0.05);
  expect(markers.todayHighPriceMarkerStartsAt).toBe(localIso(14));
  expect(markers.todayHighPriceMarkerImportPrice).toBe(0.25);
  expect(markers.solarSurplusStartAt).toBe(localIso(10));
  expect(markers.solarSurplusEndAt).toBe(localIso(12));
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
