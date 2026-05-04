import type { BatteryStrategyHistorySource } from "@emsd/core/client";
import { UI_COLORS } from "../../lib/ui-colors";
import type { BatteryHistoryPoint } from "./types";

const STRATEGY_REASON_COLORS: Record<string, string> = {
  charge: UI_COLORS.strategyCharge,
  "delayed charging": "#f59e0b",
  discharge: UI_COLORS.strategyDischarge,
  "export surplus": UI_COLORS.gridExport,
  idle: UI_COLORS.strategyIdle,
  "self-consumption": UI_COLORS.strategySelfConsumption,
};

const STRATEGY_REASON_COLOR_PALETTE = [
  "#f97316",
  "#8b5cf6",
  "#14b8a6",
  "#e879f9",
  "#a3e635",
  "#fb7185",
];

export type BatteryStrategyLegendItem = {
  color: string;
  key: string;
  label: string;
  seriesId: string;
  source: BatteryStrategyHistorySource | null;
  state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
};

export function getBatteryStrategyLegendItems(
  points: BatteryHistoryPoint[],
): BatteryStrategyLegendItem[] {
  const seen = new Set<string>();
  const items: BatteryStrategyLegendItem[] = [];

  for (const point of points) {
    const state = point.strategyDisplayState;

    if (state === null) {
      continue;
    }

    const item = buildBatteryStrategyLegendItem({
      displayLabel: point.strategyDisplayLabel,
      displayState: state,
      itemLabel: point.strategyItemLabel,
      source: point.strategySource,
    });

    if (seen.has(item.key)) {
      continue;
    }

    seen.add(item.key);
    items.push(item);
  }

  return items;
}

export function buildBatteryStrategyLegendItem(input: {
  displayLabel: string | null;
  displayState: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
  itemLabel: string | null;
  source: BatteryStrategyHistorySource | null;
}): BatteryStrategyLegendItem {
  const label = formatBatteryStrategyLegendLabel({
    displayLabel: input.displayLabel,
    displayState: input.displayState,
    itemLabel: input.itemLabel,
  });
  const seriesId = buildBatteryStrategySeriesId({
    label,
    source: input.source,
    state: input.displayState,
  });

  return {
    color: getStrategyLegendColor({
      label,
      seriesId,
      state: input.displayState,
    }),
    key: seriesId,
    label,
    seriesId,
    source: input.source,
    state: input.displayState,
  };
}

function formatBatteryStrategyLegendLabel(input: {
  displayLabel: string | null;
  displayState: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
  itemLabel: string | null;
}): string {
  return formatStrategyReason(
    input.itemLabel,
    input.displayLabel,
    input.displayState,
  );
}

function formatStrategyReason(
  itemLabel: string | null,
  displayLabel: string | null,
  displayState: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>,
): string {
  const trimmedItemLabel = itemLabel?.trim() ?? "";
  const trimmedLabel = displayLabel?.trim() ?? "";

  if (trimmedItemLabel.length > 0) {
    return trimmedItemLabel;
  }

  if (/^Delayed charging\s*:/i.test(trimmedLabel)) {
    return "Delayed charging";
  }

  if (/^Export surplus\s*:/i.test(trimmedLabel)) {
    return "Export surplus";
  }

  if (trimmedLabel.length > 0) {
    return trimmedLabel;
  }

  switch (displayState) {
    case "self-consumption":
      return "Self-consumption";
    case "charge":
      return "Charge";
    case "discharge":
      return "Discharge";
    case "idle":
      return "Idle";
  }
}

function getStrategyLegendColor(input: {
  label: string;
  seriesId: string;
  state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
}): string {
  const normalizedLabel = normalizeStrategyLegendLabel(input.label);

  return (
    STRATEGY_REASON_COLORS[normalizedLabel] ??
    STRATEGY_REASON_COLORS[input.state] ??
    STRATEGY_REASON_COLOR_PALETTE[
      hashStrategyLegendValue(input.seriesId) %
        STRATEGY_REASON_COLOR_PALETTE.length
    ] ??
    UI_COLORS.chartSeriesFallback
  );
}

function buildBatteryStrategySeriesId(input: {
  label: string;
  source: BatteryStrategyHistorySource | null;
  state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
}): string {
  return `strategy:${input.source ?? "unknown"}:${input.state}:${encodeURIComponent(normalizeStrategyLegendLabel(input.label))}`;
}

function normalizeStrategyLegendLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashStrategyLegendValue(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}
