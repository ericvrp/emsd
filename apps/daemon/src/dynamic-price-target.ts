import {
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  calculateDynamicReserveFloorPercent,
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
  DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W,
  DYNAMIC_PRICE_TARGET_PERIOD_MINUTES,
  applySolarSeriesSmoothing,
  buildExpectedSiteLoadProfile,
  buildHouseLoadHistorySeries,
  buildPredictedSolarGenerationSeries,
  isLowPriceAutoDischargeItem,
  resolveExpectedSiteLoadW,
  type BatteryPowerSampleRecord,
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  type DynamicPriceSampleRecord,
  type NormalizedBatteryInfo,
  type P1MeterSampleRecord,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
} from "@emsd/core";
import {
  getNextPriceMarkerTriggerAt,
  getNextStrategyTriggerAt,
} from "./strategy-scheduler";

const MIN_SOLAR_SURPLUS_W = DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W;
const DEFAULT_PERIOD_MINUTES = DYNAMIC_PRICE_TARGET_PERIOD_MINUTES;

export interface DynamicPriceTargetEstimate {
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
  resolvedManualState: BatteryStrategyPlanItem["manualState"];
  skipReason: string | null;
  /** Warning message if the estimate encountered unexpected conditions (e.g., invalid target time). */
  warning: string | null;
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
  fallbackLoadW: number;
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

export function estimateDynamicPriceTarget(input: {
  battery: BatteryRecord;
  batteryPowerSamples: BatteryPowerSampleRecord[];
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  items: BatteryStrategyPlanItem[];
  item: BatteryStrategyPlanItem;
  now: Date;
  p1MeterSamples: P1MeterSampleRecord[];
  sample: NormalizedBatteryInfo;
  minimumSolarSurplusWOverride?: number;
  backupReserveMarginOverride?: number;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  solarForecastSamples: SolarForecastSampleRecord[];
  targetBufferPercentPerHourOverride?: number;
}): DynamicPriceTargetEstimate {
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
      resolvedManualState: input.item.manualState,
      skipReason: null,
      predictedSolarGenerationWh: 0,
      reasoning: "a fixed target method is configured",
      targetTime: fallbackTargetTime,
      targetTimeSignal: null,
      warning: null,
      windowKind: "general",
    };
  }

  const predictedSeries = buildPredictedSolarSeries(
    input.solarForecastSamples,
    input.solarEnergyProviderSamples,
  );
  const historySeries = buildHouseLoadHistorySeries({
    batteryPowerSamples: input.batteryPowerSamples,
    p1MeterSamples: input.p1MeterSamples,
    solarEnergyProviderSamples: input.solarEnergyProviderSamples,
  });
  const sharedLoadProfile = buildExpectedSiteLoadProfile(historySeries, input.now);
  const loadProfile: LoadProfile = {
    expectedLoadBySlot: sharedLoadProfile.expectedLoadBySlot,
    fallbackLoadW: sharedLoadProfile.fallbackLoadW,
    historicalPeriodsUsed: sharedLoadProfile.historicalPeriodsUsed,
    sameWeekdayPeriodsUsed: sharedLoadProfile.sameWeekdayPeriodsUsed,
  };
  const isLowPriceAutoDischarge = isLowPriceAutoDischargeItem(input.item);
  const windowKind = getWindowKind(input.item, input.now);
  const solarRecoverySignal = findSolarRecoveryTime({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    now: input.now,
    predictedSeries,
    loadProfile,
  });
  const lowPriceMarkerTime = isLowPriceAutoDischarge
    ? getNextPriceMarkerTriggerAt({
        triggerKind: "low-price",
        now: input.now,
        dynamicPriceSamples: input.dynamicPriceSamples,
      })
    : null;
  const targetTime = resolveTargetTime({
    dynamicPriceSamples: input.dynamicPriceSamples,
    item: input.item,
    items: input.items,
    lowPriceMarkerTime,
    now: input.now,
    solarRecoveryTime: solarRecoverySignal?.time ?? null,
    windowKind,
  });
  const targetTimeSignal = buildTargetTimeSignal({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    loadProfile,
    predictedSeries,
    solarForecastSamples: input.solarForecastSamples,
    targetTime,
  });
  const skipReason = isLowPriceAutoDischarge
    ? getLowPriceAutoDischargeSkipReason({
        batteryId: input.battery.id,
        itemId: input.item.id,
        targetTime,
        targetTimeSignal,
      })
    : null;

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
      resolvedManualState: resolveDynamicEstimateManualState(input.item),
      skipReason,
      predictedSolarGenerationWh: 0,
      reasoning: "battery capacity is unavailable",
      targetTime: targetTime?.toISOString() ?? fallbackTargetTime,
      targetTimeSignal: isLowPriceAutoDischarge
        ? targetTimeSignal
        : serializeSolarRecoverySignal(solarRecoverySignal),
      warning: null,
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
      resolvedManualState: resolveDynamicEstimateManualState(input.item),
      skipReason,
      predictedSolarGenerationWh: 0,
      reasoning: "no target horizon could be determined",
      targetTime: fallbackTargetTime,
      targetTimeSignal: isLowPriceAutoDischarge
        ? targetTimeSignal
        : serializeSolarRecoverySignal(solarRecoverySignal),
      warning: null,
      windowKind,
    };
  }

  const periodHours = resolvePeriodHours(input.solarForecastSamples);
  const forecastPeriods = predictedSeries
    .map((point) => {
      const overlapHours = resolveIntervalOverlapHours({
        intervalEnd: targetTime,
        intervalStart: input.now,
        periodHours,
        periodStart: point.periodStart,
      });

      if (overlapHours <= 0) {
        return null;
      }

      return {
        overlapHours,
        periodStart: point.periodStart,
        predictedPowerW:
          typeof point.value === "number" ? Math.max(0, point.value) : 0,
      };
    })
    .filter(
      (
        point,
      ): point is {
        overlapHours: number;
        periodStart: string;
        predictedPowerW: number;
      } => point !== null,
    );
  const expectedHouseLoadWh = round2(
    forecastPeriods.reduce((total, point) => {
      return (
        total +
        resolveExpectedHouseLoadWh(
          point.periodStart,
          loadProfile,
          point.overlapHours,
        )
      );
    }, 0),
  );
  const predictedSolarGenerationWh = round2(
    forecastPeriods.reduce((total, point) => {
      return total + point.predictedPowerW * point.overlapHours;
    }, 0),
  );
  const estimatedRemainingEnergyWh = round2(
    Math.max(0, expectedHouseLoadWh - predictedSolarGenerationWh),
  );
  const reserveFloorResult = shouldUseDynamicReserveFloor(input.item)
    ? calculateDynamicReserveFloorPercent({
        backupReserveMarginPercent: input.backupReserveMarginOverride,
        batteryId: input.battery.id,
        itemId: input.item.id,
        minimumDischargePercent: input.battery.minimumDischargePercent,
        now: input.now,
        reserveUntil: targetTime,
        targetBufferPercentPerHour:
          input.targetBufferPercentPerHourOverride ??
          DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
      })
    : {
        reserveFloorPercent: input.battery.minimumDischargePercent,
        warning: null,
      };
  const estimatedReservePercentAtTargetTime =
    reserveFloorResult.reserveFloorPercent;
  const estimatedTargetPercent = clampPercent(
    estimatedReservePercentAtTargetTime +
      Math.ceil(
        (estimatedRemainingEnergyWh / Math.max(1, input.sample.capacityWh)) *
          100,
      ),
    input.battery.minimumDischargePercent,
  );
  const availability =
    forecastPeriods.length === 0 || loadProfile.expectedLoadBySlot.size === 0
      ? "partial"
      : "full";
  const breakEvenTrace = buildBreakEvenTrace({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    now: input.now,
    predictedSeries,
    loadProfile,
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
      useLowPriceMarker: isLowPriceAutoDischarge,
    }),
    targetTime: targetTime.toISOString(),
    targetTimeSignal: isLowPriceAutoDischarge
      ? targetTimeSignal
      : serializeSolarRecoverySignal(solarRecoverySignal),
    historyStats: {
      historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
      sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
      slotCount: loadProfile.expectedLoadBySlot.size,
    },
    resolvedManualState: resolveDynamicEstimateManualState(input.item),
    skipReason,
    warning: reserveFloorResult.warning,
    windowKind,
  };
}

type PredictedPoint = { periodStart: string; value: number | null };

function buildPredictedSolarSeries(
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

function findSolarRecoveryTime(input: {
  minimumSolarSurplusW: number;
  now: Date;
  predictedSeries: PredictedPoint[];
  loadProfile: LoadProfile;
}): SolarRecoverySignal | null {
  const earliestRecoveryAt = input.now;

  for (const point of input.predictedSeries) {
    const pointDate = new Date(point.periodStart);
    const pointMs = pointDate.getTime();

    if (Number.isNaN(pointMs) || pointMs < earliestRecoveryAt.getTime()) {
      continue;
    }

    const expectedLoadW =
      input.loadProfile.expectedLoadBySlot.size === 0
        ? null
        : resolveExpectedSiteLoadW(pointDate, input.loadProfile);
    const predictedPowerW =
      typeof point.value === "number" ? Math.max(0, point.value) : null;
    const requiredRecoveryPowerW =
      expectedLoadW === null
        ? input.minimumSolarSurplusW
        : expectedLoadW + input.minimumSolarSurplusW;

    if (predictedPowerW !== null && predictedPowerW > requiredRecoveryPowerW) {
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

function buildBreakEvenTrace(input: {
  minimumSolarSurplusW: number;
  now: Date;
  predictedSeries: PredictedPoint[];
  loadProfile: LoadProfile;
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
        input.loadProfile.expectedLoadBySlot.size === 0
          ? null
          : resolveExpectedSiteLoadW(pointDate, input.loadProfile);
      const predictedSolarW =
        typeof point.value === "number" ? Math.max(0, point.value) : null;
      const recoveryThresholdW =
        expectedHouseLoadW === null
          ? input.minimumSolarSurplusW
          : expectedHouseLoadW + input.minimumSolarSurplusW;

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
): DynamicPriceTargetEstimate["targetTimeSignal"] {
  if (signal === null) {
    return null;
  }

  return {
    expectedHouseLoadW: signal.expectedHouseLoadW,
    predictedSolarW: signal.predictedSolarW,
    recoveryThresholdW: signal.recoveryThresholdW,
  };
}

function buildTargetTimeSignal(input: {
  minimumSolarSurplusW: number;
  targetTime: Date | null;
  loadProfile: LoadProfile;
  predictedSeries: PredictedPoint[];
  solarForecastSamples: SolarForecastSampleRecord[];
}): DynamicPriceTargetEstimate["targetTimeSignal"] {
  if (input.targetTime === null) {
    return null;
  }

  const expectedHouseLoadW =
    input.loadProfile.expectedLoadBySlot.size === 0
      ? null
      : resolveExpectedSiteLoadW(input.targetTime, input.loadProfile);
  const predictedSolarW = getPredictedSolarPowerAtOrAfter({
    targetTime: input.targetTime,
    predictedSeries: input.predictedSeries,
  }) ??
    getForecastSolarPowerAtOrAfter({
      solarForecastSamples: input.solarForecastSamples,
      targetTime: input.targetTime,
    });

  return {
    expectedHouseLoadW,
    predictedSolarW,
    recoveryThresholdW:
      expectedHouseLoadW === null
        ? input.minimumSolarSurplusW
        : expectedHouseLoadW + input.minimumSolarSurplusW,
  };
}

function getForecastSolarPowerAtOrAfter(input: {
  solarForecastSamples: SolarForecastSampleRecord[];
  targetTime: Date;
}): number | null {
  for (const sample of input.solarForecastSamples) {
    const sampleDate = new Date(sample.periodStart);

    if (Number.isNaN(sampleDate.getTime())) {
      continue;
    }

    if (sampleDate.getTime() < input.targetTime.getTime()) {
      continue;
    }

    return typeof sample.value === "number" ? Math.max(0, sample.value) : null;
  }

  return null;
}

function getPredictedSolarPowerAtOrAfter(input: {
  targetTime: Date;
  predictedSeries: PredictedPoint[];
}): number | null {
  for (const point of input.predictedSeries) {
    const pointDate = new Date(point.periodStart);

    if (Number.isNaN(pointDate.getTime())) {
      continue;
    }

    if (pointDate.getTime() < input.targetTime.getTime()) {
      continue;
    }

    return typeof point.value === "number" ? Math.max(0, point.value) : null;
  }

  return null;
}

function getLowPriceAutoDischargeSkipReason(input: {
  batteryId: string;
  itemId: string;
  targetTime: Date | null;
  targetTimeSignal: DynamicPriceTargetEstimate["targetTimeSignal"];
}): string | null {
  if (input.targetTime === null) {
    return `skipping the low-price schedule for ${input.batteryId}: no low-price marker could be resolved for item ${input.itemId}`;
  }

  if (input.targetTimeSignal?.predictedSolarW === null) {
    return `skipping the low-price schedule for ${input.batteryId}: predicted solar at ${input.targetTime.toISOString()} is unavailable`;
  }

  if (input.targetTimeSignal?.expectedHouseLoadW === null) {
    return `skipping the low-price schedule for ${input.batteryId}: expected house load at ${input.targetTime.toISOString()} is unavailable`;
  }

  const recoveryThresholdW = input.targetTimeSignal?.recoveryThresholdW;

  if (recoveryThresholdW === null || recoveryThresholdW === undefined) {
    return `skipping the low-price schedule for ${input.batteryId}: the recharge threshold at ${input.targetTime.toISOString()} is unavailable`;
  }

  const predictedSolarW = input.targetTimeSignal?.predictedSolarW;

  if (predictedSolarW === null || predictedSolarW === undefined) {
    return `skipping the low-price schedule for ${input.batteryId}: predicted solar at ${input.targetTime.toISOString()} is unavailable`;
  }

  if (predictedSolarW <= recoveryThresholdW) {
    return `skipping the low-price schedule for ${input.batteryId}: predicted solar at ${input.targetTime.toISOString()} is ${Math.round(predictedSolarW)}W, which is not above the expected recharge threshold ${Math.round(recoveryThresholdW)}W`;
  }

  return null;
}

function resolveTargetTime(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  items: BatteryStrategyPlanItem[];
  lowPriceMarkerTime: Date | null;
  now: Date;
  solarRecoveryTime: Date | null;
  windowKind: DynamicPriceTargetEstimate["windowKind"];
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

    return (
      input.solarRecoveryTime ??
      nextScheduleBoundary ??
      todayNoonOrNext(input.now)
    );
  }

  if (isLowPriceAutoDischargeItem(input.item)) {
    return input.lowPriceMarkerTime;
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
  const currentIndex = input.items.findIndex(
    (candidate) => candidate.id === input.item.id,
  );
  const laterItems =
    currentIndex === -1 ? [] : input.items.slice(currentIndex + 1);

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
  loadProfile: LoadProfile,
  overlapHours: number,
): number {
  return resolveExpectedSiteLoadW(periodStart, loadProfile) * overlapHours;
}

function resolveIntervalOverlapHours(input: {
  intervalEnd: Date;
  intervalStart: Date;
  periodHours: number;
  periodStart: string;
}): number {
  const periodStart = new Date(input.periodStart);

  if (Number.isNaN(periodStart.getTime())) {
    return 0;
  }

  const periodEnd = new Date(
    periodStart.getTime() + input.periodHours * 3_600_000,
  );
  const overlapStartMs = Math.max(
    periodStart.getTime(),
    input.intervalStart.getTime(),
  );
  const overlapEndMs = Math.min(
    periodEnd.getTime(),
    input.intervalEnd.getTime(),
  );

  if (overlapEndMs <= overlapStartMs) {
    return 0;
  }

  return (overlapEndMs - overlapStartMs) / 3_600_000;
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

function buildReasoning(input: {
  availability: DynamicPriceTargetEstimate["availability"];
  expectedLoadBySlot: Map<string, number>;
  predictedSolarGenerationWh: number;
  solarRecoveryTime: Date | null;
  useLowPriceMarker: boolean;
}): string {
  const parts = [] as string[];

  if (input.useLowPriceMarker) {
    parts.push("expected demand until the low-price marker");
  } else if (input.solarRecoveryTime !== null) {
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

function shouldUseDynamicReserveFloor(item: BatteryStrategyPlanItem): boolean {
  return item.triggerKind === "high-price" || isLowPriceAutoDischargeItem(item);
}

function resolveDynamicEstimateManualState(
  item: BatteryStrategyPlanItem,
): BatteryStrategyPlanItem["manualState"] {
  return isLowPriceAutoDischargeItem(item) ? "discharging" : item.manualState;
}

function getWindowKind(
  item: BatteryStrategyPlanItem,
  now: Date,
): DynamicPriceTargetEstimate["windowKind"] {
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
