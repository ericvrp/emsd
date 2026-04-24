import {
  BatteryStrategyTriggerKind,
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  DELAYED_CHARGING_TARGET_FLOOR_BUFFER_PERCENT,
  calculateDynamicReserveFloorPercent,
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
  DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W,
  DYNAMIC_PRICE_TARGET_PERIOD_MINUTES,
  PRICE_SELECTION_WINDOW_MS,
  applySolarSeriesSmoothing,
  buildExpectedSiteLoadProfile,
  buildHouseLoadHistorySeries,
  buildPredictedSolarGenerationSeries,
  isDelayedChargingAutoDischargeItem,
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
  energyBuckets: Array<EnergyBucket>;
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
  windowKind: "general" | "morning-export-surplus" | "evening-export-surplus";
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

interface DelayedChargingWindow {
  endTime: Date;
  startTime: Date;
}

interface BreakEvenTraceRow {
  expectedHouseLoadW: number | null;
  meetsBreakEven: boolean;
  predictedSolarW: number | null;
  recoveryThresholdW: number | null;
  time: string;
}

export interface EnergyBucket {
  time: string;
  durationMinutes: number;
  expectedHouseLoadWh: number;
  predictedSolarWh: number;
  netBatteryEnergyNeededWh: number;
  cumulativeExpectedHouseLoadWh: number;
  cumulativePredictedSolarWh: number;
  cumulativeNetBatteryEnergyNeededWh: number;
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
      energyBuckets: [],
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
  const sharedLoadProfile = buildExpectedSiteLoadProfile(
    historySeries,
    input.now,
  );
  const loadProfile: LoadProfile = {
    expectedLoadBySlot: sharedLoadProfile.expectedLoadBySlot,
    fallbackLoadW: sharedLoadProfile.fallbackLoadW,
    historicalPeriodsUsed: sharedLoadProfile.historicalPeriodsUsed,
    sameWeekdayPeriodsUsed: sharedLoadProfile.sameWeekdayPeriodsUsed,
  };
  const isDelayedChargingAutoDischarge =
    isDelayedChargingAutoDischargeItem(input.item);
  const windowKind = getWindowKind(input.item, input.now);
  const solarRecoverySignal = findSolarRecoveryTime({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    now: input.now,
    predictedSeries,
    loadProfile,
  });
  const lowPriceMarkerTime = isDelayedChargingAutoDischarge
    ? getNextPriceMarkerTriggerAt({
        triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
        now: input.now,
        dynamicPriceSamples: input.dynamicPriceSamples,
      })
    : null;
  const delayedChargingWindow = isDelayedChargingAutoDischarge
    ? resolveDelayedChargingWindow({
        dynamicPriceSamples: input.dynamicPriceSamples,
        item: input.item,
        items: input.items,
        lowPriceMarkerTime,
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

  if (input.sample.capacityWh === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
        sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
        slotCount: loadProfile.expectedLoadBySlot.size,
      },
      resolvedManualState: resolveDynamicEstimateManualState({ item: input.item }),
      skipReason: isDelayedChargingAutoDischarge
        ? `skipped: battery capacity unavailable for delayed charging item ${input.item.id}`
        : null,
      predictedSolarGenerationWh: 0,
      reasoning: "battery capacity is unavailable",
      targetTime: targetTime?.toISOString() ?? fallbackTargetTime,
      targetTimeSignal: isDelayedChargingAutoDischarge
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
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
        sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
        slotCount: loadProfile.expectedLoadBySlot.size,
      },
      resolvedManualState: resolveDynamicEstimateManualState({ item: input.item }),
      skipReason: isDelayedChargingAutoDischarge
        ? getDelayedChargingSkipReason({
            itemId: input.item.id,
            targetTime,
            window: delayedChargingWindow,
            expectedNetChargeWh: null,
          })
        : null,
      predictedSolarGenerationWh: 0,
      reasoning: "no target horizon could be determined",
      targetTime: fallbackTargetTime,
      targetTimeSignal: isDelayedChargingAutoDischarge
        ? targetTimeSignal
        : serializeSolarRecoverySignal(solarRecoverySignal),
      warning: null,
      windowKind,
    };
  }

  if (isDelayedChargingAutoDischarge && delayedChargingWindow === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
        sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
        slotCount: loadProfile.expectedLoadBySlot.size,
      },
      resolvedManualState: resolveDynamicEstimateManualState({ item: input.item }),
      skipReason: getDelayedChargingSkipReason({
        itemId: input.item.id,
        targetTime,
        window: delayedChargingWindow,
        expectedNetChargeWh: null,
      }),
      predictedSolarGenerationWh: 0,
      reasoning: "no delayed charging window could be determined",
      targetTime: targetTime.toISOString(),
      targetTimeSignal,
      warning: null,
      windowKind,
    };
  }

  const integrationStart = isDelayedChargingAutoDischarge
    ? (delayedChargingWindow?.startTime ?? targetTime)
    : input.now;
  const integrationEnd = isDelayedChargingAutoDischarge
    ? (delayedChargingWindow?.endTime ?? targetTime)
    : targetTime;

  const periodHours = resolvePeriodHours(input.solarForecastSamples);
  const forecastPeriods = predictedSeries
    .map((point) => {
      const overlapHours = resolveIntervalOverlapHours({
        intervalEnd: integrationEnd,
        intervalStart: integrationStart,
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
  let cumulativeExpectedHouseLoadWh = 0;
  let cumulativePredictedSolarWh = 0;
  const energyBuckets = forecastPeriods.map((point) => {
    const durationMinutes = Math.round(point.overlapHours * 60);
    const bucketExpectedHouseLoadWh = round2(
      resolveExpectedHouseLoadWh(
        point.periodStart,
        loadProfile,
        point.overlapHours,
      ),
    );
    const bucketPredictedSolarWh = round2(
      point.predictedPowerW * point.overlapHours,
    );
    cumulativeExpectedHouseLoadWh = round2(
      cumulativeExpectedHouseLoadWh + bucketExpectedHouseLoadWh,
    );
    cumulativePredictedSolarWh = round2(
      cumulativePredictedSolarWh + bucketPredictedSolarWh,
    );
    const cumulativeNetBatteryEnergyNeededWh = round2(
      isDelayedChargingAutoDischarge
        ? Math.max(0, cumulativePredictedSolarWh - cumulativeExpectedHouseLoadWh)
        : Math.max(0, cumulativeExpectedHouseLoadWh - cumulativePredictedSolarWh),
    );
    return {
      time: point.periodStart,
      durationMinutes,
      expectedHouseLoadWh: bucketExpectedHouseLoadWh,
      predictedSolarWh: bucketPredictedSolarWh,
      netBatteryEnergyNeededWh: round2(
        isDelayedChargingAutoDischarge
          ? Math.max(0, bucketPredictedSolarWh - bucketExpectedHouseLoadWh)
          : Math.max(0, bucketExpectedHouseLoadWh - bucketPredictedSolarWh),
      ),
      cumulativeExpectedHouseLoadWh,
      cumulativePredictedSolarWh,
      cumulativeNetBatteryEnergyNeededWh,
    };
  });
  const lastEnergyBucket = energyBuckets[energyBuckets.length - 1] ?? null;
  const expectedHouseLoadWh =
    lastEnergyBucket?.cumulativeExpectedHouseLoadWh ?? 0;
  const predictedSolarGenerationWh =
    lastEnergyBucket?.cumulativePredictedSolarWh ?? 0;
  const estimatedRemainingEnergyWh =
    lastEnergyBucket?.cumulativeNetBatteryEnergyNeededWh ?? 0;
  const reserveFloorResult = isDelayedChargingAutoDischarge
    ? {
        reserveFloorPercent: clampPercent(
          input.battery.minimumDischargePercent +
            DELAYED_CHARGING_TARGET_FLOOR_BUFFER_PERCENT,
          input.battery.minimumDischargePercent,
        ),
        warning: null,
      }
    : shouldUseDynamicReserveFloor(input.item)
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
  const estimatedTargetPercent = isDelayedChargingAutoDischarge
    ? clampPercent(
        100 -
          Math.ceil(
            (estimatedRemainingEnergyWh / Math.max(1, input.sample.capacityWh)) *
              100,
          ),
        estimatedReservePercentAtTargetTime,
      )
    : clampPercent(
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
  const skipReason = isDelayedChargingAutoDischarge
    ? getDelayedChargingSkipReason({
        itemId: input.item.id,
        targetTime,
        window: delayedChargingWindow,
        expectedNetChargeWh: estimatedRemainingEnergyWh,
      })
    : null;
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
    energyBuckets,
    estimatedRemainingEnergyWh,
    estimatedReservePercentAtTargetTime,
    estimatedTargetPercent,
    expectedHouseLoadWh,
    predictedSolarGenerationWh,
    reasoning: buildReasoning({
      availability,
      expectedLoadBySlot: loadProfile.expectedLoadBySlot,
      predictedSolarGenerationWh,
      delayedChargingWindow,
      solarRecoveryTime: solarRecoverySignal?.time ?? null,
    }),
    targetTime: targetTime.toISOString(),
    targetTimeSignal: isDelayedChargingAutoDischarge
      ? targetTimeSignal
      : serializeSolarRecoverySignal(solarRecoverySignal),
    historyStats: {
      historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
      sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
      slotCount: loadProfile.expectedLoadBySlot.size,
    },
    resolvedManualState: resolveDynamicEstimateManualState({
      item: input.item,
      estimatedTargetPercent,
      sampleSocPercent: input.sample.socPercent,
    }),
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
  const predictedSolarW =
    getPredictedSolarPowerAtOrAfter({
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
    return `skipped: no delayed charging marker resolved for item ${input.itemId}`;
  }

  if (input.targetTimeSignal?.predictedSolarW === null) {
    return `skipped: predicted solar unavailable at ${input.targetTime.toISOString()}`;
  }

  if (input.targetTimeSignal?.expectedHouseLoadW === null) {
    return `skipped: expected house load unavailable at ${input.targetTime.toISOString()}`;
  }

  const recoveryThresholdW = input.targetTimeSignal?.recoveryThresholdW;

  if (recoveryThresholdW === null || recoveryThresholdW === undefined) {
    return `skipped: recharge threshold unavailable at ${input.targetTime.toISOString()}`;
  }

  const predictedSolarW = input.targetTimeSignal?.predictedSolarW;

  if (predictedSolarW === null || predictedSolarW === undefined) {
    return `skipped: predicted solar unavailable at ${input.targetTime.toISOString()}`;
  }

  if (predictedSolarW <= recoveryThresholdW) {
    return `skipped: predicted solar ${Math.round(predictedSolarW)}W below threshold ${Math.round(recoveryThresholdW)}W at ${input.targetTime.toISOString()}`;
  }

  return null;
}

function getDelayedChargingSkipReason(input: {
  itemId: string;
  targetTime: Date | null;
  window: DelayedChargingWindow | null;
  expectedNetChargeWh: number | null;
}): string | null {
  if (input.targetTime === null) {
    return `skipped: no delayed charging marker resolved for item ${input.itemId}`;
  }

  if (input.window === null) {
    return `skipped: no delayed charging window resolved for item ${input.itemId}`;
  }

  if (input.expectedNetChargeWh === null) {
    return null;
  }

  if (input.expectedNetChargeWh <= 0) {
    return `skipped: no net solar charge expected during the delayed charging window starting ${input.targetTime.toISOString()}`;
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

  if (input.item.triggerKind === BatteryStrategyTriggerKind.ExportSurplus) {
    if (input.windowKind === "evening-export-surplus") {
      return input.solarRecoveryTime ?? nextMorningFallback(input.now);
    }

    return (
      input.solarRecoveryTime ??
      nextScheduleBoundary ??
      todayNoonOrNext(input.now)
    );
  }

  if (isDelayedChargingAutoDischargeItem(input.item)) {
    return input.lowPriceMarkerTime;
  }

  if (input.item.triggerKind === BatteryStrategyTriggerKind.DelayedCharging) {
    return nextScheduleBoundary ?? endOfDay(input.now);
  }

  return nextScheduleBoundary ?? endOfDay(input.now);
}

function resolveDelayedChargingWindow(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  items: BatteryStrategyPlanItem[];
  lowPriceMarkerTime: Date | null;
}): DelayedChargingWindow | null {
  const lowPriceMarkerTime = input.lowPriceMarkerTime;

  if (lowPriceMarkerTime === null) {
    return null;
  }

  const fallbackEnd = new Date(lowPriceMarkerTime.getTime() + PRICE_SELECTION_WINDOW_MS);
  const nextHighPriceMarker = getNextPriceMarkerTriggerAt({
    triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
    now: new Date(lowPriceMarkerTime.getTime() + 1),
    dynamicPriceSamples: input.dynamicPriceSamples,
  });
  const nextScheduleBoundary = getNextScheduleBoundary({
    dynamicPriceSamples: input.dynamicPriceSamples,
    item: input.item,
    items: input.items,
    now: lowPriceMarkerTime,
  });
  const endTime = [nextHighPriceMarker, nextScheduleBoundary, fallbackEnd]
    .filter((candidate): candidate is Date => candidate !== null)
    .filter(
      (candidate) =>
        candidate.getTime() > lowPriceMarkerTime.getTime() &&
        !Number.isNaN(candidate.getTime()),
    )
    .sort((left, right) => left.getTime() - right.getTime())[0];

  if (!endTime) {
    return null;
  }

  return {
    endTime,
    startTime: lowPriceMarkerTime,
  };
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
  delayedChargingWindow: DelayedChargingWindow | null;
  expectedLoadBySlot: Map<string, number>;
  predictedSolarGenerationWh: number;
  solarRecoveryTime: Date | null;
}): string {
  const parts = [] as string[];

  if (input.delayedChargingWindow !== null) {
    parts.push("expected solar charge opportunity during the delayed charging window");
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
  return item.triggerKind === BatteryStrategyTriggerKind.ExportSurplus;
}

function resolveDynamicEstimateManualState(input: {
  item: BatteryStrategyPlanItem;
  estimatedTargetPercent?: number | null;
  sampleSocPercent?: number | null;
}): BatteryStrategyPlanItem["manualState"] {
  if (!isDelayedChargingAutoDischargeItem(input.item)) {
    return input.item.manualState;
  }

  return typeof input.estimatedTargetPercent === "number" &&
    input.sampleSocPercent !== null &&
    input.sampleSocPercent !== undefined &&
    input.sampleSocPercent <= input.estimatedTargetPercent
    ? "idle"
    : "discharging";
}

function getWindowKind(
  item: BatteryStrategyPlanItem,
  now: Date,
): DynamicPriceTargetEstimate["windowKind"] {
  if (item.triggerKind !== BatteryStrategyTriggerKind.ExportSurplus) {
    return "general";
  }

  return now.getHours() >= 15
    ? "evening-export-surplus"
    : "morning-export-surplus";
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
