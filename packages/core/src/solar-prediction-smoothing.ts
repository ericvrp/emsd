export const SOLAR_PREDICTION_BUCKET_MS = 15 * 60 * 1_000;

export type SolarPredictionSmoothingMode =
  | "off"
  | "weighted-3"
  | "average-3"
  | "average-5"
  | "weighted-5";

export const SOLAR_PREDICTION_SMOOTHING_MODES: SolarPredictionSmoothingMode[] = [
  "off",
  "weighted-3",
  "average-3",
  "average-5",
  "weighted-5",
];

export const DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE: SolarPredictionSmoothingMode =
  "average-5";

export function applySolarSeriesSmoothing(
  series: Array<{ periodStart: string; value: number | null }>,
  smoothingMode: SolarPredictionSmoothingMode,
): Array<{ periodStart: string; value: number | null }> {
  const smoothingWeights = getSolarPredictionSmoothingWeights(smoothingMode);

  if (smoothingWeights === null) {
    return series;
  }

  return series.map((point, index) => ({
    periodStart: point.periodStart,
    value: buildWeightedPredictionValue(series, index, smoothingWeights),
  }));
}

export function formatSolarPredictionSmoothingMode(
  mode: SolarPredictionSmoothingMode,
): string {
  switch (mode) {
    case "off":
      return "No filter";
    case "weighted-3":
      return "25-50-25 filtering";
    case "average-3":
      return "Three-sample average";
    case "average-5":
      return "Five-sample average";
    case "weighted-5":
      return "Five-sample weighted average";
  }
}

function buildWeightedPredictionValue(
  series: Array<{ periodStart: string; value: number | null }>,
  index: number,
  smoothingWeights: Array<{ offset: number; weight: number }>,
): number | null {
  const referencePoint = series[index];

  if (!referencePoint) {
    return null;
  }

  let weightedTotal = 0;
  let totalWeight = 0;

  for (const weightedPoint of smoothingWeights) {
    const candidateIndex = index + weightedPoint.offset;
    const candidate = series[candidateIndex];

    if (!candidate || typeof candidate.value !== "number") {
      continue;
    }

    if (
      weightedPoint.offset !== 0 &&
      !isAdjacentPredictionBucket(referencePoint, candidate, weightedPoint.offset)
    ) {
      continue;
    }

    weightedTotal += candidate.value * weightedPoint.weight;
    totalWeight += weightedPoint.weight;
  }

  if (totalWeight === 0) {
    return null;
  }

  return weightedTotal / totalWeight;
}

function getSolarPredictionSmoothingWeights(
  smoothingMode: SolarPredictionSmoothingMode,
): Array<{ offset: number; weight: number }> | null {
  switch (smoothingMode) {
    case "off":
      return null;
    case "weighted-3":
      return [
        { offset: -1, weight: 0.25 },
        { offset: 0, weight: 0.5 },
        { offset: 1, weight: 0.25 },
      ];
    case "average-3":
      return [
        { offset: -1, weight: 1 / 3 },
        { offset: 0, weight: 1 / 3 },
        { offset: 1, weight: 1 / 3 },
      ];
    case "average-5":
      return [
        { offset: -2, weight: 0.2 },
        { offset: -1, weight: 0.2 },
        { offset: 0, weight: 0.2 },
        { offset: 1, weight: 0.2 },
        { offset: 2, weight: 0.2 },
      ];
    case "weighted-5":
      return [
        { offset: -2, weight: 0.125 },
        { offset: -1, weight: 0.125 },
        { offset: 0, weight: 0.5 },
        { offset: 1, weight: 0.125 },
        { offset: 2, weight: 0.125 },
      ];
  }
}

function isAdjacentPredictionBucket(
  referencePoint: { periodStart: string; value: number | null },
  candidatePoint: { periodStart: string; value: number | null },
  offset: number,
): boolean {
  const referenceTimestampMs = new Date(referencePoint.periodStart).getTime();
  const candidateTimestampMs = new Date(candidatePoint.periodStart).getTime();

  if (
    Number.isNaN(referenceTimestampMs) ||
    Number.isNaN(candidateTimestampMs)
  ) {
    return false;
  }

  return (
    candidateTimestampMs - referenceTimestampMs ===
    offset * SOLAR_PREDICTION_BUCKET_MS
  );
}
