import { expect, test } from "bun:test";
import { findPriceSelections } from "./price-selection";

test("findPriceSelections finds strict local lows and highs inside the price window", () => {
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
    { periodStart: "2026-05-13T02:00:00.000Z", value: 1 },
  ]);
  expect(selections.highest).toEqual([
    { periodStart: "2026-05-13T06:00:00.000Z", value: 6 },
  ]);
});
