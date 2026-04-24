export enum BatteryStrategyBuiltinItemKey {
  Automatic = "automatic",
  ExportSurplus = "export-surplus",
  DelayedCharging = "delayed-charging",
}

export enum BatteryStrategyTriggerKind {
  DailyTime = "daily-time",
  ExportSurplus = "export-surplus",
  DelayedCharging = "delayed-charging",
}

export const BATTERY_STRATEGY_FIXED_ITEM_COUNT = 3;

export function getBatteryStrategyBuiltinItemKey(
  index: number,
): BatteryStrategyBuiltinItemKey | null {
  if (index === 0) {
    return BatteryStrategyBuiltinItemKey.Automatic;
  }

  if (index === 1) {
    return BatteryStrategyBuiltinItemKey.ExportSurplus;
  }

  if (index === 2) {
    return BatteryStrategyBuiltinItemKey.DelayedCharging;
  }

  return null;
}

export function formatBatteryStrategyBuiltinItemLabel(
  key: BatteryStrategyBuiltinItemKey,
): string {
  switch (key) {
    case BatteryStrategyBuiltinItemKey.Automatic:
      return "Automatic";
    case BatteryStrategyBuiltinItemKey.ExportSurplus:
      return "Export surplus";
    case BatteryStrategyBuiltinItemKey.DelayedCharging:
      return "Delayed charging";
  }
}

export function formatBatteryStrategyTriggerKindLabel(
  triggerKind: BatteryStrategyTriggerKind,
): string {
  switch (triggerKind) {
    case BatteryStrategyTriggerKind.DailyTime:
      return "Scheduled time";
    case BatteryStrategyTriggerKind.ExportSurplus:
      return "Export surplus";
    case BatteryStrategyTriggerKind.DelayedCharging:
      return "Delayed charging";
  }
}

export function isBatteryStrategyPriceTrigger(
  triggerKind: BatteryStrategyTriggerKind | null | undefined,
): triggerKind is
  | BatteryStrategyTriggerKind.ExportSurplus
  | BatteryStrategyTriggerKind.DelayedCharging {
  return (
    triggerKind === BatteryStrategyTriggerKind.ExportSurplus ||
    triggerKind === BatteryStrategyTriggerKind.DelayedCharging
  );
}
