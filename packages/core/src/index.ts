import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EMSD_NAME = "EMSD";

export type BatteryStatus = "idle" | "charging" | "discharging" | "offline";

export type BatteryStrategyMode = "auto" | "manual" | "self-consumption";

export type BatteryManualState = "idle" | "charging" | "discharging";

export interface BatteryStrategyRecord {
  strategyMode: BatteryStrategyMode;
  manualPowerW: number | null;
  manualState: BatteryManualState | null;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
  manualTargetSoc: number | null;
}

export interface NormalizedBatteryInfo extends BatteryStrategyRecord {
  capacityWh: number | null;
  currentW: number | null;
  model: string;
  name: string;
  socPercent: number | null;
  status: BatteryStatus;
}

export type DiscoveryCategory = "battery" | "meter";

export interface DiscoverReportDevice {
  discoveryId: string;
  category: DiscoveryCategory;
  model: string;
  name: string;
  ipAddress: string;
  details: string;
}

export interface SiteRecord {
  id: string;
  location: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WeatherForecastSourceRecord {
  id: string;
  siteId: string;
  name: string;
  updatedAt: string;
}

export interface DynamicPriceSourceRecord {
  id: string;
  siteId: string;
  name: string;
  updatedAt: string;
}

export interface DiscoverReport {
  schema: "emsd.discover.report.v1";
  reportedAt: string;
  host: string | null;
  subnet: string | null;
  interfaceName: string | null;
  devices: DiscoverReportDevice[];
}

export const discoverReportJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://emsd.local/schemas/discover-report.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "reportedAt",
    "host",
    "subnet",
    "interfaceName",
    "devices",
  ],
  properties: {
    schema: {
      type: "string",
      const: "emsd.discover.report.v1",
    },
    reportedAt: {
      type: "string",
      format: "date-time",
    },
    host: {
      type: ["string", "null"],
      format: "ipv4",
    },
    subnet: {
      type: ["string", "null"],
    },
    interfaceName: {
      type: ["string", "null"],
    },
    devices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "discoveryId",
          "category",
          "model",
          "name",
          "ipAddress",
          "details",
        ],
        properties: {
          discoveryId: {
            type: "string",
            minLength: 1,
          },
          category: {
            type: "string",
            enum: ["battery", "meter"],
          },
          model: {
            type: "string",
            minLength: 1,
          },
          name: {
            type: "string",
            minLength: 1,
          },
          ipAddress: {
            type: "string",
            format: "ipv4",
          },
          details: {
            type: "string",
          },
        },
      },
    },
  },
} as const;

export interface BatteryRecord extends BatteryStrategyRecord {
  id: string;
  siteId: string;
  name: string;
  plugin: string;
  model: string;
  ipAddress: string;
  enabled: boolean;
  status: BatteryStatus;
  connected: boolean;
  minimumDischargePercent: number;
  updatedAt: string;
}

export interface MeterRecord {
  id: string;
  siteId: string;
  name: string;
  model: string;
  ipAddress: string;
  enabled: boolean;
  connected: boolean;
  details: string;
  updatedAt: string;
}

export type ManagedDeviceKind = "battery" | "meter";

export type ManagedDeviceState =
  | "idle"
  | "charging"
  | "discharging"
  | "connected"
  | "offline";

export interface ManagedDeviceRecord {
  id: string;
  siteId: string;
  kind: ManagedDeviceKind;
  name: string;
  model: string;
  address: string;
  enabled: boolean;
  connected: boolean;
  state: ManagedDeviceState;
  batteryStrategy: BatteryStrategyRecord | null;
  minimumDischargePercent: number | null;
  note: string | null;
  updatedAt: string;
}

export function formatManagedDeviceState(state: ManagedDeviceState): string {
  return state.replace(/-/g, " ");
}

export interface ManagedDeviceTelemetryRecord {
  deviceId: string;
  siteId: string;
  kind: ManagedDeviceKind;
  powerW: number | null;
  socPercent: number | null;
  gasM3: number | null;
  state: ManagedDeviceState | null;
  observedAt: string;
}

export interface ManagedDeviceStatusRecord extends ManagedDeviceRecord {
  telemetry: ManagedDeviceTelemetryRecord | null;
}

export function getRepoRoot(): string {
  if (process.env.EMSD_REPO_ROOT) {
    return resolve(process.env.EMSD_REPO_ROOT);
  }

  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");
}

export function getDatabasePath(): string {
  const configuredPath = process.env.EMSD_DB_PATH;

  if (!configuredPath) {
    return resolve(getRepoRoot(), "data/emsd.sqlite");
  }

  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(getRepoRoot(), configuredPath);
}

export function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function getRuntimePath(...segments: string[]): string {
  return resolve(getRepoRoot(), "var/run", ...segments);
}

export function getDaemonLockPath(): string {
  return getRuntimePath("emsd.lock");
}
