import { existsSync, readFileSync } from "node:fs";
import {
  type BatteryRecord,
  type DynamicPriceSourceRecord,
  type ManagedDeviceRecord,
  type ManagedDeviceStatusRecord,
  type ManagedDeviceTelemetryRecord,
  type MeterRecord,
  type SiteRecord,
  type WeatherForecastSourceRecord,
  getDaemonLockPath,
} from "@emsd/core";
import {
  openDaemonDatabase,
  readManagedDeviceTelemetry,
} from "../../daemon/src/database";
import {
  type DiscoveredDevice,
  discoverDevices,
  discoverHostDevices,
  getPreferredDiscoveryTarget,
} from "../../ems/src/discover";
import {
  createBattery,
  createDynamicPriceSource,
  createMeter,
  createSite,
  createWeatherForecastSource,
  deleteBattery,
  deleteDynamicPriceSource,
  deleteMeter,
  deleteSite,
  deleteWeatherForecastSource,
  listBatteries,
  listDynamicPriceSources,
  listMeters,
  listSites,
  listWeatherForecastSources,
  setBatteryEnabled,
  setMeterEnabled,
  updateDynamicPriceSource,
  updateSite,
  updateWeatherForecastSource,
} from "../../ems/src/managed-site-store";

interface BridgeSuccess<T> {
  ok: true;
  data: T;
}

interface BridgeFailure {
  ok: false;
  error: string;
}

function respond<T>(payload: BridgeSuccess<T> | BridgeFailure): void {
  process.stdout.write(JSON.stringify(payload));
}

function succeed<T>(data: T): void {
  respond({ ok: true, data });
}

function fail(error: unknown): void {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function readInput<T>(): T {
  const raw = process.argv[3];
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required value: ${label}`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inferBatteryStatus(details: string): BatteryRecord["status"] {
  const matchedState = details.match(/state\s+([^,]+)/i)?.[1]?.trim();

  if (
    matchedState === "idle" ||
    matchedState === "charging" ||
    matchedState === "discharging"
  ) {
    return matchedState;
  }

  return "idle";
}

function getExistingManagedDeviceIds(siteId: string): Set<string> {
  return new Set([
    ...listBatteries(siteId).map((battery) => battery.id),
    ...listMeters(siteId).map((meter) => meter.id),
  ]);
}

function createManagedBatteryFromDiscovered(
  discovered: DiscoveredDevice,
  siteId: string,
) {
  return createBattery(
    {
      adapter: discovered.model,
      connected: true,
      enabled: true,
      id: discovered.discoveryId,
      ipAddress: discovered.ipAddress,
      model: discovered.model,
      name: discovered.name,
      status: inferBatteryStatus(discovered.details),
    },
    siteId,
  );
}

function createManagedMeterFromDiscovered(
  discovered: DiscoveredDevice,
  siteId: string,
) {
  return createMeter(
    {
      connected: true,
      details: discovered.details,
      enabled: true,
      id: discovered.discoveryId,
      ipAddress: discovered.ipAddress,
      model: discovered.model,
      name: discovered.name,
    },
    siteId,
  );
}

function toManagedDeviceRecord(
  record: BatteryRecord | MeterRecord,
): ManagedDeviceRecord {
  if ("adapter" in record) {
    return {
      id: record.id,
      siteId: record.siteId,
      kind: "battery",
      name: record.name,
      model: record.model,
      address: record.ipAddress,
      enabled: record.enabled,
      connected: record.connected,
      state: record.connected ? record.status : "offline",
      note: record.adapter,
      updatedAt: record.updatedAt,
    };
  }

  return {
    id: record.id,
    siteId: record.siteId,
    kind: "meter",
    name: record.name,
    model: record.model,
    address: record.ipAddress,
    enabled: record.enabled,
    connected: record.connected,
    state: record.connected ? "connected" : "offline",
    note: record.details || null,
    updatedAt: record.updatedAt,
  };
}

async function discoverForSelection(
  host: string | null,
): Promise<DiscoveredDevice[]> {
  if (host) {
    return discoverHostDevices(host, { host, verbose: false });
  }

  const target = getPreferredDiscoveryTarget();

  if (!target) {
    return [];
  }

  return discoverDevices([target.subnet], { host: null, verbose: false });
}

async function resolveDiscoveredDevice(input: {
  category: DiscoveredDevice["category"];
  discoveryId: string;
  host: string | null;
}): Promise<DiscoveredDevice> {
  const devices = await discoverForSelection(input.host);
  const exactMatch = devices.find(
    (device) => device.discoveryId === input.discoveryId,
  );

  if (!exactMatch) {
    throw new Error(
      `Discovered ${input.category} not found or not reachable right now: ${input.discoveryId}`,
    );
  }

  if (exactMatch.category !== input.category) {
    throw new Error(
      `Discovery id ${input.discoveryId} is a ${exactMatch.category}, not a ${input.category}.`,
    );
  }

  return exactMatch;
}

function buildSnapshot(): {
  generatedAt: string;
  sites: Array<
    SiteRecord & {
      devices: ManagedDeviceRecord[];
      dynamicPriceSources: DynamicPriceSourceRecord[];
      weatherSources: WeatherForecastSourceRecord[];
    }
  >;
} {
  const sites = listSites();

  return {
    generatedAt: new Date().toISOString(),
    sites: sites.map((site) => ({
      ...site,
      devices: [
        ...listBatteries(site.id).map(toManagedDeviceRecord),
        ...listMeters(site.id).map(toManagedDeviceRecord),
      ],
      dynamicPriceSources: listDynamicPriceSources(site.id),
      weatherSources: listWeatherForecastSources(site.id),
    })),
  };
}

function readDaemonState(): { pid: number | null; running: boolean } {
  const lockPath = getDaemonLockPath();

  if (!existsSync(lockPath)) {
    return { pid: null, running: false };
  }

  const rawPid = readFileSync(lockPath, "utf8").trim();
  const pid = Number.parseInt(rawPid, 10);

  if (Number.isNaN(pid)) {
    return { pid: null, running: false };
  }

  try {
    process.kill(pid, 0);
    return { pid, running: true };
  } catch {
    return { pid, running: false };
  }
}

function buildLiveStatus() {
  const db = openDaemonDatabase();
  const telemetry = readManagedDeviceTelemetry(db);
  db.close();
  const telemetryByDeviceId = new Map<string, ManagedDeviceTelemetryRecord>(
    telemetry.map((entry) => [entry.deviceId, entry]),
  );
  const snapshot = buildSnapshot();

  return {
    daemon: readDaemonState(),
    generatedAt: snapshot.generatedAt,
    sites: snapshot.sites.map((site) => ({
      ...site,
      devices: site.devices.map(
        (device): ManagedDeviceStatusRecord => ({
          ...device,
          telemetry: telemetryByDeviceId.get(device.id) ?? null,
        }),
      ),
    })),
  };
}

async function run(): Promise<void> {
  const action = process.argv[2];

  if (!action) {
    throw new Error("Missing bridge action.");
  }

  switch (action) {
    case "snapshot": {
      succeed(buildSnapshot());
      return;
    }

    case "live-status": {
      succeed(buildLiveStatus());
      return;
    }

    case "discover": {
      const input = readInput<{ host?: string | null }>();
      succeed(await discoverForSelection(optionalString(input.host ?? null)));
      return;
    }

    case "site-create": {
      const input = readInput<{ id?: string; name?: string }>();
      succeed(
        createSite({
          id: requireString(input.id, "id"),
          name: requireString(input.name, "name"),
        }),
      );
      return;
    }

    case "site-update": {
      const input = readInput<{ id?: string; name?: string }>();
      const site = updateSite(requireString(input.id, "id"), {
        name: requireString(input.name, "name"),
      });

      if (!site) {
        throw new Error(
          `Managed site not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(site);
      return;
    }

    case "site-delete": {
      const input = readInput<{ id?: string }>();
      const site = deleteSite(requireString(input.id, "id"));

      if (!site) {
        throw new Error(
          `Managed site not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(site);
      return;
    }

    case "battery-create": {
      const input = readInput<{
        discoveryId?: string;
        host?: string | null;
        siteId?: string;
      }>();
      const discoveryId = requireString(input.discoveryId, "discoveryId");
      const siteId = requireString(input.siteId, "siteId");
      const discovered = await resolveDiscoveredDevice({
        category: "battery",
        discoveryId,
        host: optionalString(input.host ?? null),
      });

      succeed(
        toManagedDeviceRecord(
          createManagedBatteryFromDiscovered(discovered, siteId),
        ),
      );
      return;
    }

    case "battery-set-enabled": {
      const input = readInput<{
        enabled?: boolean;
        id?: string;
        siteId?: string;
      }>();
      const battery = setBatteryEnabled(
        requireString(input.id, "id"),
        input.enabled === true,
        requireString(input.siteId, "siteId"),
      );

      if (!battery) {
        throw new Error(
          `Managed battery not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(toManagedDeviceRecord(battery));
      return;
    }

    case "battery-delete": {
      const input = readInput<{ id?: string; siteId?: string }>();
      const battery = deleteBattery(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!battery) {
        throw new Error(
          `Managed battery not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(toManagedDeviceRecord(battery));
      return;
    }

    case "meter-create": {
      const input = readInput<{
        discoveryId?: string;
        host?: string | null;
        siteId?: string;
      }>();
      const discoveryId = requireString(input.discoveryId, "discoveryId");
      const siteId = requireString(input.siteId, "siteId");
      const discovered = await resolveDiscoveredDevice({
        category: "meter",
        discoveryId,
        host: optionalString(input.host ?? null),
      });

      succeed(
        toManagedDeviceRecord(
          createManagedMeterFromDiscovered(discovered, siteId),
        ),
      );
      return;
    }

    case "discovery-add-all": {
      const input = readInput<{
        discoveryIds?: string[];
        host?: string | null;
        siteId?: string;
      }>();
      const siteId = requireString(input.siteId, "siteId");
      const discoveryIds = Array.isArray(input.discoveryIds)
        ? input.discoveryIds.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : [];

      if (discoveryIds.length === 0) {
        throw new Error("No discovered devices were selected.");
      }

      const discoveredDevices = await discoverForSelection(
        optionalString(input.host ?? null),
      );
      const existingIds = getExistingManagedDeviceIds(siteId);
      let addedBatteries = 0;
      let addedMeters = 0;
      let skippedDevices = 0;

      for (const candidateId of discoveryIds) {
        if (existingIds.has(candidateId)) {
          skippedDevices += 1;
          continue;
        }

        const discovered = discoveredDevices.find(
          (device) => device.discoveryId === candidateId,
        );

        if (!discovered) {
          skippedDevices += 1;
          continue;
        }

        if (discovered.category === "battery") {
          createManagedBatteryFromDiscovered(discovered, siteId);
          addedBatteries += 1;
        } else {
          createManagedMeterFromDiscovered(discovered, siteId);
          addedMeters += 1;
        }

        existingIds.add(candidateId);
      }

      succeed({ addedBatteries, addedMeters, skippedDevices });
      return;
    }

    case "meter-set-enabled": {
      const input = readInput<{
        enabled?: boolean;
        id?: string;
        siteId?: string;
      }>();
      const meter = setMeterEnabled(
        requireString(input.id, "id"),
        input.enabled === true,
        requireString(input.siteId, "siteId"),
      );

      if (!meter) {
        throw new Error(
          `Managed meter not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(toManagedDeviceRecord(meter));
      return;
    }

    case "meter-delete": {
      const input = readInput<{ id?: string; siteId?: string }>();
      const meter = deleteMeter(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!meter) {
        throw new Error(
          `Managed meter not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(toManagedDeviceRecord(meter));
      return;
    }

    case "weather-create": {
      const input = readInput<{
        id?: string;
        name?: string;
        siteId?: string;
      }>();
      succeed(
        createWeatherForecastSource(
          {
            id: requireString(input.id, "id"),
            name: requireString(input.name, "name"),
          },
          requireString(input.siteId, "siteId"),
        ),
      );
      return;
    }

    case "weather-update": {
      const input = readInput<{
        id?: string;
        name?: string;
        siteId?: string;
      }>();
      const source = updateWeatherForecastSource(
        requireString(input.id, "id"),
        { name: requireString(input.name, "name") },
        requireString(input.siteId, "siteId"),
      );

      if (!source) {
        throw new Error(
          `Managed weather source not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(source);
      return;
    }

    case "weather-delete": {
      const input = readInput<{ id?: string; siteId?: string }>();
      const source = deleteWeatherForecastSource(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!source) {
        throw new Error(
          `Managed weather source not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(source);
      return;
    }

    case "price-create": {
      const input = readInput<{
        id?: string;
        name?: string;
        siteId?: string;
      }>();
      succeed(
        createDynamicPriceSource(
          {
            id: requireString(input.id, "id"),
            name: requireString(input.name, "name"),
          },
          requireString(input.siteId, "siteId"),
        ),
      );
      return;
    }

    case "price-update": {
      const input = readInput<{
        id?: string;
        name?: string;
        siteId?: string;
      }>();
      const source = updateDynamicPriceSource(
        requireString(input.id, "id"),
        { name: requireString(input.name, "name") },
        requireString(input.siteId, "siteId"),
      );

      if (!source) {
        throw new Error(
          `Managed dynamic price source not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(source);
      return;
    }

    case "price-delete": {
      const input = readInput<{ id?: string; siteId?: string }>();
      const source = deleteDynamicPriceSource(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!source) {
        throw new Error(
          `Managed dynamic price source not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(source);
      return;
    }

    default:
      throw new Error(`Unknown bridge action: ${action}`);
  }
}

run().catch((error) => {
  fail(error);
  process.exitCode = 1;
});
