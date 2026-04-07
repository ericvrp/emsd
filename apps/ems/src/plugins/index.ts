import { batteryPlugins } from "./battery";
import { meterPlugins } from "./meter";
import { pricePlugins } from "./price";
import { weatherPlugins } from "./weather";

export const pluginTypes = ["battery", "meter", "weather", "price"] as const;

export const discoveryPlugins = [...batteryPlugins, ...meterPlugins];

export { batteryPlugins, meterPlugins, pricePlugins, weatherPlugins };
export type {
  DiscoveryPlugin,
  DiscoveryRequestDefinition,
  DiscoveryResponseDefinition,
  DiscoverySignatureDefinition,
  PluginType,
} from "./types";
