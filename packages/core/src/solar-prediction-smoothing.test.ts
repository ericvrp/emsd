import { expect, test } from "bun:test";
import {
  applySolarSeriesSmoothing,
  formatSolarPredictionSmoothingMode,
} from "./solar-prediction-smoothing";

test("average-3 smoothing averages adjacent buckets", () => {
  const smoothed = applySolarSeriesSmoothing(
    [
      { periodStart: "2026-04-09T12:00:00.000Z", value: 100 },
      { periodStart: "2026-04-09T12:15:00.000Z", value: 200 },
      { periodStart: "2026-04-09T12:30:00.000Z", value: 400 },
    ],
    "average-3",
  );

  expect(smoothed[1]?.value).toBeCloseTo((100 + 200 + 400) / 3, 10);
});

test("smoothing skips non-adjacent buckets across gaps", () => {
  const smoothed = applySolarSeriesSmoothing(
    [
      { periodStart: "2026-04-09T12:00:00.000Z", value: 100 },
      { periodStart: "2026-04-09T12:30:00.000Z", value: 400 },
    ],
    "average-3",
  );

  expect(smoothed[0]?.value).toBeCloseTo(100, 10);
  expect(smoothed[1]?.value).toBeCloseTo(400, 10);
});

test("smoothing mode labels stay stable", () => {
  expect(formatSolarPredictionSmoothingMode("weighted-5")).toBe(
    "Five-sample weighted average",
  );
});
