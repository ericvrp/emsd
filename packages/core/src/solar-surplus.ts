export interface SolarSurplusPoint {
  periodStart: string;
  value: number | null;
}

export interface SolarSurplusWindow {
  startTime: string;
  endTime: string;
}

export interface SolarSurplusBounds {
  firstStartTime: string | null;
  finalEndTime: string | null;
}

export type ResolveExpectedSolarLoadW = (
  periodStart: Date,
  point: SolarSurplusPoint,
) => number | null | undefined;

export function findSolarSurplusWindows(input: {
  fallbackEndTime?: Date | string | null;
  minimumSurplusW?: number;
  predictedSeries: SolarSurplusPoint[];
  resolveExpectedLoadW: ResolveExpectedSolarLoadW;
  selectedDayKey?: string | null;
  startAt?: Date | string | null;
}): SolarSurplusWindow[] {
  const minimumSurplusW = Math.max(0, input.minimumSurplusW ?? 0);
  const startAtMs = input.startAt ? new Date(input.startAt).getTime() : null;
  const fallbackEndTime = formatBoundaryTime(input.fallbackEndTime ?? null);
  let openStartTime: string | null = null;
  let lastIncludedPeriodStart: string | null = null;
  const windows: SolarSurplusWindow[] = [];

  for (const point of input.predictedSeries) {
    const pointDate = new Date(point.periodStart);
    const pointMs = pointDate.getTime();

    if (Number.isNaN(pointMs)) {
      continue;
    }

    if (startAtMs !== null && pointMs < startAtMs) {
      continue;
    }

    if (
      input.selectedDayKey &&
      getLocalDayKey(pointDate) !== input.selectedDayKey
    ) {
      continue;
    }

    lastIncludedPeriodStart = point.periodStart;

    if (isSolarSurplusPoint({ minimumSurplusW, point, pointDate }, input)) {
      openStartTime ??= point.periodStart;
      continue;
    }

    if (openStartTime !== null) {
      windows.push({ startTime: openStartTime, endTime: point.periodStart });
      openStartTime = null;
    }
  }

  if (openStartTime !== null) {
    windows.push({
      startTime: openStartTime,
      endTime: fallbackEndTime ?? lastIncludedPeriodStart ?? openStartTime,
    });
  }

  return windows;
}

export function findFirstSolarSurplusWindow(input: {
  fallbackEndTime?: Date | string | null;
  minimumSurplusW?: number;
  predictedSeries: SolarSurplusPoint[];
  resolveExpectedLoadW: ResolveExpectedSolarLoadW;
  selectedDayKey?: string | null;
  startAt?: Date | string | null;
}): SolarSurplusWindow | null {
  return findSolarSurplusWindows(input)[0] ?? null;
}

export function findSolarSurplusBounds(input: {
  fallbackEndTime?: Date | string | null;
  minimumSurplusW?: number;
  predictedSeries: SolarSurplusPoint[];
  resolveExpectedLoadW: ResolveExpectedSolarLoadW;
  selectedDayKey?: string | null;
  startAt?: Date | string | null;
}): SolarSurplusBounds {
  const windows = findSolarSurplusWindows(input);
  const firstWindow = windows[0] ?? null;
  const finalWindow = windows.at(-1) ?? null;

  return {
    firstStartTime: firstWindow?.startTime ?? null,
    finalEndTime: finalWindow?.endTime ?? null,
  };
}

export function findSolarSurplusBoundsFromSeries(input: {
  expectedLoadSeries: SolarSurplusPoint[];
  fallbackEndTime?: Date | string | null;
  minimumSurplusW?: number;
  predictedSeries: SolarSurplusPoint[];
  selectedDayKey?: string | null;
  startAt?: Date | string | null;
}): SolarSurplusBounds {
  const expectedLoadByPeriodStart = new Map(
    input.expectedLoadSeries.map((point) => [point.periodStart, point.value]),
  );

  return findSolarSurplusBounds({
    predictedSeries: input.predictedSeries,
    resolveExpectedLoadW: (_, point) =>
      expectedLoadByPeriodStart.get(point.periodStart),
    ...(input.fallbackEndTime !== undefined
      ? { fallbackEndTime: input.fallbackEndTime }
      : {}),
    ...(input.minimumSurplusW !== undefined
      ? { minimumSurplusW: input.minimumSurplusW }
      : {}),
    ...(input.selectedDayKey !== undefined
      ? { selectedDayKey: input.selectedDayKey }
      : {}),
    ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
  });
}

function isSolarSurplusPoint(
  input: {
    minimumSurplusW: number;
    point: SolarSurplusPoint;
    pointDate: Date;
  },
  options: { resolveExpectedLoadW: ResolveExpectedSolarLoadW },
): boolean {
  const predictedSolarW =
    typeof input.point.value === "number"
      ? Math.max(0, input.point.value)
      : null;
  const expectedLoadW = options.resolveExpectedLoadW(
    input.pointDate,
    input.point,
  );

  return (
    predictedSolarW !== null &&
    typeof expectedLoadW === "number" &&
    Number.isFinite(expectedLoadW) &&
    predictedSolarW > Math.max(0, expectedLoadW) + input.minimumSurplusW
  );
}

function formatBoundaryTime(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function getLocalDayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
