import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import {
  EnphaseSolarEnergyProviderPlugin,
  enphaseSolarEnergyProviderDiscoveryPlugin,
} from "./enphase";
import {
  SolarEdgeSolarEnergyProviderPlugin,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
} from "./solaredge";

export interface SolarEnergyProviderPlugin {
  getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo>;
  setProductionEnabled(
    enabled: boolean,
  ): Promise<NormalizedSolarEnergyProviderInfo>;
}

export const solarEnergyProviderDiscoveryPlugins = [
  enphaseSolarEnergyProviderDiscoveryPlugin,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
];

export const solarEnergyProviderPlugins = [
  "enphase-local",
  "solaredge-local",
] as const;

export function createSolarEnergyProviderPlugin(
  provider: SolarEnergyProviderRecord,
): SolarEnergyProviderPlugin {
  if (provider.plugin === "enphase-local") {
    return new EnphaseSolarEnergyProviderPlugin(provider);
  }

  if (provider.plugin === "solaredge-local") {
    return new SolarEdgeSolarEnergyProviderPlugin(provider);
  }

  throw new Error(
    `Unsupported solar energy provider plugin: ${provider.plugin}`,
  );
}

export async function getSolarEnergyProviderNormalizedInfo(
  provider: SolarEnergyProviderRecord,
): Promise<NormalizedSolarEnergyProviderInfo> {
  return createSolarEnergyProviderPlugin(provider).getNormalizedInfo();
}

export async function setSolarEnergyProviderProductionEnabled(
  provider: SolarEnergyProviderRecord,
  enabled: boolean,
): Promise<NormalizedSolarEnergyProviderInfo> {
  return createSolarEnergyProviderPlugin(provider).setProductionEnabled(
    enabled,
  );
}
