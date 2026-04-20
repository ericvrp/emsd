import type { BatteryStatus } from "./index";

export function deriveBatteryStatusFromPower(
  powerW: number | null,
): BatteryStatus {
  if (powerW === null || !Number.isFinite(powerW)) {
    return "offline";
  }

  if (powerW > 0) {
    return "discharging";
  }

  if (powerW < 0) {
    return "charging";
  }

  return "idle";
}
