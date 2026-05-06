import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import {
  EnphaseSolarEnergyProviderPlugin,
  enphaseSolarEnergyProviderDiscoveryPlugin,
} from "./enphase";
import {
  HuaweiSun2000SolarEnergyProviderPlugin,
  huaweiSolarEnergyProviderDiscoveryPlugin,
} from "./huawei";
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
  huaweiSolarEnergyProviderDiscoveryPlugin,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
];

export const solarEnergyProviderPlugins = [
  "enphase-local",
  "huawei-sun2000-modbus",
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

  if (provider.plugin === "huawei-sun2000-modbus") {
    return new HuaweiSun2000SolarEnergyProviderPlugin(provider);
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
