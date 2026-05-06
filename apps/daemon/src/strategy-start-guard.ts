import {
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  DELAYED_CHARGING_MIN_SITE_SOLAR_POWER_W,
  type ManagedDeviceTelemetryRecord,
  isDelayedChargingAutoDischargeItem,
} from "@emsd/core";

export function getCurrentSiteSolarPowerW(input: {
  siteId: string;
  telemetry: ManagedDeviceTelemetryRecord[];
}): number | null {
  const solarTelemetry = input.telemetry.filter(
    (entry) =>
      entry.siteId === input.siteId &&
      entry.kind === "solar-energy-provider" &&
      typeof entry.powerW === "number",
  );

  if (solarTelemetry.length === 0) {
    return null;
  }

  return solarTelemetry.reduce(
    (total, entry) => total + (entry.powerW ?? 0),
    0,
  );
}

export function getScheduledStartSkipReason(input: {
  batteryId: string;
  item: BatteryStrategyPlanItem;
  siteCurrentSolarPowerW: number | null;
}): string | null {
  if (
    input.item.triggerKind !== BatteryStrategyTriggerKind.DelayedCharging ||
    input.item.manualState !== "charging" ||
    isDelayedChargingAutoDischargeItem(input.item)
  ) {
    return null;
  }

  if (input.siteCurrentSolarPowerW === null) {
    return `skipped: site solar unavailable (need >${DELAYED_CHARGING_MIN_SITE_SOLAR_POWER_W}W)`;
  }

  if (input.siteCurrentSolarPowerW <= DELAYED_CHARGING_MIN_SITE_SOLAR_POWER_W) {
    return `skipped: site solar ${Math.round(input.siteCurrentSolarPowerW)}W below ${DELAYED_CHARGING_MIN_SITE_SOLAR_POWER_W}W`;
  }

  return null;
}
