import {
  DYNAMIC_PRICE_TARGET_HISTORY_LOOKBACK_DAYS,
  DYNAMIC_PRICE_TARGET_MAX_SAME_WEEKDAY_MATCHES,
  DYNAMIC_PRICE_TARGET_PERIOD_MINUTES,
} from "./dynamic-price-target-defaults";
import type {
  BatteryPowerSampleRecord,
  P1MeterSampleRecord,
  SolarEnergyProviderSampleRecord,
} from "./index";

const HISTORY_LOOKBACK_DAYS = DYNAMIC_PRICE_TARGET_HISTORY_LOOKBACK_DAYS;
const MAX_SAME_WEEKDAY_MATCHES = DYNAMIC_PRICE_TARGET_MAX_SAME_WEEKDAY_MATCHES;

export interface SiteLoadPoint {
  periodStart: string;
  value: number | null;
}

export interface ExpectedSiteLoadProfile {
  expectedLoadBySlot: Map<string, number>;
  fallbackLoadW: number;
  historicalPeriodsUsed: number;
  sameWeekdayPeriodsUsed: number;
}

export function buildHouseLoadHistorySeries(input: {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
}): SiteLoadPoint[] {
  const batteryByPeriod = aggregateSignedBatteryPowerByPeriodStart(
    input.batteryPowerSamples,
  );
  const gridByPeriod = aggregatePowerByPeriodStart(input.p1MeterSamples);
  const solarByPeriod = aggregatePowerByPeriodStart(
    input.solarEnergyProviderSamples,
  );
  const periodStarts = new Set([
    ...batteryByPeriod.keys(),
    ...gridByPeriod.keys(),
    ...solarByPeriod.keys(),
  ]);

  return [...periodStarts]
    .map((periodStart) => {
      const batteryPowerW = batteryByPeriod.get(periodStart);
      const gridPowerW = gridByPeriod.get(periodStart);
      const solarPowerW = solarByPeriod.get(periodStart);

      if (
        typeof batteryPowerW !== "number" ||
        typeof gridPowerW !== "number" ||
        typeof solarPowerW !== "number"
      ) {
        return null;
      }

      return {
        periodStart,
        value: Math.max(0, solarPowerW + gridPowerW + batteryPowerW),
      };
    })
    .filter(
      (point): point is { periodStart: string; value: number } =>
        point !== null,
    )
    .sort(
      (left, right) =>
        new Date(left.periodStart).getTime() -
        new Date(right.periodStart).getTime(),
    );
}

export function buildExpectedSiteLoadProfile(
  historySeries: SiteLoadPoint[],
  anchor: Date,
): ExpectedSiteLoadProfile {
  const lookbackStartMs =
    anchor.getTime() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const targetWeekday = anchor.getDay();
  const sameWeekdayCounts = new Map<string, number>();
  const buckets = new Map<string, number[]>();
  let historicalPeriodsUsed = 0;
  let sameWeekdayPeriodsUsed = 0;

  for (const point of historySeries) {
    const pointDate = new Date(point.periodStart);
    const pointMs = pointDate.getTime();

    if (
      Number.isNaN(pointMs) ||
      pointMs < lookbackStartMs ||
      pointMs >= anchor.getTime() ||
      typeof point.value !== "number"
    ) {
      continue;
    }

    const slotKey = getSlotKey(pointDate);
    const values = buckets.get(slotKey) ?? [];
    values.push(point.value);
    buckets.set(slotKey, values);
    historicalPeriodsUsed += 1;

    if (pointDate.getDay() !== targetWeekday) {
      continue;
    }

    const usedMatches = sameWeekdayCounts.get(slotKey) ?? 0;

    if (usedMatches >= MAX_SAME_WEEKDAY_MATCHES) {
      continue;
    }

    values.push(point.value);
    sameWeekdayCounts.set(slotKey, usedMatches + 1);
    sameWeekdayPeriodsUsed += 1;
  }

  const rawExpectedLoadBySlot = new Map(
    [...buckets.entries()].map(([slotKey, values]) => [
      slotKey,
      round2(mean(values)),
    ]),
  );
  const expectedLoadBySlot = rawExpectedLoadBySlot;
  const fallbackLoadW = round2(mean([...expectedLoadBySlot.values()]));

  return {
    expectedLoadBySlot,
    fallbackLoadW,
    historicalPeriodsUsed,
    sameWeekdayPeriodsUsed,
  };
}

export function resolveExpectedSiteLoadW(
  periodStart: string | Date,
  profile: ExpectedSiteLoadProfile,
): number {
  const periodDate =
    typeof periodStart === "string" ? new Date(periodStart) : periodStart;

  if (Number.isNaN(periodDate.getTime())) {
    return profile.fallbackLoadW;
  }

  return (
    profile.expectedLoadBySlot.get(getSlotKey(periodDate)) ??
    profile.fallbackLoadW
  );
}

export function buildExpectedSiteLoadSeriesForLocalDay(input: {
  dayKey: string;
  historySeries: SiteLoadPoint[];
}): SiteLoadPoint[] {
  const profile = buildExpectedSiteLoadProfile(
    input.historySeries,
    getLocalDayStart(input.dayKey),
  );

  return createLocalDayPeriods(input.dayKey).map((periodStart) => ({
    periodStart,
    value: resolveExpectedSiteLoadW(periodStart, profile),
  }));
}

export function fillSiteLoadSeriesForLocalDay(input: {
  dayKey: string;
  points: SiteLoadPoint[];
}): SiteLoadPoint[] {
  const valuesByPeriod = new Map(
    input.points
      .filter((point) => getLocalDayKey(point.periodStart) === input.dayKey)
      .map((point) => [point.periodStart, point.value] as const),
  );

  return createLocalDayPeriods(input.dayKey).map((periodStart) => ({
    periodStart,
    value: valuesByPeriod.get(periodStart) ?? null,
  }));
}

export function getCurrentLocalDayKey(now: Date = new Date()): string {
  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join(
    "-",
  );
}

function aggregatePowerByPeriodStart(
  samples: Array<{ periodStart: string; powerW: number | null }>,
): Map<string, number> {
  const byPeriod = new Map<string, number>();

  for (const sample of samples) {
    if (typeof sample.powerW !== "number") {
      continue;
    }

    byPeriod.set(
      sample.periodStart,
      (byPeriod.get(sample.periodStart) ?? 0) + sample.powerW,
    );
  }

  return byPeriod;
}

function aggregateSignedBatteryPowerByPeriodStart(
  samples: BatteryPowerSampleRecord[],
): Map<string, number> {
  const byPeriod = new Map<string, number>();

  for (const sample of samples) {
    if (typeof sample.powerW !== "number") {
      continue;
    }

    byPeriod.set(
      sample.periodStart,
      (byPeriod.get(sample.periodStart) ?? 0) + sample.powerW,
    );
  }

  return byPeriod;
}

function createLocalDayPeriods(dayKey: string): string[] {
  const start = getLocalDayStart(dayKey);
  const periods: string[] = [];

  for (
    let current = new Date(start);
    current.getDate() === start.getDate();
    current.setMinutes(
      current.getMinutes() + DYNAMIC_PRICE_TARGET_PERIOD_MINUTES,
    )
  ) {
    periods.push(current.toISOString());
  }

  return periods;
}

function getLocalDayStart(dayKey: string): Date {
  const start = new Date(`${dayKey}T00:00:00`);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getLocalDayKey(value: string): string {
  const date = new Date(value);
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function getSlotKey(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
