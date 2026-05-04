import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import type {
  BatteryStrategyHistoryDisplayState,
  BatteryStrategyHistorySource,
} from "@emsd/core/client";

export type SingleValuePoint = {
  periodStart: string;
  value: number | null;
};

export type SplitSingleValuePoint = SingleValuePoint & {
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

export type BatteryHistoryPoint = {
  currentChargePercent: number | null;
  currentChargingPower: number | null;
  currentDischargingPower: number | null;
  currentPower: number | null;
  futureChargePercent: number | null;
  futureChargingPower: number | null;
  futureDischargingPower: number | null;
  futurePower: number | null;
  overlayCharge: number | null;
  overlayColor: string | null;
  overlayDischarge: number | null;
  overlayIdle: number | null;
  overlaySelfConsumption: number | null;
  overlayStroke: string | null;
  overlayStrokeWidth: number;
  overlayValue: number | null;
  periodStart: string;
  strategyColor: string | null;
  strategyActiveItemId: string | null;
  strategyDisplayLabel: string | null;
  strategyDisplayState: BatteryStrategyHistoryDisplayState | null;
  strategyItemLabel: string | null;
  strategySeriesId: string | null;
  strategySource: BatteryStrategyHistorySource | null;
};

export type TooltipPayloadEntry = {
  color?: string;
  dataKey?: string;
  name?: string;
  payload?: unknown;
  value?: ValueType;
};
