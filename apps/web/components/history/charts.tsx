import type { BatteryStrategyHistoryRecord } from "@emsd/core/client";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatShortPowerValue } from "../../lib/power-format";
import { UI_CHART_STYLES, UI_COLORS } from "../../lib/ui-colors";
import { cn } from "../../lib/utils";
import { MeasuredChartContainer } from "../measured-chart-container";
import {
  BATTERY_POWER_AXIS_DOMAIN,
  BATTERY_POWER_AXIS_TICKS,
  CHARGE_AXIS_DOMAIN,
  CHARGE_AXIS_TICKS,
  HISTORY_STEP_MS,
  LEFT_Y_AXIS_WIDTH,
  RIGHT_Y_AXIS_WIDTH,
  STANDARD_LEFT_AXIS_MARGIN,
  STANDARD_RIGHT_AXIS_MARGIN,
} from "./constants";
import { buildExactBatteryStrategySegments } from "./series";
import {
  BatteryHistoryTooltip,
  HistoryTooltip,
  SegmentedHistoryTooltip,
} from "./tooltips";
import type { BatteryHistoryPoint, SplitSingleValuePoint } from "./types";
import {
  buildHighestLabel,
  buildLowestLabel,
  buildMirroredYAxis,
  buildNowLabel,
  buildResponsiveDayTicks,
  buildYAxisLabel,
  formatBarTooltipTimestamp,
  formatDayTick,
  formatShortPercentValue,
  formatTooltipTimestamp,
} from "./utils";

const BATTERY_STRATEGY_BAND_HEIGHT_RATIO = 0.0603;
const BATTERY_STRATEGY_BAND_BOTTOM =
  BATTERY_POWER_AXIS_DOMAIN[1] -
  (BATTERY_POWER_AXIS_DOMAIN[1] - BATTERY_POWER_AXIS_DOMAIN[0]) *
    BATTERY_STRATEGY_BAND_HEIGHT_RATIO;

export function LegendChip({
  color,
  label,
  marker,
  onClick,
  selected,
}: {
  color: string;
  label: string;
  marker?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  const className = cn(
    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5",
    selected
      ? "border-white/25 bg-white/12 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
      : "border-white/10 bg-white/5",
    onClick
      ? "cursor-pointer transition hover:border-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
      : null,
  );
  const markerNode = marker ?? (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height="8"
      viewBox="0 0 18 8"
      width="18"
    >
      <line
        stroke={color}
        strokeLinecap="round"
        strokeWidth="2.8"
        x1="1.4"
        x2="16.6"
        y1="4"
        y2="4"
      />
    </svg>
  );

  if (onClick) {
    return (
      <button className={className} onClick={onClick} type="button">
        {markerNode}
        {label}
      </button>
    );
  }

  return (
    <span className={className}>
      {markerNode}
      {label}
    </span>
  );
}

export function BatteryHistoryChart({
  emptyMessage,
  headerAccessory,
  nowMarkerPeriodStart,
  points,
  strategyHistory,
}: {
  emptyMessage: string;
  headerAccessory?: ReactNode;
  nowMarkerPeriodStart: string | null;
  points: BatteryHistoryPoint[];
  strategyHistory: BatteryStrategyHistoryRecord[];
}) {
  const hasValues = points.some((point) =>
    [
      point.currentChargingPower,
      point.futureChargingPower,
      point.currentDischargingPower,
      point.futureDischargingPower,
      point.currentChargePercent,
      point.futureChargePercent,
    ].some((value) => typeof value === "number"),
  );
  const chartData = points.map((point) => ({
    ...point,
    timestampMs: new Date(point.periodStart).getTime(),
  }));
  const firstPeriodStartMs = chartData[0]?.timestampMs ?? 0;
  const lastPeriodStartMs = chartData.at(-1)?.timestampMs ?? 0;
  const xAxisDomain: [number, number] = [
    firstPeriodStartMs,
    lastPeriodStartMs + HISTORY_STEP_MS,
  ];
  const cutoffMs =
    nowMarkerPeriodStart === null
      ? null
      : new Date(nowMarkerPeriodStart).getTime();
  const strategySegments = buildExactBatteryStrategySegments({
    chartEndMs: xAxisDomain[1],
    chartStartMs: xAxisDomain[0],
    cutoffMs,
    strategyHistory,
  });
  const strategyStates = getBatteryStrategyLegendItems(strategySegments);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip color={UI_COLORS.batteryPowerDischarging} label="Power" />
          <LegendChip color={UI_COLORS.batteryChargeLevel} label="Charge" />
          {strategyStates.map((state) => (
            <LegendChip
              key={state.label}
              color={state.color}
              label={state.label}
              marker={<StrategyLegendMarker color={state.color} />}
            />
          ))}
        </div>
        {headerAccessory}
      </div>
      <div className="relative">
        <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
          {({ height, width }) => {
            const xAxisTicks = buildResponsiveDayTicks(
              chartData.map((point) => point.timestampMs),
              width,
            );

            return (
              <ComposedChart
                data={chartData}
                height={height}
                margin={{
                  top: 12,
                  right: STANDARD_RIGHT_AXIS_MARGIN,
                  bottom: 0,
                  left: STANDARD_LEFT_AXIS_MARGIN,
                }}
                width={width}
              >
                <CartesianGrid
                  stroke={UI_COLORS.chartGrid}
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="timestampMs"
                  domain={xAxisDomain}
                  interval={0}
                  minTickGap={28}
                  tick={UI_CHART_STYLES.axisTick}
                  tickFormatter={formatDayTick}
                  tickLine={false}
                  ticks={xAxisTicks}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  domain={BATTERY_POWER_AXIS_DOMAIN}
                  label={buildYAxisLabel("Power (W)", "insideLeft")}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={formatShortPowerValue}
                  tickLine={false}
                  tickMargin={8}
                  ticks={BATTERY_POWER_AXIS_TICKS}
                  width={LEFT_Y_AXIS_WIDTH}
                  yAxisId="power"
                />
                <YAxis
                  axisLine={false}
                  domain={CHARGE_AXIS_DOMAIN}
                  label={buildYAxisLabel("Charge (%)", "right")}
                  orientation="right"
                  tick={UI_CHART_STYLES.axisTick}
                  tickMargin={8}
                  ticks={CHARGE_AXIS_TICKS}
                  tickFormatter={formatShortPercentValue}
                  tickLine={false}
                  width={RIGHT_Y_AXIS_WIDTH}
                  yAxisId="charge"
                />
                <YAxis domain={[0, 1]} hide yAxisId="overlay" />
                <ReferenceLine
                  stroke={UI_COLORS.chartZeroLine}
                  strokeDasharray="4 6"
                  y={0}
                  yAxisId="power"
                />
                <Tooltip
                  content={
                    <BatteryHistoryTooltip
                      labelFormatter={formatTooltipTimestamp}
                    />
                  }
                />
                {strategySegments.map((segment) => (
                  <ReferenceArea
                    fill={getStrategyLegendColor(segment.state)}
                    fillOpacity={1}
                    ifOverflow="hidden"
                    key={`${segment.state}-${segment.startMs}-${segment.endMs}`}
                    stroke={getStrategyLegendColor(segment.state)}
                    strokeOpacity={0.95}
                    strokeWidth={1.2}
                    x1={segment.startMs}
                    x2={segment.endMs}
                    y1={BATTERY_STRATEGY_BAND_BOTTOM}
                    y2={BATTERY_POWER_AXIS_DOMAIN[1]}
                    yAxisId="power"
                  />
                ))}
                <Line
                  activeDot={false}
                  connectNulls={false}
                  dataKey="currentPower"
                  dot={false}
                  isAnimationActive={false}
                  name="Power"
                  stroke={UI_COLORS.batteryPowerDischarging}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="power"
                />
                <Line
                  activeDot={false}
                  connectNulls={false}
                  dataKey="futurePower"
                  dot={false}
                  isAnimationActive={false}
                  name="Power"
                  stroke={UI_COLORS.batteryPowerDischarging}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="power"
                />
                <Line
                  dataKey="currentChargePercent"
                  dot={false}
                  isAnimationActive={false}
                  name="Battery Charge"
                  stroke={UI_COLORS.batteryChargeLevel}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="charge"
                />
                <Line
                  dataKey="futureChargePercent"
                  dot={false}
                  isAnimationActive={false}
                  name="Battery Charge"
                  stroke={UI_COLORS.batteryChargeLevel}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  type="monotone"
                  yAxisId="charge"
                />
                {nowMarkerPeriodStart ? (
                  <ReferenceLine
                    label={buildNowLabel()}
                    stroke={UI_COLORS.textPrimary}
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                    strokeWidth={2}
                    x={new Date(nowMarkerPeriodStart).getTime()}
                    yAxisId="power"
                  />
                ) : null}
              </ComposedChart>
            );
          }}
        </MeasuredChartContainer>
        {!hasValues ? <EmptyChartMessage message={emptyMessage} /> : null}
      </div>
    </div>
  );
}

function getBatteryStrategyLegendItems(
  segments: Array<{
    endMs: number;
    startMs: number;
    state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>;
  }>,
): Array<{
  color: string;
  label: string;
}> {
  const presentStates = new Set(segments.map((segment) => segment.state));

  const orderedStates: Array<
    NonNullable<BatteryHistoryPoint["strategyDisplayState"]>
  > = ["self-consumption", "charge", "discharge", "idle"];

  return orderedStates
    .filter((state) => presentStates.has(state))
    .map((state) => ({
      color: getStrategyLegendColor(state),
      label: getStrategyLegendLabel(state),
    }));
}

function getStrategyLegendColor(
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

function getStrategyLegendLabel(
  state: NonNullable<BatteryHistoryPoint["strategyDisplayState"]>,
): string {
  switch (state) {
    case "self-consumption":
      return "Self-consumption";
    case "charge":
      return "Charging";
    case "discharge":
      return "Discharging";
    case "idle":
      return "Idle";
  }
}

function StrategyLegendMarker({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-4 rounded-sm border border-white/10"
      style={{ backgroundColor: color }}
    />
  );
}

export function SingleValueHistoryChart({
  accentColor,
  emptyMessage,
  entryLabelFormatter,
  headerAccessory,
  label,
  lowestMarkerPeriodStarts,
  highestMarkerPeriodStarts,
  nowMarkerPeriodStart,
  points,
  showLegend = true,
  tooltipContent,
  valueFormatter,
  yAxisLabel,
  yAxisDomain,
  yAxisFormatter,
}: {
  accentColor: string;
  emptyMessage: string;
  entryLabelFormatter?: (value: number, key?: string) => string;
  headerAccessory?: ReactNode;
  label: string;
  lowestMarkerPeriodStarts?: string[];
  highestMarkerPeriodStarts?: string[];
  nowMarkerPeriodStart: string | null;
  points: SplitSingleValuePoint[];
  showLegend?: boolean;
  tooltipContent?: ReactElement;
  valueFormatter: (value: number) => string;
  yAxisLabel?: string;
  yAxisDomain?: [number, number];
  yAxisFormatter: (value: number) => string;
}) {
  const chartData = points.map((point) => ({
    ...point,
    rightAxisValue: point.currentValue ?? point.futureValue,
  }));
  const hasValues = points.some(
    (point) =>
      typeof point.currentValue === "number" ||
      typeof point.futureValue === "number",
  );
  const gradientId = `${label.toLowerCase().replace(/\s+/g, "-")}-gradient`;
  const mutedGradientId = `${label.toLowerCase().replace(/\s+/g, "-")}-muted-gradient`;
  const axisConfig = buildMirroredYAxis(
    points.flatMap((point) => [point.currentValue, point.futureValue]),
    yAxisDomain,
  );

  return (
    <div className="space-y-2.5">
      {showLegend || headerAccessory ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {showLegend ? (
            <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
              <LegendChip color={accentColor} label={label} />
            </div>
          ) : null}
          {headerAccessory}
        </div>
      ) : null}
      <div className="relative">
        <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
          {({ height, width }) => {
            const xAxisTicks = buildResponsiveDayTicks(
              points.map((point) => point.periodStart),
              width,
            );
            return (
              <AreaChart
                data={chartData}
                height={height}
                margin={{
                  top: 12,
                  right: STANDARD_RIGHT_AXIS_MARGIN,
                  bottom: 0,
                  left: STANDARD_LEFT_AXIS_MARGIN,
                }}
                width={width}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={accentColor}
                      stopOpacity={0.38}
                    />
                    <stop
                      offset="95%"
                      stopColor={accentColor}
                      stopOpacity={0.04}
                    />
                  </linearGradient>
                  <linearGradient
                    id={mutedGradientId}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={accentColor}
                      stopOpacity={0.16}
                    />
                    <stop
                      offset="95%"
                      stopColor={accentColor}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke={UI_COLORS.chartGrid}
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="periodStart"
                  interval={0}
                  minTickGap={28}
                  tick={UI_CHART_STYLES.axisTick}
                  tickFormatter={formatDayTick}
                  tickLine={false}
                  ticks={xAxisTicks}
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  label={buildYAxisLabel(yAxisLabel ?? "", "insideLeft")}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={LEFT_Y_AXIS_WIDTH}
                  yAxisId="left"
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  orientation="right"
                  {...(yAxisLabel
                    ? { label: buildYAxisLabel(yAxisLabel, "right") }
                    : {})}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={RIGHT_Y_AXIS_WIDTH}
                  yAxisId="right"
                />
                <Tooltip
                  content={
                    tooltipContent ?? (
                      <HistoryTooltip
                        formatter={valueFormatter}
                        labelFormatter={formatTooltipTimestamp}
                        {...(entryLabelFormatter ? { entryLabelFormatter } : {})}
                      />
                    )
                  }
                />
                {nowMarkerPeriodStart ? (
                  <ReferenceLine
                    label={buildNowLabel()}
                    stroke={UI_COLORS.textPrimary}
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                    x={nowMarkerPeriodStart}
                    yAxisId="left"
                  />
                ) : null}
                {lowestMarkerPeriodStarts?.map((periodStart) => (
                  <ReferenceLine
                    key={`lowest-${periodStart}`}
                    label={buildLowestLabel()}
                    stroke={UI_COLORS.success}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                    x={periodStart}
                    yAxisId="left"
                  />
                ))}
                {highestMarkerPeriodStarts?.map((periodStart) => (
                  <ReferenceLine
                    key={`highest-${periodStart}`}
                    label={buildHighestLabel()}
                    stroke={UI_COLORS.error}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                    x={periodStart}
                    yAxisId="left"
                  />
                ))}
                <Area
                  activeDot={false}
                  dataKey="currentValue"
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                  name={label}
                  stroke={accentColor}
                  strokeWidth={3}
                  type="monotone"
                  yAxisId="left"
                />
                <Area
                  activeDot={false}
                  dataKey="futureValue"
                  fill={`url(#${mutedGradientId})`}
                  isAnimationActive={false}
                  name={label}
                  stroke={accentColor}
                  strokeOpacity={0.35}
                  strokeWidth={3}
                  type="monotone"
                  yAxisId="left"
                />
                <Area
                  activeDot={false}
                  dataKey="rightAxisValue"
                  dot={false}
                  fill="transparent"
                  isAnimationActive={false}
                  legendType="none"
                  stroke="transparent"
                  type="monotone"
                  yAxisId="right"
                />
              </AreaChart>
            );
          }}
        </MeasuredChartContainer>
        {!hasValues ? <EmptyChartMessage message={emptyMessage} /> : null}
      </div>
    </div>
  );
}

export function SingleValueBarHistoryChart({
  accentColor,
  emptyMessage,
  headerAccessory,
  label,
  nowMarkerPeriodStart,
  points,
  showLegend = true,
  tightYAxis = false,
  valueFormatter,
  yAxisLabel,
  yAxisFormatter,
}: {
  accentColor: string;
  emptyMessage: string;
  headerAccessory?: ReactNode;
  label: string;
  nowMarkerPeriodStart: string | null;
  points: SplitSingleValuePoint[];
  showLegend?: boolean;
  tightYAxis?: boolean;
  valueFormatter: (value: number) => string;
  yAxisLabel?: string;
  yAxisFormatter: (value: number) => string;
}) {
  const chartData = points.map((point) => ({
    centerTimestampMs:
      new Date(point.periodStart).getTime() + HISTORY_STEP_MS / 2,
    currentValue: point.currentValue,
    displayValue: point.currentValue ?? point.futureValue,
    futureValue: point.futureValue,
    periodStart: point.periodStart,
    periodStartMs: new Date(point.periodStart).getTime(),
    rightAxisValue: point.currentValue ?? point.futureValue,
  }));
  const hasValues = chartData.some(
    (point) =>
      typeof point.currentValue === "number" ||
      typeof point.futureValue === "number",
  );
  const axisConfig = buildMirroredYAxis(
    chartData.flatMap((point) => [point.currentValue, point.futureValue]),
    undefined,
    undefined,
    !tightYAxis,
    tightYAxis,
  );
  const firstPeriodStartMs = chartData[0]?.periodStartMs ?? 0;
  const lastPeriodStartMs = chartData.at(-1)?.periodStartMs ?? 0;
  const xAxisDomain: [number, number] = [
    firstPeriodStartMs,
    lastPeriodStartMs + HISTORY_STEP_MS,
  ];

  return (
    <div className="space-y-2.5">
      {showLegend || headerAccessory ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {showLegend ? (
            <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
              <LegendChip color={accentColor} label={label} />
            </div>
          ) : null}
          {headerAccessory}
        </div>
      ) : null}
      <div className="relative">
        <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
          {({ height, width }) => {
            const xAxisTicks = buildResponsiveDayTicks(
              chartData.map((point) => point.periodStartMs),
              width,
            );
            return (
              <ComposedChart
                data={chartData}
                height={height}
                margin={{
                  top: 16,
                  right: STANDARD_RIGHT_AXIS_MARGIN,
                  bottom: 0,
                  left: STANDARD_LEFT_AXIS_MARGIN,
                }}
                barCategoryGap="14%"
                width={width}
              >
                <CartesianGrid
                  stroke={UI_COLORS.chartGrid}
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="centerTimestampMs"
                  domain={xAxisDomain}
                  interval={0}
                  minTickGap={28}
                  tick={UI_CHART_STYLES.axisTick}
                  tickFormatter={formatDayTick}
                  tickLine={false}
                  ticks={xAxisTicks}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  label={buildYAxisLabel(yAxisLabel ?? "", "insideLeft")}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={LEFT_Y_AXIS_WIDTH}
                  yAxisId="left"
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  label={buildYAxisLabel(yAxisLabel ?? "", "right")}
                  orientation="right"
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={RIGHT_Y_AXIS_WIDTH}
                  yAxisId="right"
                />
                <Tooltip
                  content={
                    <HistoryTooltip
                      formatter={valueFormatter}
                      labelFormatter={formatTooltipTimestamp}
                    />
                  }
                />
                {chartData
                  .filter((point) => isMidnightTickValue(point.periodStartMs))
                  .map((point) => (
                    <ReferenceLine
                      key={`bar-midnight-${point.periodStart}`}
                      stroke={UI_COLORS.chartReference}
                      strokeDasharray="3 5"
                      x={point.periodStartMs}
                    />
                  ))}
                {nowMarkerPeriodStart ? (
                  <ReferenceLine
                    label={buildNowLabel()}
                    stroke={UI_COLORS.textPrimary}
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                    x={new Date(nowMarkerPeriodStart).getTime()}
                    yAxisId="left"
                  />
                ) : null}
                <Bar
                  dataKey="displayValue"
                  maxBarSize={12}
                  radius={[2, 2, 0, 0]}
                  yAxisId="left"
                >
                  {chartData.map((point) => (
                    <Cell
                      key={`bar-value-${point.periodStart}`}
                      fill={
                        typeof point.currentValue === "number"
                          ? `${accentColor}59`
                          : `${accentColor}D1`
                      }
                    />
                  ))}
                </Bar>
                <Line
                  activeDot={false}
                  dataKey="rightAxisValue"
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                  stroke="transparent"
                  strokeWidth={1}
                  type="monotone"
                  yAxisId="right"
                />
              </ComposedChart>
            );
          }}
        </MeasuredChartContainer>
        {!hasValues ? <EmptyChartMessage message={emptyMessage} /> : null}
      </div>
    </div>
  );
}

export function SegmentedLineHistoryChart({
  emptyMessage,
  headerAccessory,
  negativeColor,
  negativeLabel,
  nowMarkerPeriodStart,
  points,
  positiveColor,
  positiveLabel,
  valueFormatter,
  yAxisFormatter,
  yAxisLabel,
}: {
  emptyMessage: string;
  headerAccessory?: ReactNode;
  negativeColor: string;
  negativeLabel: string;
  nowMarkerPeriodStart: string | null;
  points: SplitSingleValuePoint[];
  positiveColor: string;
  positiveLabel: string;
  valueFormatter: (value: number) => string;
  yAxisLabel?: string;
  yAxisFormatter: (value: number) => string;
}) {
  const hasValues = points.some(
    (point) =>
      typeof point.currentValue === "number" ||
      typeof point.futureValue === "number",
  );
  const chartPoints = buildSegmentedLineChartPoints(points);
  const axisConfig = buildMirroredYAxis(
    chartPoints.flatMap((point) => [
      point.currentPositiveValue,
      point.currentNegativeValue,
      point.futurePositiveValue,
      point.futureNegativeValue,
    ]),
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip color={positiveColor} label={positiveLabel} />
          <LegendChip color={negativeColor} label={negativeLabel} />
        </div>
        {headerAccessory}
      </div>
      <div className="relative">
        <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
          {({ height, width }) => {
            const xAxisTicks = buildResponsiveDayTicks(
              chartPoints.map((point) => point.timestampMs),
              width,
            );
            return (
              <LineChart
                data={chartPoints}
                height={height}
                margin={{
                  top: 12,
                  right: STANDARD_RIGHT_AXIS_MARGIN,
                  bottom: 0,
                  left: STANDARD_LEFT_AXIS_MARGIN,
                }}
                width={width}
              >
                <CartesianGrid
                  stroke={UI_COLORS.chartGrid}
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="timestampMs"
                  domain={["dataMin", "dataMax"]}
                  interval={0}
                  minTickGap={28}
                  tick={UI_CHART_STYLES.axisTick}
                  tickFormatter={formatDayTick}
                  tickLine={false}
                  ticks={xAxisTicks}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  label={buildYAxisLabel(yAxisLabel ?? "", "insideLeft")}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={LEFT_Y_AXIS_WIDTH}
                  yAxisId="left"
                />
                <YAxis
                  axisLine={false}
                  domain={axisConfig.domain}
                  orientation="right"
                  label={buildYAxisLabel(yAxisLabel ?? "", "right")}
                  tick={UI_CHART_STYLES.axisTickMuted}
                  tickFormatter={yAxisFormatter}
                  tickLine={false}
                  tickMargin={8}
                  ticks={axisConfig.ticks}
                  width={RIGHT_Y_AXIS_WIDTH}
                  yAxisId="right"
                />
                <ReferenceLine
                  stroke={UI_COLORS.chartZeroLine}
                  strokeDasharray="4 6"
                  y={0}
                  yAxisId="left"
                />
                {nowMarkerPeriodStart ? (
                  <ReferenceLine
                    label={buildNowLabel()}
                    stroke={UI_COLORS.textPrimary}
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                    x={new Date(nowMarkerPeriodStart).getTime()}
                    yAxisId="left"
                  />
                ) : null}
                <Tooltip
                  content={
                    <SegmentedHistoryTooltip
                      labelFormatter={formatTooltipTimestamp}
                      negativeColor={negativeColor}
                      negativeLabel={negativeLabel}
                      positiveColor={positiveColor}
                      positiveLabel={positiveLabel}
                      valueFormatter={valueFormatter}
                    />
                  }
                />
                <Line
                  activeDot={false}
                  connectNulls={false}
                  dataKey="currentPositiveValue"
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                  stroke={positiveColor}
                  strokeWidth={2.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  connectNulls={false}
                  dataKey="currentNegativeValue"
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                  stroke={negativeColor}
                  strokeWidth={2.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  connectNulls={false}
                  dataKey="futurePositiveValue"
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                  stroke={positiveColor}
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  connectNulls={false}
                  dataKey="futureNegativeValue"
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                  stroke={negativeColor}
                  strokeOpacity={0.35}
                  strokeWidth={2.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  type="monotone"
                  yAxisId="left"
                />
                <Line
                  activeDot={false}
                  connectNulls={false}
                  dataKey="rightAxisValue"
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                  stroke="transparent"
                  strokeWidth={1}
                  type="monotone"
                  yAxisId="right"
                />
              </LineChart>
            );
          }}
        </MeasuredChartContainer>
        {!hasValues ? <EmptyChartMessage message={emptyMessage} /> : null}
      </div>
    </div>
  );
}

function EmptyChartMessage({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
      <p className="max-w-md text-sm leading-6 text-slate-400">{message}</p>
    </div>
  );
}

type SegmentedLineChartPoint = {
  currentNegativeValue: number | null;
  currentPositiveValue: number | null;
  futureNegativeValue: number | null;
  futurePositiveValue: number | null;
  rightAxisValue: number | null;
  timestampMs: number;
};

function buildSegmentedLineChartPoints(
  points: SplitSingleValuePoint[],
): SegmentedLineChartPoint[] {
  const chartPoints = new Map<number, SegmentedLineChartPoint>();

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;

    const timestampMs = new Date(point.periodStart).getTime();
    mergeSegmentedLineChartPoint(chartPoints, {
      currentNegativeValue:
        typeof point.currentValue === "number" && point.currentValue <= 0
          ? point.currentValue
          : null,
      currentPositiveValue:
        typeof point.currentValue === "number" && point.currentValue >= 0
          ? point.currentValue
          : null,
      futureNegativeValue:
        typeof point.futureValue === "number" && point.futureValue <= 0
          ? point.futureValue
          : null,
      futurePositiveValue:
        typeof point.futureValue === "number" && point.futureValue >= 0
          ? point.futureValue
          : null,
      rightAxisValue: point.currentValue ?? point.futureValue,
      timestampMs,
    });

    const nextPoint = points[index + 1];
    if (!nextPoint) continue;

    const currentCrossingPoint = buildZeroCrossingPoint({
      endTimestampMs: new Date(nextPoint.periodStart).getTime(),
      endValue: nextPoint.currentValue,
      startTimestampMs: timestampMs,
      startValue: point.currentValue,
      type: "current",
    });
    if (currentCrossingPoint)
      mergeSegmentedLineChartPoint(chartPoints, currentCrossingPoint);

    const futureCrossingPoint = buildZeroCrossingPoint({
      endTimestampMs: new Date(nextPoint.periodStart).getTime(),
      endValue: nextPoint.futureValue,
      startTimestampMs: timestampMs,
      startValue: point.futureValue,
      type: "future",
    });
    if (futureCrossingPoint)
      mergeSegmentedLineChartPoint(chartPoints, futureCrossingPoint);
  }

  return [...chartPoints.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs,
  );
}

function mergeSegmentedLineChartPoint(
  chartPoints: Map<number, SegmentedLineChartPoint>,
  point: SegmentedLineChartPoint,
) {
  const existing = chartPoints.get(point.timestampMs);
  if (!existing) {
    chartPoints.set(point.timestampMs, point);
    return;
  }

  chartPoints.set(point.timestampMs, {
    currentNegativeValue:
      point.currentNegativeValue ?? existing.currentNegativeValue,
    currentPositiveValue:
      point.currentPositiveValue ?? existing.currentPositiveValue,
    futureNegativeValue:
      point.futureNegativeValue ?? existing.futureNegativeValue,
    futurePositiveValue:
      point.futurePositiveValue ?? existing.futurePositiveValue,
    rightAxisValue: point.rightAxisValue ?? existing.rightAxisValue,
    timestampMs: point.timestampMs,
  });
}

function buildZeroCrossingPoint({
  endTimestampMs,
  endValue,
  startTimestampMs,
  startValue,
  type,
}: {
  endTimestampMs: number;
  endValue: number | null;
  startTimestampMs: number;
  startValue: number | null;
  type: "current" | "future";
}): SegmentedLineChartPoint | null {
  if (
    typeof startValue !== "number" ||
    typeof endValue !== "number" ||
    startValue === 0 ||
    endValue === 0 ||
    Math.sign(startValue) === Math.sign(endValue)
  ) {
    return null;
  }

  const crossingRatio = startValue / (startValue - endValue);
  const timestampMs =
    startTimestampMs + (endTimestampMs - startTimestampMs) * crossingRatio;

  return {
    currentNegativeValue: type === "current" ? 0 : null,
    currentPositiveValue: type === "current" ? 0 : null,
    futureNegativeValue: type === "future" ? 0 : null,
    futurePositiveValue: type === "future" ? 0 : null,
    rightAxisValue: 0,
    timestampMs,
  };
}

function isMidnightTickValue(value: string | number): boolean {
  const date = new Date(value);
  return date.getHours() === 0 && date.getMinutes() === 0;
}
