import type { DiscoveryCategory, ManagedDeviceState } from "@emsd/core";

export interface DiscoveredDevice {
  discoveryId: string;
  category: DiscoveryCategory;
  model: string;
  name: string;
  ipAddress: string;
  details: string;
  powerW: number | null;
  socPercent: number | null;
  state: ManagedDeviceState | null;
}

export interface BatteryTelemetrySample {
  powerW: number | null;
  socPercent: number | null;
  state: ManagedDeviceState;
}

export interface MeterTelemetrySample {
  powerW: number | null;
}
