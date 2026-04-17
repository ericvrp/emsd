import { expect, test } from "bun:test";
import {
  buildPredictedSolarGenerationSeries,
  buildSolarPredictionAccuracySummary,
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

test("default algorithm is v2 behavior", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 100),
    ...buildHistoricalForecastDays(targetPeriodStart, 6, 50),
  ];
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    6,
    (dayOffset) => dayOffset * 50,
  );

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction?.value).toBeCloseTo(250, 10);
});

test("v2 favors more recent matches than older matches", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 100),
    ...buildHistoricalForecastDays(targetPeriodStart, 3, 100),
  ];
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    3,
    (dayOffset) => (dayOffset === 1 ? 100 : 400),
  );

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction?.value).toBeCloseTo(236.363636, 6);
});

test("v2 clips peak predictions to observed site maximum", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 400),
    ...buildHistoricalForecastDays(targetPeriodStart, 4, 200),
  ];
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    4,
    () => 200,
  );

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction?.value).toBeCloseTo(200, 10);
});

test("v2 ignores low-light history but still tolerates missing periods", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 150),
    buildForecastSample("2026-04-08T12:00:00.000Z", 3),
    buildForecastSample("2026-04-07T12:00:00.000Z", 100),
    buildForecastSample("2026-04-06T12:00:00.000Z", null),
    buildForecastSample("2026-04-05T12:00:00.000Z", 80),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 500),
    buildGenerationSample("solar-1", "2026-04-07T12:00:00.000Z", 200),
    buildGenerationSample("solar-1", "2026-04-06T12:00:00.000Z", 300),
    buildGenerationSample("solar-1", "2026-04-05T12:00:00.000Z", 80),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction?.value).toBeCloseTo(266.843038, 6);
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

test("accuracy summary reports separate energy and timing accuracy", () => {
  const summary = buildSolarPredictionAccuracySummary({
    generatedSeries: [
      { periodStart: "2026-04-09T12:00:00.000Z", value: 1000 },
      { periodStart: "2026-04-09T12:15:00.000Z", value: 1000 },
    ],
    predictedSeries: [
      { periodStart: "2026-04-09T12:00:00.000Z", value: 800 },
      { periodStart: "2026-04-09T12:15:00.000Z", value: 1000 },
    ],
  });

  expect(summary.totalGeneratedWh).toBe(500);
  expect(summary.totalPredictedWh).toBe(450);
  expect(summary.energyDeltaWh).toBe(50);
  expect(summary.energyAccuracyPercentage).toBe(90);
  expect(summary.timingAccuracyPercentage).toBe(90);
  expect(summary.overallAccuracyPercentage).toBe(90);
  expect(summary.scoringPercentage).toBe(90);
});
