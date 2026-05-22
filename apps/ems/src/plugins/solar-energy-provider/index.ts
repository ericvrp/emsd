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
  huaweiSolarEnergyProviderDiscoveryPlugins,
} from "./huawei";
import {
  HomeWizardSolarEnergyProviderPlugin,
  homeWizardSolarEnergyProviderDiscoveryPlugins,
} from "./homewizard";
import {
  SolarEdgeSolarEnergyProviderPlugin,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
} from "./solaredge";

export interface SolarEnergyProviderPlugin {
  getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo | null>;
  setProductionEnabled(
    enabled: boolean,
  ): Promise<NormalizedSolarEnergyProviderInfo | null>;
}

export const solarEnergyProviderDiscoveryPlugins = [
  enphaseSolarEnergyProviderDiscoveryPlugin,
  ...homeWizardSolarEnergyProviderDiscoveryPlugins,
  ...huaweiSolarEnergyProviderDiscoveryPlugins,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
];

export {
  enphaseSolarEnergyProviderDiscoveryPlugin,
  homeWizardSolarEnergyProviderDiscoveryPlugins,
  huaweiSolarEnergyProviderDiscoveryPlugins,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
};

export const solarEnergyProviderPlugins = [
  "enphase-local",
  "homewizard-ct",
  "homewizard-smart-plug",
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

  if (
    provider.plugin === "homewizard-ct" ||
    provider.plugin === "homewizard-smart-plug"
  ) {
    return new HomeWizardSolarEnergyProviderPlugin(provider);
  }

  throw new Error(
    `Unsupported solar energy provider plugin: ${provider.plugin}`,
  );
}

export async function getSolarEnergyProviderNormalizedInfo(
  provider: SolarEnergyProviderRecord,
): Promise<NormalizedSolarEnergyProviderInfo | null> {
  return createSolarEnergyProviderPlugin(provider).getNormalizedInfo();
}

export async function setSolarEnergyProviderProductionEnabled(
  provider: SolarEnergyProviderRecord,
  enabled: boolean,
): Promise<NormalizedSolarEnergyProviderInfo | null> {
  return createSolarEnergyProviderPlugin(provider).setProductionEnabled(
    enabled,
  );
}
