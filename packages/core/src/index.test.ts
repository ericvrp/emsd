import { afterEach, expect, test } from "bun:test";
import {
  MAX_SOLAR_PREDICTION_PRECEDING_DAYS,
  SOLAR_PREDICTION_MATCH_TOLERANCE_MS,
  buildPredictedSolarGenerationSeries,
  createBatteryStrategyRuntimeForPlanApply,
  discoverReportJsonSchema,
  getDatabasePath,
  normalizeBatteryStrategyPlan,
  parseGpsCoordinate,
} from "./index";

const originalPath = process.env.EMSD_DB_PATH;

afterEach(() => {
  if (originalPath === undefined) {
    process.env.EMSD_DB_PATH = undefined;
    return;
  }

  process.env.EMSD_DB_PATH = originalPath;
});

test("getDatabasePath resolves repo-relative paths", () => {
  process.env.EMSD_DB_PATH = "data/test.sqlite";

  expect(getDatabasePath()).toEndWith("data/test.sqlite");
});

test("discoverReportJsonSchema exposes the discover report contract", () => {
  expect(discoverReportJsonSchema.properties.schema.const).toBe(
    "emsd.discover.report.v1",
  );
  expect(discoverReportJsonSchema.properties.devices.items.required).toContain(
    "discoveryId",
  );
});

test("parseGpsCoordinate parses normalized latitude longitude pairs", () => {
  expect(parseGpsCoordinate("52.367600, 4.904100")).toEqual({
    latitude: 52.3676,
    longitude: 4.9041,
  });
  expect(parseGpsCoordinate("invalid")).toBeNull();
  expect(parseGpsCoordinate("91, 4.9")).toBeNull();
});

test("createBatteryStrategyRuntimeForPlanApply marks earlier same-day items as triggered", () => {
  const runtime = createBatteryStrategyRuntimeForPlanApply(
    [
      {
        enabled: true,
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      },
      {
        enabled: true,
        id: "morning",
        kind: "daily",
        startTime: "07:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 40,
        manualTargetSoc: 40,
      },
      {
        enabled: true,
        id: "evening",
        kind: "daily",
        startTime: "21:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 20,
        manualTargetSoc: 20,
      },
    ],
    new Date("2026-04-09T15:00:00.000Z"),
  );

  expect(runtime.activeItemId).toBeNull();
  expect(runtime.activeStartedAt).toBeNull();
  expect(runtime.activeObservedAt).toBeNull();
  expect(Object.keys(runtime.lastTriggeredAtByItemId)).toEqual(["morning"]);
  expect(runtime.lastTriggeredAtByItemId.morning).toContain("T07:00:00.000");
});

test("createBatteryStrategyRuntimeForPlanApply keeps same-time items pending", () => {
  const runtime = createBatteryStrategyRuntimeForPlanApply(
    [
      {
        enabled: true,
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      },
      {
        enabled: true,
        id: "start-now",
        kind: "daily",
        startTime: "15:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 40,
        manualTargetSoc: 40,
      },
    ],
    new Date("2026-04-09T15:00:00.000Z"),
  );

  expect(runtime.lastTriggeredAtByItemId).toEqual({});
});

test("normalizeBatteryStrategyPlan defaults idle percentage targets to minimum discharge", () => {
  const normalized = normalizeBatteryStrategyPlan({
    minimumDischargePercent: 20,
    strategy: {
      strategyMode: "self-consumption",
      manualState: null,
      manualPowerW: null,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: 20,
      manualTargetSoc: 100,
    },
    value: [
      {
        enabled: true,
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 20,
        manualTargetSoc: 100,
      },
      {
        enabled: true,
        id: "idle-window",
        kind: "daily",
        startTime: "08:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "idle",
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: null,
      },
    ],
  });

  expect(normalized[1]?.manualTargetSoc).toBe(20);
});

test("normalizeBatteryStrategyPlan accepts low and high price triggers and drops removed placeholders", () => {
  const normalized = normalizeBatteryStrategyPlan({
    minimumDischargePercent: 20,
    strategy: {
      strategyMode: "self-consumption",
      manualState: null,
      manualPowerW: null,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: 20,
      manualTargetSoc: 100,
    },
    value: [
      {
        enabled: true,
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 20,
        manualTargetSoc: 100,
      },
      {
        enabled: true,
        id: "low",
        kind: "daily",
        startTime: "08:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "low-price",
        strategyMode: "manual",
        manualState: "idle",
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: 20,
      },
      {
        enabled: true,
        id: "high",
        kind: "daily",
        startTime: "08:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "high-price",
        strategyMode: "manual",
        manualState: "idle",
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: 20,
      },
      {
        enabled: true,
        id: "legacy",
        kind: "daily",
        startTime: "08:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "dynamic-price",
        strategyMode: "manual",
        manualState: "idle",
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: 20,
      },
    ],
  });

  expect(normalized[1]?.triggerKind).toBe("low-price");
  expect(normalized[2]?.triggerKind).toBe("high-price");
  expect(normalized[3]?.triggerKind).toBe("daily-time");
});

test("normalizeBatteryStrategyPlan defaults enabled to true", () => {
  const normalized = normalizeBatteryStrategyPlan({
    minimumDischargePercent: 20,
    strategy: {
      strategyMode: "self-consumption",
      manualState: null,
      manualPowerW: null,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: 20,
      manualTargetSoc: 100,
    },
    value: [
      {
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 20,
        manualTargetSoc: 100,
      },
      {
        id: "daily",
        kind: "daily",
        startTime: "08:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "idle",
        manualPowerW: null,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: null,
        manualTargetSoc: 20,
      },
    ],
  });

  expect(normalized[0]?.enabled).toBe(true);
  expect(normalized[1]?.enabled).toBe(true);
});

test("buildPredictedSolarGenerationSeries uses the current v2 predictor over preceding days", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const currentForecastWm2 = 250;
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, currentForecastWm2),
    ...buildHistoricalForecastDays(targetPeriodStart, 9, 100),
  ];
  const solarEnergyProviderSamples = [
    ...buildHistoricalGenerationDays(targetPeriodStart, 9, (dayOffset) =>
      dayOffset <= MAX_SOLAR_PREDICTION_PRECEDING_DAYS ? 100 + dayOffset : 999,
    ),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction?.periodStart).toBe(targetPeriodStart);
  expect(prediction?.value).toBeCloseTo(256.873278, 6);
});

test("buildPredictedSolarGenerationSeries matches the closest timestamps within tolerance", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 200),
    buildForecastSample("2026-04-08T12:06:00.000Z", 100),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T11:54:00.000Z", 150),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction).toEqual({
    periodStart: targetPeriodStart,
    value: 150,
  });
});

test("buildPredictedSolarGenerationSeries rejects samples outside the match tolerance", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 200),
    buildForecastSample(
      new Date(
        new Date("2026-04-08T12:00:00.000Z").getTime() +
          SOLAR_PREDICTION_MATCH_TOLERANCE_MS +
          1,
      ).toISOString(),
      100,
    ),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 150),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction).toEqual({
    periodStart: targetPeriodStart,
    value: null,
  });
});

test("buildPredictedSolarGenerationSeries aggregates multiple solar providers", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 150),
    buildForecastSample("2026-04-08T12:00:00.000Z", 100),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 90),
    buildGenerationSample("solar-2", "2026-04-08T12:00:00.000Z", 60),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction).toEqual({
    periodStart: targetPeriodStart,
    value: 150,
  });
});

test("buildPredictedSolarGenerationSeries skips zero and missing historical forecasts", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const forecastSamples = [
    buildForecastSample(targetPeriodStart, 200),
    buildForecastSample("2026-04-08T12:00:00.000Z", 0),
    buildForecastSample("2026-04-07T12:00:00.000Z", null),
    buildForecastSample("2026-04-06T12:00:00.000Z", 100),
  ];
  const solarEnergyProviderSamples = [
    buildGenerationSample("solar-1", "2026-04-08T12:00:00.000Z", 120),
    buildGenerationSample("solar-1", "2026-04-07T12:00:00.000Z", 120),
    buildGenerationSample("solar-1", "2026-04-06T12:00:00.000Z", 150),
  ];

  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples,
    solarEnergyProviderSamples,
  });

  expect(prediction).toEqual({
    periodStart: targetPeriodStart,
    value: 150,
  });
});

test("buildPredictedSolarGenerationSeries returns zero for a zero current forecast", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples: [buildForecastSample(targetPeriodStart, 0)],
    solarEnergyProviderSamples: [],
  });

  expect(prediction).toEqual({
    periodStart: targetPeriodStart,
    value: 0,
  });
});

test("buildPredictedSolarGenerationSeries returns null when no usable history exists", () => {
  const targetPeriodStart = "2026-04-09T12:00:00.000Z";
  const [prediction] = buildPredictedSolarGenerationSeries({
    forecastSamples: [buildForecastSample(targetPeriodStart, 180)],
    solarEnergyProviderSamples: [],
  });

  expect(prediction).toEqual({
    periodStart: targetPeriodStart,
    value: null,
  });
});

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
