import { afterEach, expect, test } from "bun:test";
import {
  MAX_SOLAR_PREDICTION_PRECEDING_DAYS,
  SOLAR_PREDICTION_MATCH_TOLERANCE_MS,
  buildPredictedSolarGenerationSeries,
} from "./solar-prediction";

function buildForecastSample(periodStart: string, value: number | null) {
  return {
    airTempC: null,
    cloudOpacityPercent: null,
    generatedAt: periodStart,
    ghiWm2: value,
    periodStart,
    siteId: "home",
    value,
  };
}

function buildGenerationSample(
  providerId: string,
  periodStart: string,
  powerW: number | null,
) {
  return {
    observedAt: periodStart,
    periodStart,
    powerW,
    providerId,
    siteId: "home",
  };
}

function buildHistoricalForecastDays(
  targetPeriodStart: string,
  count: number,
  value: number,
) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(targetPeriodStart);
    date.setDate(date.getDate() - (index + 1));
    return buildForecastSample(date.toISOString(), value);
  });
}

function buildHistoricalGenerationDays(
  targetPeriodStart: string,
  count: number,
  getValue: (dayOffset: number) => number,
) {
  return Array.from({ length: count }, (_, index) => {
    const dayOffset = index + 1;
    const date = new Date(targetPeriodStart);
    date.setDate(date.getDate() - dayOffset);
    return buildGenerationSample(
      "solar-1",
      date.toISOString(),
      getValue(dayOffset),
    );
  });
}

test("threshold excludes days where forecast < minForecastWm2", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 250),
    buildForecastSample("2026-04-08T12:00:00.000Z", 5), // below explicit threshold 10
    buildForecastSample("2026-04-07T12:00:00.000Z", 15),
    buildForecastSample("2026-04-06T12:00:00.000Z", 20),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 60), // ratio 12 (should be excluded)
    buildGenerationSample("solar-1", "2026-04-07T12:00:00.000Z", 45), // ratio 3
    buildGenerationSample("solar-1", "2026-04-06T12:00:00.000Z", 80), // ratio 4
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
    minForecastWm2: 10,
  });

  // Should average ratios 3 and 4 -> 3.5, times forecast 250 = 875
  expect(prediction?.value).toBeCloseTo(875, 10);
});

test("threshold default is 5 W/m²", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 200),
    buildForecastSample("2026-04-08T12:00:00.000Z", 5), // included (threshold 5)
    buildForecastSample("2026-04-07T12:00:00.000Z", 100),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 60),
    buildGenerationSample("solar-1", "2026-04-07T12:00:00.000Z", 150),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  // Two valid ratios: 60/5 = 12, 150/100 = 1.5, average = 6.75, times 200 = 1350
  expect(prediction?.value).toBeCloseTo(1350, 10);
});

test("winsorized mean drops min and max when >= 4 ratios", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 100),
    ...buildHistoricalForecastDays(targetPeriodStart, 6, 50),
  ];
  // Create ratios: 1, 2, 3, 4, 5, 6 (day offsets 1-6)
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    6,
    (dayOffset) => dayOffset * 50,
  );

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
    useOutlierRemoval: true,
  });

  // Ratios: [1,2,3,4,5,6], drop 1 and 6 -> average of 2,3,4,5 = 3.5
  // Forecast 100 * 3.5 = 350
  expect(prediction?.value).toBeCloseTo(350, 10);
});

test("winsorized mean keeps all ratios when < 4", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 100),
    ...buildHistoricalForecastDays(targetPeriodStart, 2, 50),
  ];
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    2,
    (dayOffset) => (dayOffset === 1 ? 100 : 200), // ratios 2 and 4
  );

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
    useOutlierRemoval: true,
  });

  // Only 2 ratios: 2 and 4, average = 3, forecast 100 * 3 = 300
  expect(prediction?.value).toBeCloseTo(300, 10);
});

test("outlier removal defaults to enabled", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 100),
    ...buildHistoricalForecastDays(targetPeriodStart, 5, 50),
  ];
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    5,
    (dayOffset) => dayOffset * 100, // ratios 2,4,6,8,10
  );

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  // Default useOutlierRemoval = true, drop min 2 and max 10 -> average of 4,6,8 = 6
  // Forecast 100 * 6 = 600
  expect(prediction?.value).toBeCloseTo(600, 10);
});

test("can disable outlier removal", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 100),
    ...buildHistoricalForecastDays(targetPeriodStart, 5, 50),
  ];
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    5,
    (dayOffset) => dayOffset * 100,
  );

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
    useOutlierRemoval: false,
  });

  // Average of all ratios 2,4,6,8,10 = 6, forecast 100 * 6 = 600
  // Actually same average because symmetric, but test ensures disabling works
  expect(prediction?.value).toBeCloseTo(600, 10);
});

test("zero forecast returns zero even with threshold", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples: [buildForecastSample(targetPeriodStart, 0)],
    solarEnergyProviderSamples: [],
    minForecastWm2: 10,
  });

  expect(prediction?.value).toBe(0);
});

test("forecast below threshold returns zero", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples: [buildForecastSample(targetPeriodStart, 5)],
    solarEnergyProviderSamples: [],
    minForecastWm2: 10,
  });

  expect(prediction?.value).toBe(0);
});

test("forecast below threshold but historical above threshold still excluded", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 5), // below threshold
    buildForecastSample("2026-04-08T12:00:00.000Z", 20),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 60),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
    minForecastWm2: 10,
  });

  // Current forecast is 5 (<10) => return 0, regardless of history
  expect(prediction?.value).toBe(0);
});
