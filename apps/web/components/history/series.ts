import type { BatteryStrategyHistoryRecord } from "@emsd/core/client";
import { UI_COLORS } from "../../lib/ui-colors";
import { HISTORY_STEP_MS } from "./constants";
import type {
  BatteryHistoryPoint,
  SignedValuePoint,
  SingleValuePoint,
  SplitSignedValuePoint,
  SplitSingleValuePoint,
} from "./types";
import { getLocalDayKey } from "./utils";

export function aggregatePowerSamples(
  samples: Array<{ periodStart: string; powerW: number | null }>,
): SingleValuePoint[] {
  const aggregated = new Map<string, { hasValue: boolean; total: number }>();

  for (const sample of samples) {
    const bucket = aggregated.get(sample.periodStart) ?? {
      hasValue: false,
      total: 0,
    };

    if (typeof sample.powerW === "number") {
      bucket.hasValue = true;
      bucket.total += sample.powerW;
    }

    aggregated.set(sample.periodStart, bucket);
  }

  return [...aggregated.entries()]
    .map(([periodStart, entry]) => ({
      periodStart,
      value: entry.hasValue ? entry.total : null,
    }))
    .sort(
      (left, right) =>
        new Date(left.periodStart).getTime() -
        new Date(right.periodStart).getTime(),
    );
}

export function invertSingleValueSeries(
  points: SingleValuePoint[],
): SingleValuePoint[] {
  return points.map((point) => ({
    ...point,
    value: typeof point.value === "number" ? -point.value : null,
  }));
}

export function createSignedSeries(
  points: SingleValuePoint[],
): SignedValuePoint[] {
  return points.map((point) => ({
    ...point,
    negativeValue:
      typeof point.value === "number" && point.value <= 0 ? point.value : null,
    positiveValue:
      typeof point.value === "number" && point.value >= 0 ? point.value : null,
  }));
}

export function splitSingleValueSeriesByTime(
  points: SingleValuePoint[],
): SplitSingleValuePoint[] {
  const now = Date.now();
  const firstFutureIndex = points.findIndex(
    (point) => new Date(point.periodStart).getTime() > now,
  );

  return points.map((point, index) => {
    const isFuture = firstFutureIndex !== -1 && index >= firstFutureIndex;
    const includeInFutureSeries =
      firstFutureIndex !== -1 && index >= Math.max(0, firstFutureIndex - 1);

    return {
      ...point,
      currentValue: isFuture ? null : point.value,
      futureValue: includeInFutureSeries ? point.value : null,
    };
  });
}

export function splitSignedSeriesByTime(
  points: SignedValuePoint[],
): SplitSignedValuePoint[] {
  const now = Date.now();
  const firstFutureIndex = points.findIndex(
    (point) => new Date(point.periodStart).getTime() > now,
  );

  return points.map((point, index) => {
    const isFuture = firstFutureIndex !== -1 && index >= firstFutureIndex;
    const includeInFutureSeries =
      firstFutureIndex !== -1 && index >= Math.max(0, firstFutureIndex - 1);

    return {
      ...point,
      currentNegativeValue: isFuture ? null : point.negativeValue,
      currentPositiveValue: isFuture ? null : point.positiveValue,
      futureNegativeValue: includeInFutureSeries ? point.negativeValue : null,
      futurePositiveValue: includeInFutureSeries ? point.positiveValue : null,
    };
  });
}

export function fillSingleValueDay(
  points: SingleValuePoint[],
  dayKey: string,
): SingleValuePoint[] {
  const valuesByPeriod = new Map(
    points
      .filter((point) => getLocalDayKey(point.periodStart) === dayKey)
      .map((point) => [point.periodStart, point.value] as const),
  );

  return createLocalDayPeriods(dayKey).map((periodStart) => ({
    periodStart,
    value: valuesByPeriod.get(periodStart) ?? null,
  }));
}

export function fillSignedDay(
  points: SignedValuePoint[],
  dayKey: string,
): SignedValuePoint[] {
  const valuesByPeriod = new Map(
    points
      .filter((point) => getLocalDayKey(point.periodStart) === dayKey)
      .map((point) => [point.periodStart, point] as const),
  );

  return createLocalDayPeriods(dayKey).map((periodStart) => {
    const existing = valuesByPeriod.get(periodStart);

    return (
      existing ?? {
        negativeValue: null,
        periodStart,
        positiveValue: null,
        value: null,
      }
    );
  });
}

export function buildBatteryHistoryPoints(
  samples: Array<{
    periodStart: string;
    powerW: number | null;
    socPercent: number | null;
  }>,
  strategyHistory: BatteryStrategyHistoryRecord[],
  dayKey: string,
): BatteryHistoryPoint[] {
  const batterySeries = createSignedSeries(
    invertSingleValueSeries(aggregatePowerSamples(samples)),
  );
  const batteryChargeSeries = createSingleValueSeries(
    aggregateBatteryChargeSamples(samples),
  );

  return combineBatteryHistorySeries({
    charge: splitSingleValueSeriesByTime(
      fillSingleValueDay(batteryChargeSeries, dayKey),
    ),
    power: splitSignedSeriesByTime(fillSignedDay(batterySeries, dayKey)),
    strategyHistory,
  });
}

function createSingleValueSeries(
  points: SingleValuePoint[],
): SingleValuePoint[] {
  return [...points].sort(
    (left, right) =>
      new Date(left.periodStart).getTime() -
      new Date(right.periodStart).getTime(),
  );
}

function aggregateBatteryChargeSamples(
  samples: Array<{ periodStart: string; socPercent: number | null }>,
): SingleValuePoint[] {
  const aggregated = new Map<string, { count: number; total: number }>();

  for (const sample of samples) {
    const bucket = aggregated.get(sample.periodStart) ?? {
      count: 0,
      total: 0,
    };

    if (typeof sample.socPercent === "number") {
      bucket.count += 1;
      bucket.total += sample.socPercent;
    }

    aggregated.set(sample.periodStart, bucket);
  }

  return [...aggregated.entries()]
    .map(([periodStart, entry]) => ({
      periodStart,
      value: entry.count > 0 ? entry.total / entry.count : null,
    }))
    .sort(
      (left, right) =>
        new Date(left.periodStart).getTime() -
        new Date(right.periodStart).getTime(),
    );
}

function combineBatteryHistorySeries(input: {
  charge: SplitSingleValuePoint[];
  power: SplitSignedValuePoint[];
  strategyHistory: BatteryStrategyHistoryRecord[];
}): BatteryHistoryPoint[] {
  const historyForDisplay = getStrategyHistoryForPrimaryBattery(
    input.strategyHistory,
    input.power[0]?.periodStart ?? null,
  );

  return input.power.map((powerPoint, index) => {
    const chargePoint = input.charge[index];
    const strategyEntry = findStrategyEntryAtPeriodStart(
      historyForDisplay,
      powerPoint.periodStart,
    );
    const overlay = buildStrategyOverlayStyle(strategyEntry?.source ?? null, strategyEntry?.displayState ?? null);

    return {
      currentChargePercent: chargePoint?.currentValue ?? null,
      currentChargingPower: powerPoint.currentPositiveValue,
      currentDischargingPower: powerPoint.currentNegativeValue,
      currentPower:
        powerPoint.currentPositiveValue ?? powerPoint.currentNegativeValue,
      futureChargePercent: chargePoint?.futureValue ?? null,
      futureChargingPower: powerPoint.futurePositiveValue,
      futureDischargingPower: powerPoint.futureNegativeValue,
      futurePower:
        powerPoint.futurePositiveValue ?? powerPoint.futureNegativeValue,
      overlayCharge: strategyEntry?.displayState === "charge" ? 1 : null,
      overlayColor: overlay.color,
      overlayDischarge: strategyEntry?.displayState === "discharge" ? 1 : null,
      overlayIdle: strategyEntry?.displayState === "idle" ? 1 : null,
      overlaySelfConsumption:
        strategyEntry?.displayState === "self-consumption" ? 1 : null,
      overlayStroke: overlay.stroke,
      overlayStrokeWidth: overlay.strokeWidth,
      overlayValue: strategyEntry ? 1 : null,
      periodStart: powerPoint.periodStart,
      strategyDisplayLabel: strategyEntry?.displayLabel ?? null,
      strategyDisplayState: strategyEntry?.displayState ?? null,
      strategySource: strategyEntry?.source ?? null,
    };
  });
}

function getStrategyHistoryForPrimaryBattery(
  strategyHistory: BatteryStrategyHistoryRecord[],
  _periodStart: string | null,
): BatteryStrategyHistoryRecord[] {
  const batteryId = strategyHistory[0]?.batteryId ?? null;

  if (batteryId === null) {
    return [];
  }

  return strategyHistory.filter((entry) => entry.batteryId === batteryId);
}

function findStrategyEntryAtPeriodStart(
  strategyHistory: BatteryStrategyHistoryRecord[],
  periodStart: string,
): BatteryStrategyHistoryRecord | null {
  const targetMs = new Date(periodStart).getTime();

  if (Number.isNaN(targetMs)) {
    return null;
  }

  return (
    strategyHistory.find((entry) => {
      const startedAtMs = new Date(entry.startedAt).getTime();
      const endedAtMs = entry.endedAt ? new Date(entry.endedAt).getTime() : null;

      if (Number.isNaN(startedAtMs)) {
        return false;
      }

      return (
        startedAtMs <= targetMs &&
        (endedAtMs === null || Number.isNaN(endedAtMs) || targetMs < endedAtMs)
      );
    }) ?? null
  );
}

function buildStrategyOverlayStyle(
  source: BatteryHistoryPoint["strategySource"],
  displayState: BatteryHistoryPoint["strategyDisplayState"],
): { color: string | null; stroke: string | null; strokeWidth: number } {
  if (displayState === null) {
    return { color: null, stroke: null, strokeWidth: 0 };
  }

  const color = getStrategyOverlayColor(displayState);

  void source;

  return {
    color,
    stroke: null,
    strokeWidth: 0,
  };
}

function getStrategyOverlayColor(
  displayState: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>,
): string {
  switch (displayState) {
    case "charge":
      return UI_COLORS.strategyCharge;
    case "discharge":
      return UI_COLORS.strategyDischarge;
    case "idle":
      return UI_COLORS.strategyIdle;
    case "self-consumption":
      return UI_COLORS.strategySelfConsumption;
  }
}

function createLocalDayPeriods(dayKey: string): string[] {
  const parts = dayKey.split("-");
  if (parts.length !== 3) return [];
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return [];

  const startMs = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  const endMs = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime();
  const periods: string[] = [];

  for (
    let periodStartMs = startMs;
    periodStartMs < endMs;
    periodStartMs += HISTORY_STEP_MS
  ) {
    periods.push(new Date(periodStartMs).toISOString());
  }

  return periods;
}
