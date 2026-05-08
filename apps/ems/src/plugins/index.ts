import {
  homeWizardBatteryPlugin,
  indevoltBatteryPlugin,
  sonnenBatteryPlugin,
} from "./battery";
import { meterPlugins } from "./meter";
import { pricePlugins } from "./price";
import {
  enphaseSolarEnergyProviderDiscoveryPlugin,
  huaweiSolarEnergyProviderDiscoveryPlugin,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
  solarEnergyProviderPlugins,
} from "./solar-energy-provider";
import { weatherPlugins } from "./solar-forecast";

export const pluginTypes = [
  "battery",
  "meter",
  "weather",
  "price",
  "solar-energy-provider",
] as const;

export const discoveryPlugins = [
  ...meterPlugins,
  sonnenBatteryPlugin,
  indevoltBatteryPlugin,
  homeWizardBatteryPlugin,
  huaweiSolarEnergyProviderDiscoveryPlugin,
  solaredgeSolarEnergyProviderDiscoveryPlugin,
  enphaseSolarEnergyProviderDiscoveryPlugin,
];

export {
  meterPlugins,
  pricePlugins,
  solarEnergyProviderPlugins,
  weatherPlugins,
};
export type {
  DiscoveryPlugin,
  DiscoveryRequestDefinition,
  DiscoveryResponseDefinition,
  DiscoverySignatureDefinition,
  PluginType,
} from "./types";
