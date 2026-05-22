import { expect, test } from "bun:test";
import { findPriceSelections } from "./price-selection";

test("findPriceSelections uses centered moving-average lows and strict local highs", () => {
  const selections = findPriceSelections([
    { periodStart: "2026-05-13T00:00:00.000Z", value: 5 },
    { periodStart: "2026-05-13T01:00:00.000Z", value: 4 },
    { periodStart: "2026-05-13T02:00:00.000Z", value: 1 },
    { periodStart: "2026-05-13T03:00:00.000Z", value: 4 },
    { periodStart: "2026-05-13T04:00:00.000Z", value: 5 },
    { periodStart: "2026-05-13T05:00:00.000Z", value: 2 },
    { periodStart: "2026-05-13T06:00:00.000Z", value: 6 },
    { periodStart: "2026-05-13T07:00:00.000Z", value: 2 },
    { periodStart: "2026-05-13T08:00:00.000Z", value: 1 },
  ]);

  expect(selections.lowest).toEqual([
    { periodStart: "2026-05-13T07:00:00.000Z", value: 2 },
  ]);
  expect(selections.highest).toEqual([
    { periodStart: "2026-05-13T06:00:00.000Z", value: 6 },
  ]);
});

test("findPriceSelections marks flat low-price valleys once each", () => {
  const selections = findPriceSelections([
    { periodStart: "2026-05-13T00:00:00.000Z", value: 0.3 },
    { periodStart: "2026-05-13T01:00:00.000Z", value: 0.25 },
    { periodStart: "2026-05-13T02:00:00.000Z", value: 0.1 },
    { periodStart: "2026-05-13T03:00:00.000Z", value: 0.1 },
    { periodStart: "2026-05-13T04:00:00.000Z", value: 0.1 },
    { periodStart: "2026-05-13T05:00:00.000Z", value: 0.1 },
    { periodStart: "2026-05-13T06:00:00.000Z", value: 0.25 },
    { periodStart: "2026-05-13T07:00:00.000Z", value: 0.3 },
    { periodStart: "2026-05-13T12:00:00.000Z", value: 0.32 },
    { periodStart: "2026-05-13T13:00:00.000Z", value: 0.2 },
    { periodStart: "2026-05-13T14:00:00.000Z", value: 0.12 },
    { periodStart: "2026-05-13T15:00:00.000Z", value: 0.12 },
    { periodStart: "2026-05-13T16:00:00.000Z", value: 0.12 },
    { periodStart: "2026-05-13T17:00:00.000Z", value: 0.12 },
    { periodStart: "2026-05-13T18:00:00.000Z", value: 0.22 },
    { periodStart: "2026-05-13T19:00:00.000Z", value: 0.34 },
  ]);

  expect(selections.lowest).toEqual([
    { periodStart: "2026-05-13T03:00:00.000Z", value: 0.1 },
    { periodStart: "2026-05-13T15:00:00.000Z", value: 0.12 },
  ]);
});
