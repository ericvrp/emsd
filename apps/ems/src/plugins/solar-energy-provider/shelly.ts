import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import {
  fetchShellyLocalSnapshot,
  formatShellyDetails,
  isShellyPlug,
} from "../shelly-local";
import type { DiscoveryPlugin } from "../types";

const SHELLY_PLUG_MODEL = "shelly-plug";
const SHELLY_PLUG_NAME = "Shelly Plug";
const SHELLY_DISCOVERY_REQUEST_TIMEOUT_MS = 750;

export class ShellySolarEnergyProviderPlugin {
  constructor(private readonly provider: SolarEnergyProviderRecord) {}

  async getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo | null> {
    const snapshot = await fetchShellyLocalSnapshot(this.provider.ipAddress);
    const currentPowerW = normalizeInvertedSolarPowerW(snapshot.powerW);

    return {
      currentPowerW,
      productionControlStatus: "unavailable",
      status: currentPowerW === null ? "offline" : "connected",
    };
  }

  async setProductionEnabled(): Promise<NormalizedSolarEnergyProviderInfo | null> {
    throw new Error(
      `Shelly production control is unavailable for provider ${this.provider.id}.`,
    );
  }
}

export const shellySolarEnergyProviderDiscoveryPlugin: DiscoveryPlugin = {
  pluginType: "solar-energy-provider",
  category: "solar-energy-provider",
  model: SHELLY_PLUG_MODEL,
  name: SHELLY_PLUG_NAME,
  port: 80,
  schemes: ["http"],
  async probe({ ipAddress }) {
    const snapshot = await fetchShellyLocalSnapshot(ipAddress, {
      requestTimeoutMs: SHELLY_DISCOVERY_REQUEST_TIMEOUT_MS,
    }).catch(() => null);

    if (!snapshot || !isShellyPlug(snapshot)) {
      return null;
    }

    return {
      category: "solar-energy-provider",
      capacityWh: null,
      details: formatShellyDetails(snapshot),
      ipAddress,
      model: SHELLY_PLUG_MODEL,
      name: SHELLY_PLUG_NAME,
      port: 80,
      powerW: snapshot.powerW,
      socPercent: null,
      state: "connected",
    };
  },
};

function normalizeInvertedSolarPowerW(powerW: number | null): number | null {
  return powerW === null ? null : Math.max(0, -powerW);
}
