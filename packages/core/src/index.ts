import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EMSD_NAME = "EMSD";

export type BatteryStatus = "idle" | "charging" | "discharging" | "offline";

export type DiscoveryCategory = "battery" | "meter";

export interface DiscoveredDeviceRecord {
  id: string;
  category: DiscoveryCategory;
  model: string;
  name: string;
  ipAddress: string;
  details: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DiscoverReportDevice extends DiscoveredDeviceRecord {
  isNew: boolean;
}

export interface DiscoverReport {
  schema: "emsd.discover.report.v1";
  reportedAt: string;
  filter: "new" | "all";
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
    "filter",
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
    filter: {
      type: "string",
      enum: ["new", "all"],
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
          "id",
          "category",
          "model",
          "name",
          "ipAddress",
          "details",
          "firstSeenAt",
          "lastSeenAt",
          "isNew",
        ],
        properties: {
          id: {
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
          firstSeenAt: {
            type: "string",
            format: "date-time",
          },
          lastSeenAt: {
            type: "string",
            format: "date-time",
          },
          isNew: {
            type: "boolean",
          },
        },
      },
    },
  },
} as const;

export interface BatteryRecord {
  id: string;
  name: string;
  adapter: string;
  status: BatteryStatus;
  connected: boolean;
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
