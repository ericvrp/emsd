import { existsSync, readFileSync } from "node:fs";
import {
  type BatteryManualState,
  type BatteryRecord,
  type BatteryStrategyMode,
  type DynamicPriceSnapshotRecord,
  type DynamicPriceSourceRecord,
  type ManagedDeviceRecord,
  type ManagedDeviceStatusRecord,
  type ManagedDeviceTelemetryRecord,
  type MeterRecord,
  type SiteRecord,
  type SolarEnergyProviderRecord,
  type WeatherForecastRecord,
  type WeatherForecastSourceRecord,
  getDaemonLockPath,
} from "@emsd/core";
import {
  deleteWeatherForecast,
  openDaemonDatabase,
  readBatteryPowerSamples,
  readDynamicPriceSamples,
  readDynamicPriceSnapshot,
  readDynamicPriceSources,
  readManagedDeviceTelemetry,
  readP1MeterSamples,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarEnergyProviders,
  readSolarForecastSamples,
  readWeatherForecast,
  readWeatherForecastSources,
} from "../../daemon/src/database";
import { createBatteryPlugin } from "../../ems/src/battery-plugins";
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
  createSolarEnergyProvider,
  createWeatherForecastSource,
  deleteBattery,
  deleteDynamicPriceSource,
  deleteMeter,
  deleteSite,
  deleteSolarEnergyProvider,
  deleteWeatherForecastSource,
  getBattery,
  listBatteries,
  listDynamicPriceSources,
  listMeters,
  listSites,
  listSolarEnergyProviders,
  listWeatherForecastSources,
  setBatteryEnabled,
  setBatteryMinimumDischargePercent,
  setBatteryStrategy,
  setBatteryStrategyPlan,
  setMeterEnabled,
  updateDynamicPriceSource,
  updateSite,
  updateWeatherForecastSource,
} from "../../ems/src/managed-site-store";
import {
  type SignedDiscoveredDevice,
  verifySignedDiscoveredDevice,
} from "../lib/discovery-proof";

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

function readSignedDiscoveredDevice(value: unknown): DiscoveredDevice {
  if (!isSignedDiscoveredDevice(value)) {
    throw new Error("Invalid discovered device payload.");
  }

  return verifySignedDiscoveredDevice(value);
}

function readSignedDiscoveredDeviceList(value: unknown): DiscoveredDevice[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => !isSignedDiscoveredDevice(entry))
  ) {
    throw new Error("Invalid discovered device list payload.");
  }

  return value.map((entry) => verifySignedDiscoveredDevice(entry));
}

function isSignedDiscoveredDevice(
  value: unknown,
): value is SignedDiscoveredDevice {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.category === "battery" ||
      candidate.category === "meter" ||
      candidate.category === "solar-energy-provider") &&
    typeof candidate.details === "string" &&
    typeof candidate.discoveryId === "string" &&
    typeof candidate.ipAddress === "string" &&
    typeof candidate.model === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.discoveryExpiresAt === "string" &&
    typeof candidate.discoveryIssuedAt === "string" &&
    typeof candidate.discoveryProof === "string" &&
    (typeof candidate.powerW === "number" || candidate.powerW === null) &&
    (typeof candidate.socPercent === "number" ||
      candidate.socPercent === null) &&
    (candidate.state === "idle" ||
      candidate.state === "charging" ||
      candidate.state === "discharging" ||
      candidate.state === "connected" ||
      candidate.state === "offline" ||
      candidate.state === null)
  );
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

function inferBatteryStrategyMode(details: string): BatteryStrategyMode {
  const matchedMode = details.match(/mode\s+([^,]+)/i)?.[1]?.trim();

  if (matchedMode === "self-consumption") {
    return "self-consumption";
  }

  if (matchedMode === "real-time control") {
    return "manual";
  }

  return "auto";
}

function inferBatteryPowerW(details: string): number | null {
  const matchedPower = details.match(/power\s+(-?\d+)\s*W/i)?.[1];

  if (!matchedPower) {
    return null;
  }

  const parsed = Number(matchedPower);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function parseDiscoverySerialNumber(details: string): string | null {
  const matched = details.match(/serial\s+(\d{6,})/i)?.[1] ?? null;
  return matched && matched.length > 0 ? matched : null;
}

function getExistingManagedDeviceIds(siteId: string): Set<string> {
  return new Set([
    ...listBatteries(siteId).map((battery) => battery.id),
    ...listMeters(siteId).map((meter) => meter.id),
    ...listSolarEnergyProviders(siteId).map((provider) => provider.id),
  ]);
}

function createManagedBatteryFromDiscovered(
  discovered: DiscoveredDevice,
  siteId: string,
) {
  return createBattery(
    {
      plugin: discovered.model,
      connected: true,
      enabled: true,
      id: discovered.discoveryId,
      ipAddress: discovered.ipAddress,
      minimumDischargePercent: 10,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: 10,
      model: discovered.model,
      name: discovered.name,
      manualPowerW: inferBatteryPowerW(discovered.details),
      manualState:
        inferBatteryStatus(discovered.details) === "offline"
          ? "idle"
          : (inferBatteryStatus(discovered.details) as BatteryManualState),
      manualTargetSoc: 100,
      status: inferBatteryStatus(discovered.details),
      strategyMode: inferBatteryStrategyMode(discovered.details),
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

function createManagedSolarEnergyProviderFromDiscovered(
  discovered: DiscoveredDevice,
  siteId: string,
) {
  return createSolarEnergyProvider(
    {
      connected: true,
      enabled: true,
      id: discovered.discoveryId,
      ipAddress: discovered.ipAddress,
      name: discovered.name,
      plugin: discovered.model,
      serialNumber: parseDiscoverySerialNumber(discovered.details),
    },
    siteId,
  );
}

function toManagedDeviceRecord(
  record: BatteryRecord | MeterRecord | SolarEnergyProviderRecord,
): ManagedDeviceRecord {
  if ("plugin" in record) {
    if (!("minimumDischargePercent" in record)) {
      return {
        id: record.id,
        siteId: record.siteId,
        kind: "solar-energy-provider",
        name: record.name,
        model: record.name,
        address: record.ipAddress,
        enabled: record.enabled,
        connected: record.connected,
        state: record.connected ? "connected" : "offline",
        batteryStrategy: null,
        batteryStrategyPlan: null,
        batteryManualModeActive: false,
        minimumDischargePercent: null,
        updatedAt: record.updatedAt,
      };
    }

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
      batteryStrategy: {
        manualChargeTargetSoc: record.manualChargeTargetSoc,
        manualDischargeTargetSoc: record.manualDischargeTargetSoc,
        manualPowerW: record.manualPowerW,
        manualState: record.manualState,
        manualTargetSoc: record.manualTargetSoc,
        strategyMode: record.strategyMode,
      },
      batteryStrategyPlan: record.strategyPlan,
      batteryManualModeActive: record.manualModeActive,
      minimumDischargePercent: record.minimumDischargePercent,
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
    batteryStrategy: null,
    batteryStrategyPlan: null,
    batteryManualModeActive: false,
    minimumDischargePercent: null,
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

function loadTelemetryByDeviceId(): Map<string, ManagedDeviceTelemetryRecord> {
  const db = openDaemonDatabase();
  const telemetry = readManagedDeviceTelemetry(db);
  db.close();

  return new Map<string, ManagedDeviceTelemetryRecord>(
    telemetry.map((entry) => [entry.deviceId, entry]),
  );
}

function buildSnapshot(): {
  generatedAt: string;
  sites: Array<
    SiteRecord & {
      devices: ManagedDeviceStatusRecord[];
      dynamicPriceSources: DynamicPriceSourceRecord[];
      weatherSources: WeatherForecastSourceRecord[];
    }
  >;
} {
  const sites = listSites();
  const telemetryByDeviceId = loadTelemetryByDeviceId();

  return {
    generatedAt: new Date().toISOString(),
    sites: sites.map((site) => ({
      ...site,
      devices: [
        ...listBatteries(site.id).map(toManagedDeviceRecord),
        ...listMeters(site.id).map(toManagedDeviceRecord),
        ...listSolarEnergyProviders(site.id).map(toManagedDeviceRecord),
      ].map(
        (device): ManagedDeviceStatusRecord => ({
          ...device,
          telemetry: telemetryByDeviceId.get(device.id) ?? null,
        }),
      ),
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
  const snapshot = buildSnapshot();

  return {
    daemon: readDaemonState(),
    generatedAt: snapshot.generatedAt,
    sites: snapshot.sites,
  };
}

function requestDaemonRefresh(): void {
  const daemon = readDaemonState();

  if (!daemon.running || daemon.pid === null) {
    throw new Error("EMSD daemon is not running.");
  }

  process.kill(daemon.pid, "SIGUSR1");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForWeatherForecastRefresh(
  siteId: string,
  previousGeneratedAt: string | null,
): Promise<WeatherForecastRecord> {
  const deadline = Date.now() + 12_000;

  while (Date.now() < deadline) {
    const db = openDaemonDatabase();

    try {
      const forecast = readWeatherForecast(db, siteId);

      if (forecast && forecast.generatedAt !== previousGeneratedAt) {
        return forecast;
      }
    } finally {
      db.close();
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for the daemon to refresh the solar forecast for site ${siteId}.`,
  );
}

async function waitForDynamicPriceRefresh(
  siteId: string,
  previousGeneratedAt: string | null,
): Promise<DynamicPriceSnapshotRecord> {
  const deadline = Date.now() + 12_000;

  while (Date.now() < deadline) {
    const db = openDaemonDatabase();

    try {
      const snapshot = readDynamicPriceSnapshot(db, siteId);

      if (snapshot && snapshot.generatedAt !== previousGeneratedAt) {
        return snapshot;
      }
    } finally {
      db.close();
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for the daemon to refresh the dynamic price snapshot for site ${siteId}.`,
  );
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

    case "history-get-archive": {
      const input = readInput<{ siteId?: string }>();
      const siteId = requireString(input.siteId, "siteId");
      const db = openDaemonDatabase();

      try {
        succeed({
          batteryPowerSamples: readBatteryPowerSamples(db, siteId),
          dynamicPriceSamples: readDynamicPriceSamples(db, siteId),
          p1MeterSamples: readP1MeterSamples(db, siteId),
          siteId,
          solarEnergyProviderSamples: readSolarEnergyProviderSamples(
            db,
            siteId,
          ),
          solarForecastSamples: readSolarForecastSamples(db, siteId),
        });
      } finally {
        db.close();
      }
      return;
    }

    case "discover": {
      const input = readInput<{ host?: string | null }>();
      succeed(await discoverForSelection(optionalString(input.host ?? null)));
      return;
    }

    case "site-create": {
      const input = readInput<{
        id?: string;
        location?: string;
        name?: string;
      }>();
      succeed(
        createSite({
          id: requireString(input.id, "id"),
          location: requireString(input.location, "location"),
          name: requireString(input.name, "name"),
        }),
      );
      return;
    }

    case "site-update": {
      const input = readInput<{
        id?: string;
        location?: string;
        name?: string;
      }>();
      const site = updateSite(requireString(input.id, "id"), {
        location: requireString(input.location, "location"),
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
      const input = readInput<{ device?: DiscoveredDevice; siteId?: string }>();
      const siteId = requireString(input.siteId, "siteId");
      const discovered = readSignedDiscoveredDevice(input.device);

      if (discovered.category !== "battery") {
        throw new Error(
          `Discovery id ${discovered.discoveryId} is a ${discovered.category}, not a battery.`,
        );
      }

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

    case "battery-set-minimum-discharge-percent": {
      const input = readInput<{
        id?: string;
        minimumDischargePercent?: number;
        siteId?: string;
      }>();
      const battery = setBatteryMinimumDischargePercent(
        requireString(input.id, "id"),
        {
          minimumDischargePercent:
            typeof input.minimumDischargePercent === "number"
              ? input.minimumDischargePercent
              : 10,
        },
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

    case "battery-set-strategy": {
      const input = readInput<{
        id?: string;
        manualChargeTargetSoc?: number | null;
        manualDischargeTargetSoc?: number | null;
        manualPowerW?: number | null;
        manualState?: BatteryManualState | null;
        manualTargetSoc?: number | null;
        manualModeActive?: boolean;
        siteId?: string;
        strategyMode?: BatteryStrategyMode;
      }>();
      const batteryId = requireString(input.id, "id");
      const siteId = requireString(input.siteId, "siteId");
      const existing = getBattery(batteryId, siteId);

      if (!existing) {
        throw new Error(`Managed battery not found: ${batteryId}`);
      }

      const strategyMode =
        input.strategyMode === "manual" ||
        input.strategyMode === "self-consumption" ||
        input.strategyMode === "auto"
          ? input.strategyMode
          : existing.strategyMode;
      const manualState = input.manualState ?? existing.manualState;
      const manualPowerW =
        typeof input.manualPowerW === "number"
          ? input.manualPowerW
          : existing.manualPowerW;
      const manualChargeTargetSoc =
        typeof input.manualChargeTargetSoc === "number"
          ? input.manualChargeTargetSoc
          : existing.manualChargeTargetSoc;
      const manualDischargeTargetSoc =
        typeof input.manualDischargeTargetSoc === "number"
          ? input.manualDischargeTargetSoc
          : existing.manualDischargeTargetSoc;
      const manualTargetSoc =
        typeof input.manualTargetSoc === "number"
          ? clampManualTargetSoc(
              input.manualTargetSoc,
              manualState,
              existing.minimumDischargePercent,
            )
          : clampNullableManualTargetSoc(
              resolveManualTargetSoc({
                manualState,
                manualChargeTargetSoc,
                manualDischargeTargetSoc,
              }) ?? existing.manualTargetSoc,
              manualState,
              existing.minimumDischargePercent,
            );

      await createBatteryPlugin(existing).setStrategy({
        manualChargeTargetSoc,
        manualDischargeTargetSoc,
        strategyMode,
        manualPowerW,
        manualState,
        manualTargetSoc,
      });

      const updated = setBatteryStrategy(
        batteryId,
        {
          manualChargeTargetSoc,
          manualDischargeTargetSoc,
          manualPowerW,
          manualState,
          manualTargetSoc,
          manualModeActive: input.manualModeActive === true,
          strategyMode,
        },
        siteId,
      );

      if (!updated) {
        throw new Error(`Managed battery not found: ${batteryId}`);
      }

      succeed(toManagedDeviceRecord(updated));
      return;
    }

    case "battery-set-strategy-plan": {
      const input = readInput<{
        id?: string;
        siteId?: string;
        strategyPlan?: BatteryRecord["strategyPlan"];
      }>();
      const batteryId = requireString(input.id, "id");
      const siteId = requireString(input.siteId, "siteId");
      const updated = setBatteryStrategyPlan(
        batteryId,
        {
          strategyPlan: Array.isArray(input.strategyPlan)
            ? input.strategyPlan
            : [],
        },
        siteId,
      );

      if (!updated) {
        throw new Error(`Managed battery not found: ${batteryId}`);
      }

      succeed(toManagedDeviceRecord(updated));
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
      const input = readInput<{ device?: DiscoveredDevice; siteId?: string }>();
      const siteId = requireString(input.siteId, "siteId");
      const discovered = readSignedDiscoveredDevice(input.device);

      if (discovered.category !== "meter") {
        throw new Error(
          `Discovery id ${discovered.discoveryId} is a ${discovered.category}, not a meter.`,
        );
      }

      succeed(
        toManagedDeviceRecord(
          createManagedMeterFromDiscovered(discovered, siteId),
        ),
      );
      return;
    }

    case "solar-energy-provider-create": {
      const input = readInput<{ device?: DiscoveredDevice; siteId?: string }>();
      const siteId = requireString(input.siteId, "siteId");
      const discovered = readSignedDiscoveredDevice(input.device);

      if (discovered.category !== "solar-energy-provider") {
        throw new Error(
          `Discovery id ${discovered.discoveryId} is a ${discovered.category}, not a solar-energy-provider.`,
        );
      }

      succeed(
        toManagedDeviceRecord(
          createManagedSolarEnergyProviderFromDiscovered(discovered, siteId),
        ),
      );
      return;
    }

    case "discovery-add-all": {
      const input = readInput<{
        devices?: DiscoveredDevice[];
        siteId?: string;
      }>();
      const siteId = requireString(input.siteId, "siteId");
      const discoveredDevices = readSignedDiscoveredDeviceList(
        input.devices ?? [],
      );

      if (discoveredDevices.length === 0) {
        throw new Error("No discovered devices were selected.");
      }

      const existingIds = getExistingManagedDeviceIds(siteId);
      let addedBatteries = 0;
      let addedMeters = 0;
      let addedSolarEnergyProviders = 0;
      let skippedDevices = 0;

      for (const discovered of discoveredDevices) {
        const candidateId = discovered.discoveryId;

        if (existingIds.has(candidateId)) {
          skippedDevices += 1;
          continue;
        }

        if (discovered.category === "battery") {
          createManagedBatteryFromDiscovered(discovered, siteId);
          addedBatteries += 1;
        } else if (discovered.category === "meter") {
          createManagedMeterFromDiscovered(discovered, siteId);
          addedMeters += 1;
        } else {
          createManagedSolarEnergyProviderFromDiscovered(discovered, siteId);
          addedSolarEnergyProviders += 1;
        }

        existingIds.add(candidateId);
      }

      succeed({
        addedBatteries,
        addedMeters,
        addedSolarEnergyProviders,
        skippedDevices,
      });
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

    case "solar-energy-provider-delete": {
      const input = readInput<{ id?: string; siteId?: string }>();
      const provider = deleteSolarEnergyProvider(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!provider) {
        throw new Error(
          `Managed solar energy provider not found: ${requireString(input.id, "id")}`,
        );
      }

      succeed(toManagedDeviceRecord(provider));
      return;
    }

    case "weather-create": {
      const input = readInput<{
        id?: string;
        name?: string;
        provider?: "open-meteo";
        surface?: "open-meteo-shortwave-radiation";
        siteId?: string;
      }>();
      succeed(
        createWeatherForecastSource(
          {
            id: requireString(input.id, "id"),
            name: requireString(input.name, "name"),
            provider: "open-meteo",
            surface: "open-meteo-shortwave-radiation",
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
        provider?: "open-meteo";
        surface?: "open-meteo-shortwave-radiation";
        siteId?: string;
      }>();
      const source = updateWeatherForecastSource(
        requireString(input.id, "id"),
        {
          name: requireString(input.name, "name"),
          provider: "open-meteo",
          surface: "open-meteo-shortwave-radiation",
        },
        requireString(input.siteId, "siteId"),
      );

      if (!source) {
        throw new Error(
          `Managed solar forecast source not found: ${requireString(input.id, "id")}`,
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
          `Managed solar forecast source not found: ${requireString(input.id, "id")}`,
        );
      }

      const db = openDaemonDatabase();

      try {
        deleteWeatherForecast(db, requireString(input.siteId, "siteId"));
      } finally {
        db.close();
      }

      succeed(source);
      return;
    }

    case "weather-get-forecast": {
      const input = readInput<{
        siteId?: string;
      }>();
      const siteId = requireString(input.siteId, "siteId");
      const db = openDaemonDatabase();

      try {
        const forecast = readWeatherForecast(db, siteId);

        if (forecast === null) {
          throw new Error(
            `No solar forecast snapshot is available yet for site ${siteId}. Wait for the daemon refresh cycle or check provider configuration.`,
          );
        }

        succeed(forecast satisfies WeatherForecastRecord);
      } finally {
        db.close();
      }
      return;
    }

    case "weather-refresh-forecast": {
      const input = readInput<{ siteId?: string }>();
      const siteId = requireString(input.siteId, "siteId");
      const db = openDaemonDatabase();
      let previousGeneratedAt: string | null = null;

      try {
        const site = readSites(db).find((entry) => entry.id === siteId);

        if (!site) {
          throw new Error(`Managed site not found: ${siteId}`);
        }

        const source =
          readWeatherForecastSources(db).find(
            (entry) => entry.siteId === siteId,
          ) ?? null;

        if (source === null) {
          deleteWeatherForecast(db, siteId);
          throw new Error(
            `No forecast source is configured for site ${siteId}. Select a provider and save to fetch a forecast.`,
          );
        }

        previousGeneratedAt =
          readWeatherForecast(db, siteId)?.generatedAt ?? null;
      } finally {
        db.close();
      }

      requestDaemonRefresh();
      succeed(await waitForWeatherForecastRefresh(siteId, previousGeneratedAt));
      return;
    }

    case "price-create": {
      const input = readInput<{
        id?: string;
        name?: string;
        provider?: "tibber";
        siteId?: string;
      }>();
      succeed(
        createDynamicPriceSource(
          {
            id: requireString(input.id, "id"),
            name: requireString(input.name, "name"),
            provider: "tibber",
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
        provider?: "tibber";
        siteId?: string;
      }>();
      const source = updateDynamicPriceSource(
        requireString(input.id, "id"),
        {
          name: requireString(input.name, "name"),
          provider: "tibber",
        },
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

    case "price-get-snapshot": {
      const input = readInput<{ siteId?: string }>();
      const db = openDaemonDatabase();
      const siteId = requireString(input.siteId, "siteId");

      try {
        const snapshot = readDynamicPriceSnapshot(db, siteId);

        if (snapshot === null) {
          throw new Error(
            `No dynamic price snapshot is available yet for site ${siteId}. Wait for the daemon refresh cycle or check Tibber configuration.`,
          );
        }

        succeed(snapshot);
      } finally {
        db.close();
      }
      return;
    }

    case "price-refresh-snapshot": {
      const input = readInput<{ siteId?: string }>();
      const siteId = requireString(input.siteId, "siteId");
      const db = openDaemonDatabase();
      let previousGeneratedAt: string | null = null;

      try {
        const site = readSites(db).find((entry) => entry.id === siteId);

        if (!site) {
          throw new Error(`Managed site not found: ${siteId}`);
        }

        const source =
          readDynamicPriceSources(db).find(
            (entry) => entry.siteId === siteId,
          ) ?? null;

        if (source === null) {
          throw new Error(
            `No dynamic price source is configured for site ${siteId}.`,
          );
        }

        previousGeneratedAt =
          readDynamicPriceSnapshot(db, siteId)?.generatedAt ?? null;
      } finally {
        db.close();
      }

      requestDaemonRefresh();
      succeed(await waitForDynamicPriceRefresh(siteId, previousGeneratedAt));
      return;
    }

    default:
      throw new Error(`Unknown bridge action: ${action}`);
  }
}

function resolveManualTargetSoc(input: {
  manualState: BatteryManualState | null;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
}): number | null {
  if (input.manualState === "charging") {
    return input.manualChargeTargetSoc;
  }

  if (input.manualState === "discharging") {
    return input.manualDischargeTargetSoc;
  }

  return null;
}

function clampManualTargetSoc(
  value: number,
  state: BatteryManualState | null,
  minimumDischargePercent: number,
): number {
  const minimum = state === "discharging" ? minimumDischargePercent : 5;
  return Math.max(minimum, Math.min(100, Math.round(value)));
}

function clampNullableManualTargetSoc(
  value: number | null,
  state: BatteryManualState | null,
  minimumDischargePercent: number,
): number | null {
  if (value === null) {
    return null;
  }

  return clampManualTargetSoc(value, state, minimumDischargePercent);
}

run().catch((error) => {
  fail(error);
  process.exitCode = 1;
});
