import { expect, test } from "bun:test";
import type { HistoryArchive } from "@emsd/core";
import { computeDerivedMarkers, computePricing } from "./local-current";

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

test("computePricing exposes export price and import-to-export reduction", () => {
  const pricing = computePricing(
    {
      currency: "EUR",
      exportDeduction: 0.13,
      generatedAt: localIso(0),
      points: [dynamicPriceSample(9, 0.1), dynamicPriceSample(10, 0.2)],
      provider: "tibber",
      providerLabel: "Tibber",
      siteId: "home",
      sourceId: "price-source",
      sourceName: "Tibber",
    },
    new Date(localIso(9)),
  );

  expect(pricing.current).toEqual({
    startsAt: localIso(9),
    importPrice: 0.1,
    exportPrice: -0.03,
    importPriceReduction: 0.13,
    currency: "EUR",
  });
  expect(pricing.upcoming[0]).toEqual({
    startsAt: localIso(10),
    importPrice: 0.2,
    exportPrice: 0.07,
    importPriceReduction: 0.13,
    currency: "EUR",
  });
});

function localIso(hour: number): string {
  return new Date(2026, 3, 19, hour, 0, 0).toISOString();
}

function dynamicPriceSample(hour: number, importPrice: number) {
  return {
    siteId: "home",
    periodStart: localIso(hour),
    startsAt: localIso(hour),
    generatedAt: localIso(0),
    currency: "EUR",
    importPrice,
  };
}
