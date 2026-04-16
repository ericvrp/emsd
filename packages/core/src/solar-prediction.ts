import type {
  SolarEnergyProviderSampleRecord,
  SolarForecastSampleRecord,
} from "./index";

export const MAX_SOLAR_PREDICTION_PRECEDING_DAYS = 7;
export const SOLAR_PREDICTION_MATCH_TOLERANCE_MS = 7.5 * 60 * 1_000;

export interface PredictedSolarGenerationPoint {
  periodStart: string;
  value: number | null;
}

export interface SolarPredictionOptions {
  maxPrecedingDays?: number;
  matchToleranceMs?: number;
  minForecastWm2?: number;
  useOutlierRemoval?: boolean;
  targetForecastSamples?: SolarForecastSampleRecord[];
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

function computeMeanWithOutlierRemoval(ratios: number[]): number {
  if (ratios.length < 4) {
    return ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length;
  }

  const sorted = [...ratios].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, -1);
  return trimmed.reduce((total, ratio) => total + ratio, 0) / trimmed.length;
}

function predictSolarGenerationForForecastSample(
  forecastIndex: TimestampedValueIndex,
  generationIndex: TimestampedValueIndex,
  forecastValue: number | null,
  maxPrecedingDays: number,
  matchToleranceMs: number,
  periodStart: string,
  minForecastWm2: number,
  useOutlierRemoval: boolean,
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

  const ratios: number[] = [];

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

    ratios.push(generationMatch.value / forecastMatch.value);
  }

  if (ratios.length === 0) {
    return null;
  }

  const averageRatio = useOutlierRemoval
    ? computeMeanWithOutlierRemoval(ratios)
    : ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length;
  return forecastValue * averageRatio;
}

export function buildPredictedSolarGenerationSeries(input: {
  forecastSamples: SolarForecastSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  targetForecastSamples?: SolarForecastSampleRecord[];
  maxPrecedingDays?: number;
  matchToleranceMs?: number;
  minForecastWm2?: number;
  useOutlierRemoval?: boolean;
}): PredictedSolarGenerationPoint[] {
  const forecastIndex = buildTimestampedValueIndex(
    input.forecastSamples.map((sample) => ({
      timestamp: sample.periodStart,
      value: sample.ghiWm2 ?? sample.value,
    })),
  );
  const generationIndex = buildTimestampedValueIndex(
    aggregateSolarGenerationByPeriodStart(input.solarEnergyProviderSamples),
  );
  const targetSamples = input.targetForecastSamples ?? input.forecastSamples;
  const maxPrecedingDays =
    input.maxPrecedingDays ?? MAX_SOLAR_PREDICTION_PRECEDING_DAYS;
  const matchToleranceMs =
    input.matchToleranceMs ?? SOLAR_PREDICTION_MATCH_TOLERANCE_MS;
  const minForecastWm2 = input.minForecastWm2 ?? 5;
  const useOutlierRemoval = input.useOutlierRemoval ?? true;

  return targetSamples.map((sample) => ({
    periodStart: sample.periodStart,
    value: predictSolarGenerationForForecastSample(
      forecastIndex,
      generationIndex,
      sample.ghiWm2 ?? sample.value,
      maxPrecedingDays,
      matchToleranceMs,
      sample.periodStart,
      minForecastWm2,
      useOutlierRemoval,
    ),
  }));
}
