"use client";

import {
  CloudSun,
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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { HistoryArchive } from "../lib/ems-bridge";
import {
  formatAbsolutePowerValue,
  formatPowerValue,
  formatShortPowerValue,
} from "../lib/power-format";
import { UI_CHART_STYLES, UI_COLORS, UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import { DateSelect } from "./date-select";
import { MeasuredChartContainer } from "./measured-chart-container";
import { Card, CardContent, CardHeader } from "./ui/card";

type HistoryTab =
  | "combined"
  | "price"
  | "solar"
  | "solar-energy"
  | "grid"
  | "battery";

type HistoryPageProps = {
  archive: HistoryArchive;
  requestedDay: string | null;
  selectedTab: HistoryTab;
};

export type SingleValuePoint = {
  periodStart: string;
  value: number | null;
};

type SplitSingleValuePoint = SingleValuePoint & {
  currentValue: number | null;
  futureValue: number | null;
};

export type SignedValuePoint = SingleValuePoint & {
  negativeValue: number | null;
  positiveValue: number | null;
};

export type SplitSignedValuePoint = SignedValuePoint & {
  currentNegativeValue: number | null;
  currentPositiveValue: number | null;
  futureNegativeValue: number | null;
  futurePositiveValue: number | null;
};

type CombinedPoint = {
  batteryCharge: number | null;
  batteryLevel: number | null;
  batteryDischarge: number | null;
  gridExport: number | null;
  gridImport: number | null;
  periodStart: string;
  price: number | null;
  solarEnergy: number | null;
  solar: number | null;
};

type SplitCombinedPoint = CombinedPoint & {
  currentBatteryCharge: number | null;
  currentBatteryLevel: number | null;
  currentBatteryDischarge: number | null;
  currentBatteryPower: number | null;
  currentGridExport: number | null;
  currentGridImport: number | null;
  currentGridPower: number | null;
  currentPrice: number | null;
  currentSolarEnergy: number | null;
  currentSolar: number | null;
  futureBatteryCharge: number | null;
  futureBatteryLevel: number | null;
  futureBatteryDischarge: number | null;
  futureBatteryPower: number | null;
  futureGridExport: number | null;
  futureGridImport: number | null;
  futureGridPower: number | null;
  futurePrice: number | null;
  futureSolarEnergy: number | null;
  futureSolar: number | null;
};

type BatteryHistoryPoint = {
  currentChargePercent: number | null;
  currentChargingPower: number | null;
  currentDischargingPower: number | null;
  currentPower: number | null;
  futureChargePercent: number | null;
  futureChargingPower: number | null;
  futureDischargingPower: number | null;
  futurePower: number | null;
  periodStart: string;
};

type TooltipPayloadEntry = {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: ValueType;
};

const HISTORY_STEP_MS = 15 * 60 * 1_000;
const CHARGE_AXIS_DOMAIN: [number, number] = [0, 100];
const CHARGE_AXIS_TICKS = [0, 20, 40, 60, 80, 100];
const BATTERY_POWER_AXIS_DOMAIN: [number, number] = [-3000, 3000];

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
    description: "Review battery power and charge history.",
    icon: Zap,
    label: "Battery",
    value: "battery",
  },
  {
    description: "Review generated wattage measured by the local provider.",
    icon: SunMedium,
    label: "Solar Energy",
    value: "solar-energy",
  },
  {
    description: "Review the solar forecast aligned to each 15-minute period.",
    icon: CloudSun,
    label: "Solar Forecast",
    value: "solar",
  },
  {
    description: "Review the Tibber 15-minute import prices.",
    icon: HandCoins,
    label: "Price",
    value: "price",
  },
  {
    description: "Review P1 grid import and export power.",
    icon: Gauge,
    label: "Grid",
    value: "grid",
  },
];

export function HistoryPage({
  archive,
  requestedDay,
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
  const nowMarkerPeriodStart =
    selectedDay !== null && selectedDay === getUtcDayKey(new Date())
      ? getCurrentPeriodStart()
      : null;

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
  const solarEnergySeries = createSingleValueSeries(
    aggregatePowerSamples(archive.solarEnergyProviderSamples),
  );
  const gridValueSeries = invertSingleValueSeries(
    aggregatePowerSamples(archive.p1MeterSamples),
  );
  const gridSeries = createSignedSeries(gridValueSeries);
  const batterySeries = createSignedSeries(
    invertSingleValueSeries(aggregatePowerSamples(archive.batteryPowerSamples)),
  );
  const batteryChargeSeries = createSingleValueSeries(
    aggregateBatteryChargeSamples(archive.batteryPowerSamples),
  );

  const dailyPriceSeries =
    selectedDay === null ? [] : fillSingleValueDay(priceSeries, selectedDay);
  const dailySolarSeries =
    selectedDay === null ? [] : fillSingleValueDay(solarSeries, selectedDay);
  const dailySolarEnergySeries =
    selectedDay === null
      ? []
      : fillSingleValueDay(solarEnergySeries, selectedDay);
  const dailyGridValueSeries =
    selectedDay === null ? [] : fillSingleValueDay(gridValueSeries, selectedDay);
  const dailyGridSeries =
    selectedDay === null ? [] : fillSignedDay(gridSeries, selectedDay);
  const dailyBatterySeries =
    selectedDay === null ? [] : fillSignedDay(batterySeries, selectedDay);
  const dailyBatteryChargeSeries =
    selectedDay === null
      ? []
      : fillSingleValueDay(batteryChargeSeries, selectedDay);
  const splitDailyBatterySeries = splitSignedSeriesByTime(dailyBatterySeries);
  const splitDailyBatteryChargeSeries = splitSingleValueSeriesByTime(
    dailyBatteryChargeSeries,
  );
  const batteryHistoryPoints = combineBatteryHistorySeries({
    charge: splitDailyBatteryChargeSeries,
    power: splitDailyBatterySeries,
  });

  const combinedDailySeries = createCombinedSeries({
    battery: dailyBatterySeries,
    batteryCharge: dailyBatteryChargeSeries,
    grid: dailyGridSeries,
    price: dailyPriceSeries,
    solarEnergy: dailySolarEnergySeries,
    solar: dailySolarSeries,
  });
  const splitCombinedDailySeries =
    splitCombinedSeriesByTime(combinedDailySeries);

  const canGoBackward = selectedDayIndex > 0;
  const canGoForward =
    selectedDayIndex >= 0 && selectedDayIndex < availableDays.length - 1;

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
      <Card className="overflow-hidden border-white/10 bg-slate-950/75">
        <CardHeader className="border-b border-white/8 p-0">
          <div className={`${UI_STYLES.tabBar} pt-2.5 sm:pt-3`}>
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
        <CardContent className="space-y-3 pt-3">
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
                day: canGoForward
                  ? (availableDays[selectedDayIndex + 1] ?? null)
                  : null,
              })
            }
            onSelectPreviousDay={() =>
              navigate({
                day: canGoBackward
                  ? (availableDays[selectedDayIndex - 1] ?? null)
                  : null,
              })
            }
            selectedDay={selectedDay}
          />
          {selectedDay === null ? (
            <p className="py-4 text-center text-slate-300">
              History will appear here once the daemon has collected at least
              one sampled day.
            </p>
          ) : selectedTab === "combined" ? (
            <CombinedHistoryChart
              nowMarkerPeriodStart={nowMarkerPeriodStart}
              points={splitCombinedDailySeries}
            />
          ) : selectedTab === "price" ? (
            <SingleValueHistoryChart
              accentColor={UI_COLORS.price}
              emptyMessage="No dynamic price samples were available for this range."
              label="Price"
              nowMarkerPeriodStart={nowMarkerPeriodStart}
              points={splitSingleValueSeriesByTime(dailyPriceSeries)}
              valueFormatter={formatPriceValue}
              yAxisFormatter={formatShortPriceValue}
            />
          ) : selectedTab === "solar" ? (
            <SingleValueHistoryChart
              accentColor={UI_COLORS.forecast}
              emptyMessage="No solar forecast samples were available for this range."
              label="Solar Forecast"
              nowMarkerPeriodStart={nowMarkerPeriodStart}
              points={splitSingleValueSeriesByTime(dailySolarSeries)}
              valueFormatter={formatWholeNumberValue}
              yAxisFormatter={formatShortPowerValue}
            />
          ) : selectedTab === "solar-energy" ? (
            <SingleValueHistoryChart
              accentColor={UI_COLORS.solarEnergy}
              emptyMessage="No generated wattage samples were available for this range."
              label="Solar Energy"
              nowMarkerPeriodStart={nowMarkerPeriodStart}
              points={splitSingleValueSeriesByTime(dailySolarEnergySeries)}
              valueFormatter={formatPowerValue}
              yAxisFormatter={formatShortPowerValue}
            />
          ) : selectedTab === "grid" ? (
            <SegmentedLineHistoryChart
              emptyMessage="No P1 meter samples were available for this range."
              negativeColor={UI_COLORS.gridImport}
              negativeLabel="Take from grid"
              nowMarkerPeriodStart={nowMarkerPeriodStart}
              points={splitSingleValueSeriesByTime(dailyGridValueSeries)}
              positiveColor={UI_COLORS.gridExport}
              positiveLabel="Return to grid"
              valueFormatter={formatAbsolutePowerValue}
              yAxisFormatter={formatShortPowerValue}
            />
          ) : (
            <BatteryHistoryChart
              emptyMessage="No battery power or charge samples were available for this range."
              nowMarkerPeriodStart={nowMarkerPeriodStart}
              points={batteryHistoryPoints}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CombinedHistoryChart({
  nowMarkerPeriodStart,
  points,
}: {
  nowMarkerPeriodStart: string | null;
  points: SplitCombinedPoint[];
}) {
  const chartPoints = points.map((point) => ({
    ...point,
    timestampMs: new Date(point.periodStart).getTime(),
  }));
  const currentGridSegments = buildSegmentedLineSegments({
    negativeColor: UI_COLORS.gridImport,
    positiveColor: UI_COLORS.gridExport,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.currentGridPower,
    })),
    strokeOpacity: 1,
  });
  const futureGridSegments = buildSegmentedLineSegments({
    negativeColor: UI_COLORS.gridImport,
    positiveColor: UI_COLORS.gridExport,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.futureGridPower,
    })),
    strokeOpacity: 0.35,
  });
  const currentBatterySegments = buildSegmentedLineSegments({
    negativeColor: UI_COLORS.batteryPowerDischarging,
    positiveColor: UI_COLORS.batteryPowerCharging,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.currentBatteryPower,
    })),
    strokeOpacity: 1,
  });
  const futureBatterySegments = buildSegmentedLineSegments({
    negativeColor: UI_COLORS.batteryPowerDischarging,
    positiveColor: UI_COLORS.batteryPowerCharging,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.futureBatteryPower,
    })),
    strokeOpacity: 0.35,
  });
  const hasValues = points.some((point) =>
    [
      point.currentPrice,
      point.futurePrice,
      point.currentSolar,
      point.futureSolar,
      point.currentSolarEnergy,
      point.futureSolarEnergy,
      point.currentBatteryLevel,
      point.futureBatteryLevel,
      point.currentGridImport,
      point.futureGridImport,
      point.currentGridExport,
      point.futureGridExport,
      point.currentBatteryCharge,
      point.futureBatteryCharge,
      point.currentBatteryDischarge,
      point.futureBatteryDischarge,
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
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
        <LegendChip
          color={UI_COLORS.batteryPowerCharging}
          label="Battery Charging Power"
        />
        <LegendChip
          color={UI_COLORS.batteryPowerDischarging}
          label="Battery Discharging Power"
        />
        <LegendChip color={UI_COLORS.batteryChargeLevel} label="Battery Charge" />
        <LegendChip color={UI_COLORS.solarEnergy} label="Solar Energy" />
        <LegendChip color={UI_COLORS.forecast} label="Solar Forecast" />
        <LegendChip color={UI_COLORS.price} label="Price" />
        <LegendChip color={UI_COLORS.gridExport} label="Return to grid" />
        <LegendChip color={UI_COLORS.gridImport} label="Take from grid" />
      </div>
      <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
        {({ height, width }) => (
          <LineChart
            data={chartPoints}
            height={height}
            margin={{ top: 12, right: 56, bottom: 0, left: 0 }}
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
              minTickGap={28}
              tick={UI_CHART_STYLES.axisTick}
              tickFormatter={formatDayTick}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              tick={UI_CHART_STYLES.axisTickMuted}
              tickFormatter={formatShortPowerValue}
              tickLine={false}
              width={60}
              yAxisId="power"
            />
            <YAxis
              axisLine={false}
              domain={CHARGE_AXIS_DOMAIN}
              label={buildYAxisLabel("Charge (%)", "insideRight")}
              orientation="right"
              tick={UI_CHART_STYLES.axisTick}
              tickMargin={8}
              ticks={CHARGE_AXIS_TICKS}
              tickFormatter={formatShortPercentValue}
              tickLine={false}
              width={76}
              yAxisId="charge"
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
                <CombinedHistoryTooltip
                  labelFormatter={formatTooltipTimestamp}
                />
              }
            />
            <Line
              dataKey="currentSolarEnergy"
              dot={false}
              isAnimationActive={false}
              name="Solar Energy"
              stroke={UI_COLORS.solarEnergy}
              strokeWidth={2.2}
              type="monotone"
              yAxisId="power"
            />
            <Line
              dataKey="futureSolarEnergy"
              dot={false}
              isAnimationActive={false}
              name="Solar Energy"
              stroke={UI_COLORS.solarEnergy}
              strokeOpacity={0.35}
              strokeWidth={2.2}
              type="monotone"
              yAxisId="power"
            />
            <Line
              dataKey="currentSolar"
              dot={false}
              isAnimationActive={false}
              name="Solar Forecast"
              stroke={UI_COLORS.forecast}
              strokeWidth={2.2}
              type="monotone"
              yAxisId="solar"
            />
            <Line
              dataKey="futureSolar"
              dot={false}
              isAnimationActive={false}
              name="Solar Forecast"
              stroke={UI_COLORS.forecast}
              strokeOpacity={0.35}
              strokeWidth={2.2}
              type="monotone"
              yAxisId="solar"
            />
            <Line
              dataKey="currentPrice"
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
              dataKey="futurePrice"
              dot={false}
              isAnimationActive={false}
              name="Price"
              stroke={UI_COLORS.price}
              strokeDasharray="5 4"
              strokeOpacity={0.35}
              strokeWidth={2}
              type="monotone"
              yAxisId="price"
            />
            <Line
              activeDot={false}
              dataKey="currentGridPower"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
              yAxisId="power"
            />
            <Line
              activeDot={false}
              dataKey="futureGridPower"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
              yAxisId="power"
            />
            <Line
              activeDot={false}
              dataKey="currentBatteryPower"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
              yAxisId="power"
            />
            <Line
              activeDot={false}
              dataKey="futureBatteryPower"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
              yAxisId="power"
            />
            <Line
              dataKey="currentBatteryLevel"
              dot={false}
              isAnimationActive={false}
              name="Battery Charge"
              stroke={UI_COLORS.batteryChargeLevel}
              strokeWidth={2.2}
              type="monotone"
              yAxisId="charge"
            />
            <Line
              dataKey="futureBatteryLevel"
              dot={false}
              isAnimationActive={false}
              name="Battery Charge"
              stroke={UI_COLORS.batteryChargeLevel}
              strokeOpacity={0.35}
              strokeWidth={2.2}
              type="monotone"
              yAxisId="charge"
            />
            {currentGridSegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.1}
                type="linear"
                yAxisId="power"
              />
            ))}
            {futureGridSegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.1}
                type="linear"
                yAxisId="power"
              />
            ))}
            {currentBatterySegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.1}
                type="linear"
                yAxisId="power"
              />
            ))}
            {futureBatterySegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.1}
                type="linear"
                yAxisId="power"
              />
            ))}
            {nowMarkerPeriodStart ? (
              <ReferenceLine
                ifOverflow="extendDomain"
                label={buildNowLabel()}
                stroke={UI_COLORS.textPrimary}
                strokeDasharray="4 4"
                strokeOpacity={0.8}
                strokeWidth={2}
                x={new Date(nowMarkerPeriodStart).getTime()}
                yAxisId="power"
              />
            ) : null}
          </LineChart>
        )}
      </MeasuredChartContainer>
    </div>
  );
}

export function BatteryHistoryChart({
  emptyMessage,
  nowMarkerPeriodStart,
  points,
}: {
  emptyMessage: string;
  nowMarkerPeriodStart: string | null;
  points: BatteryHistoryPoint[];
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

  if (!hasValues) {
    return <p className="text-sm leading-6 text-slate-400">{emptyMessage}</p>;
  }

  const chartPoints = points.map((point) => ({
    ...point,
    timestampMs: new Date(point.periodStart).getTime(),
  }));
  const currentBatterySegments = buildSegmentedLineSegments({
    negativeColor: UI_COLORS.batteryPowerDischarging,
    positiveColor: UI_COLORS.batteryPowerCharging,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.currentPower,
    })),
    strokeOpacity: 1,
  });
  const futureBatterySegments = buildSegmentedLineSegments({
    negativeColor: UI_COLORS.batteryPowerDischarging,
    positiveColor: UI_COLORS.batteryPowerCharging,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.futurePower,
    })),
    strokeOpacity: 0.35,
  });

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
        <LegendChip
          color={UI_COLORS.batteryPowerCharging}
          label="Battery Charging Power"
        />
        <LegendChip
          color={UI_COLORS.batteryPowerDischarging}
          label="Battery Discharging Power"
        />
        <LegendChip color={UI_COLORS.batteryChargeLevel} label="Battery Charge" />
      </div>
      <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
        {({ height, width }) => (
          <LineChart
            data={chartPoints}
            height={height}
            margin={{ top: 12, right: 56, bottom: 0, left: 0 }}
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
              minTickGap={28}
              tick={UI_CHART_STYLES.axisTick}
              tickFormatter={formatDayTick}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              domain={BATTERY_POWER_AXIS_DOMAIN}
              label={buildYAxisLabel("Power (W)", "insideLeft")}
              tick={UI_CHART_STYLES.axisTickMuted}
              tickFormatter={formatShortPowerValue}
              tickLine={false}
              width={72}
              yAxisId="power"
            />
            <YAxis
              axisLine={false}
              domain={CHARGE_AXIS_DOMAIN}
              label={buildYAxisLabel("Charge (%)", "insideRight")}
              orientation="right"
              tick={UI_CHART_STYLES.axisTick}
              tickMargin={8}
              ticks={CHARGE_AXIS_TICKS}
              tickFormatter={formatShortPercentValue}
              tickLine={false}
              width={76}
              yAxisId="charge"
            />
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
            <Line
              activeDot={false}
              dataKey="currentPower"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
              yAxisId="power"
            />
            <Line
              activeDot={false}
              dataKey="futurePower"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
              yAxisId="power"
            />
            {currentBatterySegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.2}
                type="linear"
                yAxisId="power"
              />
            ))}
            {futureBatterySegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.2}
                type="linear"
                yAxisId="power"
              />
            ))}
            <Line
              dataKey="currentChargePercent"
              dot={false}
              isAnimationActive={false}
              name="Battery Charge"
              stroke={UI_COLORS.batteryChargeLevel}
              strokeWidth={2.4}
              type="monotone"
              yAxisId="charge"
            />
            <Line
              dataKey="futureChargePercent"
              dot={false}
              isAnimationActive={false}
              name="Battery Charge"
              stroke={UI_COLORS.batteryChargeLevel}
              strokeOpacity={0.35}
              strokeWidth={2.4}
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
          </LineChart>
        )}
      </MeasuredChartContainer>
    </div>
  );
}

export function buildBatteryHistoryPoints(
  samples: Array<{
    periodStart: string;
    powerW: number | null;
    socPercent: number | null;
  }>,
  dayKey: string,
) {
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
  });
}

export function SingleValueHistoryChart({
  accentColor,
  emptyMessage,
  label,
  nowMarkerPeriodStart,
  points,
  showLegend = true,
  valueFormatter,
  yAxisLabel,
  yAxisDomain,
  yAxisFormatter,
}: {
  accentColor: string;
  emptyMessage: string;
  label: string;
  nowMarkerPeriodStart: string | null;
  points: SplitSingleValuePoint[];
  showLegend?: boolean;
  valueFormatter: (value: number) => string;
  yAxisLabel?: string;
  yAxisDomain?: [number, number];
  yAxisFormatter: (value: number) => string;
}) {
  const hasValues = points.some(
    (point) =>
      typeof point.currentValue === "number" ||
      typeof point.futureValue === "number",
  );
  const gradientId = `${label.toLowerCase().replace(/\s+/g, "-")}-gradient`;
  const mutedGradientId = `${label.toLowerCase().replace(/\s+/g, "-")}-muted-gradient`;

  if (!hasValues) {
    return <p className="text-sm leading-6 text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-2.5">
      {showLegend ? (
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
          <LegendChip color={accentColor} label={label} />
        </div>
      ) : null}
      <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
        {({ height, width }) => (
          <AreaChart
            data={points}
            height={height}
            margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
            width={width}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={accentColor} stopOpacity={0.38} />
                <stop offset="95%" stopColor={accentColor} stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id={mutedGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={accentColor} stopOpacity={0.16} />
                <stop offset="95%" stopColor={accentColor} stopOpacity={0.02} />
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
              minTickGap={28}
              tick={UI_CHART_STYLES.axisTick}
              tickFormatter={formatDayTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              {...(yAxisLabel
                ? { label: buildYAxisLabel(yAxisLabel, "insideLeft") }
                : {})}
              {...(yAxisDomain ? { domain: yAxisDomain } : {})}
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
            {nowMarkerPeriodStart ? (
              <ReferenceLine
                label={buildNowLabel()}
                stroke={UI_COLORS.textPrimary}
                strokeDasharray="4 4"
                strokeOpacity={0.8}
                x={nowMarkerPeriodStart}
              />
            ) : null}
            <Area
              dataKey="currentValue"
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              name={label}
              stroke={accentColor}
              strokeWidth={3}
              type="monotone"
            />
            <Area
              dataKey="futureValue"
              fill={`url(#${mutedGradientId})`}
              isAnimationActive={false}
              name={label}
              stroke={accentColor}
              strokeOpacity={0.35}
              strokeWidth={3}
              type="monotone"
            />
          </AreaChart>
        )}
      </MeasuredChartContainer>
    </div>
  );
}

export function SegmentedLineHistoryChart({
  emptyMessage,
  negativeColor,
  negativeLabel,
  nowMarkerPeriodStart,
  points,
  positiveColor,
  positiveLabel,
  valueFormatter,
  yAxisFormatter,
}: {
  emptyMessage: string;
  negativeColor: string;
  negativeLabel: string;
  nowMarkerPeriodStart: string | null;
  points: SplitSingleValuePoint[];
  positiveColor: string;
  positiveLabel: string;
  valueFormatter: (value: number) => string;
  yAxisFormatter: (value: number) => string;
}) {
  const hasValues = points.some(
    (point) =>
      typeof point.currentValue === "number" ||
      typeof point.futureValue === "number",
  );

  if (!hasValues) {
    return <p className="text-sm leading-6 text-slate-400">{emptyMessage}</p>;
  }

  const chartPoints = points.map((point) => ({
    currentValue: point.currentValue,
    futureValue: point.futureValue,
    timestampMs: new Date(point.periodStart).getTime(),
  }));
  const currentSegments = buildSegmentedLineSegments({
    negativeColor,
    positiveColor,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.currentValue,
    })),
    strokeOpacity: 1,
  });
  const futureSegments = buildSegmentedLineSegments({
    negativeColor,
    positiveColor,
    points: chartPoints.map((point) => ({
      timestampMs: point.timestampMs,
      value: point.futureValue,
    })),
    strokeOpacity: 0.35,
  });

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
        <LegendChip color={positiveColor} label={positiveLabel} />
        <LegendChip color={negativeColor} label={negativeLabel} />
      </div>
      <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
        {({ height, width }) => (
          <LineChart
            data={chartPoints}
            height={height}
            margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
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
              minTickGap={28}
              tick={UI_CHART_STYLES.axisTick}
              tickFormatter={formatDayTick}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              tick={UI_CHART_STYLES.axisTickMuted}
              tickFormatter={yAxisFormatter}
              tickLine={false}
              width={60}
            />
            <ReferenceLine
              stroke={UI_COLORS.chartZeroLine}
              strokeDasharray="4 6"
              y={0}
            />
            {nowMarkerPeriodStart ? (
              <ReferenceLine
                label={buildNowLabel()}
                stroke={UI_COLORS.textPrimary}
                strokeDasharray="4 4"
                strokeOpacity={0.8}
                x={new Date(nowMarkerPeriodStart).getTime()}
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
              dataKey="currentValue"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
            />
            <Line
              activeDot={false}
              connectNulls={false}
              dataKey="futureValue"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              stroke="transparent"
              strokeWidth={10}
              type="linear"
            />
            {currentSegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.8}
                type="linear"
              />
            ))}
            {futureSegments.map((segment) => (
              <Line
                key={segment.key}
                activeDot={false}
                connectNulls={false}
                data={segment.points}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                legendType="none"
                stroke={segment.color}
                strokeOpacity={segment.strokeOpacity}
                strokeWidth={2.8}
                type="linear"
              />
            ))}
          </LineChart>
        )}
      </MeasuredChartContainer>
    </div>
  );
}

export function SignedHistoryChart({
  emptyMessage,
  negativeColor,
  negativeLabel,
  nowMarkerPeriodStart,
  points,
  positiveColor,
  positiveLabel,
  valueFormatter,
  yAxisFormatter,
}: {
  emptyMessage: string;
  negativeColor: string;
  negativeLabel: string;
  nowMarkerPeriodStart: string | null;
  points: SplitSignedValuePoint[];
  positiveColor: string;
  positiveLabel: string;
  valueFormatter: (value: number) => string;
  yAxisFormatter: (value: number) => string;
}) {
  const hasValues = points.some(
    (point) =>
      typeof point.currentPositiveValue === "number" ||
      typeof point.futurePositiveValue === "number" ||
      typeof point.currentNegativeValue === "number" ||
      typeof point.futureNegativeValue === "number",
  );
  const positiveGradientId = `${positiveLabel.toLowerCase().replace(/\s+/g, "-")}-gradient`;
  const negativeGradientId = `${negativeLabel.toLowerCase().replace(/\s+/g, "-")}-gradient`;
  const positiveMutedGradientId = `${positiveLabel.toLowerCase().replace(/\s+/g, "-")}-muted-gradient`;
  const negativeMutedGradientId = `${negativeLabel.toLowerCase().replace(/\s+/g, "-")}-muted-gradient`;

  if (!hasValues) {
    return <p className="text-sm leading-6 text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-300">
        <LegendChip color={positiveColor} label={positiveLabel} />
        <LegendChip color={negativeColor} label={negativeLabel} />
      </div>
      <MeasuredChartContainer className="h-[360px] min-w-0 w-full">
        {({ height, width }) => (
          <AreaChart
            data={points}
            height={height}
            margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
            width={width}
          >
            <defs>
              <linearGradient
                id={positiveGradientId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={positiveColor}
                  stopOpacity={0.34}
                />
                <stop
                  offset="95%"
                  stopColor={positiveColor}
                  stopOpacity={0.04}
                />
              </linearGradient>
              <linearGradient
                id={positiveMutedGradientId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={positiveColor}
                  stopOpacity={0.16}
                />
                <stop
                  offset="95%"
                  stopColor={positiveColor}
                  stopOpacity={0.02}
                />
              </linearGradient>
              <linearGradient
                id={negativeGradientId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={negativeColor} stopOpacity={0.3} />
                <stop
                  offset="95%"
                  stopColor={negativeColor}
                  stopOpacity={0.04}
                />
              </linearGradient>
              <linearGradient
                id={negativeMutedGradientId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={negativeColor}
                  stopOpacity={0.16}
                />
                <stop
                  offset="95%"
                  stopColor={negativeColor}
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
            <ReferenceLine
              stroke={UI_COLORS.chartZeroLine}
              strokeDasharray="4 6"
              y={0}
            />
            {nowMarkerPeriodStart ? (
              <ReferenceLine
                label={buildNowLabel()}
                stroke={UI_COLORS.textPrimary}
                strokeDasharray="4 4"
                strokeOpacity={0.8}
                x={nowMarkerPeriodStart}
              />
            ) : null}
            <Tooltip
              content={
                <HistoryTooltip
                  formatter={valueFormatter}
                  labelFormatter={formatTooltipTimestamp}
                />
              }
            />
            <Area
              dataKey="currentPositiveValue"
              fill={`url(#${positiveGradientId})`}
              isAnimationActive={false}
              name={positiveLabel}
              stroke={positiveColor}
              strokeWidth={2.6}
              type="monotone"
            />
            <Area
              dataKey="futurePositiveValue"
              fill={`url(#${positiveMutedGradientId})`}
              isAnimationActive={false}
              name={positiveLabel}
              stroke={positiveColor}
              strokeOpacity={0.35}
              strokeWidth={2.6}
              type="monotone"
            />
            <Area
              dataKey="currentNegativeValue"
              fill={`url(#${negativeGradientId})`}
              isAnimationActive={false}
              name={negativeLabel}
              stroke={negativeColor}
              strokeWidth={2.6}
              type="monotone"
            />
            <Area
              dataKey="futureNegativeValue"
              fill={`url(#${negativeMutedGradientId})`}
              isAnimationActive={false}
              name={negativeLabel}
              stroke={negativeColor}
              strokeOpacity={0.35}
              strokeWidth={2.6}
              type="monotone"
            />
          </AreaChart>
        )}
      </MeasuredChartContainer>
    </div>
  );
}

type SegmentedLinePoint = {
  timestampMs: number;
  value: number | null;
};

type SegmentedLineSeries = {
  color: string;
  key: string;
  points: Array<{ timestampMs: number; value: number }>;
  strokeOpacity: number;
};

function SegmentedHistoryTooltip({
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
  if (!active || label === undefined || label === null || !payload || payload.length === 0) {
    return null;
  }

  const selectedEntry =
    payload.find(
      (entry) =>
        entry.dataKey === "futureValue" && typeof entry.value === "number",
    ) ??
    payload.find(
      (entry) =>
        entry.dataKey === "currentValue" && typeof entry.value === "number",
    ) ??
    payload.find(
      (entry) =>
        entry.dataKey?.startsWith("future") && typeof entry.value === "number",
    ) ?? payload.find((entry) => typeof entry.value === "number");

  if (!selectedEntry || typeof selectedEntry.value !== "number") {
    return null;
  }

  const isPositive = selectedEntry.value >= 0;
  const seriesColor = isPositive ? positiveColor : negativeColor;
  const seriesLabel = isPositive ? positiveLabel : negativeLabel;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {labelFormatter(label)}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-slate-200">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: seriesColor }}
            />
            {seriesLabel}
          </span>
          <span className="font-medium text-white">
            {valueFormatter(selectedEntry.value)}
          </span>
        </div>
      </div>
    </div>
  );
}

function BatteryHistoryTooltip({
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
  if (label === undefined || label === null || !active || !payload || payload.length === 0) {
    return null;
  }

  const powerEntry =
    payload.find(
      (entry) => entry.dataKey === "futurePower" && typeof entry.value === "number",
    ) ??
    payload.find(
      (entry) => entry.dataKey === "currentPower" && typeof entry.value === "number",
    );
  const chargeEntry =
    payload.find(
      (entry) =>
        entry.dataKey === "futureChargePercent" && typeof entry.value === "number",
    ) ??
    payload.find(
      (entry) =>
        entry.dataKey === "currentChargePercent" && typeof entry.value === "number",
    );

  if (!powerEntry && !chargeEntry) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {labelFormatter(label)}
      </p>
      <div className="space-y-1.5">
        {powerEntry && typeof powerEntry.value === "number" ? (
          <TooltipRow
            color={
              powerEntry.value >= 0
                ? UI_COLORS.batteryPowerCharging
                : UI_COLORS.batteryPowerDischarging
            }
            label={
              powerEntry.value >= 0
                ? "Battery Charging Power"
                : "Battery Discharging Power"
            }
            value={formatAbsolutePowerValue(powerEntry.value)}
          />
        ) : null}
        {chargeEntry && typeof chargeEntry.value === "number" ? (
          <TooltipRow
            color={UI_COLORS.batteryChargeLevel}
            label="Battery Charge"
            value={formatPercentValue(chargeEntry.value)}
          />
        ) : null}
      </div>
    </div>
  );
}

function CombinedHistoryTooltip({
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
  if (label === undefined || label === null || !active || !payload || payload.length === 0) {
    return null;
  }

  const rows: Array<{ color: string; label: string; value: string }> = [];
  const pushEntry = (entry: TooltipPayloadEntry | undefined, color: string, rowLabel: string, value: string) => {
    if (entry && typeof entry.value === "number") {
      rows.push({ color, label: rowLabel, value });
    }
  };

  const selectEntry = (...keys: string[]) =>
    payload.find(
      (entry) => keys.includes(entry.dataKey ?? "") && typeof entry.value === "number",
    );

  const priceEntry = selectEntry("futurePrice", "currentPrice");
  const solarEntry = selectEntry("futureSolar", "currentSolar");
  const solarEnergyEntry = selectEntry("futureSolarEnergy", "currentSolarEnergy");
  const batteryLevelEntry = selectEntry("futureBatteryLevel", "currentBatteryLevel");
  const gridPowerEntry = selectEntry("futureGridPower", "currentGridPower");
  const batteryPowerEntry = selectEntry("futureBatteryPower", "currentBatteryPower");

  if (priceEntry && typeof priceEntry.value === "number") {
    rows.push({
      color: UI_COLORS.price,
      label: "Price",
      value: formatPriceValue(priceEntry.value),
    });
  }

  if (solarEntry && typeof solarEntry.value === "number") {
    rows.push({
      color: UI_COLORS.forecast,
      label: "Solar Forecast",
      value: formatWholeNumberValue(solarEntry.value),
    });
  }

  if (solarEnergyEntry && typeof solarEnergyEntry.value === "number") {
    rows.push({
      color: UI_COLORS.solarEnergy,
      label: "Solar Energy",
      value: formatPowerValue(solarEnergyEntry.value),
    });
  }

  if (batteryLevelEntry && typeof batteryLevelEntry.value === "number") {
    rows.push({
      color: UI_COLORS.batteryChargeLevel,
      label: "Battery Charge",
      value: formatPercentValue(batteryLevelEntry.value),
    });
  }

  if (batteryPowerEntry && typeof batteryPowerEntry.value === "number") {
    rows.push({
      color:
        batteryPowerEntry.value >= 0
          ? UI_COLORS.batteryPowerCharging
          : UI_COLORS.batteryPowerDischarging,
      label:
        batteryPowerEntry.value >= 0
          ? "Battery Charging Power"
          : "Battery Discharging Power",
      value: formatAbsolutePowerValue(batteryPowerEntry.value),
    });
  }

  if (gridPowerEntry && typeof gridPowerEntry.value === "number") {
    rows.push({
      color:
        gridPowerEntry.value >= 0 ? UI_COLORS.gridExport : UI_COLORS.gridImport,
      label:
        gridPowerEntry.value >= 0 ? "Return to grid" : "Take from grid",
      value: formatAbsolutePowerValue(gridPowerEntry.value),
    });
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 text-sm text-slate-50 shadow-[0_24px_70px_rgba(2,6,23,0.6)] backdrop-blur">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {labelFormatter(label)}
      </p>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <TooltipRow
            key={`${row.label}-${row.value}`}
            color={row.color}
            label={row.label}
            value={row.value}
          />
        ))}
      </div>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-slate-200">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function buildSegmentedLineSegments({
  negativeColor,
  positiveColor,
  points,
  strokeOpacity,
}: {
  negativeColor: string;
  positiveColor: string;
  points: SegmentedLinePoint[];
  strokeOpacity: number;
}): SegmentedLineSeries[] {
  const segments: SegmentedLineSeries[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (
      !current ||
      !next ||
      typeof current.value !== "number" ||
      typeof next.value !== "number"
    ) {
      continue;
    }

    if (current.value === 0 && next.value === 0) {
      segments.push({
        color: positiveColor,
        key: `${current.timestampMs}-${next.timestampMs}-zero`,
        points: [
          { timestampMs: current.timestampMs, value: current.value },
          { timestampMs: next.timestampMs, value: next.value },
        ],
        strokeOpacity,
      });
      continue;
    }

    if (current.value === 0 || next.value === 0 || current.value * next.value > 0) {
      const segmentValue = current.value !== 0 ? current.value : next.value;

      segments.push({
        color: segmentValue >= 0 ? positiveColor : negativeColor,
        key: `${current.timestampMs}-${next.timestampMs}-direct`,
        points: [
          { timestampMs: current.timestampMs, value: current.value },
          { timestampMs: next.timestampMs, value: next.value },
        ],
        strokeOpacity,
      });
      continue;
    }

    const zeroRatio = Math.abs(current.value) /
      (Math.abs(current.value) + Math.abs(next.value));
    const zeroTimestampMs =
      current.timestampMs +
      (next.timestampMs - current.timestampMs) * zeroRatio;

    segments.push({
      color: current.value >= 0 ? positiveColor : negativeColor,
      key: `${current.timestampMs}-${next.timestampMs}-before-zero`,
      points: [
        { timestampMs: current.timestampMs, value: current.value },
        { timestampMs: zeroTimestampMs, value: 0 },
      ],
      strokeOpacity,
    });
    segments.push({
      color: next.value >= 0 ? positiveColor : negativeColor,
      key: `${current.timestampMs}-${next.timestampMs}-after-zero`,
      points: [
        { timestampMs: zeroTimestampMs, value: 0 },
        { timestampMs: next.timestampMs, value: next.value },
      ],
      strokeOpacity,
    });
  }

  return segments;
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

  const deduplicatedEntries = deduplicateTooltipEntries(numericEntries);

  if (deduplicatedEntries.length === 0) {
    return null;
  }

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
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: entry.color ?? UI_COLORS.chartSeriesFallback,
                }}
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
      aria-label={label}
      className={cn(
        UI_STYLES.tabItem,
        active ? UI_STYLES.tabItemActive : UI_STYLES.tabItemInactive,
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
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

  for (const sample of archive.solarEnergyProviderSamples) {
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

function createSingleValueSeries(
  points: SingleValuePoint[],
): SingleValuePoint[] {
  return [...points].sort(
    (left, right) =>
      new Date(left.periodStart).getTime() -
      new Date(right.periodStart).getTime(),
  );
}

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
}): BatteryHistoryPoint[] {
  return input.power.map((powerPoint, index) => {
    const chargePoint = input.charge[index];

    return {
      currentChargePercent: chargePoint?.currentValue ?? null,
      currentChargingPower: powerPoint.currentPositiveValue,
      currentDischargingPower: powerPoint.currentNegativeValue,
      currentPower:
        powerPoint.currentPositiveValue ?? powerPoint.currentNegativeValue,
      futureChargePercent: chargePoint?.futureValue ?? null,
      futureChargingPower: powerPoint.futurePositiveValue,
      futureDischargingPower: powerPoint.futureNegativeValue,
      futurePower: powerPoint.futurePositiveValue ?? powerPoint.futureNegativeValue,
      periodStart: powerPoint.periodStart,
    };
  });
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
      .filter((point) => getUtcDayKey(point.periodStart) === dayKey)
      .map((point) => [point.periodStart, point.value] as const),
  );

  return createDayPeriods(dayKey).map((periodStart) => ({
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
      .filter((point) => getUtcDayKey(point.periodStart) === dayKey)
      .map((point) => [point.periodStart, point] as const),
  );

  return createDayPeriods(dayKey).map((periodStart) => {
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

function createCombinedSeries(input: {
  battery: SignedValuePoint[];
  batteryCharge: SingleValuePoint[];
  grid: SignedValuePoint[];
  price: SingleValuePoint[];
  solarEnergy: SingleValuePoint[];
  solar: SingleValuePoint[];
}): CombinedPoint[] {
  const combined = new Map<string, CombinedPoint>();

  for (const point of input.price) {
    combined.set(point.periodStart, {
      batteryCharge: null,
      batteryLevel: null,
      batteryDischarge: null,
      gridExport: null,
      gridImport: null,
      periodStart: point.periodStart,
      price: point.value,
      solarEnergy: null,
      solar: null,
    });
  }

  for (const point of input.solarEnergy) {
    const existing =
      combined.get(point.periodStart) ??
      createEmptyCombinedPoint(point.periodStart);
    existing.solarEnergy = point.value;
    combined.set(point.periodStart, existing);
  }

  for (const point of input.solar) {
    const existing =
      combined.get(point.periodStart) ??
      createEmptyCombinedPoint(point.periodStart);
    existing.solar = point.value;
    combined.set(point.periodStart, existing);
  }

  for (const point of input.grid) {
    const existing =
      combined.get(point.periodStart) ??
      createEmptyCombinedPoint(point.periodStart);
    existing.gridExport = point.positiveValue;
    existing.gridImport = point.negativeValue;
    combined.set(point.periodStart, existing);
  }

  for (const point of input.battery) {
    const existing =
      combined.get(point.periodStart) ??
      createEmptyCombinedPoint(point.periodStart);
    existing.batteryCharge = point.positiveValue;
    existing.batteryDischarge = point.negativeValue;
    combined.set(point.periodStart, existing);
  }

  for (const point of input.batteryCharge) {
    const existing =
      combined.get(point.periodStart) ??
      createEmptyCombinedPoint(point.periodStart);
    existing.batteryLevel = point.value;
    combined.set(point.periodStart, existing);
  }

  return [...combined.values()].sort(
    (left, right) =>
      new Date(left.periodStart).getTime() -
      new Date(right.periodStart).getTime(),
  );
}

function splitCombinedSeriesByTime(
  points: CombinedPoint[],
): SplitCombinedPoint[] {
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
        currentBatteryCharge: isFuture ? null : point.batteryCharge,
        currentBatteryLevel: isFuture ? null : point.batteryLevel,
        currentBatteryDischarge: isFuture ? null : point.batteryDischarge,
        currentBatteryPower:
          isFuture ? null : (point.batteryCharge ?? point.batteryDischarge),
        currentGridExport: isFuture ? null : point.gridExport,
        currentGridImport: isFuture ? null : point.gridImport,
        currentGridPower: isFuture ? null : (point.gridExport ?? point.gridImport),
        currentPrice: isFuture ? null : point.price,
        currentSolarEnergy: isFuture ? null : point.solarEnergy,
        currentSolar: isFuture ? null : point.solar,
        futureBatteryCharge: includeInFutureSeries ? point.batteryCharge : null,
        futureBatteryLevel: includeInFutureSeries ? point.batteryLevel : null,
        futureBatteryDischarge: includeInFutureSeries
          ? point.batteryDischarge
          : null,
        futureBatteryPower: includeInFutureSeries
          ? (point.batteryCharge ?? point.batteryDischarge)
          : null,
        futureGridExport: includeInFutureSeries ? point.gridExport : null,
        futureGridImport: includeInFutureSeries ? point.gridImport : null,
        futureGridPower: includeInFutureSeries
          ? (point.gridExport ?? point.gridImport)
          : null,
        futurePrice: includeInFutureSeries ? point.price : null,
        futureSolarEnergy: includeInFutureSeries ? point.solarEnergy : null,
        futureSolar: includeInFutureSeries ? point.solar : null,
      };
  });
}

function createEmptyCombinedPoint(periodStart: string): CombinedPoint {
  return {
    batteryCharge: null,
    batteryLevel: null,
    batteryDischarge: null,
    gridExport: null,
    gridImport: null,
    periodStart,
    price: null,
    solarEnergy: null,
    solar: null,
  };
}

function createDayPeriods(dayKey: string): string[] {
  const startMs = new Date(`${dayKey}T00:00:00.000Z`).getTime();

  return Array.from({ length: 24 * 4 }, (_, index) =>
    new Date(startMs + index * HISTORY_STEP_MS).toISOString(),
  );
}

function formatDayTick(value: string | number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTooltipTimestamp(value: string | number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
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

function formatPercentValue(value: number): string {
  return `${Math.round(value)}%`;
}

function formatShortPercentValue(value: number): string {
  return `${Math.round(value)}%`;
}

function formatCombinedValue(value: number, key?: string): string {
  if (key === "price" || key === "currentPrice" || key === "futurePrice") {
    return formatPriceValue(value);
  }

  if (key === "solar" || key === "currentSolar" || key === "futureSolar") {
    return formatWholeNumberValue(value);
  }

  if (
    key === "batteryLevel" ||
    key === "currentBatteryLevel" ||
    key === "futureBatteryLevel"
  ) {
    return formatPercentValue(value);
  }

  if (
    key === "solarEnergy" ||
    key === "currentSolarEnergy" ||
    key === "futureSolarEnergy"
  ) {
    return formatPowerValue(value);
  }

  return formatAbsolutePowerValue(value);
}

function formatBatteryHistoryValue(value: number, key?: string): string {
  if (key?.includes("ChargePercent")) {
    return formatPercentValue(value);
  }

  return formatAbsolutePowerValue(value);
}

export function getUtcDayKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function deduplicateTooltipEntries(
  entries: Array<TooltipPayloadEntry & { value: number }>,
): Array<TooltipPayloadEntry & { value: number }> {
  const entriesByName = new Map<
    string,
    TooltipPayloadEntry & { value: number }
  >();

  for (const entry of entries) {
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
  if (entry.dataKey?.startsWith("current")) {
    return 2;
  }

  if (entry.dataKey?.startsWith("future")) {
    return 1;
  }

  return 0;
}

export function getCurrentPeriodStart(): string {
  const now = Date.now();
  return new Date(
    Math.floor(now / HISTORY_STEP_MS) * HISTORY_STEP_MS,
  ).toISOString();
}

function buildNowLabel() {
  return {
    fill: UI_COLORS.textPrimary,
    fontSize: 12,
    position: "top" as const,
    value: "Now",
  };
}

function buildYAxisLabel(
  value: string,
  position: "insideLeft" | "insideRight",
) {
  return {
    angle: position === "insideLeft" ? -90 : 90,
    fill: UI_COLORS.chartTickMuted,
    fontSize: 12,
    position,
    value,
  };
}
