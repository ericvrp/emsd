import {
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  applySolarSeriesSmoothing,
  buildPredictedSolarGenerationSeries,
  type BatteryPowerSampleRecord,
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  type DynamicPriceSampleRecord,
  type NormalizedBatteryInfo,
  type P1MeterSampleRecord,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
} from "@emsd/core";
import { getNextStrategyTriggerAt } from "./strategy-scheduler";

const HISTORY_LOOKBACK_DAYS = 7;
const MAX_SAME_WEEKDAY_MATCHES = 4;
const DEFAULT_PERIOD_MINUTES = 15;
const EVENING_TARGET_TIME_RESERVE_BUFFER_PERCENT = 1;
const MIN_STRONG_SOLAR_RECOVERY_W = 150;
const SOC_DIRECTION_EPSILON_PERCENT = 0.05;

export interface StrategyEstimate {
  availability: "full" | "partial" | "unavailable";
  breakEvenTrace: Array<{
    expectedHouseLoadW: number | null;
    meetsBreakEven: boolean;
    predictedSolarW: number | null;
    recoveryThresholdW: number | null;
    time: string;
  }>;
  estimatedRemainingEnergyWh: number;
  estimatedReservePercentAtTargetTime: number;
  estimatedTargetPercent: number;
  expectedHouseLoadWh: number;
  historyStats: {
    historicalPeriodsUsed: number;
    sameWeekdayPeriodsUsed: number;
    slotCount: number;
  };
  predictedSolarGenerationWh: number;
  reasoning: string;
  targetTime: string | null;
  targetTimeSignal: {
    expectedHouseLoadW: number | null;
    predictedSolarW: number | null;
    recoveryThresholdW: number | null;
  } | null;
  windowKind: "general" | "morning-high-price" | "evening-high-price";
}

interface LoadProfile {
  expectedLoadBySlot: Map<string, number>;
  historicalPeriodsUsed: number;
  sameWeekdayPeriodsUsed: number;
}

interface SolarRecoverySignal {
  expectedHouseLoadW: number | null;
  predictedSolarW: number;
  recoveryThresholdW: number;
  time: Date;
}

interface BreakEvenTraceRow {
  expectedHouseLoadW: number | null;
  meetsBreakEven: boolean;
  predictedSolarW: number | null;
  recoveryThresholdW: number | null;
  time: string;
}

export function estimateStrategyTarget(input: {
  battery: BatteryRecord;
  batteryPowerSamples: BatteryPowerSampleRecord[];
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  items: BatteryStrategyPlanItem[];
  item: BatteryStrategyPlanItem;
  now: Date;
  p1MeterSamples: P1MeterSampleRecord[];
  sample: NormalizedBatteryInfo;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  solarForecastSamples: SolarForecastSampleRecord[];
}): StrategyEstimate {
  const fallbackTargetPercent = getFallbackTargetPercent(input);
  const fallbackTargetTime = getFallbackTargetTime(input);

  if (input.item.targetMethod !== "auto") {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: 0,
        sameWeekdayPeriodsUsed: 0,
        slotCount: 0,
      },
      predictedSolarGenerationWh: 0,
      reasoning: "a fixed target method is configured",
      targetTime: fallbackTargetTime,
      targetTimeSignal: null,
      windowKind: "general",
    };
  }

  const predictedSeries = buildPredictedSeries(
    input.solarForecastSamples,
    input.solarEnergyProviderSamples,
  );
  const historySeries = buildHouseLoadHistorySeries({
    batteryPowerSamples: input.batteryPowerSamples,
    p1MeterSamples: input.p1MeterSamples,
    solarEnergyProviderSamples: input.solarEnergyProviderSamples,
  });
  const loadProfile = buildExpectedLoadBySlot(historySeries, input.now);
  const windowKind = getWindowKind(input.item, input.now);
  const solarRecoverySignal = findSolarRecoveryTime({
    now: input.now,
    predictedSeries,
    expectedLoadBySlot: loadProfile.expectedLoadBySlot,
  });
  const targetTime = resolveTargetTime({
    dynamicPriceSamples: input.dynamicPriceSamples,
    item: input.item,
    items: input.items,
    now: input.now,
    solarRecoveryTime: solarRecoverySignal?.time ?? null,
    windowKind,
  });

  if (input.sample.capacityWh === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
        sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
        slotCount: loadProfile.expectedLoadBySlot.size,
      },
      predictedSolarGenerationWh: 0,
      reasoning: "battery capacity is unavailable",
      targetTime: targetTime?.toISOString() ?? fallbackTargetTime,
      targetTimeSignal: serializeSolarRecoverySignal(solarRecoverySignal),
      windowKind,
    };
  }

  if (targetTime === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
        sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
        slotCount: loadProfile.expectedLoadBySlot.size,
      },
      predictedSolarGenerationWh: 0,
      reasoning: "no target horizon could be determined",
      targetTime: fallbackTargetTime,
      targetTimeSignal: serializeSolarRecoverySignal(solarRecoverySignal),
      windowKind,
    };
  }

  const forecastPeriods = predictedSeries.filter((point) => {
    const periodStartMs = new Date(point.periodStart).getTime();
    return (
      !Number.isNaN(periodStartMs) &&
      periodStartMs >= input.now.getTime() &&
      periodStartMs < targetTime.getTime()
    );
  });

  const periodHours = resolvePeriodHours(input.solarForecastSamples);
  const expectedHouseLoadWh = round2(
    forecastPeriods.reduce((total, point) => {
      return total + resolveExpectedHouseLoadWh(point.periodStart, loadProfile.expectedLoadBySlot, periodHours);
    }, 0),
  );
  const predictedSolarGenerationWh = round2(
    forecastPeriods.reduce((total, point) => {
      const predictedPowerW = typeof point.value === "number" ? Math.max(0, point.value) : 0;
      return total + predictedPowerW * periodHours;
    }, 0),
  );
  const estimatedRemainingEnergyWh = round2(
    Math.max(0, expectedHouseLoadWh - predictedSolarGenerationWh),
  );
  const estimatedReservePercentAtTargetTime = getEstimatedReservePercentAtTargetTime(
    input.battery.minimumDischargePercent,
    windowKind,
  );
  const estimatedTargetPercent = clampPercent(
    estimatedReservePercentAtTargetTime +
      Math.ceil(
        (estimatedRemainingEnergyWh / Math.max(1, input.sample.capacityWh)) * 100,
      ),
    input.battery.minimumDischargePercent,
  );
  const availability =
    forecastPeriods.length === 0 || loadProfile.expectedLoadBySlot.size === 0
      ? "partial"
      : "full";
  const breakEvenTrace = buildBreakEvenTrace({
    now: input.now,
    predictedSeries,
    expectedLoadBySlot: loadProfile.expectedLoadBySlot,
    targetTime,
  });

  return {
    availability,
    breakEvenTrace,
    estimatedRemainingEnergyWh,
    estimatedReservePercentAtTargetTime,
    estimatedTargetPercent,
    expectedHouseLoadWh,
    predictedSolarGenerationWh,
    reasoning: buildReasoning({
      availability,
      expectedLoadBySlot: loadProfile.expectedLoadBySlot,
      predictedSolarGenerationWh,
      solarRecoveryTime: solarRecoverySignal?.time ?? null,
    }),
    targetTime: targetTime.toISOString(),
    targetTimeSignal: serializeSolarRecoverySignal(solarRecoverySignal),
    historyStats: {
      historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
      sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
      slotCount: loadProfile.expectedLoadBySlot.size,
    },
    windowKind,
  };
}

type PredictedPoint = { periodStart: string; value: number | null };
type HouseLoadHistoryPoint = { periodStart: string; loadW: number };

function buildPredictedSeries(
  solarForecastSamples: SolarForecastSampleRecord[],
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[],
): PredictedPoint[] {
  return applySolarSeriesSmoothing(
    buildPredictedSolarGenerationSeries({
      forecastSamples: solarForecastSamples,
      solarEnergyProviderSamples,
    }),
    DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  );
}

function buildHouseLoadHistorySeries(input: {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
}): HouseLoadHistoryPoint[] {
  const batteryByPeriod = aggregateSignedBatteryPowerByPeriodStart(
    input.batteryPowerSamples,
  );
  const gridByPeriod = aggregatePowerByPeriodStart(input.p1MeterSamples);
  const solarByPeriod = aggregatePowerByPeriodStart(input.solarEnergyProviderSamples);
  const periodStarts = new Set([
    ...batteryByPeriod.keys(),
    ...gridByPeriod.keys(),
    ...solarByPeriod.keys(),
  ]);

  return [...periodStarts]
    .map((periodStart) => {
      const batteryPowerW = batteryByPeriod.get(periodStart);
      const gridPowerW = gridByPeriod.get(periodStart);
      const solarPowerW = solarByPeriod.get(periodStart);

      if (
        typeof batteryPowerW !== "number" ||
        typeof gridPowerW !== "number" ||
        typeof solarPowerW !== "number"
      ) {
        return null;
      }

      return {
        periodStart,
        loadW: Math.max(0, solarPowerW + gridPowerW - batteryPowerW),
      };
    })
    .filter((point): point is HouseLoadHistoryPoint => point !== null)
    .sort(
      (left, right) =>
        new Date(left.periodStart).getTime() - new Date(right.periodStart).getTime(),
    );
}

function aggregatePowerByPeriodStart(
  samples: Array<{ periodStart: string; powerW: number | null }>,
): Map<string, number> {
  const byPeriod = new Map<string, number>();

  for (const sample of samples) {
    if (typeof sample.powerW !== "number") {
      continue;
    }

    byPeriod.set(sample.periodStart, (byPeriod.get(sample.periodStart) ?? 0) + sample.powerW);
  }

  return byPeriod;
}

function aggregateSignedBatteryPowerByPeriodStart(
  samples: BatteryPowerSampleRecord[],
): Map<string, number> {
  const grouped = new Map<string, BatteryPowerSampleRecord[]>();

  for (const sample of samples) {
    const current = grouped.get(sample.batteryId) ?? [];
    current.push(sample);
    grouped.set(sample.batteryId, current);
  }

  const byPeriod = new Map<string, number>();

  for (const batterySamples of grouped.values()) {
    const sortedSamples = [...batterySamples].sort(
      (left, right) =>
        new Date(left.periodStart).getTime() -
        new Date(right.periodStart).getTime(),
    );

    for (let index = 0; index < sortedSamples.length; index += 1) {
      const current = sortedSamples[index];

      if (!current || typeof current.powerW !== "number") {
        continue;
      }

      const sign = inferBatteryPowerDirection({
        current,
        next: sortedSamples[index + 1] ?? null,
        previous: sortedSamples[index - 1] ?? null,
      });

      if (sign === 0) {
        continue;
      }

      byPeriod.set(
        current.periodStart,
        (byPeriod.get(current.periodStart) ?? 0) + Math.abs(current.powerW) * sign,
      );
    }
  }

  return byPeriod;
}

function inferBatteryPowerDirection(input: {
  current: BatteryPowerSampleRecord;
  next: BatteryPowerSampleRecord | null;
  previous: BatteryPowerSampleRecord | null;
}): -1 | 0 | 1 {
  const nextDirection = inferSocDirection(
    input.current.socPercent,
    input.next?.socPercent ?? null,
  );

  if (nextDirection !== 0) {
    return nextDirection;
  }

  return inferSocDirection(
    input.previous?.socPercent ?? null,
    input.current.socPercent,
  );
}

function inferSocDirection(
  beforeSocPercent: number | null,
  afterSocPercent: number | null,
): -1 | 0 | 1 {
  if (
    typeof beforeSocPercent !== "number" ||
    typeof afterSocPercent !== "number"
  ) {
    return 0;
  }

  const delta = afterSocPercent - beforeSocPercent;

  if (delta > SOC_DIRECTION_EPSILON_PERCENT) {
    return 1;
  }

  if (delta < -SOC_DIRECTION_EPSILON_PERCENT) {
    return -1;
  }

  return 0;
}

function buildExpectedLoadBySlot(
  historySeries: HouseLoadHistoryPoint[],
  now: Date,
): LoadProfile {
  const lookbackStartMs = now.getTime() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const todayWeekday = now.getDay();
  const sameWeekdayCounts = new Map<string, number>();
  const buckets = new Map<string, number[]>();
  let historicalPeriodsUsed = 0;
  let sameWeekdayPeriodsUsed = 0;

  for (const point of historySeries) {
    const pointDate = new Date(point.periodStart);
    const pointMs = pointDate.getTime();

    if (Number.isNaN(pointMs) || pointMs < lookbackStartMs || pointMs >= now.getTime()) {
      continue;
    }

    const slotKey = getSlotKey(pointDate);
    const values = buckets.get(slotKey) ?? [];
    values.push(point.loadW);
    buckets.set(slotKey, values);
    historicalPeriodsUsed += 1;

    if (pointDate.getDay() !== todayWeekday) {
      continue;
    }

    const usedMatches = sameWeekdayCounts.get(slotKey) ?? 0;

    if (usedMatches >= MAX_SAME_WEEKDAY_MATCHES) {
      continue;
    }

    values.push(point.loadW);
    sameWeekdayCounts.set(slotKey, usedMatches + 1);
    sameWeekdayPeriodsUsed += 1;
  }

  const rawExpectedLoadBySlot = new Map(
    [...buckets.entries()].map(([slotKey, values]) => [slotKey, round2(median(values))]),
  );

  return {
    expectedLoadBySlot: smoothExpectedLoadBySlot(rawExpectedLoadBySlot),
    historicalPeriodsUsed,
    sameWeekdayPeriodsUsed,
  };
}

function findSolarRecoveryTime(input: {
  now: Date;
  predictedSeries: PredictedPoint[];
  expectedLoadBySlot: Map<string, number>;
}): SolarRecoverySignal | null {
  const earliestRecoveryAt = input.now;

  for (const point of input.predictedSeries) {
    const pointDate = new Date(point.periodStart);
    const pointMs = pointDate.getTime();

    if (Number.isNaN(pointMs) || pointMs < earliestRecoveryAt.getTime()) {
      continue;
    }

    const expectedLoadW =
      input.expectedLoadBySlot.get(getSlotKey(pointDate)) ?? input.expectedLoadBySlot.get("fallback") ?? null;
    const predictedPowerW = typeof point.value === "number" ? Math.max(0, point.value) : null;
    const requiredRecoveryPowerW =
      expectedLoadW === null
        ? MIN_STRONG_SOLAR_RECOVERY_W
        : Math.max(expectedLoadW, MIN_STRONG_SOLAR_RECOVERY_W);

    if (
      predictedPowerW !== null &&
      predictedPowerW > requiredRecoveryPowerW
    ) {
      return {
        expectedHouseLoadW: expectedLoadW,
        predictedSolarW: predictedPowerW,
        recoveryThresholdW: requiredRecoveryPowerW,
        time: pointDate,
      };
    }
  }

  return null;
}

function smoothExpectedLoadBySlot(
  rawExpectedLoadBySlot: Map<string, number>,
): Map<string, number> {
  const sortedKeys = [...rawExpectedLoadBySlot.keys()].sort();

  return new Map(
    sortedKeys.map((slotKey, index) => {
      const neighborhoodValues = [-1, 0, 1]
        .map((offset) => sortedKeys[index + offset] ?? null)
        .map((neighborKey) =>
          neighborKey === null ? null : (rawExpectedLoadBySlot.get(neighborKey) ?? null),
        )
        .filter((value): value is number => typeof value === "number");

      return [
        slotKey,
        neighborhoodValues.length === 0 ? 0 : round2(median(neighborhoodValues)),
      ];
    }),
  );
}

function buildBreakEvenTrace(input: {
  now: Date;
  predictedSeries: PredictedPoint[];
  expectedLoadBySlot: Map<string, number>;
  targetTime: Date;
}): BreakEvenTraceRow[] {
  return input.predictedSeries
    .filter((point) => {
      const pointMs = new Date(point.periodStart).getTime();
      return (
        !Number.isNaN(pointMs) &&
        pointMs >= input.now.getTime() &&
        pointMs <= input.targetTime.getTime()
      );
    })
    .map((point) => {
      const pointDate = new Date(point.periodStart);
      const expectedHouseLoadW =
        input.expectedLoadBySlot.get(getSlotKey(pointDate)) ?? null;
      const predictedSolarW =
        typeof point.value === "number" ? Math.max(0, point.value) : null;
      const recoveryThresholdW =
        expectedHouseLoadW === null
          ? MIN_STRONG_SOLAR_RECOVERY_W
          : Math.max(expectedHouseLoadW, MIN_STRONG_SOLAR_RECOVERY_W);

      return {
        expectedHouseLoadW,
        meetsBreakEven:
          predictedSolarW !== null && predictedSolarW > recoveryThresholdW,
        predictedSolarW,
        recoveryThresholdW,
        time: pointDate.toISOString(),
      };
    });
}

function serializeSolarRecoverySignal(
  signal: SolarRecoverySignal | null,
): StrategyEstimate["targetTimeSignal"] {
  if (signal === null) {
    return null;
  }

  return {
    expectedHouseLoadW: signal.expectedHouseLoadW,
    predictedSolarW: signal.predictedSolarW,
    recoveryThresholdW: signal.recoveryThresholdW,
  };
}

function resolveTargetTime(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  items: BatteryStrategyPlanItem[];
  now: Date;
  solarRecoveryTime: Date | null;
  windowKind: StrategyEstimate["windowKind"];
}): Date | null {
  const nextScheduleBoundary = getNextScheduleBoundary(input);

  if (input.item.targetMethod === "end-time" && input.item.targetEndTime) {
    const endAt = new Date(input.now);
    const [hoursPart, minutesPart] = input.item.targetEndTime.split(":");
    endAt.setHours(Number(hoursPart ?? "0"), Number(minutesPart ?? "0"), 0, 0);

    if (endAt.getTime() <= input.now.getTime()) {
      endAt.setDate(endAt.getDate() + 1);
    }

    return endAt;
  }

  if (input.item.triggerKind === "high-price") {
    if (input.windowKind === "evening-high-price") {
      return input.solarRecoveryTime ?? nextMorningFallback(input.now);
    }

    return input.solarRecoveryTime ?? nextScheduleBoundary ?? todayNoonOrNext(input.now);
  }

  if (input.item.triggerKind === "low-price") {
    return nextScheduleBoundary ?? endOfDay(input.now);
  }

  return nextScheduleBoundary ?? endOfDay(input.now);
}

function getNextScheduleBoundary(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  items: BatteryStrategyPlanItem[];
  now: Date;
}): Date | null {
  const currentIndex = input.items.findIndex((candidate) => candidate.id === input.item.id);
  const laterItems = currentIndex === -1 ? [] : input.items.slice(currentIndex + 1);

  for (const candidate of laterItems) {
    const nextAt = getNextStrategyTriggerAt({
      item: candidate,
      now: input.now,
      ...(input.dynamicPriceSamples.length > 0
        ? { dynamicPriceSamples: input.dynamicPriceSamples }
        : {}),
    });

    if (nextAt !== null && nextAt.getTime() > input.now.getTime()) {
      return nextAt;
    }
  }

  return null;
}

function resolveExpectedHouseLoadWh(
  periodStart: string,
  expectedLoadBySlot: Map<string, number>,
  periodHours: number,
): number {
  const periodDate = new Date(periodStart);
  const expectedLoadW =
    expectedLoadBySlot.get(getSlotKey(periodDate)) ?? expectedLoadBySlot.get("fallback") ?? 0;

  return expectedLoadW * periodHours;
}

function getFallbackTargetPercent(input: {
  battery: BatteryRecord;
  item: BatteryStrategyPlanItem;
}): number {
  if (input.item.manualState === "charging") {
    return 100;
  }

  if (input.item.strategyMode === "self-consumption") {
    return input.battery.minimumDischargePercent;
  }

  return input.battery.minimumDischargePercent;
}

function getFallbackTargetTime(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  items: BatteryStrategyPlanItem[];
  now: Date;
}): string | null {
  return (
    getNextScheduleBoundary(input)?.toISOString() ??
    endOfDay(input.now).toISOString()
  );
}

function getEstimatedReservePercentAtTargetTime(
  minimumDischargePercent: number,
  windowKind: StrategyEstimate["windowKind"],
): number {
  if (windowKind === "general") {
    return minimumDischargePercent;
  }

  return minimumDischargePercent + EVENING_TARGET_TIME_RESERVE_BUFFER_PERCENT;
}

function buildReasoning(input: {
  availability: StrategyEstimate["availability"];
  expectedLoadBySlot: Map<string, number>;
  predictedSolarGenerationWh: number;
  solarRecoveryTime: Date | null;
}): string {
  const parts = [] as string[];

  if (input.solarRecoveryTime !== null) {
    parts.push("expected demand until solar recovery");
  } else {
    parts.push("recent site usage");
  }

  if (input.expectedLoadBySlot.size > 0) {
    parts.push("recent history");
  }

  if (input.predictedSolarGenerationWh > 0) {
    parts.push(
      input.solarRecoveryTime === null
        ? "predicted solar contribution"
        : "predicted solar recovery",
    );
  }

  if (input.availability !== "full") {
    parts.push("partial data");
  }

  return parts.join(", ");
}

function getWindowKind(
  item: BatteryStrategyPlanItem,
  now: Date,
): StrategyEstimate["windowKind"] {
  if (item.triggerKind !== "high-price") {
    return "general";
  }

  return now.getHours() >= 15 ? "evening-high-price" : "morning-high-price";
}

function resolvePeriodHours(samples: SolarForecastSampleRecord[]): number {
  if (samples.length < 2) {
    return DEFAULT_PERIOD_MINUTES / 60;
  }

  const firstMs = new Date(samples[0]?.periodStart ?? "").getTime();
  const secondMs = new Date(samples[1]?.periodStart ?? "").getTime();

  if (Number.isNaN(firstMs) || Number.isNaN(secondMs) || secondMs <= firstMs) {
    return DEFAULT_PERIOD_MINUTES / 60;
  }

  return (secondMs - firstMs) / 3_600_000;
}

function getSlotKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  const middle = sorted[middleIndex];

  if (middle === undefined) {
    return 0;
  }

  if (sorted.length % 2 === 1) {
    return middle;
  }

  const previous = sorted[middleIndex - 1];
  return previous === undefined ? middle : (previous + middle) / 2;
}

function clampPercent(value: number, minimum: number): number {
  return Math.max(minimum, Math.min(100, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function endOfDay(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

function endOfNextDay(now: Date): Date {
  const end = endOfDay(now);
  end.setDate(end.getDate() + 1);
  return end;
}

function todayNoonOrNext(now: Date): Date {
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);

  if (noon.getTime() > now.getTime()) {
    return noon;
  }

  noon.setDate(noon.getDate() + 1);
  return noon;
}

function nextMorningFallback(now: Date): Date {
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(8, 30, 0, 0);
  return fallback;
}
