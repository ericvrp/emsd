import { expect, test } from "bun:test";
import {
  buildHouseLoadHistorySeries,
  buildExpectedSiteLoadProfile,
  buildExpectedSiteLoadSeriesForLocalDay,
  fillSiteLoadSeriesForLocalDay,
  resolveExpectedSiteLoadW,
  type SiteLoadPoint,
} from "./index";

test("resolveExpectedSiteLoadW uses a fallback profile value for missing slots", () => {
  const historySeries: SiteLoadPoint[] = [
    { periodStart: "2026-04-13T08:00:00.000Z", value: 200 },
    { periodStart: "2026-04-14T08:00:00.000Z", value: 220 },
    { periodStart: "2026-04-13T08:15:00.000Z", value: 380 },
    { periodStart: "2026-04-14T08:15:00.000Z", value: 420 },
  ];
  const profile = buildExpectedSiteLoadProfile(
    historySeries,
    new Date("2026-04-15T00:00:00.000Z"),
  );

  expect(resolveExpectedSiteLoadW("2026-04-15T09:00:00.000Z", profile)).toBe(305);
});

test("buildExpectedSiteLoadSeriesForLocalDay builds a full selected-day series from prior history", () => {
  const historySeries: SiteLoadPoint[] = [
    { periodStart: "2026-04-13T08:00:00.000Z", value: 200 },
    { periodStart: "2026-04-14T08:00:00.000Z", value: 220 },
  ];
  const series = buildExpectedSiteLoadSeriesForLocalDay({
    dayKey: "2026-04-15",
    historySeries,
  });

  expect(series).toHaveLength(96);
  expect(series.find((point) => point.periodStart === "2026-04-15T08:00:00.000Z")?.value).toBe(210);
});

test("fillSiteLoadSeriesForLocalDay keeps actual samples and fills missing periods with null", () => {
  const filled = fillSiteLoadSeriesForLocalDay({
    dayKey: "2026-04-15",
    points: [{ periodStart: "2026-04-15T08:00:00.000Z", value: 250 }],
  });

  expect(filled).toHaveLength(96);
  expect(filled.find((point) => point.periodStart === "2026-04-15T08:00:00.000Z")?.value).toBe(250);
  expect(filled.find((point) => point.periodStart === "2026-04-15T08:15:00.000Z")?.value).toBeNull();
});

test("buildHouseLoadHistorySeries keeps zero-watt battery samples when SoC is flat", () => {
  expect(
    buildHouseLoadHistorySeries({
      batteryPowerSamples: [
        {
          batteryId: "battery-1",
          observedAt: "2026-04-21T14:00:00.000Z",
          periodStart: "2026-04-21T14:00:00.000Z",
          powerW: 0,
          siteId: "site-1",
          socPercent: 100,
        },
      ],
      p1MeterSamples: [
        {
          meterId: "meter-1",
          observedAt: "2026-04-21T14:00:00.000Z",
          periodStart: "2026-04-21T14:00:00.000Z",
          powerW: -2591,
          siteId: "site-1",
        },
      ],
      solarEnergyProviderSamples: [
        {
          observedAt: "2026-04-21T14:00:00.000Z",
          periodStart: "2026-04-21T14:00:00.000Z",
          powerW: 3057.28,
          providerId: "solar-1",
          siteId: "site-1",
        },
      ],
    }),
  ).toEqual([
    {
      periodStart: "2026-04-21T14:00:00.000Z",
      value: 466.2800000000002,
    },
  ]);
});
