import type {
  BatteryStrategyHistoryDisplayState,
  BatteryStrategyHistoryRecord,
} from "@emsd/core/client";
import { HISTORY_STEP_MS } from "./constants";
import { buildBatteryStrategyLegendItem } from "./strategy-legend";
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
      typeof point.value === "number" && point.value < 0 ? point.value : null,
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
    batteryId?: string;
    periodStart: string;
    powerW: number | null;
    socPercent: number | null;
  }>,
  strategyHistory: BatteryStrategyHistoryRecord[],
  dayKey: string,
  strategyPlansByBatteryId: Record<
    string,
    import("@emsd/core/client").BatteryStrategyPlanRecord
  > = {},
): BatteryHistoryPoint[] {
  const batterySeries = createSignedSeries(aggregatePowerSamples(samples));
  const batteryChargeSeries = createSingleValueSeries(
    aggregateBatteryChargeSamples(samples),
  );

  return combineBatteryHistorySeries({
    charge: splitSingleValueSeriesByTime(
      fillSingleValueDay(batteryChargeSeries, dayKey),
    ),
    power: splitSignedSeriesByTime(fillSignedDay(batterySeries, dayKey)),
    strategyPlansByBatteryId,
    strategyBatteryId: getBatteryHistoryStrategyBatteryId(samples, dayKey),
    strategyHistory,
  });
}

export function getBatteryHistoryStrategyBatteryId(
  samples: Array<{ batteryId?: string; periodStart: string }>,
  dayKey: string,
): string | null {
  const countsByBatteryId = new Map<string, number>();

  for (const sample of samples) {
    if (
      typeof sample.batteryId !== "string" ||
      sample.batteryId.length === 0 ||
      getLocalDayKey(sample.periodStart) !== dayKey
    ) {
      continue;
    }

    countsByBatteryId.set(
      sample.batteryId,
      (countsByBatteryId.get(sample.batteryId) ?? 0) + 1,
    );
  }

  if (countsByBatteryId.size === 0) {
    for (const sample of samples) {
      if (
        typeof sample.batteryId !== "string" ||
        sample.batteryId.length === 0
      ) {
        continue;
      }

      countsByBatteryId.set(
        sample.batteryId,
        (countsByBatteryId.get(sample.batteryId) ?? 0) + 1,
      );
    }
  }

  return (
    [...countsByBatteryId.entries()].sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0] ?? null
  );
}

export function buildExactBatteryStrategySegments(input: {
  chartEndMs: number;
  chartStartMs: number;
  cutoffMs: number | null;
  strategyPlansByBatteryId?: Record<
    string,
    import("@emsd/core/client").BatteryStrategyPlanRecord
  >;
  strategyBatteryId?: string | null;
  strategyHistory: BatteryStrategyHistoryRecord[];
}): Array<{
  color: string;
  endMs: number;
  seriesId: string;
  startMs: number;
  state: BatteryStrategyHistoryDisplayState;
}> {
  const historyForDisplay = getStrategyHistoryForBattery(
    input.strategyHistory,
    input.strategyBatteryId ?? null,
  );
  const segments: Array<{
    color: string;
    endMs: number;
    seriesId: string;
    startMs: number;
    state: BatteryStrategyHistoryDisplayState;
  }> = [];
  const clipEndMs =
    input.cutoffMs === null
      ? input.chartEndMs
      : Math.min(input.cutoffMs, input.chartEndMs);

  if (clipEndMs <= input.chartStartMs) {
    return [];
  }

  for (const entry of historyForDisplay) {
    const startedAtMs = new Date(entry.startedAt).getTime();
    const endedAtMs = entry.endedAt ? new Date(entry.endedAt).getTime() : null;

    if (Number.isNaN(startedAtMs)) {
      continue;
    }

    const effectiveEndMs =
      endedAtMs !== null && !Number.isNaN(endedAtMs) ? endedAtMs : clipEndMs;
    const startMs = Math.max(startedAtMs, input.chartStartMs);
    const endMs = Math.min(effectiveEndMs, clipEndMs);

    if (endMs <= startMs) {
      continue;
    }

    const legendItem = buildBatteryStrategyLegendItem({
      displayLabel: entry.displayLabel,
      displayState: entry.displayState,
      itemLabel: resolveStrategyItemLabel(
        entry,
        input.strategyPlansByBatteryId ?? {},
      ),
      source: entry.source,
    });

    segments.push({
      color: legendItem.color,
      endMs,
      seriesId: legendItem.seriesId,
      startMs,
      state: entry.displayState,
    });
  }

  return segments;
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
  strategyPlansByBatteryId: Record<
    string,
    import("@emsd/core/client").BatteryStrategyPlanRecord
  >;
  strategyBatteryId: string | null;
  strategyHistory: BatteryStrategyHistoryRecord[];
}): BatteryHistoryPoint[] {
  const historyForDisplay = getStrategyHistoryForBattery(
    input.strategyHistory,
    input.strategyBatteryId,
  );

  return input.power.map((powerPoint, index) => {
    const chargePoint = input.charge[index];
    const strategyEntry = findStrategyEntryForPeriod(
      historyForDisplay,
      powerPoint.periodStart,
    );
    const strategyItemLabel = resolveStrategyItemLabel(
      strategyEntry,
      input.strategyPlansByBatteryId,
    );
    const strategyLegendItem =
      strategyEntry?.displayState !== undefined &&
      strategyEntry?.displayState !== null
        ? buildBatteryStrategyLegendItem({
            displayLabel: strategyEntry.displayLabel,
            displayState: strategyEntry.displayState,
            itemLabel: strategyItemLabel,
            source: strategyEntry.source,
          })
        : null;
    const overlay = buildStrategyOverlayStyle(
      strategyLegendItem?.color ?? null,
    );

    return {
      currentChargePercent: chargePoint?.currentValue ?? null,
      currentChargingPower: powerPoint.currentNegativeValue,
      currentDischargingPower: powerPoint.currentPositiveValue,
      currentPower:
        powerPoint.currentPositiveValue ?? powerPoint.currentNegativeValue,
      futureChargePercent: chargePoint?.futureValue ?? null,
      futureChargingPower: powerPoint.futureNegativeValue,
      futureDischargingPower: powerPoint.futurePositiveValue,
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
      strategyColor: strategyLegendItem?.color ?? null,
      strategyActiveItemId: strategyEntry?.activeItemId ?? null,
      strategyDisplayLabel: strategyEntry?.displayLabel ?? null,
      strategyDisplayState: strategyEntry?.displayState ?? null,
      strategyItemLabel,
      strategySeriesId: strategyLegendItem?.seriesId ?? null,
      strategySource: strategyEntry?.source ?? null,
    };
  });
}

function resolveStrategyItemLabel(
  strategyEntry: BatteryStrategyHistoryRecord | null,
  strategyPlansByBatteryId: Record<
    string,
    import("@emsd/core/client").BatteryStrategyPlanRecord
  >,
): string | null {
  if (!strategyEntry) {
    return null;
  }

  if (strategyEntry.itemLabel && strategyEntry.itemLabel.trim().length > 0) {
    return strategyEntry.itemLabel;
  }

  if (!strategyEntry.activeItemId) {
    return null;
  }

  const batteryPlan = strategyPlansByBatteryId[strategyEntry.batteryId] ?? [];
  const activeItem = batteryPlan.find(
    (item) => item.id === strategyEntry.activeItemId,
  );

  return activeItem?.name?.trim().length ? activeItem.name : null;
}

function getStrategyHistoryForBattery(
  strategyHistory: BatteryStrategyHistoryRecord[],
  batteryId: string | null,
): BatteryStrategyHistoryRecord[] {
  const selectedBatteryId = batteryId ?? strategyHistory[0]?.batteryId ?? null;

  if (selectedBatteryId === null) {
    return [];
  }

  return strategyHistory.filter(
    (entry) => entry.batteryId === selectedBatteryId,
  );
}

function findStrategyEntryForPeriod(
  strategyHistory: BatteryStrategyHistoryRecord[],
  periodStart: string,
): BatteryStrategyHistoryRecord | null {
  const periodStartMs = new Date(periodStart).getTime();
  const periodEndMs = periodStartMs + HISTORY_STEP_MS;

  if (Number.isNaN(periodStartMs)) {
    return null;
  }

  return (
    strategyHistory
      .filter((entry) => {
        const startedAtMs = new Date(entry.startedAt).getTime();
        const endedAtMs = entry.endedAt
          ? new Date(entry.endedAt).getTime()
          : null;

        if (Number.isNaN(startedAtMs)) {
          return false;
        }

        return (
          startedAtMs < periodEndMs &&
          (endedAtMs === null ||
            Number.isNaN(endedAtMs) ||
            periodStartMs < endedAtMs)
        );
      })
      .sort(
        (left, right) =>
          new Date(right.startedAt).getTime() -
          new Date(left.startedAt).getTime(),
      )[0] ?? null
  );
}

function buildStrategyOverlayStyle(color: string | null): {
  color: string | null;
  stroke: string | null;
  strokeWidth: number;
} {
  if (color === null) {
    return { color: null, stroke: null, strokeWidth: 0 };
  }

  return {
    color,
    stroke: null,
    strokeWidth: 0,
  };
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
