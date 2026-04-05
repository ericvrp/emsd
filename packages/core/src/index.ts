import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EMSD_NAME = "EMSD";

export type BatteryStatus = "idle" | "charging" | "discharging" | "offline";

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
  name: string;
  createdAt: string;
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

export interface BatteryRecord {
  id: string;
  siteId: string;
  name: string;
  adapter: string;
  model: string;
  ipAddress: string;
  enabled: boolean;
  status: BatteryStatus;
  connected: boolean;
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
