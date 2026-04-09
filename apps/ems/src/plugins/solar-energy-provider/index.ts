import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import {
  EnphaseSolarEnergyProviderPlugin,
  enphaseSolarEnergyProviderDiscoveryPlugin,
} from "./enphase";

export interface SolarEnergyProviderPlugin {
  getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo>;
}

export const solarEnergyProviderDiscoveryPlugins = [
  enphaseSolarEnergyProviderDiscoveryPlugin,
];

export const solarEnergyProviderPlugins = ["enphase-local"] as const;

export function createSolarEnergyProviderPlugin(
  provider: SolarEnergyProviderRecord,
): SolarEnergyProviderPlugin {
  if (provider.plugin === "enphase-local") {
    return new EnphaseSolarEnergyProviderPlugin(provider);
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
