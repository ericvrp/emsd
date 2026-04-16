export const PRICE_SELECTION_WINDOW_MS = 4 * 60 * 60 * 1_000;

export interface PriceSelectionPoint {
  periodStart: string;
  value: number;
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
      value: sample.value,
    }))
    .filter(
      (sample): sample is { periodStart: string; value: number } =>
        typeof sample.value === "number" && Number.isFinite(sample.value),
    )
    .sort(
      (left, right) =>
        new Date(left.periodStart).getTime() -
        new Date(right.periodStart).getTime(),
    );

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

  for (let i = 0; i < validSamples.length; i++) {
    const current = validSamples[i];
    if (!current) {
      continue;
    }
    const currentTime = new Date(current.periodStart).getTime();
    const windowStart = currentTime - windowMs;
    const windowEnd = currentTime + windowMs;

    const windowSamples = validSamples.filter((sample) => {
      const sampleTime = new Date(sample.periodStart).getTime();
      return sampleTime >= windowStart && sampleTime <= windowEnd;
    });

    if (windowSamples.length < 2) {
      continue;
    }

    const samplesOnLeft = windowSamples.filter(
      (s) => new Date(s.periodStart).getTime() < currentTime,
    );
    const samplesOnRight = windowSamples.filter(
      (s) => new Date(s.periodStart).getTime() > currentTime,
    );

    const isHigherThanAllLeft =
      samplesOnLeft.length > 0 &&
      samplesOnLeft.every((s) => s.value < current.value);
    const isHigherThanAllRight =
      samplesOnRight.length > 0 &&
      samplesOnRight.every((s) => s.value < current.value);
    const isLowerThanAllLeft =
      samplesOnLeft.length > 0 &&
      samplesOnLeft.every((s) => s.value > current.value);
    const isLowerThanAllRight =
      samplesOnRight.length > 0 &&
      samplesOnRight.every((s) => s.value > current.value);

    const isLocalHigh = isHigherThanAllLeft && isHigherThanAllRight;
    const isLocalLow = isLowerThanAllLeft && isLowerThanAllRight;

    if (isLocalLow) {
      const alreadyIncluded = lowest.some(
        (l) => l.periodStart === current.periodStart,
      );
      if (!alreadyIncluded) {
        lowest.push({ periodStart: current.periodStart, value: current.value });
      }
    }

    if (isLocalHigh) {
      const alreadyIncluded = highest.some(
        (h) => h.periodStart === current.periodStart,
      );
      if (!alreadyIncluded) {
        highest.push({
          periodStart: current.periodStart,
          value: current.value,
        });
      }
    }
  }

  return { lowest, highest };
}
