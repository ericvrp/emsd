import {
  LOW_PRICE_CHARGE_MIN_SITE_SOLAR_POWER_W,
  isLowPriceAutoDischargeItem,
  type BatteryStrategyPlanItem,
  type ManagedDeviceTelemetryRecord,
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
    input.item.triggerKind !== "low-price" ||
    input.item.manualState !== "charging" ||
    isLowPriceAutoDischargeItem(input.item)
  ) {
    return null;
  }

  if (input.siteCurrentSolarPowerW === null) {
    return `skipping the low-price schedule for ${input.batteryId}: site solar production at start time is unavailable, below required ${LOW_PRICE_CHARGE_MIN_SITE_SOLAR_POWER_W}W`;
  }

  if (input.siteCurrentSolarPowerW <= LOW_PRICE_CHARGE_MIN_SITE_SOLAR_POWER_W) {
    return `skipping the low-price schedule for ${input.batteryId}: site solar production at start time is ${Math.round(input.siteCurrentSolarPowerW)}W, which is not above required ${LOW_PRICE_CHARGE_MIN_SITE_SOLAR_POWER_W}W`;
  }

  return null;
}
