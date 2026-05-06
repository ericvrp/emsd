import type { DiscoveryCategory } from "@emsd/core";
import type {
  BatteryTelemetrySample,
  DiscoveredDevice,
  MeterTelemetrySample,
} from "../discovery-types";

export type PluginType =
  | "battery"
  | "meter"
  | "weather"
  | "price"
  | "solar-energy-provider";

export interface DiscoveryRequestDefinition {
  path: string;
  method: string;
  headers?:
    | Record<string, string>
    | ((ipAddress: string) => Record<string, string> | null);
}

export interface DiscoveryResponseDefinition {
  match: string[];
}

export interface DiscoverySignatureDefinition {
  pluginType: PluginType;
  category: DiscoveryCategory;
  model: string;
  name: string;
  port: number;
  transport?: "http" | "modbus";
  schemes?: Array<"https" | "http">;
  request?: DiscoveryRequestDefinition;
  response?: DiscoveryResponseDefinition;
}

export interface DiscoveryPlugin extends DiscoverySignatureDefinition {
  supplementalRequest?: DiscoveryRequestDefinition;
  buildDiscoveredDevice?(args: {
    ipAddress: string;
    responseText: string;
    supplementalResponseText: string | null;
  }): Omit<DiscoveredDevice, "discoveryId">;
  probe?: (args: {
    ipAddress: string;
    verbose: boolean;
  }) => Promise<Omit<DiscoveredDevice, "discoveryId"> | null>;
  parseTelemetry?: (
    responseText: string,
  ) => BatteryTelemetrySample | MeterTelemetrySample;
}
