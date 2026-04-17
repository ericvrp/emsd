import type {
  SolarEnergyProviderSampleRecord,
  SolarForecastSampleRecord,
} from "./index";

export const MAX_SOLAR_PREDICTION_PRECEDING_DAYS = 7;
export const SOLAR_PREDICTION_MATCH_TOLERANCE_MS = 7.5 * 60 * 1_000;
export const DEFAULT_SOLAR_PREDICTION_ALGORITHM_VERSION = "v2";
const V2_FORECAST_SIMILARITY_EXPONENT = 1.5;

export type SolarPredictionAlgorithmVersion = "v2";

export interface PredictedSolarGenerationPoint {
  periodStart: string;
  value: number | null;
}

export interface SolarPredictionAccuracySummary {
  energyAccuracyPercentage: number | null;
  energyDeltaWh: number;
  overallAccuracyPercentage: number | null;
  scoringPercentage: number | null;
  timingAccuracyPercentage: number | null;
  totalAbsoluteErrorWh: number;
  totalGeneratedWh: number;
  totalPredictedWh: number;
  usedSamples: number;
}

export interface SolarPredictionOptions {
  maxPrecedingDays?: number;
  matchToleranceMs?: number;
  minForecastWm2?: number;
  targetForecastSamples?: SolarForecastSampleRecord[];
}

interface ResolvedSolarPredictionOptions {
  matchToleranceMs: number;
  maxPrecedingDays: number;
  minForecastWm2: number;
  targetForecastSamples: SolarForecastSampleRecord[] | undefined;
}

interface HistoricalMatchSample {
  dayOffset: number;
  forecastValue: number;
  generationValue: number;
  ratio: number;
  similarityWeight: number;
}

interface TimestampedValuePoint {
  timestampMs: number;
  value: number | null;
}

interface TimestampedValueIndex {
  points: TimestampedValuePoint[];
  timestampsMs: number[];
}

function aggregateSolarGenerationByPeriodStart(
  samples: SolarEnergyProviderSampleRecord[],
): Array<{ timestamp: string; value: number | null }> {
  const aggregated = new Map<string, { hasValue: boolean; total: number }>();

  for (const sample of samples) {
    const current = aggregated.get(sample.periodStart) ?? {
      hasValue: false,
      total: 0,
    };

    if (typeof sample.powerW === "number") {
      current.hasValue = true;
      current.total += sample.powerW;
    }

    aggregated.set(sample.periodStart, current);
  }

  return [...aggregated.entries()]
    .map(([timestamp, entry]) => ({
      timestamp,
      value: entry.hasValue ? entry.total : null,
    }))
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    );
}

function buildTimestampedValueIndex(
  values: Array<{ timestamp: string; value: number | null }>,
): TimestampedValueIndex {
  const points = values
    .map((value) => ({
      timestampMs: new Date(value.timestamp).getTime(),
      value: value.value,
    }))
    .filter((value) => Number.isFinite(value.timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  return {
    points,
    timestampsMs: points.map((point) => point.timestampMs),
  };
}

function findTimestampInsertionIndex(
  timestampsMs: number[],
  targetTimestampMs: number,
): number {
  let low = 0;
  let high = timestampsMs.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const value = timestampsMs[middle];

    if (value === undefined) {
      break;
    }

    if (value < targetTimestampMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function findClosestTimestampedValueWithin(
  index: TimestampedValueIndex,
  targetTimestampMs: number,
  maxDeltaMs: number,
): TimestampedValuePoint | null {
  if (!Number.isFinite(targetTimestampMs) || index.points.length === 0) {
    return null;
  }

  const insertionIndex = findTimestampInsertionIndex(
    index.timestampsMs,
    targetTimestampMs,
  );
  let closest: TimestampedValuePoint | null = null;

  for (const candidateIndex of [insertionIndex - 1, insertionIndex]) {
    const candidate = index.points[candidateIndex];

    if (!candidate) {
      continue;
    }

    if (
      closest === null ||
      Math.abs(candidate.timestampMs - targetTimestampMs) <
        Math.abs(closest.timestampMs - targetTimestampMs)
    ) {
      closest = candidate;
    }
  }

  if (
    closest === null ||
    Math.abs(closest.timestampMs - targetTimestampMs) > maxDeltaMs
  ) {
    return null;
  }

  return closest;
}

function computeMean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function computeRecencyWeightedMean(samples: HistoricalMatchSample[]): number {
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const sample of samples) {
    const weight = buildWeightedSampleWeight(sample);
    weightedTotal += sample.ratio * weight;
    totalWeight += weight;
  }

  return totalWeight === 0 ? computeMean(samples.map((sample) => sample.ratio)) : weightedTotal / totalWeight;
}

function computeWinsorizedWeightedMean(samples: HistoricalMatchSample[]): number {
  if (samples.length < 4) {
    return computeRecencyWeightedMean(samples);
  }

  const sorted = [...samples].sort((a, b) => a.ratio - b.ratio);
  const lowerReplacement = sorted[1]?.ratio;
  const upperReplacement = sorted[sorted.length - 2]?.ratio;

  if (lowerReplacement === undefined || upperReplacement === undefined) {
    return computeRecencyWeightedMean(samples);
  }

  const winsorized = samples.map((sample) => ({
    ...sample,
    ratio: Math.min(Math.max(sample.ratio, lowerReplacement), upperReplacement),
  }));

  return computeRecencyWeightedMean(winsorized);
}

function resolveSolarPredictionOptions(
  input: SolarPredictionOptions,
): ResolvedSolarPredictionOptions {
  return {
    matchToleranceMs:
      input.matchToleranceMs ?? SOLAR_PREDICTION_MATCH_TOLERANCE_MS,
    maxPrecedingDays:
      input.maxPrecedingDays ?? MAX_SOLAR_PREDICTION_PRECEDING_DAYS,
    minForecastWm2: input.minForecastWm2 ?? 5,
    targetForecastSamples: input.targetForecastSamples,
  };
}

function buildRecencyWeight(dayOffset: number): number {
  return 1 / dayOffset;
}

function buildForecastSimilarityWeight(
  targetForecastValue: number,
  historicalForecastValue: number,
): number {
  const maxForecastValue = Math.max(targetForecastValue, historicalForecastValue);

  if (maxForecastValue <= 0) {
    return 1;
  }

  return (
    Math.min(targetForecastValue, historicalForecastValue) / maxForecastValue
  ) ** V2_FORECAST_SIMILARITY_EXPONENT;
}

function buildWeightedSampleWeight(sample: HistoricalMatchSample): number {
  return buildRecencyWeight(sample.dayOffset) * sample.similarityWeight;
}

function computeObservedGenerationCeiling(
  generationIndex: TimestampedValueIndex,
): number | null {
  let ceiling: number | null = null;

  for (const point of generationIndex.points) {
    if (typeof point.value !== "number") {
      continue;
    }

    ceiling = ceiling === null ? point.value : Math.max(ceiling, point.value);
  }

  return ceiling;
}

function computeWeightedRegressionRatio(samples: HistoricalMatchSample[]): number {
  let numerator = 0;
  let denominator = 0;

  for (const sample of samples) {
    const weight = buildWeightedSampleWeight(sample);
    numerator += weight * sample.forecastValue * sample.generationValue;
    denominator += weight * sample.forecastValue * sample.forecastValue;
  }

  if (denominator === 0) {
    return computeRecencyWeightedMean(samples);
  }

  return numerator / denominator;
}

function buildV2PredictionValue(input: {
  forecastValue: number;
  generationCeiling: number | null;
  samples: HistoricalMatchSample[];
}): number {
  const robustRatio = computeWinsorizedWeightedMean(input.samples);
  const regressionRatio = computeWeightedRegressionRatio(input.samples);
  const calibrationWeight = Math.min(0.85, 0.35 + input.samples.length * 0.1);
  const blendedRatio =
    robustRatio * (1 - calibrationWeight) +
    regressionRatio * calibrationWeight;
  const predictedValue = input.forecastValue * blendedRatio;

  if (input.generationCeiling === null) {
    return predictedValue;
  }

  return Math.min(predictedValue, input.generationCeiling);
}

function predictSolarGenerationForForecastSample(
  forecastIndex: TimestampedValueIndex,
  generationIndex: TimestampedValueIndex,
  forecastValue: number | null,
  maxPrecedingDays: number,
  matchToleranceMs: number,
  periodStart: string,
  minForecastWm2: number,
): number | null {
  if (forecastValue === null) {
    return null;
  }

  if (forecastValue === 0 || forecastValue < minForecastWm2) {
    return 0;
  }

  const targetDate = new Date(periodStart);

  if (Number.isNaN(targetDate.getTime())) {
    return null;
  }

  const matchSamples: HistoricalMatchSample[] = [];

  for (let dayOffset = 1; dayOffset <= maxPrecedingDays; dayOffset += 1) {
    const historicalDate = new Date(targetDate);
    historicalDate.setDate(historicalDate.getDate() - dayOffset);

    const historicalTimestampMs = historicalDate.getTime();
    const forecastMatch = findClosestTimestampedValueWithin(
      forecastIndex,
      historicalTimestampMs,
      matchToleranceMs,
    );
    const generationMatch = findClosestTimestampedValueWithin(
      generationIndex,
      historicalTimestampMs,
      matchToleranceMs,
    );

    if (
      forecastMatch === null ||
      generationMatch === null ||
      forecastMatch.value === null ||
      generationMatch.value === null ||
      forecastMatch.value <= 0 ||
      forecastMatch.value < minForecastWm2
    ) {
      continue;
    }

    matchSamples.push({
      dayOffset,
      forecastValue: forecastMatch.value,
      generationValue: generationMatch.value,
      ratio: generationMatch.value / forecastMatch.value,
      similarityWeight: buildForecastSimilarityWeight(
        forecastValue,
        forecastMatch.value,
      ),
    });
  }

  if (matchSamples.length === 0) {
    return null;
  }

  return buildV2PredictionValue({
    forecastValue,
    generationCeiling: computeObservedGenerationCeiling(generationIndex),
    samples: matchSamples,
  });
}

export function buildPredictedSolarGenerationSeries(input: {
  forecastSamples: SolarForecastSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  targetForecastSamples?: SolarForecastSampleRecord[];
  maxPrecedingDays?: number;
  matchToleranceMs?: number;
  minForecastWm2?: number;
}): PredictedSolarGenerationPoint[] {
  const resolvedOptions = resolveSolarPredictionOptions(input);
  const forecastIndex = buildTimestampedValueIndex(
    input.forecastSamples.map((sample) => ({
      timestamp: sample.periodStart,
      value: sample.ghiWm2 ?? sample.value,
    })),
  );
  const generationIndex = buildTimestampedValueIndex(
    aggregateSolarGenerationByPeriodStart(input.solarEnergyProviderSamples),
  );
  const targetSamples =
    resolvedOptions.targetForecastSamples ?? input.forecastSamples;

  return targetSamples.map((sample) => ({
    periodStart: sample.periodStart,
    value: predictSolarGenerationForForecastSample(
      forecastIndex,
      generationIndex,
      sample.ghiWm2 ?? sample.value,
      resolvedOptions.maxPrecedingDays,
      resolvedOptions.matchToleranceMs,
      sample.periodStart,
      resolvedOptions.minForecastWm2,
    ),
  }));
}

export function buildSolarPredictionAccuracySummary(input: {
  generatedSeries: Array<{ periodStart: string; value: number | null }>;
  nowMarkerPeriodStart?: string | null;
  predictedSeries: Array<{ periodStart: string; value: number | null }>;
}): SolarPredictionAccuracySummary {
  let totalAbsoluteError = 0;
  let totalGeneratedW = 0;
  let totalPredictedW = 0;
  let denominator = 0;
  let usedSamples = 0;
  const nowMarkerMs = input.nowMarkerPeriodStart
    ? new Date(input.nowMarkerPeriodStart).getTime()
    : null;

  for (let index = 0; index < input.predictedSeries.length; index += 1) {
    const predictedPoint = input.predictedSeries[index];
    const generatedPoint = input.generatedSeries[index];

    if (!predictedPoint || !generatedPoint) {
      continue;
    }

    const periodStartMs = new Date(predictedPoint.periodStart).getTime();

    if (
      nowMarkerMs !== null &&
      !Number.isNaN(periodStartMs) &&
      periodStartMs > nowMarkerMs
    ) {
      continue;
    }

    if (
      typeof predictedPoint.value !== "number" ||
      typeof generatedPoint.value !== "number"
    ) {
      continue;
    }

    totalPredictedW += predictedPoint.value;
    totalGeneratedW += generatedPoint.value;
    totalAbsoluteError += Math.abs(predictedPoint.value - generatedPoint.value);
    denominator += Math.max(predictedPoint.value, generatedPoint.value);
    usedSamples += 1;
  }

  const timingAccuracyPercentage =
    usedSamples === 0
      ? null
      : denominator === 0
        ? 100
        : Math.max(0, 100 * (1 - totalAbsoluteError / denominator));
  const totalPredictedWh = Number((totalPredictedW * 0.25).toFixed(2));
  const totalGeneratedWh = Number((totalGeneratedW * 0.25).toFixed(2));
  const totalAbsoluteErrorWh = Number((totalAbsoluteError * 0.25).toFixed(2));
  const energyScaleWh = Math.max(totalPredictedWh, totalGeneratedWh);
  const energyDeltaWh = Number(
    Math.abs(totalPredictedWh - totalGeneratedWh).toFixed(2),
  );
  const energyAccuracyPercentage =
    usedSamples === 0
      ? null
      : energyScaleWh === 0
        ? 100
        : Math.max(0, 100 * (1 - energyDeltaWh / energyScaleWh));
  const overallAccuracyPercentage =
    energyAccuracyPercentage === null || timingAccuracyPercentage === null
      ? null
      : (energyAccuracyPercentage + timingAccuracyPercentage) / 2;

  return {
    energyAccuracyPercentage:
      energyAccuracyPercentage === null
        ? null
        : Number(energyAccuracyPercentage.toFixed(2)),
    energyDeltaWh,
    overallAccuracyPercentage:
      overallAccuracyPercentage === null
        ? null
        : Number(overallAccuracyPercentage.toFixed(2)),
    scoringPercentage:
      timingAccuracyPercentage === null
        ? null
        : Number(timingAccuracyPercentage.toFixed(2)),
    timingAccuracyPercentage:
      timingAccuracyPercentage === null
        ? null
        : Number(timingAccuracyPercentage.toFixed(2)),
    totalAbsoluteErrorWh,
    totalGeneratedWh,
    totalPredictedWh,
    usedSamples,
  };
}
