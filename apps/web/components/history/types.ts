import type { ValueType } from "recharts/types/component/DefaultTooltipContent";

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
  periodStart: string;
};

export type TooltipPayloadEntry = {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: ValueType;
};
