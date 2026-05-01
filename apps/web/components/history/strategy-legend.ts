import type { BatteryStrategyHistorySource } from "@emsd/core/client";
import { UI_COLORS } from "../../lib/ui-colors";
import type { BatteryHistoryPoint } from "./types";

export function getBatteryStrategyLegendItems(
  points: BatteryHistoryPoint[],
): Array<{
  color: string;
  key: string;
  label: string;
  source: BatteryStrategyHistorySource | null;
  state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
}> {
  const seen = new Set<string>();
  const items: Array<{
    color: string;
    key: string;
    label: string;
    source: BatteryStrategyHistorySource | null;
    state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
  }> = [];

  for (const point of points) {
    const state = point.strategyDisplayState;

    if (state === null) {
      continue;
    }

    const label = formatBatteryStrategyLegendLabel({
      displayLabel: point.strategyDisplayLabel,
      displayState: state,
      itemLabel: point.strategyItemLabel,
    });
    const key = `${point.strategySource ?? "unknown"}:${state}:${label}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push({
      color: getStrategyLegendColor(state),
      key,
      label,
      source: point.strategySource,
      state,
    });
  }

  return items;
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

export function getStrategyLegendColor(
  state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>,
): string {
  switch (state) {
    case "self-consumption":
      return UI_COLORS.strategySelfConsumption;
    case "charge":
      return UI_COLORS.strategyCharge;
    case "discharge":
      return UI_COLORS.strategyDischarge;
    case "idle":
      return UI_COLORS.strategyIdle;
  }
}
