import {
  type BatteryPowerSampleRecord,
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
  DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W,
  DYNAMIC_PRICE_TARGET_PERIOD_MINUTES,
  type DynamicPriceSampleRecord,
  type NormalizedBatteryInfo,
  type P1MeterSampleRecord,
  PRICE_SELECTION_WINDOW_MS,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
  applySolarSeriesSmoothing,
  buildExpectedSiteLoadProfile,
  buildHouseLoadHistorySeries,
  buildPredictedSolarGenerationSeries,
  calculateDynamicReserveFloorPercent,
  findPriceSelections,
  isDelayedChargingAutoDischargeItem,
  resolveExpectedSiteLoadW,
} from "@emsd/core";
import {
  formatDaemonLogTimestamp,
  getNextPriceMarkerTriggerAt,
  getNextStrategyTriggerAt,
} from "./strategy-scheduler";

const MIN_SOLAR_SURPLUS_W = DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W;
const DEFAULT_PERIOD_MINUTES = DYNAMIC_PRICE_TARGET_PERIOD_MINUTES;
const DELAYED_CHARGING_TRIGGER_BASE_FACTOR = 0.5;
const DELAYED_CHARGING_TRIGGER_MARGIN_FACTOR = 1.2;
const IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR = 0.2;
const IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR = 1;
const IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR = 1.2;

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
    activationMode: "charging" | "self-consumption";
    currentSocBasisPercent: number;
    effectiveFillPowerW: number;
    energyToFullWh: number;
    expectedHouseLoadAtMarkerW: number;
    expectedNetSolarFillPowerW: number;
    lowestPrice: number;
    lowPriceMarkerTime: string;
    predictedSolarAtMarkerW: number | null;
    targetChargePercent: number;
    timeToFullMinutes: number;
    triggerLeadTimeMinutes: number;
    triggerMarginFactor: number;
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
  importShortageDetails?: ImportShortageDynamicTargetDetails | null;
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

interface DelayedChargingEstimate {
  activationMode: "charging" | "self-consumption";
  currentSocBasisPercent: number;
  effectiveFillPowerW: number;
  energyToFullWh: number;
  expectedHouseLoadAtMarkerW: number;
  expectedNetSolarFillPowerW: number;
  lowestPrice: number;
  lowPriceMarkerTime: Date;
  predictedSolarAtMarkerW: number | null;
  resolvedManualState: BatteryStrategyPlanItem["manualState"];
  targetPercent: number;
  timeToFullMinutes: number;
  triggerLeadTimeMinutes: number;
  triggerTime: Date;
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

interface DelayedChargingMarkerSignal {
  expectedHouseLoadW: number;
  predictedSolarW: number | null;
  recoveryThresholdW: number;
}

export interface DelayedChargingLowPriceMarkerEligibility {
  eligible: boolean;
  expectedHouseLoadW: number;
  expectedNetSolarFillPowerW: number;
  lowPriceMarkerTime: Date | null;
  predictedSolarW: number | null;
}

export interface ImportShortageEstimate {
  availability: "full" | "partial" | "unavailable";
  chargeStartTime: string | null;
  currentSocPercent: number | null;
  expectedFullAt: string | null;
  expectedHouseLoadDuringSurplusWh: number;
  expectedHouseLoadUntilChargeStartWh: number;
  expectedSolarGenerationWh: number;
  expectedSurplusEnergyWh: number;
  historyStats: {
    historicalPeriodsUsed: number;
    sameWeekdayPeriodsUsed: number;
    slotCount: number;
  };
  projectedChargeStartSocPercent: number | null;
  projectedEndSocPercent: number | null;
  reasoning: string;
  shortageToFullPercent: number | null;
  surplusEndTime: string | null;
  triggerAt: string;
  warning: string | null;
}

export interface ImportShortageDynamicTargetDetails {
  bufferPercent: number;
  currentSocPercent: number;
  effectiveChargePowerW: number;
  energyToImportWh: number;
  expectedHouseLoadUntilSurplusEndWh: number;
  expectedNetSolarSurplusWh: number;
  expectedNetSolarSurplusPercent: number;
  expectedSolarGenerationUntilSurplusEndWh: number;
  lowPriceMarkerTime: string;
  requiredChargeMinutes: number;
  baseTargetSocPercent: number;
  solarSurplusEndTime: string;
  targetSocPercent: number;
  triggerLeadTimeMinutes: number;
  triggerMarginFactor: number;
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
    earliestRecoveryAt:
      windowKind === "evening-export-surplus"
        ? startOfNextDay(input.now)
        : input.now,
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
  if (isDelayedChargingAutoDischarge) {
    return estimateDelayedChargingAuto({
      battery: input.battery,
      capacityWh: input.sample.capacityWh,
      currentSocBasisPercent: delayedChargingSocBasis?.socPercent ?? null,
      dynamicPriceSamples: input.dynamicPriceSamples,
      item: input.item,
      loadProfile,
      lowPriceMarkerTime,
      minimumSolarSurplusW:
        input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
      predictedSeries,
      solarForecastSamples: input.solarForecastSamples,
    });
  }

  const reserveFloorResult = shouldUseDynamicReserveFloor(input.item)
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
  const targetTime = targetTimeBeforeCapacityCheck;

  if (targetTime === null) {
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
      skipReason: null,
      predictedSolarGenerationWh: 0,
      reasoning: "no target horizon could be determined",
      targetTime: fallbackTargetTime,
      targetTimeSignal: serializeSolarRecoverySignal(solarRecoverySignal),
      warning: null,
      windowKind,
    };
  }

  const targetTimeSignal = buildTargetTimeSignal({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    loadProfile,
    predictedSeries,
    solarForecastSamples: input.solarForecastSamples,
    targetTime,
  });
  const intervalEnergyEstimate = buildIntervalEnergyEstimate({
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
  const estimatedTargetPercent = clampPercent(
    estimatedReservePercentAtTargetTime +
      Math.ceil(
        (estimatedRemainingEnergyWh / Math.max(1, input.sample.capacityWh)) *
          100,
      ),
    input.battery.minimumDischargePercent,
  );
  const availability =
    energyBuckets.length === 0 || loadProfile.expectedLoadBySlot.size === 0
      ? "partial"
      : "full";
  const skipReason = null;
  const breakEvenTrace = buildBreakEvenTrace({
    minimumSolarSurplusW:
      input.minimumSolarSurplusWOverride ?? MIN_SOLAR_SURPLUS_W,
    now: input.now,
    predictedSeries,
    loadProfile,
    targetTime,
  });
  const exportSurplusSkipReason = resolveExportSurplusSkipReason({
    dynamicPriceSamples: input.dynamicPriceSamples,
    item: input.item,
    normalizedImportExportSpread: input.normalizedImportExportSpread,
    now: input.now,
  });

  return {
    availability,
    breakEvenTrace,
    energyBuckets,
    estimatedRemainingEnergyWh,
    estimatedReservePercentAtTargetTime,
    estimatedTargetPercent,
    delayedChargingDetails: null,
    expectedHouseLoadWh,
    startTime: input.now.toISOString(),
    startTimeBasisSocPercent: input.sample.socPercent,
    effectiveDischargePowerW: null,
    requiredDischargeMinutes: null,
    predictedSolarGenerationWh,
    reasoning: buildReasoning({
      availability,
      expectedLoadBySlot: loadProfile.expectedLoadBySlot,
      predictedSolarGenerationWh,
      solarRecoveryTime: solarRecoverySignal?.time ?? null,
    }),
    targetTime: targetTime.toISOString(),
    targetTimeSignal,
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
    skipReason: exportSurplusSkipReason ?? skipReason,
    warning: reserveFloorResult.warning,
    windowKind,
  };
}

function resolveExportSurplusSkipReason(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  normalizedImportExportSpread?: number | null | undefined;
  now: Date;
}): string | null {
  if (
    input.item.triggerKind !== BatteryStrategyTriggerKind.ExportSurplus ||
    input.normalizedImportExportSpread === null ||
    input.normalizedImportExportSpread === undefined
  ) {
    return null;
  }

  const markerPair = resolveExportSurplusHighPriceMarkerPair({
    dynamicPriceSamples: input.dynamicPriceSamples,
    now: input.now,
  });

  if (markerPair === null) {
    return null;
  }

  if (
    markerPair.currentMarkerAt.getHours() < 12 ||
    markerPair.nextMarkerAt.getHours() >= 12
  ) {
    return null;
  }

  const currentExportPrice = resolveExportPriceAtTime({
    dynamicPriceSamples: input.dynamicPriceSamples,
    markerAt: markerPair.currentMarkerAt,
    normalizedImportExportSpread: input.normalizedImportExportSpread,
  });
  const nextExportPrice = resolveExportPriceAtTime({
    dynamicPriceSamples: input.dynamicPriceSamples,
    markerAt: markerPair.nextMarkerAt,
    normalizedImportExportSpread: input.normalizedImportExportSpread,
  });

  if (
    currentExportPrice === null ||
    nextExportPrice === null ||
    nextExportPrice <= currentExportPrice
  ) {
    return null;
  }

  return `skipped: next morning high-price marker ${formatDaemonLogTimestamp(markerPair.nextMarkerAt)} has higher export price ${formatPricePerKwh(nextExportPrice)} than afternoon high-price marker ${formatDaemonLogTimestamp(markerPair.currentMarkerAt)} at ${formatPricePerKwh(currentExportPrice)}`;
}

function resolveExportSurplusHighPriceMarkerPair(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  now: Date;
}): { currentMarkerAt: Date; nextMarkerAt: Date } | null {
  const highMarkers = findPriceSelections(
    input.dynamicPriceSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
    PRICE_SELECTION_WINDOW_MS,
  )
    .highest.map((point) => new Date(point.periodStart))
    .filter((markerAt) => !Number.isNaN(markerAt.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  const nowMs = input.now.getTime();
  let currentIndex = highMarkers.findIndex(
    (markerAt) => markerAt.getTime() === nowMs,
  );

  if (currentIndex === -1) {
    for (let index = highMarkers.length - 1; index >= 0; index -= 1) {
      const markerAt = highMarkers[index];

      if (markerAt && markerAt.getTime() <= nowMs) {
        currentIndex = index;
        break;
      }
    }
  }

  if (currentIndex === -1) {
    currentIndex = highMarkers.findIndex(
      (markerAt) => markerAt.getTime() > nowMs,
    );
  }

  const currentMarkerAt = highMarkers[currentIndex];
  const nextMarkerAt = highMarkers[currentIndex + 1];

  return currentMarkerAt && nextMarkerAt
    ? { currentMarkerAt, nextMarkerAt }
    : null;
}

function resolveExportPriceAtTime(input: {
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  markerAt: Date;
  normalizedImportExportSpread: number;
}): number | null {
  const markerMs = input.markerAt.getTime();

  for (const sample of input.dynamicPriceSamples) {
    const sampleMs = new Date(sample.periodStart).getTime();

    if (Number.isNaN(sampleMs) || sampleMs !== markerMs) {
      continue;
    }

    return Number(
      (sample.importPrice - input.normalizedImportExportSpread).toFixed(5),
    );
  }

  return null;
}

function formatPricePerKwh(value: number): string {
  return `${value.toFixed(3)} EUR/kWh`;
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

function buildPredictedSolarSeriesWithForecastFallback(
  solarForecastSamples: SolarForecastSampleRecord[],
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[],
): PredictedPoint[] {
  const forecastByPeriodStart = new Map(
    solarForecastSamples.map((sample) => [sample.periodStart, sample.value]),
  );

  return buildPredictedSolarSeries(
    solarForecastSamples,
    solarEnergyProviderSamples,
  ).map((point) => {
    const forecastValue = forecastByPeriodStart.get(point.periodStart);
    const fallbackValue =
      typeof forecastValue === "number" ? Math.max(0, forecastValue) : null;

    return {
      ...point,
      value:
        point.value === null
          ? fallbackValue
          : fallbackValue === null
            ? point.value
            : Math.max(point.value, fallbackValue),
    };
  });
}

export function resolveDelayedChargingLowPriceMarkerEligibility(input: {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  now: Date;
  p1MeterSamples: P1MeterSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  solarForecastSamples: SolarForecastSampleRecord[];
}): DelayedChargingLowPriceMarkerEligibility {
  const lowPriceMarkerTime = getNextPriceMarkerTriggerAt({
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    now: input.now,
    dynamicPriceSamples: input.dynamicPriceSamples,
  });
  const predictedSeries = buildPredictedSolarSeriesWithForecastFallback(
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

  return resolveDelayedChargingMarkerEligibility({
    loadProfile,
    lowPriceMarkerTime,
    predictedSeries,
    solarForecastSamples: input.solarForecastSamples,
  });
}

export function formatDelayedChargingLowPriceMarkerSkipReason(
  eligibility: DelayedChargingLowPriceMarkerEligibility,
): string {
  if (eligibility.lowPriceMarkerTime === null) {
    return "skipped: no delayed charging marker resolved";
  }

  const predictedSolarText =
    eligibility.predictedSolarW === null
      ? "unknown"
      : String(Math.round(eligibility.predictedSolarW));

  return `skipped: low-price marker ${eligibility.lowPriceMarkerTime.toISOString()} needs expected solar above expected house load, but predicted solar is ${predictedSolarText}W and expected house load is ${Math.round(eligibility.expectedHouseLoadW)}W`;
}

export function estimateImportShortage(input: {
  battery: BatteryRecord;
  batteryPowerSamples: BatteryPowerSampleRecord[];
  now: Date;
  p1MeterSamples: P1MeterSampleRecord[];
  sample: NormalizedBatteryInfo;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  solarForecastSamples: SolarForecastSampleRecord[];
  triggerAt: Date;
}): ImportShortageEstimate {
  const predictedSeries = buildPredictedSolarSeriesWithForecastFallback(
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
  const historyStats = {
    historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
    sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
    slotCount: loadProfile.expectedLoadBySlot.size,
  };
  const capacityWh = input.sample.capacityWh;
  const currentSocPercent = input.sample.socPercent;

  if (capacityWh === null || capacityWh <= 0 || currentSocPercent === null) {
    return {
      availability: "unavailable",
      chargeStartTime: null,
      currentSocPercent,
      expectedFullAt: null,
      expectedHouseLoadDuringSurplusWh: 0,
      expectedHouseLoadUntilChargeStartWh: 0,
      expectedSolarGenerationWh: 0,
      expectedSurplusEnergyWh: 0,
      historyStats,
      projectedChargeStartSocPercent: null,
      projectedEndSocPercent: null,
      reasoning: "battery capacity or current charge was unavailable",
      shortageToFullPercent: null,
      surplusEndTime: null,
      triggerAt: input.triggerAt.toISOString(),
      warning: null,
    };
  }

  const chargeStart = findSolarSurplusStart({
    loadProfile,
    predictedSeries,
    triggerAt: input.triggerAt,
  });

  if (chargeStart === null) {
    return {
      availability: predictedSeries.length === 0 ? "unavailable" : "partial",
      chargeStartTime: null,
      currentSocPercent,
      expectedFullAt: null,
      expectedHouseLoadDuringSurplusWh: 0,
      expectedHouseLoadUntilChargeStartWh: 0,
      expectedSolarGenerationWh: 0,
      expectedSurplusEnergyWh: 0,
      historyStats,
      projectedChargeStartSocPercent: null,
      projectedEndSocPercent: currentSocPercent,
      reasoning: "no expected solar surplus window was found",
      shortageToFullPercent: round2(100 - currentSocPercent),
      surplusEndTime: null,
      triggerAt: input.triggerAt.toISOString(),
      warning: null,
    };
  }

  const surplusEnd = findSolarSurplusEnd({
    chargeStart,
    loadProfile,
    predictedSeries,
    triggerAt: input.triggerAt,
  });
  const periodHours = resolvePeriodHours(input.solarForecastSamples);
  const preChargeEnergyEstimate = buildIntervalEnergyEstimate({
    integrationEnd: chargeStart,
    integrationStart: input.triggerAt,
    loadProfile,
    mode: "load-minus-solar",
    periodHours,
    predictedSeries,
  });
  const surplusEnergyEstimate = buildIntervalEnergyEstimate({
    integrationEnd: surplusEnd,
    integrationStart: chargeStart,
    loadProfile,
    mode: "solar-minus-load",
    periodHours,
    predictedSeries,
  });
  const currentEnergyWh = capacityWh * (currentSocPercent / 100);
  const chargeStartEnergyWh = Math.max(
    0,
    currentEnergyWh - preChargeEnergyEstimate.estimatedRemainingEnergyWh,
  );
  const projectedChargeStartSocPercent = round2(
    (chargeStartEnergyWh / capacityWh) * 100,
  );
  const projectedEndEnergyWh = Math.min(
    capacityWh,
    chargeStartEnergyWh + surplusEnergyEstimate.estimatedRemainingEnergyWh,
  );
  const projectedEndSocPercent = round2(
    (projectedEndEnergyWh / capacityWh) * 100,
  );
  const shortageToFullPercent = round2(100 - projectedEndSocPercent);

  return {
    availability:
      loadProfile.expectedLoadBySlot.size === 0 ? "partial" : "full",
    chargeStartTime: chargeStart.toISOString(),
    currentSocPercent,
    expectedFullAt:
      resolveExpectedFullAt({
        capacityWh,
        chargeStartEnergyWh,
        energyBuckets: surplusEnergyEstimate.energyBuckets,
      })?.toISOString() ?? null,
    expectedHouseLoadDuringSurplusWh: surplusEnergyEstimate.expectedHouseLoadWh,
    expectedHouseLoadUntilChargeStartWh:
      preChargeEnergyEstimate.estimatedRemainingEnergyWh,
    expectedSolarGenerationWh: surplusEnergyEstimate.predictedSolarGenerationWh,
    expectedSurplusEnergyWh: surplusEnergyEstimate.estimatedRemainingEnergyWh,
    historyStats,
    projectedChargeStartSocPercent,
    projectedEndSocPercent,
    reasoning: "expected solar surplus recovery after low-price trigger",
    shortageToFullPercent,
    surplusEndTime: surplusEnd.toISOString(),
    triggerAt: input.triggerAt.toISOString(),
    warning: null,
  };
}

export function estimateImportShortageDynamicTarget(input: {
  battery: BatteryRecord;
  batteryPowerSamples: BatteryPowerSampleRecord[];
  lowPriceMarkerTime: Date;
  now: Date;
  p1MeterSamples: P1MeterSampleRecord[];
  sample: NormalizedBatteryInfo;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  solarForecastSamples: SolarForecastSampleRecord[];
}): DynamicPriceTargetEstimate {
  const predictedSeries = buildPredictedSolarSeriesWithForecastFallback(
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
  const historyStats = {
    historicalPeriodsUsed: loadProfile.historicalPeriodsUsed,
    sameWeekdayPeriodsUsed: loadProfile.sameWeekdayPeriodsUsed,
    slotCount: loadProfile.expectedLoadBySlot.size,
  };
  const capacityWh = input.sample.capacityWh;
  const currentSocPercent = input.sample.socPercent;
  const availability =
    predictedSeries.length === 0
      ? "unavailable"
      : loadProfile.expectedLoadBySlot.size === 0
        ? "partial"
        : "full";
  const solarSurplusEnd =
    predictedSeries.length === 0
      ? null
      : (findFinalSolarSurplusEnd({
          loadProfile,
          predictedSeries,
          triggerAt: input.lowPriceMarkerTime,
        }) ?? endOfDay(input.lowPriceMarkerTime));
  const baseEstimate = createImportShortageDynamicTargetBase({
    availability,
    expectedHouseLoadWh: 0,
    historyStats,
    lowPriceMarkerTime: input.lowPriceMarkerTime,
    predictedSolarGenerationWh: 0,
    sample: input.sample,
  });
  const intervalEnergyEstimate = solarSurplusEnd
    ? buildIntervalEnergyEstimate({
        integrationEnd: solarSurplusEnd,
        integrationStart: input.lowPriceMarkerTime,
        loadProfile,
        mode: "solar-minus-load",
        periodHours: resolvePeriodHours(input.solarForecastSamples),
        predictedSeries,
      })
    : null;

  if (capacityWh === null || capacityWh <= 0 || currentSocPercent === null) {
    return {
      ...baseEstimate,
      skipReason: formatImportShortageSkipReason({
        currentSocPercent,
        lowPriceMarkerTime: input.lowPriceMarkerTime,
        reason: "battery capacity or current charge unavailable",
        solarSurplusEndTime: solarSurplusEnd,
      }),
    };
  }

  if (solarSurplusEnd === null || intervalEnergyEstimate === null) {
    return {
      ...baseEstimate,
      skipReason: formatImportShortageSkipReason({
        currentSocPercent,
        lowPriceMarkerTime: input.lowPriceMarkerTime,
        reason: "solar forecast unavailable",
        solarSurplusEndTime: solarSurplusEnd,
      }),
    };
  }

  const expectedNetSolarSurplusWh =
    intervalEnergyEstimate.estimatedRemainingEnergyWh;
  const expectedNetSolarSurplusPercent = round2(
    (expectedNetSolarSurplusWh / capacityWh) * 100,
  );
  const baseTargetSocPercent = round2(100 - expectedNetSolarSurplusPercent);
  const hoursUntilSolarSurplusEnd = Math.max(
    0,
    (solarSurplusEnd.getTime() - input.lowPriceMarkerTime.getTime()) /
      3_600_000,
  );
  const bufferPercent = round2(
    hoursUntilSolarSurplusEnd * IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR,
  );
  const targetSocPercent = round2(
    Math.min(100, Math.max(0, baseTargetSocPercent + bufferPercent)),
  );
  const energyToImportWh = round2(
    Math.max(0, capacityWh * ((targetSocPercent - currentSocPercent) / 100)),
  );

  if (energyToImportWh <= 0) {
    return {
      ...baseEstimate,
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: currentSocPercent,
      estimatedTargetPercent: targetSocPercent,
      expectedHouseLoadWh: intervalEnergyEstimate.expectedHouseLoadWh,
      predictedSolarGenerationWh:
        intervalEnergyEstimate.predictedSolarGenerationWh,
      skipReason: formatImportShortageSkipReason({
        bufferPercent,
        currentSocPercent,
        energyToImportWh,
        expectedHouseLoadUntilSurplusEndWh:
          intervalEnergyEstimate.expectedHouseLoadWh,
        expectedNetSolarSurplusPercent,
        expectedNetSolarSurplusWh,
        expectedSolarGenerationUntilSurplusEndWh:
          intervalEnergyEstimate.predictedSolarGenerationWh,
        lowPriceMarkerTime: input.lowPriceMarkerTime,
        reason: "current charge already meets import-shortage target",
        baseTargetSocPercent,
        solarSurplusEndTime: solarSurplusEnd,
        targetSocPercent,
      }),
    };
  }

  if (input.battery.maximumChargePowerW <= 0) {
    return {
      ...baseEstimate,
      skipReason: formatImportShortageSkipReason({
        bufferPercent,
        currentSocPercent,
        energyToImportWh,
        expectedHouseLoadUntilSurplusEndWh:
          intervalEnergyEstimate.expectedHouseLoadWh,
        expectedNetSolarSurplusPercent,
        expectedNetSolarSurplusWh,
        expectedSolarGenerationUntilSurplusEndWh:
          intervalEnergyEstimate.predictedSolarGenerationWh,
        lowPriceMarkerTime: input.lowPriceMarkerTime,
        reason: "maximum charge power unavailable",
        baseTargetSocPercent,
        solarSurplusEndTime: solarSurplusEnd,
        targetSocPercent,
      }),
    };
  }

  const requiredChargeMinutes = Math.ceil(
    (energyToImportWh / input.battery.maximumChargePowerW) * 60,
  );
  const triggerLeadTimeMinutes = Math.ceil(
    requiredChargeMinutes *
      IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR *
      IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR,
  );
  const triggerAt = new Date(
    input.lowPriceMarkerTime.getTime() - triggerLeadTimeMinutes * 60_000,
  );

  return {
    ...baseEstimate,
    delayedChargingDetails: null,
    estimatedRemainingEnergyWh: energyToImportWh,
    estimatedReservePercentAtTargetTime: currentSocPercent,
    estimatedTargetPercent: targetSocPercent,
    expectedHouseLoadWh: intervalEnergyEstimate.expectedHouseLoadWh,
    importShortageDetails: {
      bufferPercent,
      currentSocPercent,
      effectiveChargePowerW: input.battery.maximumChargePowerW,
      energyToImportWh,
      expectedHouseLoadUntilSurplusEndWh:
        intervalEnergyEstimate.expectedHouseLoadWh,
      expectedNetSolarSurplusPercent,
      expectedNetSolarSurplusWh,
      expectedSolarGenerationUntilSurplusEndWh:
        intervalEnergyEstimate.predictedSolarGenerationWh,
      lowPriceMarkerTime: input.lowPriceMarkerTime.toISOString(),
      requiredChargeMinutes,
      baseTargetSocPercent,
      solarSurplusEndTime: solarSurplusEnd.toISOString(),
      targetSocPercent,
      triggerLeadTimeMinutes,
      triggerMarginFactor: IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR,
    },
    predictedSolarGenerationWh:
      intervalEnergyEstimate.predictedSolarGenerationWh,
    startTime: triggerAt.toISOString(),
    startTimeBasisSocPercent: currentSocPercent,
    resolvedManualState: "charging",
    skipReason: null,
    targetTime: input.lowPriceMarkerTime.toISOString(),
    reasoning: `required marker charge for net solar surplus until solar-surplus end plus ${IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR}%/hour buffer`,
  };
}

export function formatImportShortageEstimateForLog(input: {
  batteryId: string;
  estimate: ImportShortageEstimate;
}): string {
  const expectedFullAt = input.estimate.expectedFullAt
    ? ` expectedFullAt=${input.estimate.expectedFullAt}`
    : "";

  return `import-shortage estimate for battery ${input.batteryId}: triggerAt=${input.estimate.triggerAt} currentSoc=${formatNullablePercent(input.estimate.currentSocPercent)} chargeStart=${input.estimate.chargeStartTime ?? "unknown"} surplusEnd=${input.estimate.surplusEndTime ?? "unknown"} solarEnergy=${formatWhAsKwh(input.estimate.expectedSolarGenerationWh)} houseEnergyDuringSurplus=${formatWhAsKwh(input.estimate.expectedHouseLoadDuringSurplusWh)} surplusEnergy=${formatWhAsKwh(input.estimate.expectedSurplusEnergyWh)} houseEnergyUntilChargeStart=${formatWhAsKwh(input.estimate.expectedHouseLoadUntilChargeStartWh)} projectedChargeStartSoc=${formatNullablePercent(input.estimate.projectedChargeStartSocPercent)} projectedEndSoc=${formatNullablePercent(input.estimate.projectedEndSocPercent)} shortageToFull=${formatNullablePercent(input.estimate.shortageToFullPercent)} availability=${input.estimate.availability}${expectedFullAt}`;
}

function formatImportShortageSkipReason(input: {
  bufferPercent?: number | null;
  baseTargetSocPercent?: number | null;
  currentSocPercent: number | null;
  energyToImportWh?: number | null;
  expectedHouseLoadUntilSurplusEndWh?: number | null;
  expectedNetSolarSurplusPercent?: number | null;
  expectedNetSolarSurplusWh?: number | null;
  expectedSolarGenerationUntilSurplusEndWh?: number | null;
  lowPriceMarkerTime: Date;
  reason: string;
  solarSurplusEndTime: Date | null;
  targetSocPercent?: number | null;
}): string {
  const parts = [
    `skipped: ${input.reason} for import-shortage item`,
    `marker=${formatImportShortageTimestamp(input.lowPriceMarkerTime)}`,
    `currentSoc=${formatNullablePercent(input.currentSocPercent)}`,
    `solarSurplusEnd=${formatNullableImportShortageDate(input.solarSurplusEndTime)}`,
  ];

  if (
    input.expectedSolarGenerationUntilSurplusEndWh !== null &&
    input.expectedSolarGenerationUntilSurplusEndWh !== undefined
  ) {
    parts.push(
      `solarUntilEnd=${formatWhAsKwh(input.expectedSolarGenerationUntilSurplusEndWh)}`,
    );
  }

  if (
    input.expectedHouseLoadUntilSurplusEndWh !== null &&
    input.expectedHouseLoadUntilSurplusEndWh !== undefined
  ) {
    parts.push(
      `loadUntilEnd=${formatWhAsKwh(input.expectedHouseLoadUntilSurplusEndWh)}`,
    );
  }

  if (
    input.expectedNetSolarSurplusWh !== null &&
    input.expectedNetSolarSurplusWh !== undefined
  ) {
    parts.push(`netSurplus=${formatWhAsKwh(input.expectedNetSolarSurplusWh)}`);
  }

  if (
    input.expectedNetSolarSurplusPercent !== null &&
    input.expectedNetSolarSurplusPercent !== undefined
  ) {
    parts.push(
      `netSolarFill=${formatNullablePercent(input.expectedNetSolarSurplusPercent)}`,
    );
  }

  if (
    input.baseTargetSocPercent !== null &&
    input.baseTargetSocPercent !== undefined
  ) {
    parts.push(
      `baseTarget=${formatNullablePercent(input.baseTargetSocPercent)}`,
    );
  }

  if (input.bufferPercent !== null && input.bufferPercent !== undefined) {
    parts.push(`buffer=${formatNullablePercent(input.bufferPercent)}`);
  }

  if (input.targetSocPercent !== null && input.targetSocPercent !== undefined) {
    parts.push(`targetSoc=${formatNullablePercent(input.targetSocPercent)}`);
  }

  if (input.energyToImportWh !== null && input.energyToImportWh !== undefined) {
    parts.push(`energyToImport=${formatWhAsKwh(input.energyToImportWh)}`);
  }

  return parts.join(" ");
}

function createImportShortageDynamicTargetBase(input: {
  availability: DynamicPriceTargetEstimate["availability"];
  expectedHouseLoadWh: number;
  historyStats: DynamicPriceTargetEstimate["historyStats"];
  lowPriceMarkerTime: Date;
  predictedSolarGenerationWh: number;
  sample: NormalizedBatteryInfo;
}): DynamicPriceTargetEstimate {
  return {
    availability: input.availability,
    breakEvenTrace: [],
    delayedChargingDetails: null,
    effectiveDischargePowerW: null,
    energyBuckets: [],
    estimatedRemainingEnergyWh: 0,
    estimatedReservePercentAtTargetTime: input.sample.socPercent ?? 0,
    estimatedTargetPercent: input.sample.socPercent ?? 100,
    expectedHouseLoadWh: input.expectedHouseLoadWh,
    historyStats: input.historyStats,
    predictedSolarGenerationWh: input.predictedSolarGenerationWh,
    reasoning:
      "required marker charge for net solar surplus until solar-surplus end",
    requiredDischargeMinutes: null,
    resolvedManualState: "charging",
    skipReason: null,
    startTime: input.lowPriceMarkerTime.toISOString(),
    startTimeBasisSocPercent: input.sample.socPercent,
    targetTime: input.lowPriceMarkerTime.toISOString(),
    targetTimeSignal: null,
    warning: null,
    windowKind: "general",
  };
}

function findSolarRecoveryTime(input: {
  earliestRecoveryAt?: Date;
  minimumSolarSurplusW: number;
  now: Date;
  predictedSeries: PredictedPoint[];
  loadProfile: LoadProfile;
}): SolarRecoverySignal | null {
  const earliestRecoveryAt = input.earliestRecoveryAt ?? input.now;

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

function estimateDelayedChargingAuto(input: {
  battery: BatteryRecord;
  capacityWh: number;
  currentSocBasisPercent: number | null;
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  item: BatteryStrategyPlanItem;
  loadProfile: LoadProfile;
  lowPriceMarkerTime: Date | null;
  minimumSolarSurplusW: number;
  predictedSeries: PredictedPoint[];
  solarForecastSamples: SolarForecastSampleRecord[];
}): DynamicPriceTargetEstimate {
  const historyStats = {
    historicalPeriodsUsed: input.loadProfile.historicalPeriodsUsed,
    sameWeekdayPeriodsUsed: input.loadProfile.sameWeekdayPeriodsUsed,
    slotCount: input.loadProfile.expectedLoadBySlot.size,
  };
  const baseAvailability =
    input.loadProfile.expectedLoadBySlot.size === 0 ? "partial" : "full";

  if (input.lowPriceMarkerTime === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      delayedChargingDetails: null,
      effectiveDischargePowerW: null,
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: 100,
      estimatedTargetPercent: 100,
      expectedHouseLoadWh: 0,
      historyStats,
      predictedSolarGenerationWh: 0,
      reasoning: "no delayed-charging marker was resolved",
      requiredDischargeMinutes: null,
      resolvedManualState: null,
      skipReason: `skipped: no delayed charging marker resolved for item ${input.item.id}`,
      startTime: null,
      startTimeBasisSocPercent: input.currentSocBasisPercent,
      targetTime: null,
      targetTimeSignal: null,
      warning: null,
      windowKind: "general",
    };
  }

  if (input.currentSocBasisPercent === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      delayedChargingDetails: null,
      effectiveDischargePowerW: null,
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: 100,
      estimatedTargetPercent: 100,
      expectedHouseLoadWh: 0,
      historyStats,
      predictedSolarGenerationWh: 0,
      reasoning: "no SoC basis was available for delayed charging",
      requiredDischargeMinutes: null,
      resolvedManualState: null,
      skipReason: `skipped: no SoC basis available for delayed charging item ${input.item.id}`,
      startTime: null,
      startTimeBasisSocPercent: null,
      targetTime: input.lowPriceMarkerTime.toISOString(),
      targetTimeSignal: null,
      warning: null,
      windowKind: "general",
    };
  }

  const lowestPrice = resolvePriceAtTime(
    input.dynamicPriceSamples,
    input.lowPriceMarkerTime,
  );

  if (lowestPrice === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      delayedChargingDetails: null,
      effectiveDischargePowerW: null,
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: 100,
      estimatedTargetPercent: 100,
      expectedHouseLoadWh: 0,
      historyStats,
      predictedSolarGenerationWh: 0,
      reasoning: "the delayed-charging marker price was unavailable",
      requiredDischargeMinutes: null,
      resolvedManualState: null,
      skipReason: `skipped: no delayed charging marker price resolved for item ${input.item.id}`,
      startTime: null,
      startTimeBasisSocPercent: input.currentSocBasisPercent,
      targetTime: input.lowPriceMarkerTime.toISOString(),
      targetTimeSignal: null,
      warning: null,
      windowKind: "general",
    };
  }

  const markerEligibility = resolveDelayedChargingMarkerEligibility({
    loadProfile: input.loadProfile,
    lowPriceMarkerTime: input.lowPriceMarkerTime,
    predictedSeries: input.predictedSeries,
    solarForecastSamples: input.solarForecastSamples,
  });
  const markerSignal =
    input.lowPriceMarkerTime === null
      ? null
      : resolveDelayedChargingMarkerSignal({
          loadProfile: input.loadProfile,
          minimumSolarSurplusW: input.minimumSolarSurplusW,
          predictedSeries: input.predictedSeries,
          solarForecastSamples: input.solarForecastSamples,
          targetTime: input.lowPriceMarkerTime,
        });
  if (markerSignal === null) {
    return {
      availability: "unavailable",
      breakEvenTrace: [],
      delayedChargingDetails: null,
      effectiveDischargePowerW: null,
      energyBuckets: [],
      estimatedRemainingEnergyWh: 0,
      estimatedReservePercentAtTargetTime: 100,
      estimatedTargetPercent: 100,
      expectedHouseLoadWh: 0,
      historyStats,
      predictedSolarGenerationWh: 0,
      reasoning: "no delayed-charging marker was resolved",
      requiredDischargeMinutes: null,
      resolvedManualState: null,
      skipReason: `skipped: no delayed charging marker resolved for item ${input.item.id}`,
      startTime: null,
      startTimeBasisSocPercent: input.currentSocBasisPercent,
      targetTime: null,
      targetTimeSignal: null,
      warning: null,
      windowKind: "general",
    };
  }
  const energyToFullWh = Math.max(
    0,
    input.capacityWh * ((100 - input.currentSocBasisPercent) / 100),
  );
  const expectedNetSolarFillPowerW =
    markerEligibility.expectedNetSolarFillPowerW;

  const activationMode = lowestPrice > 0 ? "self-consumption" : "charging";
  const effectiveFillPowerW =
    activationMode === "self-consumption"
      ? expectedNetSolarFillPowerW
      : resolveDelayedChargingChargePowerW(input.battery);

  if (!markerEligibility.eligible) {
    return {
      availability:
        markerSignal.predictedSolarW === null ? "partial" : baseAvailability,
      breakEvenTrace: [],
      delayedChargingDetails: serializeDelayedChargingDetails({
        activationMode,
        currentSocBasisPercent: input.currentSocBasisPercent,
        effectiveFillPowerW: 0,
        energyToFullWh,
        expectedHouseLoadAtMarkerW: markerSignal.expectedHouseLoadW,
        expectedNetSolarFillPowerW,
        lowestPrice,
        lowPriceMarkerTime: input.lowPriceMarkerTime,
        predictedSolarAtMarkerW: markerSignal.predictedSolarW,
        targetChargePercent: 100,
        timeToFullMinutes: 0,
        triggerLeadTimeMinutes: 0,
      }),
      effectiveDischargePowerW: null,
      energyBuckets: [],
      estimatedRemainingEnergyWh: energyToFullWh,
      estimatedReservePercentAtTargetTime: 100,
      estimatedTargetPercent: 100,
      expectedHouseLoadWh: 0,
      historyStats,
      predictedSolarGenerationWh: 0,
      reasoning: "expected solar surplus at the low-price marker",
      requiredDischargeMinutes: null,
      resolvedManualState: null,
      skipReason: `${formatDelayedChargingLowPriceMarkerSkipReason(markerEligibility)} for item ${input.item.id}`,
      startTime: null,
      startTimeBasisSocPercent: input.currentSocBasisPercent,
      targetTime: input.lowPriceMarkerTime.toISOString(),
      targetTimeSignal: {
        expectedHouseLoadW: markerSignal.expectedHouseLoadW,
        predictedSolarW: markerSignal.predictedSolarW,
        recoveryThresholdW: markerSignal.recoveryThresholdW,
      },
      warning: null,
      windowKind: "general",
    };
  }

  if (effectiveFillPowerW === null || effectiveFillPowerW <= 0) {
    const skipReason =
      activationMode === "self-consumption"
        ? `${formatDelayedChargingLowPriceMarkerSkipReason(markerEligibility)} for item ${input.item.id}`
        : `skipped: maximum charge power unavailable for delayed charging item ${input.item.id}`;

    return {
      availability:
        markerSignal.predictedSolarW === null ? "partial" : baseAvailability,
      breakEvenTrace: [],
      delayedChargingDetails: serializeDelayedChargingDetails({
        activationMode,
        currentSocBasisPercent: input.currentSocBasisPercent,
        effectiveFillPowerW: 0,
        energyToFullWh,
        expectedHouseLoadAtMarkerW: markerSignal.expectedHouseLoadW,
        expectedNetSolarFillPowerW,
        lowestPrice,
        lowPriceMarkerTime: input.lowPriceMarkerTime,
        predictedSolarAtMarkerW: markerSignal.predictedSolarW,
        targetChargePercent: 100,
        timeToFullMinutes: 0,
        triggerLeadTimeMinutes: 0,
      }),
      effectiveDischargePowerW: null,
      energyBuckets: [],
      estimatedRemainingEnergyWh: energyToFullWh,
      estimatedReservePercentAtTargetTime: 100,
      estimatedTargetPercent: 100,
      expectedHouseLoadWh: 0,
      historyStats,
      predictedSolarGenerationWh: 0,
      reasoning:
        activationMode === "self-consumption"
          ? "expected net solar fill power at the low-price marker"
          : "full charging at the low-price marker",
      requiredDischargeMinutes: null,
      resolvedManualState: null,
      skipReason,
      startTime: null,
      startTimeBasisSocPercent: input.currentSocBasisPercent,
      targetTime: input.lowPriceMarkerTime.toISOString(),
      targetTimeSignal: {
        expectedHouseLoadW: markerSignal.expectedHouseLoadW,
        predictedSolarW: markerSignal.predictedSolarW,
        recoveryThresholdW: markerSignal.recoveryThresholdW,
      },
      warning: null,
      windowKind: "general",
    };
  }

  const timeToFullMinutes = Math.ceil(
    (energyToFullWh / effectiveFillPowerW) * 60,
  );
  const triggerLeadTimeMinutes = Math.ceil(
    timeToFullMinutes *
      DELAYED_CHARGING_TRIGGER_BASE_FACTOR *
      DELAYED_CHARGING_TRIGGER_MARGIN_FACTOR,
  );
  const triggerTime = new Date(
    input.lowPriceMarkerTime.getTime() - triggerLeadTimeMinutes * 60_000,
  );

  return {
    availability:
      markerSignal.predictedSolarW === null ? "partial" : baseAvailability,
    breakEvenTrace: [],
    delayedChargingDetails: serializeDelayedChargingDetails({
      activationMode,
      currentSocBasisPercent: input.currentSocBasisPercent,
      effectiveFillPowerW,
      energyToFullWh,
      expectedHouseLoadAtMarkerW: markerSignal.expectedHouseLoadW,
      expectedNetSolarFillPowerW,
      lowestPrice,
      lowPriceMarkerTime: input.lowPriceMarkerTime,
      predictedSolarAtMarkerW: markerSignal.predictedSolarW,
      targetChargePercent: 100,
      timeToFullMinutes,
      triggerLeadTimeMinutes,
    }),
    effectiveDischargePowerW: null,
    energyBuckets: [],
    estimatedRemainingEnergyWh: energyToFullWh,
    estimatedReservePercentAtTargetTime: 100,
    estimatedTargetPercent: 100,
    expectedHouseLoadWh: 0,
    historyStats,
    predictedSolarGenerationWh: 0,
    reasoning:
      activationMode === "self-consumption"
        ? "expected net solar fill power at the low-price marker"
        : "full charging at the low-price marker",
    requiredDischargeMinutes: null,
    resolvedManualState: activationMode === "charging" ? "charging" : null,
    skipReason: null,
    startTime: triggerTime.toISOString(),
    startTimeBasisSocPercent: input.currentSocBasisPercent,
    targetTime: input.lowPriceMarkerTime.toISOString(),
    targetTimeSignal: {
      expectedHouseLoadW: markerSignal.expectedHouseLoadW,
      predictedSolarW: markerSignal.predictedSolarW,
      recoveryThresholdW: markerSignal.recoveryThresholdW,
    },
    warning: null,
    windowKind: "general",
  };
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

function resolvePriceAtTime(
  samples: DynamicPriceSampleRecord[],
  targetTime: Date,
): number | null {
  for (const sample of samples) {
    const sampleTime = new Date(sample.periodStart);

    if (Number.isNaN(sampleTime.getTime())) {
      continue;
    }

    if (sampleTime.getTime() === targetTime.getTime()) {
      return sample.importPrice;
    }
  }

  return null;
}

function resolveDelayedChargingMarkerSignal(input: {
  loadProfile: LoadProfile;
  minimumSolarSurplusW: number;
  predictedSeries: PredictedPoint[];
  solarForecastSamples: SolarForecastSampleRecord[];
  targetTime: Date;
}): DelayedChargingMarkerSignal {
  const expectedHouseLoadW = resolveExpectedSiteLoadW(
    input.targetTime,
    input.loadProfile,
  );
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
    recoveryThresholdW: expectedHouseLoadW + input.minimumSolarSurplusW,
  };
}

function resolveDelayedChargingMarkerEligibility(input: {
  loadProfile: LoadProfile;
  lowPriceMarkerTime: Date | null;
  predictedSeries: PredictedPoint[];
  solarForecastSamples: SolarForecastSampleRecord[];
}): DelayedChargingLowPriceMarkerEligibility {
  if (input.lowPriceMarkerTime === null) {
    return {
      eligible: false,
      expectedHouseLoadW: 0,
      expectedNetSolarFillPowerW: 0,
      lowPriceMarkerTime: null,
      predictedSolarW: null,
    };
  }

  const markerSignal = resolveDelayedChargingMarkerSignal({
    loadProfile: input.loadProfile,
    minimumSolarSurplusW: MIN_SOLAR_SURPLUS_W,
    predictedSeries: input.predictedSeries,
    solarForecastSamples: input.solarForecastSamples,
    targetTime: input.lowPriceMarkerTime,
  });
  const expectedNetSolarFillPowerW = round2(
    Math.max(0, markerSignal.predictedSolarW ?? 0) -
      markerSignal.expectedHouseLoadW,
  );

  return {
    eligible:
      markerSignal.predictedSolarW !== null &&
      markerSignal.predictedSolarW > markerSignal.expectedHouseLoadW,
    expectedHouseLoadW: markerSignal.expectedHouseLoadW,
    expectedNetSolarFillPowerW,
    lowPriceMarkerTime: input.lowPriceMarkerTime,
    predictedSolarW: markerSignal.predictedSolarW,
  };
}

function findSolarSurplusStart(input: {
  loadProfile: LoadProfile;
  predictedSeries: PredictedPoint[];
  triggerAt: Date;
}): Date | null {
  for (const point of input.predictedSeries) {
    const pointDate = new Date(point.periodStart);

    if (
      Number.isNaN(pointDate.getTime()) ||
      pointDate.getTime() < input.triggerAt.getTime()
    ) {
      continue;
    }

    const predictedSolarW =
      typeof point.value === "number" ? Math.max(0, point.value) : null;
    const expectedHouseLoadW = resolveExpectedSiteLoadW(
      pointDate,
      input.loadProfile,
    );

    if (predictedSolarW !== null && predictedSolarW > expectedHouseLoadW) {
      return pointDate;
    }
  }

  return null;
}

function findSolarSurplusEnd(input: {
  chargeStart: Date;
  loadProfile: LoadProfile;
  predictedSeries: PredictedPoint[];
  triggerAt: Date;
}): Date {
  for (const point of input.predictedSeries) {
    const pointDate = new Date(point.periodStart);

    if (
      Number.isNaN(pointDate.getTime()) ||
      pointDate.getTime() <= input.chargeStart.getTime()
    ) {
      continue;
    }

    const predictedSolarW =
      typeof point.value === "number" ? Math.max(0, point.value) : null;
    const expectedHouseLoadW = resolveExpectedSiteLoadW(
      pointDate,
      input.loadProfile,
    );

    if (predictedSolarW === null || predictedSolarW <= expectedHouseLoadW) {
      return pointDate;
    }
  }

  return endOfDay(input.triggerAt);
}

function findFinalSolarSurplusEnd(input: {
  loadProfile: LoadProfile;
  predictedSeries: PredictedPoint[];
  triggerAt: Date;
}): Date | null {
  let wasInSurplus = false;
  let finalSurplusEnd: Date | null = null;
  let sawSurplus = false;

  for (const point of input.predictedSeries) {
    const pointDate = new Date(point.periodStart);

    if (
      Number.isNaN(pointDate.getTime()) ||
      pointDate.getTime() < input.triggerAt.getTime() ||
      formatLocalDayKey(pointDate) !== formatLocalDayKey(input.triggerAt)
    ) {
      continue;
    }

    const predictedSolarW =
      typeof point.value === "number" ? Math.max(0, point.value) : null;
    const expectedHouseLoadW = resolveExpectedSiteLoadW(
      pointDate,
      input.loadProfile,
    );
    const isInSurplus =
      predictedSolarW !== null && predictedSolarW > expectedHouseLoadW;

    if (isInSurplus) {
      sawSurplus = true;
    }

    if (wasInSurplus && !isInSurplus) {
      finalSurplusEnd = pointDate;
    }

    wasInSurplus = isInSurplus;
  }

  if (!sawSurplus) {
    return null;
  }

  return finalSurplusEnd ?? endOfDay(input.triggerAt);
}

function resolveExpectedFullAt(input: {
  capacityWh: number;
  chargeStartEnergyWh: number;
  energyBuckets: EnergyBucket[];
}): Date | null {
  if (input.chargeStartEnergyWh >= input.capacityWh) {
    const firstBucket = input.energyBuckets[0];

    return firstBucket ? new Date(firstBucket.time) : null;
  }

  let priorCumulativeSurplusWh = 0;

  for (const bucket of input.energyBuckets) {
    const currentEnergyWh =
      input.chargeStartEnergyWh + bucket.cumulativeNetBatteryEnergyNeededWh;

    if (currentEnergyWh < input.capacityWh) {
      priorCumulativeSurplusWh = bucket.cumulativeNetBatteryEnergyNeededWh;
      continue;
    }

    const bucketSurplusWh = Math.max(
      0,
      bucket.cumulativeNetBatteryEnergyNeededWh - priorCumulativeSurplusWh,
    );
    const remainingWh = Math.max(
      0,
      input.capacityWh - input.chargeStartEnergyWh - priorCumulativeSurplusWh,
    );
    const fraction = bucketSurplusWh > 0 ? remainingWh / bucketSurplusWh : 1;
    const bucketStart = new Date(bucket.time);

    if (Number.isNaN(bucketStart.getTime())) {
      return null;
    }

    return new Date(
      bucketStart.getTime() +
        Math.min(1, Math.max(0, fraction)) * bucket.durationMinutes * 60_000,
    );
  }

  return null;
}

function resolveDelayedChargingChargePowerW(
  battery: BatteryRecord,
): number | null {
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
  activationMode: "charging" | "self-consumption";
  currentSocBasisPercent: number;
  effectiveFillPowerW: number;
  energyToFullWh: number;
  expectedHouseLoadAtMarkerW: number;
  expectedNetSolarFillPowerW: number;
  lowestPrice: number;
  lowPriceMarkerTime: Date;
  predictedSolarAtMarkerW: number | null;
  targetChargePercent: number;
  timeToFullMinutes: number;
  triggerLeadTimeMinutes: number;
}): DynamicPriceTargetEstimate["delayedChargingDetails"] {
  return {
    activationMode: input.activationMode,
    currentSocBasisPercent: input.currentSocBasisPercent,
    effectiveFillPowerW: input.effectiveFillPowerW,
    energyToFullWh: round2(input.energyToFullWh),
    expectedHouseLoadAtMarkerW: input.expectedHouseLoadAtMarkerW,
    expectedNetSolarFillPowerW: input.expectedNetSolarFillPowerW,
    lowestPrice: input.lowestPrice,
    lowPriceMarkerTime: input.lowPriceMarkerTime.toISOString(),
    predictedSolarAtMarkerW: input.predictedSolarAtMarkerW,
    targetChargePercent: input.targetChargePercent,
    timeToFullMinutes: input.timeToFullMinutes,
    triggerLeadTimeMinutes: input.triggerLeadTimeMinutes,
    triggerMarginFactor: DELAYED_CHARGING_TRIGGER_MARGIN_FACTOR,
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

function formatNullablePercent(value: number | null): string {
  return value === null ? "unknown" : `${round2(value)}%`;
}

function formatNullableImportShortageTimestamp(value: string | null): string {
  if (value === null) {
    return "unknown";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : formatImportShortageTimestamp(date);
}

function formatNullableImportShortageDate(value: Date | null): string {
  return value === null ? "unknown" : formatImportShortageTimestamp(value);
}

function formatImportShortageTimestamp(date: Date): string {
  return `${date.getFullYear()}-${formatImportShortageTimePart(
    date.getMonth() + 1,
  )}-${formatImportShortageTimePart(date.getDate())} ${formatImportShortageTimePart(date.getHours())}:${formatImportShortageTimePart(date.getMinutes())}`;
}

function formatLocalDayKey(date: Date): string {
  return `${date.getFullYear()}-${formatImportShortageTimePart(
    date.getMonth() + 1,
  )}-${formatImportShortageTimePart(date.getDate())}`;
}

function formatImportShortageTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatWhAsKwh(value: number): string {
  return `${round2(value / 1000)}kWh`;
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

function startOfNextDay(now: Date): Date {
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  return start;
}
