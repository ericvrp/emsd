export const PRICE_SELECTION_WINDOW_MS = 4 * 60 * 60 * 1_000;
const PRICE_SELECTION_MIN_AVERAGE_IMPROVEMENT = 0.005;
const PRICE_SELECTION_AVERAGE_EPSILON = 1e-9;

export interface PriceSelectionPoint {
  periodStart: string;
  value: number;
}

interface ValidPriceSelectionPoint extends PriceSelectionPoint {
  timeMs: number;
}

interface AveragePriceSelectionPoint extends ValidPriceSelectionPoint {
  averageValue: number;
}

export function findPriceSelections(
  samples: Array<{ periodStart: string; value: number | null }>,
  windowMs: number = PRICE_SELECTION_WINDOW_MS,
): {
  lowest: PriceSelectionPoint[];
  highest: PriceSelectionPoint[];
} {
  const validSamples = samples
    .map((sample) => ({
      periodStart: sample.periodStart,
      timeMs: new Date(sample.periodStart).getTime(),
      value: sample.value,
    }))
    .filter(
      (sample): sample is ValidPriceSelectionPoint =>
        typeof sample.value === "number" &&
        Number.isFinite(sample.value) &&
        !Number.isNaN(sample.timeMs),
    )
    .sort((left, right) => left.timeMs - right.timeMs);

  if (validSamples.length === 0) {
    return { lowest: [], highest: [] };
  }

  if (validSamples.length === 1) {
    const first = validSamples[0];
    if (first) {
      return {
        lowest: [{ periodStart: first.periodStart, value: first.value }],
        highest: [{ periodStart: first.periodStart, value: first.value }],
      };
    }
    return { lowest: [], highest: [] };
  }

  return {
    lowest: findMovingAverageLowSelections(validSamples, windowMs),
    highest: findStrictHighSelections(validSamples, windowMs),
  };
}

function findStrictHighSelections(
  validSamples: ValidPriceSelectionPoint[],
  windowMs: number,
): PriceSelectionPoint[] {
  const highest: PriceSelectionPoint[] = [];
  const highestPeriodStarts = new Set<string>();

  for (let i = 0; i < validSamples.length; i++) {
    const current = validSamples[i];
    if (!current) {
      continue;
    }
    const currentTime = current.timeMs;
    const windowStart = currentTime - windowMs;
    const windowEnd = currentTime + windowMs;
    let leftCount = 0;
    let rightCount = 0;
    let isHigherThanAllLeft = true;
    let isHigherThanAllRight = true;

    for (let leftIndex = i - 1; leftIndex >= 0; leftIndex -= 1) {
      const sample = validSamples[leftIndex];

      if (!sample || sample.timeMs < windowStart) {
        break;
      }

      leftCount += 1;
      isHigherThanAllLeft &&= sample.value < current.value;
    }

    for (
      let rightIndex = i + 1;
      rightIndex < validSamples.length;
      rightIndex += 1
    ) {
      const sample = validSamples[rightIndex];

      if (!sample || sample.timeMs > windowEnd) {
        break;
      }

      rightCount += 1;
      isHigherThanAllRight &&= sample.value < current.value;
    }

    const isLocalHigh =
      leftCount > 0 &&
      rightCount > 0 &&
      isHigherThanAllLeft &&
      isHigherThanAllRight;

    if (isLocalHigh) {
      if (!highestPeriodStarts.has(current.periodStart)) {
        highestPeriodStarts.add(current.periodStart);
        highest.push({
          periodStart: current.periodStart,
          value: current.value,
        });
      }
    }
  }

  return highest;
}

function findMovingAverageLowSelections(
  validSamples: ValidPriceSelectionPoint[],
  windowMs: number,
): PriceSelectionPoint[] {
  const averagePoints = buildCenteredAveragePoints(validSamples, windowMs);
  const candidates = averagePoints.filter((point, index) =>
    isMovingAverageLowCandidate(averagePoints, index, windowMs),
  );
  const selected: AveragePriceSelectionPoint[] = [];

  for (const candidate of [...candidates].sort(compareLowCandidates)) {
    const overlapsSelected = selected.some(
      (point) => Math.abs(point.timeMs - candidate.timeMs) < windowMs,
    );

    if (!overlapsSelected) {
      selected.push(candidate);
    }
  }

  return selected
    .sort((left, right) => left.timeMs - right.timeMs)
    .map((point) => ({ periodStart: point.periodStart, value: point.value }));
}

function buildCenteredAveragePoints(
  validSamples: ValidPriceSelectionPoint[],
  windowMs: number,
): AveragePriceSelectionPoint[] {
  const halfWindowMs = windowMs / 2;
  let windowStartIndex = 0;
  let windowEndIndex = 0;
  let windowSum = 0;

  return validSamples.map((sample) => {
    const windowStartMs = sample.timeMs - halfWindowMs;
    const windowEndMs = sample.timeMs + halfWindowMs;

    while (
      windowStartIndex < validSamples.length &&
      (validSamples[windowStartIndex]?.timeMs ?? Number.POSITIVE_INFINITY) <
        windowStartMs
    ) {
      windowSum -= validSamples[windowStartIndex]?.value ?? 0;
      windowStartIndex += 1;
    }

    while (
      windowEndIndex < validSamples.length &&
      (validSamples[windowEndIndex]?.timeMs ?? Number.POSITIVE_INFINITY) <=
        windowEndMs
    ) {
      windowSum += validSamples[windowEndIndex]?.value ?? 0;
      windowEndIndex += 1;
    }

    return {
      ...sample,
      averageValue: windowSum / (windowEndIndex - windowStartIndex),
    };
  });
}

function isMovingAverageLowCandidate(
  points: AveragePriceSelectionPoint[],
  index: number,
  windowMs: number,
): boolean {
  const current = points[index];

  if (!current) {
    return false;
  }

  let leftCount = 0;
  let rightCount = 0;
  let hasLowerNeighbor = false;
  let hasMeaningfullyHigherLeft = false;
  let hasMeaningfullyHigherRight = false;
  const windowStart = current.timeMs - windowMs;
  const windowEnd = current.timeMs + windowMs;

  for (let leftIndex = index - 1; leftIndex >= 0; leftIndex -= 1) {
    const point = points[leftIndex];

    if (!point || point.timeMs < windowStart) {
      break;
    }

    leftCount += 1;
    hasLowerNeighbor ||= isMeaningfullyLowerAverage(point, current);
    hasMeaningfullyHigherLeft ||= isMeaningfullyHigherAverage(point, current);
  }

  for (
    let rightIndex = index + 1;
    rightIndex < points.length;
    rightIndex += 1
  ) {
    const point = points[rightIndex];

    if (!point || point.timeMs > windowEnd) {
      break;
    }

    rightCount += 1;
    hasLowerNeighbor ||= isMeaningfullyLowerAverage(point, current);
    hasMeaningfullyHigherRight ||= isMeaningfullyHigherAverage(point, current);
  }

  return (
    leftCount > 0 &&
    rightCount > 0 &&
    !hasLowerNeighbor &&
    hasMeaningfullyHigherLeft &&
    hasMeaningfullyHigherRight
  );
}

function compareLowCandidates(
  left: AveragePriceSelectionPoint,
  right: AveragePriceSelectionPoint,
): number {
  const averageDelta = left.averageValue - right.averageValue;

  return Math.abs(averageDelta) > PRICE_SELECTION_AVERAGE_EPSILON
    ? averageDelta
    : left.timeMs - right.timeMs;
}

function isMeaningfullyLowerAverage(
  point: AveragePriceSelectionPoint,
  current: AveragePriceSelectionPoint,
): boolean {
  return (
    point.averageValue < current.averageValue - PRICE_SELECTION_AVERAGE_EPSILON
  );
}

function isMeaningfullyHigherAverage(
  point: AveragePriceSelectionPoint,
  current: AveragePriceSelectionPoint,
): boolean {
  return (
    point.averageValue >=
    current.averageValue + PRICE_SELECTION_MIN_AVERAGE_IMPROVEMENT
  );
}
