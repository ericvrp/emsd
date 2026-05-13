import { expect, test } from "bun:test";
import {
  findFirstSolarSurplusWindow,
  findSolarSurplusBoundsFromSeries,
} from "./solar-surplus";

test("findSolarSurplusBoundsFromSeries returns null markers when there is no surplus", () => {
  expect(
    findSolarSurplusBoundsFromSeries({
      expectedLoadSeries: [
        { periodStart: "2026-04-15T08:00:00.000Z", value: 400 },
        { periodStart: "2026-04-15T08:15:00.000Z", value: 400 },
      ],
      predictedSeries: [
        { periodStart: "2026-04-15T08:00:00.000Z", value: 300 },
        { periodStart: "2026-04-15T08:15:00.000Z", value: 400 },
      ],
      selectedDayKey: "2026-04-15",
    }),
  ).toEqual({ firstStartTime: null, finalEndTime: null });
});

test("findSolarSurplusBoundsFromSeries returns first start and end for one surplus window", () => {
  expect(
    findSolarSurplusBoundsFromSeries({
      expectedLoadSeries: buildExpectedLoadSeries(300),
      predictedSeries: [
        { periodStart: "2026-04-15T08:00:00.000Z", value: 100 },
        { periodStart: "2026-04-15T08:15:00.000Z", value: 500 },
        { periodStart: "2026-04-15T08:30:00.000Z", value: 600 },
        { periodStart: "2026-04-15T08:45:00.000Z", value: 250 },
      ],
      selectedDayKey: "2026-04-15",
    }),
  ).toEqual({
    firstStartTime: "2026-04-15T08:15:00.000Z",
    finalEndTime: "2026-04-15T08:45:00.000Z",
  });
});

test("findSolarSurplusBoundsFromSeries returns first start and final end across multiple windows", () => {
  expect(
    findSolarSurplusBoundsFromSeries({
      expectedLoadSeries: buildExpectedLoadSeries(300),
      predictedSeries: [
        { periodStart: "2026-04-15T08:00:00.000Z", value: 500 },
        { periodStart: "2026-04-15T08:15:00.000Z", value: 100 },
        { periodStart: "2026-04-15T08:30:00.000Z", value: 650 },
        { periodStart: "2026-04-15T08:45:00.000Z", value: 200 },
      ],
      selectedDayKey: "2026-04-15",
    }),
  ).toEqual({
    firstStartTime: "2026-04-15T08:00:00.000Z",
    finalEndTime: "2026-04-15T08:45:00.000Z",
  });
});

test("findSolarSurplusBoundsFromSeries uses fallback end for an open surplus window", () => {
  expect(
    findSolarSurplusBoundsFromSeries({
      expectedLoadSeries: buildExpectedLoadSeries(300),
      fallbackEndTime: "2026-04-15T23:59:59.999Z",
      predictedSeries: [
        { periodStart: "2026-04-15T08:00:00.000Z", value: 100 },
        { periodStart: "2026-04-15T08:15:00.000Z", value: 500 },
      ],
      selectedDayKey: "2026-04-15",
    }),
  ).toEqual({
    firstStartTime: "2026-04-15T08:15:00.000Z",
    finalEndTime: "2026-04-15T23:59:59.999Z",
  });
});

test("findFirstSolarSurplusWindow respects minimum surplus threshold", () => {
  expect(
    findFirstSolarSurplusWindow({
      predictedSeries: [
        { periodStart: "2026-04-15T08:00:00.000Z", value: 340 },
        { periodStart: "2026-04-15T08:15:00.000Z", value: 360 },
        { periodStart: "2026-04-15T08:30:00.000Z", value: 290 },
      ],
      minimumSurplusW: 50,
      resolveExpectedLoadW: () => 300,
      selectedDayKey: "2026-04-15",
    }),
  ).toEqual({
    startTime: "2026-04-15T08:15:00.000Z",
    endTime: "2026-04-15T08:30:00.000Z",
  });
});

function buildExpectedLoadSeries(value: number) {
  return [
    { periodStart: "2026-04-15T08:00:00.000Z", value },
    { periodStart: "2026-04-15T08:15:00.000Z", value },
    { periodStart: "2026-04-15T08:30:00.000Z", value },
    { periodStart: "2026-04-15T08:45:00.000Z", value },
  ];
}
