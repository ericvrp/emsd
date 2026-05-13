export const PRICE_SELECTION_WINDOW_MS = 4 * 60 * 60 * 1_000;

export interface PriceSelectionPoint {
  periodStart: string;
  value: number;
}

interface ValidPriceSelectionPoint extends PriceSelectionPoint {
  timeMs: number;
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

  const lowest: PriceSelectionPoint[] = [];
  const highest: PriceSelectionPoint[] = [];
  const lowestPeriodStarts = new Set<string>();
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
    let isLowerThanAllLeft = true;
    let isLowerThanAllRight = true;

    for (let leftIndex = i - 1; leftIndex >= 0; leftIndex -= 1) {
      const sample = validSamples[leftIndex];

      if (!sample || sample.timeMs < windowStart) {
        break;
      }

      leftCount += 1;
      isHigherThanAllLeft &&= sample.value < current.value;
      isLowerThanAllLeft &&= sample.value > current.value;
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
      isLowerThanAllRight &&= sample.value > current.value;
    }

    const isLocalHigh =
      leftCount > 0 &&
      rightCount > 0 &&
      isHigherThanAllLeft &&
      isHigherThanAllRight;
    const isLocalLow =
      leftCount > 0 &&
      rightCount > 0 &&
      isLowerThanAllLeft &&
      isLowerThanAllRight;

    if (isLocalLow) {
      if (!lowestPeriodStarts.has(current.periodStart)) {
        lowestPeriodStarts.add(current.periodStart);
        lowest.push({ periodStart: current.periodStart, value: current.value });
      }
    }

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

  return { lowest, highest };
}
