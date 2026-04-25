import {
  type BatteryPowerSampleRecord,
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  DELAYED_CHARGING_TARGET_FLOOR_BUFFER_PERCENT,
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
  DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W,
  DYNAMIC_PRICE_TARGET_PERIOD_MINUTES,
  type DynamicPriceSampleRecord,
  type NormalizedBatteryInfo,
  type P1MeterSampleRecord,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
  applySolarSeriesSmoothing,
  buildExpectedSiteLoadProfile,
  buildHouseLoadHistorySeries,
  buildPredictedSolarGenerationSeries,
  calculateDynamicReserveFloorPercent,
  isDelayedChargingAutoDischargeItem,
  resolveExpectedSiteLoadW,
} from "@emsd/core";
import {
  getNextPriceMarkerTriggerAt,
  getNextStrategyTriggerAt,
} from "./strategy-scheduler";

const MIN_SOLAR_SURPLUS_W = DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W;
const DEFAULT_PERIOD_MINUTES = DYNAMIC_PRICE_TARGET_PERIOD_MINUTES;
const DELAYED_CHARGING_LOW_PRICE_MARGIN_FACTOR = 3;

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
  delayedChargingDetails: {
    actualWindowEnd: string;
    actualWindowEndPrice: number;
    actualWindowStart: string;
    actualWindowStartPrice: number;
    chargePowerW: number;
    chargeStartSocPercent: number;
    currentSocBasisPercent: number;
    latestFeasiblePreDischargeStartTime: string | null;
    lowestPrice: number;
    lowPriceMargin: number;
    lowPriceMarkerTime: string;
    minimumTimeToFullChargeMinutes: number;
    normalizedImportExportSpread: number;
    potentialWindowEnd: string;
    potentialWindowStart: string;
    preDischargeTargetSocPercent: number | null;
  } | null;
  expectedHouseLoadWh: number;
  historyStats: {
    historicalPeriodsUsed: number;
    sameWeekdayPeriodsUsed: number;
    slotCount: number;
  };
  resolvedManualState: BatteryStrategyPlanItem["manualState"];
  skipReason: string | null;
  startTime: string | null;
  startTimeBasisSocPercent: number | null;
  effectiveDischargePowerW: number | null;
  requiredDischargeMinutes: number | null;
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
  chargePowerW: number;
  chargeStartSocPercent: number;
  endTime: Date;
  endPrice: number;
  lowPriceMargin: number;
  lowestPrice: number;
  lowPriceMarkerTime: Date;
  minimumTimeToFullChargeMinutes: number;
  normalizedImportExportSpread: number;
  potentialEndTime: Date;
  potentialStartTime: Date;
  startTime: Date;
  startPrice: number;
}

interface DelayedChargingStartPlan {
  effectiveDischargePowerW: number;
  requiredDischargeMinutes: number;
  startSocPercent: number;
  startTime: Date;
}

interface DelayedChargingEstimate extends IntervalEnergyEstimate {
  targetPercent: number;
  window: DelayedChargingWindow;
}

interface IntervalEnergyEstimate {
  energyBuckets: EnergyBucket[];
  estimatedRemainingEnergyWh: number;
  expectedHouseLoadWh: number;
  predictedSolarGenerationWh: number;
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
  normalizedImportExportSpread?: number | null;
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
      delayedChargingDetails: null,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: 0,
        sameWeekdayPeriodsUsed: 0,
        slotCount: 0,
      },
      startTime: input.now.toISOString(),
      startTimeBasisSocPercent: input.sample.socPercent,
      effectiveDischargePowerW: null,
      requiredDischargeMinutes: null,
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
  const isDelayedChargingAutoDischarge = isDelayedChargingAutoDischargeItem(
    input.item,
  );
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
  const targetTimeBeforeCapacityCheck = resolveTargetTime({
    dynamicPriceSamples: input.dynamicPriceSamples,
    item: input.item,
    items: input.items,
    lowPriceMarkerTime,
    now: input.now,
    solarRecoveryTime: solarRecoverySignal?.time ?? null,
    windowKind,
  });
  const targetTimeSignalBeforeCapacityCheck = buildTargetTimeSignal({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    loadProfile,
    predictedSeries,
    solarForecastSamples: input.solarForecastSamples,
    targetTime: targetTimeBeforeCapacityCheck,
  });
  const emptyDelayedChargingStartPlan = {
    effectiveDischargePowerW: null,
    requiredDischargeMinutes: null,
    startSocPercent: null,
    startTime: null,
  } as const;

  if (input.sample.capacityWh === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      delayedChargingDetails: null,
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
        sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
        slotCount: loadProfile.expectedLoadBySlot.size,
      },
      startTime: input.now.toISOString(),
      startTimeBasisSocPercent: input.sample.socPercent,
      effectiveDischargePowerW: null,
      requiredDischargeMinutes: null,
      resolvedManualState: resolveDynamicEstimateManualState({
        item: input.item,
      }),
      skipReason: isDelayedChargingAutoDischarge
        ? `skipped: battery capacity unavailable for delayed charging item ${input.item.id}`
        : null,
      predictedSolarGenerationWh: 0,
      reasoning: "battery capacity is unavailable",
      targetTime:
        targetTimeBeforeCapacityCheck?.toISOString() ?? fallbackTargetTime,
      targetTimeSignal: isDelayedChargingAutoDischarge
        ? targetTimeSignalBeforeCapacityCheck
        : serializeSolarRecoverySignal(solarRecoverySignal),
      warning: null,
      windowKind,
    };
  }

  const delayedChargingSocBasis = isDelayedChargingAutoDischarge
    ? resolveDelayedChargingSocBasis({
        battery: input.battery,
        batteryPowerSamples: input.batteryPowerSamples,
        now: input.now,
        sampleSocPercent: input.sample.socPercent,
      })
    : null;
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
          reserveUntil: targetTimeBeforeCapacityCheck ?? input.now,
          targetBufferPercentPerHour:
            input.targetBufferPercentPerHourOverride ??
            DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
        })
      : {
          reserveFloorPercent: input.battery.minimumDischargePercent,
          warning: null,
        };
  const delayedChargingEstimate = isDelayedChargingAutoDischarge
    ? resolveDelayedChargingEstimate({
        battery: input.battery,
        capacityWh: input.sample.capacityWh,
        currentSocPercent: delayedChargingSocBasis?.socPercent ?? null,
        dynamicPriceSamples: input.dynamicPriceSamples,
        item: input.item,
        loadProfile,
        lowPriceMarkerTime,
        normalizedImportExportSpread:
          input.normalizedImportExportSpread ?? null,
        periodHours: resolvePeriodHours(input.solarForecastSamples),
        predictedSeries,
        reserveFloorPercent: reserveFloorResult.reserveFloorPercent,
      })
    : null;
  const delayedChargingWindow = delayedChargingEstimate?.window ?? null;
  const targetTime = isDelayedChargingAutoDischarge
    ? (delayedChargingWindow?.startTime ?? null)
    : targetTimeBeforeCapacityCheck;
  const targetTimeSignal = buildTargetTimeSignal({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    loadProfile,
    predictedSeries,
    solarForecastSamples: input.solarForecastSamples,
    targetTime,
  });

  if (targetTime === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: fallbackTargetPercent,
      estimatedTargetPercent: fallbackTargetPercent,
      delayedChargingDetails: serializeDelayedChargingDetails({
        chargeStartSocPercent:
          delayedChargingEstimate?.window.chargeStartSocPercent ?? null,
        currentSocBasisPercent: delayedChargingSocBasis?.socPercent ?? null,
        preDischargeTargetSocPercent: null,
        startPlan: null,
        window: delayedChargingWindow,
      }),
      expectedHouseLoadWh: 0,
      historyStats: {
        historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
        sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
        slotCount: loadProfile.expectedLoadBySlot.size,
      },
      startTime: isDelayedChargingAutoDischarge
        ? null
        : input.now.toISOString(),
      startTimeBasisSocPercent: input.sample.socPercent,
      effectiveDischargePowerW: null,
      requiredDischargeMinutes: null,
      resolvedManualState: resolveDynamicEstimateManualState({
        item: input.item,
      }),
      skipReason: isDelayedChargingAutoDischarge
        ? getDelayedChargingSkipReason({
            itemId: input.item.id,
            targetTime: isDelayedChargingAutoDischarge
              ? lowPriceMarkerTime
              : targetTime,
            window: delayedChargingWindow,
            expectedNetChargeWh: null,
            startPlan: emptyDelayedChargingStartPlan,
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

  const intervalEnergyEstimate = isDelayedChargingAutoDischarge
    ? delayedChargingEstimate
    : buildIntervalEnergyEstimate({
        integrationEnd: targetTime,
        integrationStart: input.now,
        loadProfile,
        mode: "load-minus-solar",
        periodHours: resolvePeriodHours(input.solarForecastSamples),
        predictedSeries,
      });
  const energyBuckets = intervalEnergyEstimate?.energyBuckets ?? [];
  const expectedHouseLoadWh = intervalEnergyEstimate?.expectedHouseLoadWh ?? 0;
  const predictedSolarGenerationWh =
    intervalEnergyEstimate?.predictedSolarGenerationWh ?? 0;
  const estimatedRemainingEnergyWh =
    intervalEnergyEstimate?.estimatedRemainingEnergyWh ?? 0;
  const estimatedReservePercentAtTargetTime =
    reserveFloorResult.reserveFloorPercent;
  const estimatedTargetPercent = isDelayedChargingAutoDischarge
    ? (delayedChargingEstimate?.targetPercent ??
      clampPercent(
        100 -
          Math.ceil(
            (estimatedRemainingEnergyWh /
              Math.max(1, input.sample.capacityWh)) *
              100,
          ),
        estimatedReservePercentAtTargetTime,
      ))
    : clampPercent(
        estimatedReservePercentAtTargetTime +
          Math.ceil(
            (estimatedRemainingEnergyWh /
              Math.max(1, input.sample.capacityWh)) *
              100,
          ),
        input.battery.minimumDischargePercent,
      );
  const delayedChargingStartPlan = isDelayedChargingAutoDischarge
    ? resolveDelayedChargingStartPlan({
        battery: input.battery,
        batteryPowerSamples: input.batteryPowerSamples,
        capacityWh: input.sample.capacityWh,
        item: input.item,
        now: input.now,
        sampleSocPercent:
          delayedChargingSocBasis?.socPercent ?? input.sample.socPercent,
        targetPercent: estimatedTargetPercent,
        targetTime,
      })
    : null;
  const availability =
    energyBuckets.length === 0 || loadProfile.expectedLoadBySlot.size === 0
      ? "partial"
      : "full";
  const skipReason = isDelayedChargingAutoDischarge
    ? getDelayedChargingSkipReason({
        itemId: input.item.id,
        targetTime,
        window: delayedChargingWindow,
        expectedNetChargeWh: estimatedRemainingEnergyWh,
        startPlan: delayedChargingStartPlan ?? emptyDelayedChargingStartPlan,
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
    delayedChargingDetails: serializeDelayedChargingDetails({
      chargeStartSocPercent:
        delayedChargingEstimate?.window.chargeStartSocPercent ?? null,
      currentSocBasisPercent: delayedChargingSocBasis?.socPercent ?? null,
      preDischargeTargetSocPercent: isDelayedChargingAutoDischarge
        ? estimatedTargetPercent
        : null,
      startPlan: delayedChargingStartPlan,
      window: delayedChargingWindow,
    }),
    expectedHouseLoadWh,
    startTime:
      delayedChargingStartPlan?.startTime.toISOString() ??
      input.now.toISOString(),
    startTimeBasisSocPercent:
      delayedChargingStartPlan?.startSocPercent ?? input.sample.socPercent,
    effectiveDischargePowerW:
      delayedChargingStartPlan?.effectiveDischargePowerW ?? null,
    requiredDischargeMinutes:
      delayedChargingStartPlan?.requiredDischargeMinutes ?? null,
    predictedSolarGenerationWh,
    reasoning: buildReasoning({
      availability,
      delayedChargingStartPlan,
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
      sampleSocPercent:
        delayedChargingStartPlan?.startSocPercent ?? input.sample.socPercent,
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

function resolveDelayedChargingEstimate(input: {
  battery: BatteryRecord;
  capacityWh: number;
  currentSocPercent: number | null;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  loadProfile: LoadProfile;
  lowPriceMarkerTime: Date | null;
  normalizedImportExportSpread: number | null;
  periodHours: number;
  predictedSeries: PredictedPoint[];
  reserveFloorPercent: number;
}): DelayedChargingEstimate | null {
  if (input.currentSocPercent === null) {
    return null;
  }

  let chargeStartSocPercent = input.currentSocPercent;
  let resolvedEstimate: DelayedChargingEstimate | null = null;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const window = resolveDelayedChargingWindow({
      battery: input.battery,
      capacityWh: input.capacityWh,
      chargeStartSocPercent,
      dynamicPriceSamples: input.dynamicPriceSamples,
      item: input.item,
      lowPriceMarkerTime: input.lowPriceMarkerTime,
      normalizedImportExportSpread: input.normalizedImportExportSpread,
    });

    if (window === null) {
      return null;
    }

    const intervalEstimate = buildIntervalEnergyEstimate({
      integrationEnd: window.endTime,
      integrationStart: window.startTime,
      loadProfile: input.loadProfile,
      mode: "solar-minus-load",
      periodHours: input.periodHours,
      predictedSeries: input.predictedSeries,
    });
    const targetPercent = clampPercent(
      100 -
        Math.ceil(
          (intervalEstimate.estimatedRemainingEnergyWh /
            Math.max(1, input.capacityWh)) *
            100,
        ),
      input.reserveFloorPercent,
    );
    const nextChargeStartSocPercent = Math.min(
      input.currentSocPercent,
      targetPercent,
    );

    resolvedEstimate = {
      ...intervalEstimate,
      targetPercent,
      window,
    };

    if (nextChargeStartSocPercent === chargeStartSocPercent) {
      return resolvedEstimate;
    }

    chargeStartSocPercent = nextChargeStartSocPercent;
  }

  return resolvedEstimate;
}

function buildIntervalEnergyEstimate(input: {
  integrationEnd: Date;
  integrationStart: Date;
  loadProfile: LoadProfile;
  mode: "load-minus-solar" | "solar-minus-load";
  periodHours: number;
  predictedSeries: PredictedPoint[];
}): IntervalEnergyEstimate {
  const forecastPeriods = input.predictedSeries
    .map((point) => {
      const overlapHours = resolveIntervalOverlapHours({
        intervalEnd: input.integrationEnd,
        intervalStart: input.integrationStart,
        periodHours: input.periodHours,
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
        input.loadProfile,
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
      input.mode === "solar-minus-load"
        ? Math.max(
            0,
            cumulativePredictedSolarWh - cumulativeExpectedHouseLoadWh,
          )
        : Math.max(
            0,
            cumulativeExpectedHouseLoadWh - cumulativePredictedSolarWh,
          ),
    );

    return {
      time: point.periodStart,
      durationMinutes,
      expectedHouseLoadWh: bucketExpectedHouseLoadWh,
      predictedSolarWh: bucketPredictedSolarWh,
      netBatteryEnergyNeededWh: round2(
        input.mode === "solar-minus-load"
          ? Math.max(0, bucketPredictedSolarWh - bucketExpectedHouseLoadWh)
          : Math.max(0, bucketExpectedHouseLoadWh - bucketPredictedSolarWh),
      ),
      cumulativeExpectedHouseLoadWh,
      cumulativePredictedSolarWh,
      cumulativeNetBatteryEnergyNeededWh,
    };
  });
  const lastEnergyBucket = energyBuckets[energyBuckets.length - 1] ?? null;

  return {
    energyBuckets,
    estimatedRemainingEnergyWh:
      lastEnergyBucket?.cumulativeNetBatteryEnergyNeededWh ?? 0,
    expectedHouseLoadWh: lastEnergyBucket?.cumulativeExpectedHouseLoadWh ?? 0,
    predictedSolarGenerationWh:
      lastEnergyBucket?.cumulativePredictedSolarWh ?? 0,
  };
}

function getDelayedChargingSkipReason(input: {
  itemId: string;
  targetTime: Date | null;
  window: DelayedChargingWindow | null;
  expectedNetChargeWh: number | null;
  startPlan: DelayedChargingStartPlan | { startTime: null };
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

  if (input.startPlan.startTime === null) {
    return `skipped: no delayed charging start time could be resolved for item ${input.itemId}`;
  }

  return null;
}

function resolveDelayedChargingStartPlan(input: {
  battery: BatteryRecord;
  batteryPowerSamples: BatteryPowerSampleRecord[];
  capacityWh: number;
  item: BatteryStrategyPlanItem;
  now: Date;
  sampleSocPercent: number | null;
  targetPercent: number;
  targetTime: Date;
}): DelayedChargingStartPlan | null {
  const effectiveDischargePowerW = resolveDelayedChargingDischargePowerW(
    input.battery,
    input.item,
  );

  if (effectiveDischargePowerW === null) {
    return null;
  }

  if (
    input.sampleSocPercent !== null &&
    input.now.getTime() < input.targetTime.getTime()
  ) {
    return buildDelayedChargingStartPlan({
      basisSocPercent: input.sampleSocPercent,
      basisTime: input.now,
      capacityWh: input.capacityWh,
      effectiveDischargePowerW,
      targetPercent: input.targetPercent,
      targetTime: input.targetTime,
    });
  }

  const historicalSocSamples = input.batteryPowerSamples
    .filter(
      (sample) =>
        sample.batteryId === input.battery.id &&
        sample.socPercent !== null &&
        new Date(sample.periodStart).getTime() <= input.targetTime.getTime(),
    )
    .sort(
      (left, right) =>
        new Date(right.periodStart).getTime() -
        new Date(left.periodStart).getTime(),
    );

  for (const sample of historicalSocSamples) {
    const basisTime = new Date(sample.periodStart);

    if (Number.isNaN(basisTime.getTime()) || sample.socPercent === null) {
      continue;
    }

    const candidatePlan = buildDelayedChargingStartPlan({
      basisSocPercent: sample.socPercent,
      basisTime,
      capacityWh: input.capacityWh,
      effectiveDischargePowerW,
      targetPercent: input.targetPercent,
      targetTime: input.targetTime,
    });

    if (candidatePlan === null) {
      continue;
    }

    if (candidatePlan.startTime.getTime() < basisTime.getTime()) {
      continue;
    }

    return candidatePlan;
  }

  return null;
}

function buildDelayedChargingStartPlan(input: {
  basisSocPercent: number;
  basisTime: Date;
  capacityWh: number;
  effectiveDischargePowerW: number;
  targetPercent: number;
  targetTime: Date;
}): DelayedChargingStartPlan | null {
  if (
    Number.isNaN(input.basisTime.getTime()) ||
    Number.isNaN(input.targetTime.getTime()) ||
    input.effectiveDischargePowerW <= 0
  ) {
    return null;
  }

  const requiredDischargeWh = Math.max(
    0,
    ((input.basisSocPercent - input.targetPercent) / 100) * input.capacityWh,
  );
  const requiredDischargeMinutes = Math.ceil(
    (requiredDischargeWh / input.effectiveDischargePowerW) * 60,
  );

  return {
    effectiveDischargePowerW: input.effectiveDischargePowerW,
    requiredDischargeMinutes,
    startSocPercent: input.basisSocPercent,
    startTime:
      requiredDischargeWh <= 0
        ? input.basisTime
        : new Date(
            input.targetTime.getTime() - requiredDischargeMinutes * 60_000,
          ),
  };
}

function resolveDelayedChargingDischargePowerW(
  battery: BatteryRecord,
  item: BatteryStrategyPlanItem,
): number | null {
  if (typeof item.manualPowerW === "number" && item.manualPowerW > 0) {
    return item.manualPowerW;
  }

  return battery.maximumDischargePowerW > 0
    ? battery.maximumDischargePowerW
    : null;
}

function resolveDelayedChargingChargePowerW(
  battery: BatteryRecord,
  item: BatteryStrategyPlanItem,
): number | null {
  if (typeof item.manualPowerW === "number" && item.manualPowerW > 0) {
    return item.manualPowerW;
  }

  return battery.maximumChargePowerW > 0 ? battery.maximumChargePowerW : null;
}

function resolveDelayedChargingSocBasis(input: {
  battery: BatteryRecord;
  batteryPowerSamples: BatteryPowerSampleRecord[];
  now: Date;
  sampleSocPercent: number | null;
}): { socPercent: number; time: Date } | null {
  if (input.sampleSocPercent !== null) {
    return { socPercent: input.sampleSocPercent, time: input.now };
  }

  const samples = input.batteryPowerSamples
    .filter(
      (sample) =>
        sample.batteryId === input.battery.id &&
        sample.socPercent !== null &&
        new Date(sample.periodStart).getTime() <= input.now.getTime(),
    )
    .sort(
      (left, right) =>
        new Date(right.periodStart).getTime() -
        new Date(left.periodStart).getTime(),
    );

  for (const sample of samples) {
    const time = new Date(sample.periodStart);

    if (Number.isNaN(time.getTime()) || sample.socPercent === null) {
      continue;
    }

    return { socPercent: sample.socPercent, time };
  }

  return null;
}

function serializeDelayedChargingDetails(input: {
  chargeStartSocPercent: number | null;
  currentSocBasisPercent: number | null;
  preDischargeTargetSocPercent: number | null;
  startPlan: DelayedChargingStartPlan | null;
  window: DelayedChargingWindow | null;
}): DynamicPriceTargetEstimate["delayedChargingDetails"] {
  if (
    input.window === null ||
    input.currentSocBasisPercent === null ||
    input.chargeStartSocPercent === null
  ) {
    return null;
  }

  return {
    actualWindowEnd: input.window.endTime.toISOString(),
    actualWindowEndPrice: input.window.endPrice,
    actualWindowStart: input.window.startTime.toISOString(),
    actualWindowStartPrice: input.window.startPrice,
    chargePowerW: input.window.chargePowerW,
    chargeStartSocPercent: input.chargeStartSocPercent,
    currentSocBasisPercent: input.currentSocBasisPercent,
    latestFeasiblePreDischargeStartTime:
      input.startPlan?.startTime.toISOString() ?? null,
    lowestPrice: input.window.lowestPrice,
    lowPriceMargin: input.window.lowPriceMargin,
    lowPriceMarkerTime: input.window.lowPriceMarkerTime.toISOString(),
    minimumTimeToFullChargeMinutes: input.window.minimumTimeToFullChargeMinutes,
    normalizedImportExportSpread: input.window.normalizedImportExportSpread,
    potentialWindowEnd: input.window.potentialEndTime.toISOString(),
    potentialWindowStart: input.window.potentialStartTime.toISOString(),
    preDischargeTargetSocPercent: input.preDischargeTargetSocPercent,
  };
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
  battery: BatteryRecord;
  capacityWh: number;
  chargeStartSocPercent: number | null;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  lowPriceMarkerTime: Date | null;
  normalizedImportExportSpread: number | null;
}): DelayedChargingWindow | null {
  const lowPriceMarkerTime = input.lowPriceMarkerTime;

  if (lowPriceMarkerTime === null) {
    return null;
  }

  if (
    input.chargeStartSocPercent === null ||
    input.normalizedImportExportSpread === null ||
    input.normalizedImportExportSpread < 0
  ) {
    return null;
  }

  const effectiveChargePowerW = resolveDelayedChargingChargePowerW(
    input.battery,
    input.item,
  );

  if (effectiveChargePowerW === null) {
    return null;
  }

  const markerMs = lowPriceMarkerTime.getTime();
  const sortedSamples = input.dynamicPriceSamples
    .map((sample) => ({
      date: new Date(sample.periodStart),
      price: sample.importPrice,
    }))
    .filter(
      (sample) =>
        !Number.isNaN(sample.date.getTime()) && Number.isFinite(sample.price),
    )
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const markerIndex = sortedSamples.findIndex(
    (sample) => sample.date.getTime() === markerMs,
  );

  if (markerIndex === -1) {
    return null;
  }

  const markerSample = sortedSamples[markerIndex];

  if (!markerSample) {
    return null;
  }

  const energyToFullWh = Math.max(
    0,
    input.capacityWh * ((100 - input.chargeStartSocPercent) / 100),
  );
  const minimumTimeToFullChargeMinutes = Math.ceil(
    (energyToFullWh / effectiveChargePowerW) * 60,
  );
  const minimumTimeToFullChargeMs = minimumTimeToFullChargeMinutes * 60_000;
  const potentialStartTime = new Date(markerMs - minimumTimeToFullChargeMs);
  const potentialEndTime = new Date(markerMs + minimumTimeToFullChargeMs);
  const lowPriceMargin = Number(
    (
      input.normalizedImportExportSpread *
      DELAYED_CHARGING_LOW_PRICE_MARGIN_FACTOR
    ).toFixed(6),
  );
  const lowPriceThreshold = markerSample.price + lowPriceMargin;
  let startIndex = markerIndex;
  let endIndex = markerIndex;

  while (startIndex > 0) {
    const previousSample = sortedSamples[startIndex - 1];

    if (
      !previousSample ||
      previousSample.date.getTime() < potentialStartTime.getTime() ||
      previousSample.price > lowPriceThreshold
    ) {
      break;
    }

    startIndex -= 1;
  }

  while (endIndex < sortedSamples.length - 1) {
    const nextSample = sortedSamples[endIndex + 1];

    if (
      !nextSample ||
      nextSample.date.getTime() > potentialEndTime.getTime() ||
      nextSample.price > lowPriceThreshold
    ) {
      break;
    }

    endIndex += 1;
  }

  const startSample = sortedSamples[startIndex];
  const endSample = sortedSamples[endIndex];

  if (!startSample || !endSample) {
    return null;
  }

  const nextSample = sortedSamples[endIndex + 1] ?? null;
  const inferredPeriodMs = resolvePriceSamplePeriodMs(sortedSamples);
  const endTime =
    nextSample !== null &&
    nextSample.date.getTime() <= potentialEndTime.getTime()
      ? nextSample.date
      : new Date(
          Math.min(
            potentialEndTime.getTime(),
            endSample.date.getTime() + inferredPeriodMs,
          ),
        );

  if (endTime.getTime() <= startSample.date.getTime()) {
    return null;
  }

  return {
    chargePowerW: effectiveChargePowerW,
    chargeStartSocPercent: input.chargeStartSocPercent,
    endTime,
    endPrice: endSample.price,
    lowPriceMargin,
    lowestPrice: markerSample.price,
    lowPriceMarkerTime,
    minimumTimeToFullChargeMinutes,
    normalizedImportExportSpread: input.normalizedImportExportSpread,
    potentialEndTime,
    potentialStartTime,
    startTime: startSample.date,
    startPrice: startSample.price,
  };
}

function resolvePriceSamplePeriodMs(
  samples: Array<{ date: Date; price: number }>,
): number {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];

    if (!previous || !current) {
      continue;
    }

    const diffMs = current.date.getTime() - previous.date.getTime();

    if (diffMs > 0) {
      return diffMs;
    }
  }

  return DEFAULT_PERIOD_MINUTES * 60_000;
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
  delayedChargingStartPlan: DelayedChargingStartPlan | null;
  delayedChargingWindow: DelayedChargingWindow | null;
  expectedLoadBySlot: Map<string, number>;
  predictedSolarGenerationWh: number;
  solarRecoveryTime: Date | null;
}): string {
  const parts = [] as string[];

  if (input.delayedChargingWindow !== null) {
    parts.push(
      "expected solar charge opportunity during the delayed charging window",
    );
    if (input.delayedChargingStartPlan !== null) {
      parts.push("latest feasible delayed-charging start time");
    }
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
