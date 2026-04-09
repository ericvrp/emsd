"use client";

import {
  Gauge,
  HandCoins,
  Layers3,
  SunMedium,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { HistoryArchive } from "../lib/ems-bridge";
import { UI_CHART_STYLES, UI_COLORS, UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import { DateSelect } from "./date-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type HistoryTab = "combined" | "price" | "solar" | "grid" | "battery";

type HistoryPageProps = {
  archive: HistoryArchive;
  requestedDay: string | null;
  siteName: string;
  selectedTab: HistoryTab;
};

type SingleValuePoint = {
  periodStart: string;
  value: number | null;
};

type SignedValuePoint = SingleValuePoint & {
  negativeValue: number | null;
  positiveValue: number | null;
};

type CombinedPoint = {
  batteryCharge: number | null;
  batteryDischarge: number | null;
  gridExport: number | null;
  gridImport: number | null;
  periodStart: string;
  price: number | null;
  solar: number | null;
};

type TooltipPayloadEntry = {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: ValueType;
};

const HISTORY_STEP_MS = 15 * 60 * 1_000;

const HISTORY_TABS: Array<{
  description: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: HistoryTab;
}> = [
  {
    description: "Overlay the main energy signals in a single chart.",
    icon: Layers3,
    label: "Combined",
    value: "combined",
  },
  {
    description: "Review the Tibber 15-minute import prices.",
    icon: HandCoins,
    label: "Price",
    value: "price",
  },
  {
    description: "Review the solar forecast aligned to each 15-minute period.",
    icon: SunMedium,
    label: "Solar",
    value: "solar",
  },
  {
    description: "Review P1 grid import and export power.",
    icon: Gauge,
    label: "Grid",
    value: "grid",
  },
  {
    description: "Review combined battery charge and discharge power.",
    icon: Zap,
    label: "Battery",
    value: "battery",
  },
];

export function HistoryPage({
  archive,
  requestedDay,
  siteName,
  selectedTab,
}: HistoryPageProps) {
  const router = useRouter();
  const availableDays = getAvailableDays(archive);
  const firstDay = availableDays[0] ?? null;
  const lastDay = availableDays.at(-1) ?? null;
  const selectedDay =
    requestedDay && availableDays.includes(requestedDay)
      ? requestedDay
      : lastDay;
  const selectedDayIndex =
    selectedDay === null ? -1 : availableDays.indexOf(selectedDay);

  const priceSeries = createSingleValueSeries(
    archive.dynamicPriceSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
  );
  const solarSeries = createSingleValueSeries(
    archive.solarForecastSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.value,
    })),
  );
  const gridSeries = createSignedSeries(aggregatePowerSamples(archive.p1MeterSamples));
  const batterySeries = createSignedSeries(
    aggregatePowerSamples(archive.batteryPowerSamples),
  );

  const dailyPriceSeries =
    selectedDay === null ? [] : fillSingleValueDay(priceSeries, selectedDay);
  const dailySolarSeries =
    selectedDay === null ? [] : fillSingleValueDay(solarSeries, selectedDay);
  const dailyGridSeries =
    selectedDay === null ? [] : fillSignedDay(gridSeries, selectedDay);
  const dailyBatterySeries =
    selectedDay === null ? [] : fillSignedDay(batterySeries, selectedDay);

  const combinedDailySeries = createCombinedSeries({
    battery: dailyBatterySeries,
    grid: dailyGridSeries,
    price: dailyPriceSeries,
    solar: dailySolarSeries,
  });

  const canGoBackward = selectedDayIndex > 0;
  const canGoForward = selectedDayIndex >= 0 && selectedDayIndex < availableDays.length - 1;

  function navigate(next: {
    day?: string | null;
    tab?: HistoryTab;
  }) {
    const params = new URLSearchParams();
    const tab = next.tab ?? selectedTab;
    const day = next.day === undefined ? selectedDay : next.day;

    params.set("tab", tab);

    if (day) {
      params.set("day", day);
    }

    router.push(`/history?${params.toString()}`, { scroll: false });
  }

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_38%),radial-gradient(circle_at_top_right,rgba(192,132,252,0.12),transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.94),rgba(2,6,23,0.9))]">
        <CardHeader className="gap-4 border-b border-white/8 pb-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
                History
              </p>
              <CardTitle className="text-3xl sm:text-4xl">
                Daily time-series history for {siteName}
              </CardTitle>
              <CardDescription className="max-w-3xl text-base leading-7 text-slate-300">
                Move between sampled days, then switch between a combined chart and focused per-signal tabs.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="overflow-hidden border-white/10 bg-slate-950/75">
        <CardHeader className="border-b border-white/8 p-0">
          <div className={`${UI_STYLES.tabBar} pt-3 sm:pt-4`}>
            {HISTORY_TABS.map((tab) => (
              <HistoryTabButton
                active={selectedTab === tab.value}
                icon={tab.icon}
                key={tab.value}
                label={tab.label}
                onClick={() => navigate({ tab: tab.value })}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <DateSelect
            availableDays={availableDays}
            canGoBackward={canGoBackward}
            canGoForward={canGoForward}
            firstDay={firstDay}
            lastDay={lastDay}
            onSelectDay={(day) => navigate({ day })}
            onSelectFirstDay={() => navigate({ day: firstDay })}
            onSelectLastDay={() => navigate({ day: lastDay })}
            onSelectNextDay={() =>
              navigate({
                day: canGoForward ? availableDays[selectedDayIndex + 1] ?? null : null,
              })}
            onSelectPreviousDay={() =>
              navigate({
                day: canGoBackward ? availableDays[selectedDayIndex - 1] ?? null : null,
              })}
            selectedDay={selectedDay}
          />
          {selectedDay === null ? (
            <p className="py-4 text-center text-slate-300">
              History will appear here once the daemon has collected at least one sampled day.
            </p>
          ) : selectedTab === "combined" ? (
            <CombinedHistoryChart
              points={combinedDailySeries}
            />
          ) : selectedTab === "price" ? (
            <SingleValueHistoryChart
              accentColor={UI_COLORS.price}
              emptyMessage="No dynamic price samples were available for this range."
              label="Dynamic Price"
              points={dailyPriceSeries}
              valueFormatter={formatPriceValue}
              yAxisFormatter={formatShortPriceValue}
            />
          ) : selectedTab === "solar" ? (
            <SingleValueHistoryChart
              accentColor={UI_COLORS.forecast}
              emptyMessage="No solar forecast samples were available for this range."
              label="Solar Forecast"
              points={dailySolarSeries}
              valueFormatter={formatWholeNumberValue}
              yAxisFormatter={formatShortPowerValue}
            />
          ) : selectedTab === "grid" ? (
            <SignedHistoryChart
              emptyMessage="No P1 meter samples were available for this range."
              negativeColor={UI_COLORS.gridExport}
              negativeLabel="Return to grid"
              points={dailyGridSeries}
              positiveColor={UI_COLORS.gridImport}
              positiveLabel="Take from grid"
              valueFormatter={formatPowerValue}
              yAxisFormatter={formatShortPowerValue}
            />
          ) : (
            <SignedHistoryChart
              emptyMessage="No battery power samples were available for this range."
              negativeColor={UI_COLORS.batteryCharge}
              negativeLabel="Battery charge"
              points={dailyBatterySeries}
              positiveColor={UI_COLORS.batteryDischarge}
              positiveLabel="Battery discharge"
              valueFormatter={formatPowerValue}
              yAxisFormatter={formatShortPowerValue}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CombinedHistoryChart({
  points,
}: {
  points: CombinedPoint[];
}) {
  const hasValues = points.some((point) =>
    [
      point.price,
      point.solar,
      point.gridImport,
      point.gridExport,
      point.batteryCharge,
      point.batteryDischarge,
    ].some((value) => typeof value === "number"),
  );

  if (!hasValues) {
    return (
      <p className="text-sm leading-6 text-slate-400">
        No history samples were available for the selected chart range.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
        <LegendChip color={UI_COLORS.price} label="Price" />
        <LegendChip color={UI_COLORS.forecast} label="Solar" />
        <LegendChip color={UI_COLORS.gridImport} label="Take from grid" />
        <LegendChip color={UI_COLORS.gridExport} label="Return to grid" />
        <LegendChip color={UI_COLORS.batteryDischarge} label="Battery discharge" />
        <LegendChip color={UI_COLORS.batteryCharge} label="Battery charge" />
      </div>
      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={UI_COLORS.chartGrid} strokeDasharray="3 6" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="periodStart"
              minTickGap={28}
              tick={UI_CHART_STYLES.axisTick}
              tickFormatter={formatDayTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={UI_CHART_STYLES.axisTickMuted}
              tickFormatter={formatShortPowerValue}
              tickLine={false}
              width={60}
              yAxisId="power"
            />
            <YAxis hide yAxisId="price" />
            <YAxis hide yAxisId="solar" />
            <ReferenceLine
              stroke={UI_COLORS.chartZeroLine}
              strokeDasharray="4 6"
              y={0}
              yAxisId="power"
            />
            <Tooltip
              content={
                <HistoryTooltip
                  formatter={formatCombinedValue}
                  labelFormatter={formatTooltipTimestamp}
                />
              }
            />
            <Line
              dataKey="price"
              dot={false}
              isAnimationActive={false}
              name="Price"
              stroke={UI_COLORS.price}
              strokeDasharray="5 4"
              strokeWidth={2}
              type="monotone"
              yAxisId="price"
            />
            <Line
              dataKey="solar"
              dot={false}
              isAnimationActive={false}
              name="Solar"
              stroke={UI_COLORS.forecast}
              strokeWidth={2.2}
              type="monotone"
              yAxisId="solar"
            />
            <Line
              dataKey="gridImport"
              dot={false}
              isAnimationActive={false}
              name="Take from grid"
              stroke={UI_COLORS.gridImport}
              strokeWidth={2.1}
              type="monotone"
              yAxisId="power"
            />
            <Line
              dataKey="gridExport"
              dot={false}
              isAnimationActive={false}
              name="Return to grid"
              stroke={UI_COLORS.gridExport}
              strokeWidth={2.1}
              type="monotone"
              yAxisId="power"
            />
            <Line
              dataKey="batteryDischarge"
              dot={false}
              isAnimationActive={false}
              name="Battery discharge"
              stroke={UI_COLORS.batteryDischarge}
              strokeWidth={2.1}
              type="monotone"
              yAxisId="power"
            />
            <Line
              dataKey="batteryCharge"
              dot={false}
              isAnimationActive={false}
              name="Battery charge"
              stroke={UI_COLORS.batteryCharge}
              strokeWidth={2.1}
              type="monotone"
              yAxisId="power"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SingleValueHistoryChart({
  accentColor,
  emptyMessage,
  label,
  points,
  valueFormatter,
  yAxisFormatter,
}: {
  accentColor: string;
  emptyMessage: string;
  label: string;
  points: SingleValuePoint[];
  valueFormatter: (value: number) => string;
  yAxisFormatter: (value: number) => string;
}) {
  const hasValues = points.some((point) => typeof point.value === "number");
  const gradientId = `${label.toLowerCase().replace(/\s+/g, "-")}-gradient`;

  if (!hasValues) {
    return <p className="text-sm leading-6 text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
        <LegendChip color={accentColor} label={label} />
      </div>
      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={accentColor} stopOpacity={0.38} />
                <stop offset="95%" stopColor={accentColor} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={UI_COLORS.chartGrid} strokeDasharray="3 6" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="periodStart"
              minTickGap={28}
              tick={UI_CHART_STYLES.axisTick}
              tickFormatter={formatDayTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={UI_CHART_STYLES.axisTickMuted}
              tickFormatter={yAxisFormatter}
              tickLine={false}
              width={56}
            />
            <Tooltip
              content={
                <HistoryTooltip
                  formatter={valueFormatter}
                  labelFormatter={formatTooltipTimestamp}
                />
              }
            />
            <Area
              dataKey="value"
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              name={label}
              stroke={accentColor}
              strokeWidth={3}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SignedHistoryChart({
  emptyMessage,
  negativeColor,
  negativeLabel,
  points,
  positiveColor,
  positiveLabel,
  valueFormatter,
  yAxisFormatter,
}: {
  emptyMessage: string;
  negativeColor: string;
  negativeLabel: string;
  points: SignedValuePoint[];
  positiveColor: string;
  positiveLabel: string;
  valueFormatter: (value: number) => string;
  yAxisFormatter: (value: number) => string;
}) {
  const hasValues = points.some((point) => typeof point.value === "number");
  const positiveGradientId = `${positiveLabel.toLowerCase().replace(/\s+/g, "-")}-gradient`;
  const negativeGradientId = `${negativeLabel.toLowerCase().replace(/\s+/g, "-")}-gradient`;

  if (!hasValues) {
    return <p className="text-sm leading-6 text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
        <LegendChip color={positiveColor} label={positiveLabel} />
        <LegendChip color={negativeColor} label={negativeLabel} />
      </div>
      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={positiveGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={positiveColor} stopOpacity={0.34} />
                <stop offset="95%" stopColor={positiveColor} stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id={negativeGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={negativeColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={negativeColor} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={UI_COLORS.chartGrid} strokeDasharray="3 6" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="periodStart"
              minTickGap={28}
              tick={UI_CHART_STYLES.axisTick}
              tickFormatter={formatDayTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={UI_CHART_STYLES.axisTickMuted}
              tickFormatter={yAxisFormatter}
              tickLine={false}
              width={60}
            />
            <ReferenceLine stroke={UI_COLORS.chartZeroLine} strokeDasharray="4 6" y={0} />
            <Tooltip
              content={
                <HistoryTooltip
                  formatter={valueFormatter}
                  labelFormatter={formatTooltipTimestamp}
                />
              }
            />
            <Area
              dataKey="positiveValue"
              fill={`url(#${positiveGradientId})`}
              isAnimationActive={false}
              name={positiveLabel}
              stroke={positiveColor}
              strokeWidth={2.6}
              type="monotone"
            />
            <Area
              dataKey="negativeValue"
              fill={`url(#${negativeGradientId})`}
              isAnimationActive={false}
              name={negativeLabel}
              stroke={negativeColor}
              strokeWidth={2.6}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HistoryTooltip({
  active,
  formatter,
  label,
  labelFormatter,
  payload,
}: {
  active?: boolean;
  formatter: (value: number, key?: string) => string;
  label?: string;
  labelFormatter: (label: string) => string;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !label || !payload || payload.length === 0) {
    return null;
  }

  const numericEntries = payload.filter(
    (entry): entry is TooltipPayloadEntry & { value: number } =>
      typeof entry.value === "number",
  );

  if (numericEntries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {labelFormatter(label)}
      </p>
      <div className="space-y-1.5">
        {numericEntries.map((entry) => (
          <div key={`${entry.dataKey}-${entry.name}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-slate-200">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color ?? UI_COLORS.energy }}
              />
              {entry.name ?? entry.dataKey ?? "Value"}
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

function HistoryTabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        UI_STYLES.tabItem,
        active
          ? UI_STYLES.tabItemActive
          : UI_STYLES.tabItemInactive,
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function getAvailableDays(archive: HistoryArchive): string[] {
  const dayKeys = new Set<string>();
  const todayKey = getUtcDayKey(new Date());

  for (const sample of archive.dynamicPriceSamples) {
    const dayKey = getUtcDayKey(sample.periodStart);

    if (dayKey <= todayKey) {
      dayKeys.add(dayKey);
    }
  }

  for (const sample of archive.solarForecastSamples) {
    const dayKey = getUtcDayKey(sample.periodStart);

    if (dayKey <= todayKey) {
      dayKeys.add(dayKey);
    }
  }

  for (const sample of archive.p1MeterSamples) {
    const dayKey = getUtcDayKey(sample.periodStart);

    if (dayKey <= todayKey) {
      dayKeys.add(dayKey);
    }
  }

  for (const sample of archive.batteryPowerSamples) {
    const dayKey = getUtcDayKey(sample.periodStart);

    if (dayKey <= todayKey) {
      dayKeys.add(dayKey);
    }
  }

  return [...dayKeys].sort();
}

function createSingleValueSeries(points: SingleValuePoint[]): SingleValuePoint[] {
  return [...points].sort(
    (left, right) =>
      new Date(left.periodStart).getTime() - new Date(right.periodStart).getTime(),
  );
}

function aggregatePowerSamples(
  samples: Array<{ periodStart: string; powerW: number | null }>,
): SingleValuePoint[] {
  const aggregated = new Map<string, { hasValue: boolean; total: number }>();

  for (const sample of samples) {
    const bucket = aggregated.get(sample.periodStart) ?? { hasValue: false, total: 0 };

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
        new Date(left.periodStart).getTime() - new Date(right.periodStart).getTime(),
    );
}

function createSignedSeries(points: SingleValuePoint[]): SignedValuePoint[] {
  return points.map((point) => ({
    ...point,
    negativeValue:
      typeof point.value === "number" && point.value < 0 ? point.value : null,
    positiveValue:
      typeof point.value === "number" && point.value >= 0 ? point.value : null,
  }));
}

function fillSingleValueDay(points: SingleValuePoint[], dayKey: string): SingleValuePoint[] {
  const valuesByPeriod = new Map(
    points
      .filter((point) => getUtcDayKey(point.periodStart) === dayKey)
      .map((point) => [point.periodStart, point.value] as const),
  );

  return createDayPeriods(dayKey).map((periodStart) => ({
    periodStart,
    value: valuesByPeriod.get(periodStart) ?? null,
  }));
}

function fillSignedDay(points: SignedValuePoint[], dayKey: string): SignedValuePoint[] {
  const valuesByPeriod = new Map(
    points
      .filter((point) => getUtcDayKey(point.periodStart) === dayKey)
      .map((point) => [point.periodStart, point] as const),
  );

  return createDayPeriods(dayKey).map((periodStart) => {
    const existing = valuesByPeriod.get(periodStart);

    return existing ?? {
      negativeValue: null,
      periodStart,
      positiveValue: null,
      value: null,
    };
  });
}

function createCombinedSeries(input: {
  battery: SignedValuePoint[];
  grid: SignedValuePoint[];
  price: SingleValuePoint[];
  solar: SingleValuePoint[];
}): CombinedPoint[] {
  const combined = new Map<string, CombinedPoint>();

  for (const point of input.price) {
    combined.set(point.periodStart, {
      batteryCharge: null,
      batteryDischarge: null,
      gridExport: null,
      gridImport: null,
      periodStart: point.periodStart,
      price: point.value,
      solar: null,
    });
  }

  for (const point of input.solar) {
    const existing = combined.get(point.periodStart) ?? createEmptyCombinedPoint(point.periodStart);
    existing.solar = point.value;
    combined.set(point.periodStart, existing);
  }

  for (const point of input.grid) {
    const existing = combined.get(point.periodStart) ?? createEmptyCombinedPoint(point.periodStart);
    existing.gridExport = point.negativeValue;
    existing.gridImport = point.positiveValue;
    combined.set(point.periodStart, existing);
  }

  for (const point of input.battery) {
    const existing = combined.get(point.periodStart) ?? createEmptyCombinedPoint(point.periodStart);
    existing.batteryCharge = point.negativeValue;
    existing.batteryDischarge = point.positiveValue;
    combined.set(point.periodStart, existing);
  }

  return [...combined.values()].sort(
    (left, right) =>
      new Date(left.periodStart).getTime() - new Date(right.periodStart).getTime(),
  );
}

function createEmptyCombinedPoint(periodStart: string): CombinedPoint {
  return {
    batteryCharge: null,
    batteryDischarge: null,
    gridExport: null,
    gridImport: null,
    periodStart,
    price: null,
    solar: null,
  };
}

function createDayPeriods(dayKey: string): string[] {
  const startMs = new Date(`${dayKey}T00:00:00.000Z`).getTime();

  return Array.from({ length: 24 * 4 }, (_, index) =>
    new Date(startMs + index * HISTORY_STEP_MS).toISOString(),
  );
}

function formatDayTick(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTooltipTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatPowerValue(value: number): string {
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1000) {
    return `${value < 0 ? "-" : ""}${(absoluteValue / 1000).toFixed(2)} kW`;
  }

  return `${Math.round(value)} W`;
}

function formatShortPowerValue(value: number): string {
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1000) {
    return `${value < 0 ? "-" : ""}${(absoluteValue / 1000).toFixed(1)}k`;
  }

  return `${Math.round(value)}`;
}

function formatPriceValue(value: number): string {
  return `${value.toFixed(3)} EUR/kWh`;
}

function formatShortPriceValue(value: number): string {
  return value.toFixed(2);
}

function formatWholeNumberValue(value: number): string {
  return `${Math.round(value)} W/m2`;
}

function formatCombinedValue(value: number, key?: string): string {
  if (key === "price") {
    return formatPriceValue(value);
  }

  if (key === "solar") {
    return formatWholeNumberValue(value);
  }

  return formatPowerValue(value);
}

function getUtcDayKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}
