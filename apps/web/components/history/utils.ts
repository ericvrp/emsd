import type { HistoryArchive } from "../../lib/ems-bridge";
import { UI_COLORS } from "../../lib/ui-colors";
import {
  HISTORY_STEP_MS,
  LEFT_Y_AXIS_WIDTH,
  RIGHT_Y_AXIS_WIDTH,
  STANDARD_Y_AXIS_TICK_COUNT,
} from "./constants";
import type { TooltipPayloadEntry } from "./types";

export function formatDayTick(value: string | number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTooltipTimestamp(value: string | number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function formatBarTooltipTimestamp(value: string | number): string {
  const timestampMs =
    typeof value === "number"
      ? value - HISTORY_STEP_MS / 2
      : new Date(value).getTime();

  return formatTooltipTimestamp(timestampMs);
}

export function formatPercentValue(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatShortPercentValue(value: number): string {
  return `${Math.round(value)}%`;
}

export function getLocalDayKey(value: Date | string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayLocalDayKey(): string {
  return getLocalDayKey(new Date());
}

export function getAvailableLocalDays(archive: HistoryArchive): string[] {
  const dayKeys = new Set<string>();
  const todayKey = getLocalDayKey(new Date());

  dayKeys.add(todayKey);

  for (const sample of archive.dynamicPriceSamples)
    dayKeys.add(getLocalDayKey(sample.periodStart));
  for (const sample of archive.solarForecastSamples)
    dayKeys.add(getLocalDayKey(sample.periodStart));
  for (const sample of archive.solarEnergyProviderSamples)
    dayKeys.add(getLocalDayKey(sample.periodStart));
  for (const sample of archive.p1MeterSamples)
    dayKeys.add(getLocalDayKey(sample.periodStart));
  for (const sample of archive.batteryPowerSamples)
    dayKeys.add(getLocalDayKey(sample.periodStart));

  return [...dayKeys].sort();
}

export function getCurrentPeriodStart(): string {
  const now = Date.now();
  return new Date(
    Math.floor(now / HISTORY_STEP_MS) * HISTORY_STEP_MS,
  ).toISOString();
}

export function buildNowLabel() {
  return {
    fill: UI_COLORS.textPrimary,
    fontSize: 12,
    position: "top" as const,
    value: "Now",
  };
}

export function buildYAxisLabel(
  value: string,
  position: "insideLeft" | "right",
) {
  return {
    angle: position === "insideLeft" ? -90 : 90,
    fill: UI_COLORS.chartTickMuted,
    fontSize: 12,
    offset: 0,
    position,
    value,
  };
}

export function buildMirroredYAxis(
  values: Array<number | null | undefined>,
  domainOverride?: [number, number],
  tickCount = STANDARD_Y_AXIS_TICK_COUNT,
  includeZero = true,
  useExactDomain = false,
): { domain: [number, number]; ticks: number[] } {
  if (domainOverride) {
    return buildYAxisFromDomain(domainOverride, tickCount);
  }

  const numericValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );

  if (numericValues.length === 0) {
    return buildYAxisFromDomain([0, 1], tickCount);
  }

  let minimum = Math.min(...numericValues);
  let maximum = Math.max(...numericValues);

  if (includeZero) {
    if (minimum > 0) minimum = 0;
    if (maximum < 0) maximum = 0;
  }

  if (minimum === maximum) {
    if (minimum === 0) maximum = 1;
    else if (minimum > 0) minimum = 0;
    else maximum = 0;
  }

  if (useExactDomain) {
    return buildExactYAxisFromDomain([minimum, maximum], tickCount);
  }

  return buildYAxisFromDomain([minimum, maximum], tickCount);
}

export function buildResponsiveDayTicks<T extends string | number>(
  values: T[],
  chartWidth: number,
): T[] {
  const hourStep = getResponsiveHourStep(chartWidth);
  const hourCandidates = values.filter(
    (value) => isHourTickValue(value) && isStepAlignedHour(value, hourStep),
  );

  if (hourCandidates.length > 0) {
    return buildXAxisTicks(hourCandidates, hourCandidates.length, [
      values[0],
      values.find((value) => isMidnightTickValue(value)),
    ]);
  }

  return buildXAxisTicks(values, getResponsiveTickCount(chartWidth), [
    values[0],
    values.find((value) => isMidnightTickValue(value)),
  ]);
}

export function deduplicateTooltipEntries(
  entries: Array<TooltipPayloadEntry & { value: number }>,
): Array<TooltipPayloadEntry & { value: number }> {
  const entriesByName = new Map<
    string,
    TooltipPayloadEntry & { value: number }
  >();

  for (const entry of entries) {
    if (entry.dataKey === "rightAxisValue") continue;
    const key = entry.name ?? entry.dataKey ?? "Value";
    const existing = entriesByName.get(key);

    if (
      !existing ||
      getTooltipEntryPriority(entry) > getTooltipEntryPriority(existing)
    ) {
      entriesByName.set(key, entry);
    }
  }

  return [...entriesByName.values()];
}

function getTooltipEntryPriority(entry: TooltipPayloadEntry): number {
  if (entry.dataKey?.startsWith("current")) return 2;
  if (entry.dataKey?.startsWith("future")) return 1;
  return 0;
}

function buildXAxisTicks<T extends string | number>(
  values: T[],
  count = 7,
  requiredValues: Array<T | undefined> = [],
): T[] {
  if (values.length === 0) return [];

  const tickValues = new Map<number, T>();
  for (const value of requiredValues) {
    if (value !== undefined) tickValues.set(getXAxisTimestamp(value), value);
  }

  for (const index of buildTickIndexes(values.length, count)) {
    const value = values[index];
    if (value !== undefined) tickValues.set(getXAxisTimestamp(value), value);
  }

  return [...tickValues.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, value]) => value);
}

function getResponsiveTickCount(chartWidth: number): number {
  const usableWidth = Math.max(
    0,
    chartWidth - LEFT_Y_AXIS_WIDTH - RIGHT_Y_AXIS_WIDTH,
  );

  return Math.max(3, Math.min(8, Math.floor(usableWidth / 84)));
}

function getResponsiveHourStep(chartWidth: number): number {
  const usableWidth = Math.max(
    0,
    chartWidth - LEFT_Y_AXIS_WIDTH - RIGHT_Y_AXIS_WIDTH,
  );

  if (usableWidth >= 860) return 2;
  if (usableWidth >= 700) return 3;
  if (usableWidth >= 580) return 4;
  if (usableWidth >= 460) return 5;
  if (usableWidth >= 360) return 6;
  if (usableWidth >= 280) return 8;
  if (usableWidth >= 220) return 12;
  return 24;
}

function buildTickIndexes(length: number, count: number): number[] {
  if (length <= count) {
    return Array.from({ length }, (_, index) => index);
  }

  return Array.from({ length: count }, (_, index) =>
    Math.min(length - 1, Math.round((index / (count - 1)) * (length - 1))),
  );
}

function buildYAxisFromDomain(
  domain: [number, number],
  tickCount: number,
): { domain: [number, number]; ticks: number[] } {
  let [minimum, maximum] = domain;
  if (minimum === maximum) maximum = minimum + 1;

  const step = getNiceAxisStep(minimum, maximum, tickCount);
  const domainMinimum = normalizeAxisValue(Math.floor(minimum / step) * step);
  const domainMaximum = normalizeAxisValue(Math.ceil(maximum / step) * step);
  const ticks: number[] = [];

  for (
    let value = domainMinimum;
    value <= domainMaximum + step / 2;
    value += step
  ) {
    ticks.push(normalizeAxisValue(value));
  }

  return { domain: [domainMinimum, domainMaximum], ticks };
}

function buildExactYAxisFromDomain(
  domain: [number, number],
  tickCount: number,
): { domain: [number, number]; ticks: number[] } {
  let [minimum, maximum] = domain;
  if (minimum === maximum) maximum = minimum + 1;

  const step = (maximum - minimum) / Math.max(1, tickCount - 1);
  const ticks = Array.from({ length: tickCount }, (_, index) =>
    normalizeAxisValue(minimum + step * index),
  );

  return {
    domain: [normalizeAxisValue(minimum), normalizeAxisValue(maximum)],
    ticks,
  };
}

function getNiceAxisStep(
  minimum: number,
  maximum: number,
  tickCount: number,
): number {
  const range = Math.max(Math.abs(maximum - minimum), 1);
  const roughStep = range / Math.max(1, tickCount - 1);
  const exponent = Math.floor(Math.log10(roughStep));
  const fraction = roughStep / 10 ** exponent;

  let niceFraction: number;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  return niceFraction * 10 ** exponent;
}

function normalizeAxisValue(value: number): number {
  if (Math.abs(value) < 1e-9) return 0;
  return Number(value.toFixed(10));
}

function getXAxisTimestamp(value: string | number): number {
  return typeof value === "number" ? value : new Date(value).getTime();
}

function isHourTickValue(value: string | number): boolean {
  const date = new Date(value);
  return date.getMinutes() === 0;
}

function isStepAlignedHour(value: string | number, hourStep: number): boolean {
  return new Date(value).getHours() % hourStep === 0;
}

function isMidnightTickValue(value: string | number): boolean {
  const date = new Date(value);
  return date.getHours() === 0 && date.getMinutes() === 0;
}
