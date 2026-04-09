import { batteryPlugins } from "./battery";
import { meterPlugins } from "./meter";
import { pricePlugins } from "./price";
import {
  solarEnergyProviderDiscoveryPlugins,
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
  ...batteryPlugins,
  ...meterPlugins,
  ...solarEnergyProviderDiscoveryPlugins,
];

export {
  batteryPlugins,
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
