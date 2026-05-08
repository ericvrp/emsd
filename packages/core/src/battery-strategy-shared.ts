export enum BatteryStrategyBuiltinItemKey {
  Automatic = "automatic",
  ExportSurplus = "export-surplus",
  DelayedChargePrep = "delayed-charge-prep",
  DelayedCharging = "delayed-charging",
  ImportShortage = "import-shortage",
  SolarProductionControl = "solar-production-control",
}

export enum BatteryStrategyTriggerKind {
  DailyTime = "daily-time",
  ExportSurplus = "export-surplus",
  DelayedChargePrep = "delayed-charge-prep",
  DelayedCharging = "delayed-charging",
  ImportShortage = "import-shortage",
  SolarProductionControl = "solar-production-control",
}

export const BATTERY_STRATEGY_FIXED_ITEM_COUNT = 6;

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
    return BatteryStrategyBuiltinItemKey.DelayedChargePrep;
  }

  if (index === 3) {
    return BatteryStrategyBuiltinItemKey.DelayedCharging;
  }

  if (index === 4) {
    return BatteryStrategyBuiltinItemKey.ImportShortage;
  }

  if (index === 5) {
    return BatteryStrategyBuiltinItemKey.SolarProductionControl;
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
    case BatteryStrategyBuiltinItemKey.DelayedChargePrep:
      return "Delayed-charge prep";
    case BatteryStrategyBuiltinItemKey.DelayedCharging:
      return "Delayed charging";
    case BatteryStrategyBuiltinItemKey.ImportShortage:
      return "Import shortage";
    case BatteryStrategyBuiltinItemKey.SolarProductionControl:
      return "Solar production control";
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
    case BatteryStrategyTriggerKind.DelayedChargePrep:
      return "Delayed-charge prep";
    case BatteryStrategyTriggerKind.DelayedCharging:
      return "Delayed charging";
    case BatteryStrategyTriggerKind.ImportShortage:
      return "Import shortage";
    case BatteryStrategyTriggerKind.SolarProductionControl:
      return "Solar production control";
  }
}

export function isBatteryStrategyPriceTrigger(
  triggerKind: BatteryStrategyTriggerKind | null | undefined,
): triggerKind is
  | BatteryStrategyTriggerKind.ExportSurplus
  | BatteryStrategyTriggerKind.DelayedCharging
  | BatteryStrategyTriggerKind.ImportShortage {
  return (
    triggerKind === BatteryStrategyTriggerKind.ExportSurplus ||
    triggerKind === BatteryStrategyTriggerKind.DelayedCharging ||
    triggerKind === BatteryStrategyTriggerKind.ImportShortage
  );
}

export function isBatteryStrategyTriggerNeedingPriceSamples(
  triggerKind: BatteryStrategyTriggerKind | null | undefined,
): triggerKind is BatteryStrategyTriggerKind {
  return (
    isBatteryStrategyPriceTrigger(triggerKind) ||
    triggerKind === BatteryStrategyTriggerKind.DelayedChargePrep
  );
}
