import { CalendarClock, Hand } from "lucide-react";
import { deriveBatteryStatusFromPower } from "@emsd/core/client";
import type { ReactNode } from "react";
import { formatAbsolutePowerValue } from "../../lib/power-format";
import { UI_COLORS } from "../../lib/ui-colors";
import type { BatteryHistoryPoint, TooltipPayloadEntry } from "./types";
import { deduplicateTooltipEntries, formatPercentValue } from "./utils";

export function HistoryTooltip({
  active,
  entryLabelFormatter,
  formatter,
  label,
  labelFormatter,
  payload,
}: {
  active?: boolean;
  entryLabelFormatter?: (value: number, key?: string) => string;
  formatter: (value: number, key?: string) => string;
  label?: string;
  labelFormatter: (label: string) => string;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !label || !payload || payload.length === 0) return null;

  const numericEntries = payload.filter(
    (entry): entry is TooltipPayloadEntry & { value: number } =>
      typeof entry.value === "number",
  );
  const deduplicatedEntries = deduplicateTooltipEntries(numericEntries);
  if (deduplicatedEntries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {labelFormatter(label)}
      </p>
      <div className="space-y-1.5">
        {deduplicatedEntries.map((entry) => (
          <div
            key={`${entry.dataKey}-${entry.name}`}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-2 text-slate-200">
              <TooltipMarker
                color={entry.color ?? UI_COLORS.chartSeriesFallback}
                strokeDasharray={
                  entry.dataKey?.startsWith("predicted") ? "1 6" : undefined
                }
              />
              {entryLabelFormatter?.(entry.value, entry.dataKey) ??
                entry.name ??
                entry.dataKey ??
                "Value"}
            </span>
            <span className="font-medium text-white">
              {formatter(entry.value, entry.dataKey)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BatteryHistoryTooltip({
  active,
  label,
  labelFormatter,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  labelFormatter: (label: string | number) => string;
  payload?: TooltipPayloadEntry[];
}) {
  if (
    label === undefined ||
    label === null ||
    !active ||
    !payload ||
    payload.length === 0
  ) {
    return null;
  }

  const powerEntry =
    payload.find(
      (entry) =>
        entry.dataKey === "futurePower" && typeof entry.value === "number",
    ) ??
    payload.find(
      (entry) =>
        entry.dataKey === "currentPower" && typeof entry.value === "number",
    );
  const chargeEntry =
    payload.find(
      (entry) =>
        entry.dataKey === "futureChargePercent" &&
        typeof entry.value === "number",
    ) ??
    payload.find(
      (entry) =>
        entry.dataKey === "currentChargePercent" &&
        typeof entry.value === "number",
    );
  const point = payload.find((entry) => entry.payload)?.payload as
    | BatteryHistoryPoint
    | undefined;
  const strategyLabel = formatStrategyTooltipLabel(
    point?.strategyDisplayState ?? null,
    point?.strategyDisplayLabel ?? null,
  );
  const strategySource = point?.strategySource ?? null;

  if (!powerEntry && !chargeEntry && !strategyLabel) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {labelFormatter(label)}
      </p>
      <div className="space-y-1.5">
        {powerEntry && typeof powerEntry.value === "number" ? (
          <TooltipRow
            color={UI_COLORS.batteryPowerDischarging}
            label={formatBatteryPowerLabel(powerEntry.value)}
            strokeDasharray={undefined}
            value={formatAbsolutePowerValue(powerEntry.value)}
          />
        ) : null}
        {chargeEntry && typeof chargeEntry.value === "number" ? (
          <TooltipRow
            color={UI_COLORS.batteryChargeLevel}
            label="Battery Charge"
            strokeDasharray={undefined}
            value={formatPercentValue(chargeEntry.value)}
          />
        ) : null}
        {strategyLabel ? (
          <TooltipRow
            color={getStrategyTooltipColor(point?.strategyDisplayState ?? null)}
            label="Strategy"
            strokeDasharray={undefined}
            value={
              <span className="inline-flex items-center gap-1.5">
                {strategySource ? (
                  <StrategySourceIcon source={strategySource} />
                ) : null}
                <span>{strategyLabel}</span>
              </span>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function formatBatteryPowerLabel(value: number): string {
  switch (deriveBatteryStatusFromPower(value)) {
    case "charging":
      return "Charging Power";
    case "discharging":
      return "Discharging Power";
    case "idle":
      return "Idle Power";
    default:
      return "Power";
  }
}

function StrategySourceIcon({
  source,
}: {
  source: NonNullable<BatteryHistoryPoint["strategySource"]>;
}) {
  const Icon = source === "manual" ? Hand : CalendarClock;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
}

function formatStrategyTooltipLabel(
  displayState: BatteryHistoryPoint["strategyDisplayState"],
  fallbackLabel: string | null,
): string | null {
  switch (displayState) {
    case "charge":
      return "Charging";
    case "discharge":
      return "Discharging";
    case "idle":
      return "Idle";
    case "self-consumption":
      return "Self-consumption";
    default:
      return fallbackLabel;
  }
}

function getStrategyTooltipColor(
  displayState: BatteryHistoryPoint["strategyDisplayState"],
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
    default:
      return UI_COLORS.chartSeriesFallback;
  }
}

export function SegmentedHistoryTooltip({
  active,
  label,
  labelFormatter,
  negativeColor,
  negativeLabel,
  payload,
  positiveColor,
  positiveLabel,
  valueFormatter,
}: {
  active?: boolean;
  label?: string | number;
  labelFormatter: (label: string | number) => string;
  negativeColor: string;
  negativeLabel: string;
  payload?: TooltipPayloadEntry[];
  positiveColor: string;
  positiveLabel: string;
  valueFormatter: (value: number) => string;
}) {
  if (
    !active ||
    label === undefined ||
    label === null ||
    !payload ||
    payload.length === 0
  ) {
    return null;
  }

  const validPayload = payload.filter(
    (entry) => entry.dataKey !== "rightAxisValue",
  );
  const selectedEntry =
    validPayload.find(
      (entry) =>
        entry.dataKey === "futureValue" && typeof entry.value === "number",
    ) ??
    validPayload.find(
      (entry) =>
        entry.dataKey === "currentValue" && typeof entry.value === "number",
    ) ??
    validPayload.find(
      (entry) =>
        entry.dataKey?.startsWith("future") && typeof entry.value === "number",
    ) ??
    validPayload.find((entry) => typeof entry.value === "number");

  if (!selectedEntry || typeof selectedEntry.value !== "number") return null;

  const isPositive = selectedEntry.value >= 0;
  const seriesColor = isPositive ? positiveColor : negativeColor;
  const seriesLabel = isPositive ? positiveLabel : negativeLabel;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {labelFormatter(label)}
      </p>
      <div className="space-y-1.5">
        <TooltipRow
          color={seriesColor}
          label={seriesLabel}
          strokeDasharray={undefined}
          value={valueFormatter(selectedEntry.value)}
        />
      </div>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  strokeDasharray,
  value,
}: {
  color: string;
  label: string;
  strokeDasharray: string | undefined;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-slate-200">
        <TooltipMarker color={color} strokeDasharray={strokeDasharray} />
        {label}
      </span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function TooltipMarker({
  color,
  strokeDasharray,
}: {
  color: string;
  strokeDasharray: string | undefined;
}) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height="8"
      viewBox="0 0 18 8"
      width="18"
    >
      <line
        stroke={color}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        strokeWidth="2.8"
        x1="1.4"
        x2="16.6"
        y1="4"
        y2="4"
      />
    </svg>
  );
}
