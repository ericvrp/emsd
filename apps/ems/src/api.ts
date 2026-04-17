import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  type BatteryManualState,
  type BatteryRecord,
  type BatteryStrategyMode,
  type BatteryStrategyPlanRecord,
  type BulkDiscoveryAddResult,
  type DashboardSnapshot,
  type DynamicPriceSnapshotRecord,
  type HistoryArchive,
  type LiveStatusSnapshot,
  type ManagedDeviceRecord,
  type ManagedDeviceStatusRecord,
  type ManagedDeviceTelemetryRecord,
  type MeterRecord,
  type NormalizedBatteryInfo,
  type NormalizedSolarEnergyProviderInfo,
  type SiteRecord,
  type SolarEnergyProviderRecord,
  type WeatherForecastRecord,
  createBatteryStrategyRuntimeForPlanApply,
  getDaemonLockPath,
  normalizeBatteryStrategyPlan,
  resolveBatteryStrategyFromPlanItem,
} from "@emsd/core";
import {
  deleteWeatherForecast,
  openDaemonDatabase,
  readBatteryPowerSamples,
  readBatteryStrategyHistory,
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
import { formatBatteryStrategyStatusSummary } from "../../daemon/src/strategy-log";
import { createBatteryPlugin } from "./battery-plugins";
import {
  type DiscoveredDevice,
  discoverDevices,
  discoverHostDevices,
  getPreferredDiscoveryTarget,
} from "./discover";
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
  getSolarEnergyProvider,
  listBatteries,
  listDynamicPriceSources,
  listMeters,
  listSites,
  listSolarEnergyProviders,
  listWeatherForecastSources,
  setBatteryEnabled,
  setBatteryMinimumDischargePercent,
  setHouseStrategy,
  setHouseStrategyPlan,
  setMeterEnabled,
  updateDynamicPriceSource,
  updateSite,
  updateWeatherForecastSource,
} from "./managed-site-store";
import { getSolarEnergyProviderNormalizedInfo } from "./plugins/solar-energy-provider";

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: string;
}

function respond<T>(
  payload: ApiSuccess<T> | ApiFailure,
  outputFilePath?: string,
): void {
  const serialized = JSON.stringify(payload);

  if (outputFilePath) {
    writeFileSync(outputFilePath, serialized, "utf8");
    return;
  }

  process.stdout.write(serialized);
}

function succeed<T>(data: T, outputFilePath?: string): void {
  respond({ ok: true, data }, outputFilePath);
}

function fail(error: unknown, outputFilePath?: string): void {
  respond(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
    outputFilePath,
  );
}

function readInput<T>(raw?: string): T {
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

function readDiscoveredDevice(value: unknown): DiscoveredDevice {
  if (!isDiscoveredDevice(value)) {
    throw new Error("Invalid discovered device payload.");
  }

  return value;
}

function readDiscoveredDeviceList(value: unknown): DiscoveredDevice[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => !isDiscoveredDevice(entry))
  ) {
    throw new Error("Invalid discovered device list payload.");
  }

  return value;
}

function isDiscoveredDevice(value: unknown): value is DiscoveredDevice {
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
  now: Date,
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
        batteryStrategySummary: null,
        batteryManualTargetMethod: null,
        batteryManualTargetDurationMinutes: null,
        batteryManualTargetEndTime: null,
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
      batteryStrategySummary: formatBatteryStrategyStatusSummary(record, now),
      batteryManualTargetMethod:
        record.strategyRuntime.manualTargetMethod ?? null,
      batteryManualTargetDurationMinutes:
        record.strategyRuntime.manualTargetDurationMinutes ?? null,
      batteryManualTargetEndTime:
        record.strategyRuntime.manualTargetEndTime ?? null,
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
    batteryStrategySummary: null,
    batteryManualTargetMethod: null,
    batteryManualTargetDurationMinutes: null,
    batteryManualTargetEndTime: null,
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

function loadTelemetryByDeviceId(): Map<string, ManagedDeviceTelemetryRecord> {
  const db = openDaemonDatabase();
  const telemetry = readManagedDeviceTelemetry(db);
  db.close();

  return new Map<string, ManagedDeviceTelemetryRecord>(
    telemetry.map((entry) => [entry.deviceId, entry]),
  );
}

function buildSnapshot(): DashboardSnapshot {
  const now = new Date();
  const sites = listSites();
  const telemetryByDeviceId = loadTelemetryByDeviceId();

  return {
    generatedAt: now.toISOString(),
    sites: sites.map((site) => ({
      ...site,
      devices: [
        ...listBatteries(site.id).map((record) =>
          toManagedDeviceRecord(record, now),
        ),
        ...listMeters(site.id).map((record) =>
          toManagedDeviceRecord(record, now),
        ),
        ...listSolarEnergyProviders(site.id).map((record) =>
          toManagedDeviceRecord(record, now),
        ),
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

function buildLiveStatus(): LiveStatusSnapshot {
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

export async function runApiAction(
  action: string,
  input: Record<string, unknown> = {},
): Promise<unknown> {
  switch (action) {
    case "snapshot":
      return buildSnapshot();

    case "live-status":
      return buildLiveStatus();

    case "history-get-archive": {
      const siteId = requireString(input.siteId, "siteId");
      const db = openDaemonDatabase();

      try {
        return {
          batteryPowerSamples: readBatteryPowerSamples(db, siteId),
          batteryStrategyHistory: readBatteryStrategyHistory(db, siteId),
          dynamicPriceSamples: readDynamicPriceSamples(db, siteId),
          p1MeterSamples: readP1MeterSamples(db, siteId),
          siteId,
          solarEnergyProviderSamples: readSolarEnergyProviderSamples(
            db,
            siteId,
          ),
          solarForecastSamples: readSolarForecastSamples(db, siteId),
        };
      } finally {
        db.close();
      }
    }

    case "discover":
      return discoverForSelection(optionalString(input.host ?? null));

    case "site-create":
      return createSite({
        id: requireString(input.id, "id"),
        location: requireString(input.location, "location"),
        name: requireString(input.name, "name"),
      });

    case "site-update": {
      const site = updateSite(requireString(input.id, "id"), {
        location: requireString(input.location, "location"),
        name: requireString(input.name, "name"),
      });

      if (!site) {
        throw new Error(
          `Managed site not found: ${requireString(input.id, "id")}`,
        );
      }

      return site;
    }

    case "site-delete": {
      const site = deleteSite(requireString(input.id, "id"));

      if (!site) {
        throw new Error(
          `Managed site not found: ${requireString(input.id, "id")}`,
        );
      }

      return site;
    }

    case "battery-create": {
      const siteId = requireString(input.siteId, "siteId");
      const discovered = readDiscoveredDevice(input.device);

      if (discovered.category !== "battery") {
        throw new Error(
          `Discovery id ${discovered.discoveryId} is a ${discovered.category}, not a battery.`,
        );
      }

      return toManagedDeviceRecord(
        createManagedBatteryFromDiscovered(discovered, siteId),
        new Date(),
      );
    }

    case "battery-set-enabled": {
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

      return toManagedDeviceRecord(battery, new Date());
    }

    case "battery-set-minimum-discharge-percent": {
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

      return toManagedDeviceRecord(battery, new Date());
    }

    case "battery-delete": {
      const battery = deleteBattery(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!battery) {
        throw new Error(
          `Managed battery not found: ${requireString(input.id, "id")}`,
        );
      }

      return toManagedDeviceRecord(battery, new Date());
    }

    case "house-strategy-set": {
      const siteId = requireString(input.siteId, "siteId");
      const batteries = listBatteries(siteId);
      const firstBattery = batteries[0];

      if (!firstBattery) {
        throw new Error("No batteries found for this site");
      }

      const strategyMode =
        input.strategyMode === "manual" ||
        input.strategyMode === "self-consumption" ||
        input.strategyMode === "auto"
          ? input.strategyMode
          : firstBattery.strategyMode;
      const manualState =
        input.manualState === "idle" ||
        input.manualState === "charging" ||
        input.manualState === "discharging"
          ? input.manualState
          : input.manualState === null
            ? null
            : firstBattery.manualState;
      const manualPowerW =
        typeof input.manualPowerW === "number"
          ? input.manualPowerW
          : firstBattery.manualPowerW;
      const manualChargeTargetSoc =
        typeof input.manualChargeTargetSoc === "number"
          ? input.manualChargeTargetSoc
          : firstBattery.manualChargeTargetSoc;
      const manualDischargeTargetSoc =
        typeof input.manualDischargeTargetSoc === "number"
          ? input.manualDischargeTargetSoc
          : firstBattery.manualDischargeTargetSoc;
      const manualTargetSoc =
        typeof input.manualTargetSoc === "number"
          ? input.manualTargetSoc
          : firstBattery.manualTargetSoc;
      const manualTargetMethod =
        input.targetMethod === "soc" ||
        input.targetMethod === "duration" ||
        input.targetMethod === "end-time"
          ? input.targetMethod
          : null;
      const manualTargetDurationMinutes =
        typeof input.targetDurationMinutes === "number"
          ? input.targetDurationMinutes
          : null;
      const manualTargetEndTime =
        typeof input.targetEndTime === "string" ? input.targetEndTime : null;

      for (const battery of batteries) {
        try {
          await createBatteryPlugin(battery).setStrategy({
            manualChargeTargetSoc,
            manualDischargeTargetSoc,
            strategyMode,
            manualPowerW,
            manualState,
            manualTargetSoc,
          });
        } catch {
          // Continue with other batteries even if plugin fails
        }
      }

      const updated = setHouseStrategy(
        {
          manualChargeTargetSoc,
          manualDischargeTargetSoc,
          manualPowerW,
          manualState,
          manualTargetSoc,
          manualTargetMethod,
          manualTargetDurationMinutes,
          manualTargetEndTime,
          manualModeActive: input.manualModeActive === true,
          strategyMode,
        },
        siteId,
      );

      const now = new Date();
      return updated.map((record) => toManagedDeviceRecord(record, now));
    }

    case "house-strategy-plan-set": {
      const siteId = requireString(input.siteId, "siteId");
      const batteries = listBatteries(siteId);

      if (batteries.length === 0) {
        throw new Error("No batteries found for this site");
      }

      const strategyPlan = Array.isArray(input.strategyPlan)
        ? (input.strategyPlan as BatteryStrategyPlanRecord)
        : [];

      for (const battery of batteries) {
        const normalizedPlan = normalizeBatteryStrategyPlan({
          minimumDischargePercent: battery.minimumDischargePercent,
          strategy: {
            strategyMode: battery.strategyMode,
            manualState: battery.manualState,
            manualPowerW: battery.manualPowerW,
            manualChargeTargetSoc: battery.manualChargeTargetSoc,
            manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
            manualTargetSoc: battery.manualTargetSoc,
          },
          value: strategyPlan,
        });

        const strategy = resolveBatteryStrategyFromPlanItem({
          item: normalizedPlan[0],
          minimumDischargePercent: battery.minimumDischargePercent,
        });

        try {
          await createBatteryPlugin(battery).setStrategy(strategy);
        } catch {
          // Continue with other batteries even if plugin fails
        }
      }

      const updated = setHouseStrategyPlan(
        {
          strategyPlan,
          strategyRuntime: createBatteryStrategyRuntimeForPlanApply(
            strategyPlan,
            new Date(),
          ),
        },
        siteId,
      );

      const now = new Date();
      return updated.map((record) => toManagedDeviceRecord(record, now));
    }

    case "meter-create": {
      const siteId = requireString(input.siteId, "siteId");
      const discovered = readDiscoveredDevice(input.device);

      if (discovered.category !== "meter") {
        throw new Error(
          `Discovery id ${discovered.discoveryId} is a ${discovered.category}, not a meter.`,
        );
      }

      return toManagedDeviceRecord(
        createManagedMeterFromDiscovered(discovered, siteId),
        new Date(),
      );
    }

    case "solar-energy-provider-create": {
      const siteId = requireString(input.siteId, "siteId");
      const discovered = readDiscoveredDevice(input.device);

      if (discovered.category !== "solar-energy-provider") {
        throw new Error(
          `Discovery id ${discovered.discoveryId} is a ${discovered.category}, not a solar-energy-provider.`,
        );
      }

      return toManagedDeviceRecord(
        createManagedSolarEnergyProviderFromDiscovered(discovered, siteId),
        new Date(),
      );
    }

    case "discovery-add-all": {
      const siteId = requireString(input.siteId, "siteId");
      const discoveredDevices = readDiscoveredDeviceList(input.devices ?? []);

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

      return {
        addedBatteries,
        addedMeters,
        addedSolarEnergyProviders,
        skippedDevices,
      };
    }

    case "meter-set-enabled": {
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

      return toManagedDeviceRecord(meter, new Date());
    }

    case "meter-delete": {
      const meter = deleteMeter(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!meter) {
        throw new Error(
          `Managed meter not found: ${requireString(input.id, "id")}`,
        );
      }

      return toManagedDeviceRecord(meter, new Date());
    }

    case "solar-energy-provider-delete": {
      const provider = deleteSolarEnergyProvider(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!provider) {
        throw new Error(
          `Managed solar energy provider not found: ${requireString(input.id, "id")}`,
        );
      }

      return toManagedDeviceRecord(provider, new Date());
    }

    case "weather-create":
      return createWeatherForecastSource(
        {
          id: requireString(input.id, "id"),
          name: requireString(input.name, "name"),
          provider: "open-meteo",
          surface: "open-meteo-shortwave-radiation",
        },
        requireString(input.siteId, "siteId"),
      );

    case "weather-update": {
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

      return source;
    }

    case "weather-delete": {
      const siteId = requireString(input.siteId, "siteId");
      const source = deleteWeatherForecastSource(
        requireString(input.id, "id"),
        siteId,
      );

      if (!source) {
        throw new Error(
          `Managed solar forecast source not found: ${requireString(input.id, "id")}`,
        );
      }

      const db = openDaemonDatabase();

      try {
        deleteWeatherForecast(db, siteId);
      } finally {
        db.close();
      }

      return source;
    }

    case "weather-get-forecast": {
      const siteId = requireString(input.siteId, "siteId");
      const db = openDaemonDatabase();

      try {
        const forecast = readWeatherForecast(db, siteId);

        if (forecast === null) {
          throw new Error(
            `No solar forecast snapshot is available yet for site ${siteId}. Wait for the daemon refresh cycle or check provider configuration.`,
          );
        }

        return forecast;
      } finally {
        db.close();
      }
    }

    case "weather-refresh-forecast": {
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
      return waitForWeatherForecastRefresh(siteId, previousGeneratedAt);
    }

    case "price-create":
      return createDynamicPriceSource(
        {
          id: requireString(input.id, "id"),
          name: requireString(input.name, "name"),
          provider: "tibber",
        },
        requireString(input.siteId, "siteId"),
      );

    case "price-update": {
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

      return source;
    }

    case "price-delete": {
      const source = deleteDynamicPriceSource(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!source) {
        throw new Error(
          `Managed dynamic price source not found: ${requireString(input.id, "id")}`,
        );
      }

      return source;
    }

    case "price-get-snapshot": {
      const siteId = requireString(input.siteId, "siteId");
      const db = openDaemonDatabase();

      try {
        const snapshot = readDynamicPriceSnapshot(db, siteId);

        if (snapshot === null) {
          throw new Error(
            `No dynamic price snapshot is available yet for site ${siteId}. Wait for the daemon refresh cycle or check Tibber configuration.`,
          );
        }

        return snapshot;
      } finally {
        db.close();
      }
    }

    case "price-refresh-snapshot": {
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
      return waitForDynamicPriceRefresh(siteId, previousGeneratedAt);
    }

    case "battery-get-normalized-info": {
      const battery = getBattery(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!battery) {
        throw new Error(
          `Managed battery not found: ${requireString(input.id, "id")}`,
        );
      }

      return createBatteryPlugin(battery).getNormalizedInfo();
    }

    case "solar-energy-provider-get-normalized-info": {
      const provider = getSolarEnergyProvider(
        requireString(input.id, "id"),
        requireString(input.siteId, "siteId"),
      );

      if (!provider) {
        throw new Error(
          `Managed solar energy provider not found: ${requireString(input.id, "id")}`,
        );
      }

      return getSolarEnergyProviderNormalizedInfo(provider);
    }

    default:
      throw new Error(`Unknown API action: ${action}`);
  }
}

export async function runApiCommand(args: string[] = []): Promise<number> {
  try {
    const action = args[0];
    const outputFilePath = args[2];

    if (!action) {
      throw new Error("Missing API action.");
    }

    succeed(
      await runApiAction(action, readInput<Record<string, unknown>>(args[1])),
      outputFilePath,
    );
    return 0;
  } catch (error) {
    fail(error, args[2]);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await runApiCommand(process.argv.slice(2));
  process.exit(exitCode);
}
