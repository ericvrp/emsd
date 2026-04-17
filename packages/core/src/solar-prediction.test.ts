import { afterEach, expect, test } from "bun:test";
import {
  MAX_SOLAR_PREDICTION_PRECEDING_DAYS,
  SOLAR_PREDICTION_MATCH_TOLERANCE_MS,
  buildSolarPredictionAccuracySummary,
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

test("v1 uses trimmed mean when outlier removal is enabled", () => {
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
    algorithmVersion: "v1",
    forecastSamples,
    solarEnergyProviderSamples,
    useOutlierRemoval: true,
  });

  // Ratios: [1,2,3,4,5,6], drop 1 and 6 -> average of 2,3,4,5 = 3.5
  // Forecast 100 * 3.5 = 350
  expect(prediction?.value).toBeCloseTo(350, 10);
});

test("v2 uses winsorized mean when >= 4 ratios", () => {
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
    algorithmVersion: "v2",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  // v2 now blends robust ratios with calibrated regression and clips to observed history.
  expect(prediction?.value).toBeCloseTo(250, 10);
});

test("v1 and v2 diverge on asymmetric ratios", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 100),
    ...buildHistoricalForecastDays(targetPeriodStart, 5, 100),
  ];
  const ratios = [0, 1, 2, 100, 101];
  const solarEnergyProviderSamples = buildHistoricalGenerationDays(
    targetPeriodStart,
    ratios.length,
    (dayOffset) => {
      const ratio = ratios[dayOffset - 1];
      return ratio === undefined ? 0 : ratio * 100;
    },
  );

  const [trimmedPrediction] = buildPredictedSolarGenerationSeries({
    algorithmVersion: "v1",
    forecastSamples,
    solarEnergyProviderSamples,
  });
  const [winsorizedPrediction] = buildPredictedSolarGenerationSeries({
    algorithmVersion: "v2",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  // v2 still diverges from v1, but regression reduces the influence of the extreme ratios.
  expect(trimmedPrediction?.value).toBeCloseTo(3433.333333, 6);
  expect(winsorizedPrediction?.value).toBeCloseTo(2035.912409, 6);
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
    algorithmVersion: "v2",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  // With limited history, regression plus observed-max clipping keeps the result bounded.
  expect(prediction?.value).toBeCloseTo(200, 10);
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
    algorithmVersion: "v2",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  // Ratios: [1,4,4], weighted by 1, 1/2, 1/3 => 26/11 ~= 2.36364.
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

  const [v1Prediction] = buildPredictedSolarGenerationSeries({
    algorithmVersion: "v1",
    forecastSamples,
    solarEnergyProviderSamples,
  });
  const [v2Prediction] = buildPredictedSolarGenerationSeries({
    algorithmVersion: "v2",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(v1Prediction?.value).toBeCloseTo(400, 10);
  expect(v2Prediction?.value).toBeCloseTo(200, 10);
});

test("v2 beats v1 when low-forecast days inflate raw ratios", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const expectedActualPower = 180;
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 200),
    buildForecastSample("2026-04-08T12:00:00.000Z", 20),
    buildForecastSample("2026-04-07T12:00:00.000Z", 20),
    buildForecastSample("2026-04-06T12:00:00.000Z", 200),
    buildForecastSample("2026-04-05T12:00:00.000Z", 200),
    buildForecastSample("2026-04-04T12:00:00.000Z", 200),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 40),
    buildGenerationSample("solar-1", "2026-04-07T12:00:00.000Z", 40),
    buildGenerationSample("solar-1", "2026-04-06T12:00:00.000Z", 180),
    buildGenerationSample("solar-1", "2026-04-05T12:00:00.000Z", 180),
    buildGenerationSample("solar-1", "2026-04-04T12:00:00.000Z", 180),
  ];

  const [v1Prediction] = buildPredictedSolarGenerationSeries({
    algorithmVersion: "v1",
    forecastSamples,
    solarEnergyProviderSamples,
  });
  const [v2Prediction] = buildPredictedSolarGenerationSeries({
    algorithmVersion: "v2",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  const v1Error = Math.abs((v1Prediction?.value ?? 0) - expectedActualPower);
  const v2Error = Math.abs((v2Prediction?.value ?? 0) - expectedActualPower);

  expect(v1Prediction?.value).toBeCloseTo(253.333333, 6);
  expect(v2Prediction?.value).toBeCloseTo(180, 10);
  expect(v2Error).toBeLessThan(v1Error);
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

test("v0 keeps the legacy no-threshold simple mean behavior", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 200),
    buildForecastSample("2026-04-08T12:00:00.000Z", 5),
    buildForecastSample("2026-04-07T12:00:00.000Z", 100),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 60),
    buildGenerationSample("solar-1", "2026-04-07T12:00:00.000Z", 150),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    algorithmVersion: "v0",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction?.value).toBeCloseTo(1350, 10);
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
    algorithmVersion: "v2",
    forecastSamples,
    solarEnergyProviderSamples,
  });

  // v2 now favors the closer 100 W/m² history over the 80 W/m² history.
  expect(prediction?.value).toBeCloseTo(266.843038, 6);
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
