import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completeSolarEnergyProviderControlRequest,
  markSolarEnergyProviderControlRequestRunning,
  openDaemonDatabase,
  queueSolarEnergyProviderControlRequest,
  readBatteries,
  readBatteryPowerSamples,
  readDynamicPriceSamples,
  readManagedDeviceTelemetry,
  readMeters,
  readP1MeterSamples,
  readPendingSolarEnergyProviderControlRequests,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarForecastSamples,
  readWeatherForecast,
  upsertDynamicPriceSnapshot,
  upsertManagedDeviceTelemetry,
  upsertWeatherForecast,
} from "./database";

test("openDaemonDatabase creates the SQLite file and empty managed tables", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");

  const db = openDaemonDatabase(databasePath);
  const sites = readSites(db);
  const batteries = readBatteries(db);
  const meters = readMeters(db);

  db.close();

  expect(existsSync(databasePath)).toBe(true);
  expect(sites).toHaveLength(0);
  expect(batteries).toHaveLength(0);
  expect(meters).toHaveLength(0);

  rmSync(tempDir, { recursive: true, force: true });
});

test("managed device telemetry can be upserted and read back", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  upsertManagedDeviceTelemetry(db, {
    deviceId: "battery-1",
    siteId: "main-house",
    kind: "battery",
    capacityWh: 9600,
    powerW: -950,
    productionControlStatus: null,
    socPercent: 62,
    state: "discharging",
    observedAt: "2026-04-05T16:45:00.000Z",
  });

  const telemetry = readManagedDeviceTelemetry(db);

  db.close();

  expect(telemetry).toEqual([
    {
      deviceId: "battery-1",
      siteId: "main-house",
      kind: "battery",
      capacityWh: 9600,
      powerW: -950,
      productionControlStatus: null,
      socPercent: 62,
      state: null,
      observedAt: "2026-04-05T16:45:00.000Z",
    },
  ]);

  rmSync(tempDir, { recursive: true, force: true });
});

test("solar energy provider control requests can be queued and completed", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  const queued = queueSolarEnergyProviderControlRequest(db, {
    providerId: "solar-1",
    requestedAt: "2026-04-05T16:45:00.000Z",
    requestedEnabled: false,
    siteId: "main-house",
  });

  expect(readPendingSolarEnergyProviderControlRequests(db)).toEqual([queued]);

  markSolarEnergyProviderControlRequestRunning(
    db,
    queued.id,
    "2026-04-05T16:46:00.000Z",
  );

  expect(readPendingSolarEnergyProviderControlRequests(db)).toEqual([]);

  completeSolarEnergyProviderControlRequest(db, {
    message: "done",
    requestId: queued.id,
    status: "completed",
    updatedAt: "2026-04-05T16:47:00.000Z",
  });

  const completed = db
    .query<
      {
        message: string | null;
        status: string;
        updated_at: string;
      },
      [number]
    >(
      "SELECT status, message, updated_at FROM solar_energy_provider_control_requests WHERE id = ?1",
    )
    .get(queued.id);

  db.close();

  expect(completed).toEqual({
    message: "done",
    status: "completed",
    updated_at: "2026-04-05T16:47:00.000Z",
  });

  rmSync(tempDir, { recursive: true, force: true });
});

test("solar forecast snapshots can be upserted and read back", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  db.query(
    "INSERT INTO sites (id, name, location, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  ).run(
    "main-house",
    "Main House",
    "52.367600, 4.904100",
    "2026-04-07T00:00:00.000Z",
    "2026-04-07T00:00:00.000Z",
  );

  upsertWeatherForecast(db, "main-house", {
    generatedAt: "2026-04-07T11:50:00.000Z",
    hours: 48,
    location: "52.367600, 4.904100",
    metricLabel: "Solar irradiance",
    periodMinutes: 15,
    points: [
      {
        airTempC: 12.4,
        cloudOpacityPercent: 35,
        ghiWm2: 410,
        period: "PT15M",
        periodEnd: "2026-04-07T12:00:00.000Z",
        value: 410,
      },
    ],
    provider: "open-meteo",
    providerLabel: "Open-Meteo",
    sourceId: null,
    sourceName: "Open-Meteo",
    unitLabel: "W/m²",
  });

  const forecast = readWeatherForecast(db, "main-house");

  db.close();

  expect(forecast).toEqual({
    generatedAt: "2026-04-07T11:50:00.000Z",
    hours: 48,
    location: "52.367600, 4.904100",
    metricLabel: "Solar irradiance",
    periodMinutes: 15,
    points: [
      {
        airTempC: 12.4,
        cloudOpacityPercent: 35,
        ghiWm2: 410,
        period: "PT15M",
        periodEnd: "2026-04-07T12:00:00.000Z",
        value: 410,
      },
    ],
    provider: "open-meteo",
    providerLabel: "Open-Meteo",
    sourceId: null,
    sourceName: "Open-Meteo",
    unitLabel: "W/m²",
  });

  rmSync(tempDir, { recursive: true, force: true });
});

test("openDaemonDatabase adds telemetry columns for older schemas", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  db.exec("DROP TABLE device_telemetry;");
  db.exec(`
    CREATE TABLE device_telemetry (
      device_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      power_w REAL,
      soc_percent REAL,
      gas_m3 REAL,
      state TEXT,
      observed_at TEXT NOT NULL
    );
  `);
  db.close();

  const migratedDb = openDaemonDatabase(databasePath);
  const columns = migratedDb
    .query<{ name: string }, []>("PRAGMA table_info(device_telemetry)")
    .all()
    .map((column) => column.name);

  migratedDb.close();

  expect(columns).toContain("capacity_wh");
  expect(columns).toContain("production_control_status");

  rmSync(tempDir, { recursive: true, force: true });
});

test("dynamic price samples are stored per 15-minute period and trimmed to 30 days", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  upsertDynamicPriceSnapshot(db, "main-house", {
    currency: "EUR",
    generatedAt: "2026-04-07T11:50:00.000Z",
    points: [
      {
        currency: "EUR",
        importPrice: 0.31,
        startsAt: "2026-03-07T11:30:00.000Z",
      },
      {
        currency: "EUR",
        importPrice: 0.29,
        startsAt: "2026-04-07T11:45:00.000Z",
      },
    ],
    provider: "tibber",
    providerLabel: "Tibber",
    siteId: "main-house",
    sourceId: null,
    sourceName: "Tibber",
  });

  const samples = readDynamicPriceSamples(db, "main-house");

  db.close();

  expect(samples).toEqual([
    {
      siteId: "main-house",
      periodStart: "2026-04-07T11:45:00.000Z",
      generatedAt: "2026-04-07T11:50:00.000Z",
      currency: "EUR",
      importPrice: 0.29,
    },
  ]);

  rmSync(tempDir, { recursive: true, force: true });
});

test("solar forecast samples use the beginning of the forecast period", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  db.query(
    "INSERT INTO sites (id, name, location, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  ).run(
    "main-house",
    "Main House",
    "52.367600, 4.904100",
    "2026-04-07T00:00:00.000Z",
    "2026-04-07T00:00:00.000Z",
  );

  upsertWeatherForecast(db, "main-house", {
    generatedAt: "2026-04-07T11:50:00.000Z",
    hours: 48,
    location: "52.367600, 4.904100",
    metricLabel: "Solar irradiance",
    periodMinutes: 15,
    points: [
      {
        airTempC: 12.4,
        cloudOpacityPercent: 35,
        ghiWm2: 410,
        period: "PT15M",
        periodEnd: "2026-04-07T12:00:00.000Z",
        value: 410,
      },
    ],
    provider: "open-meteo",
    providerLabel: "Open-Meteo",
    sourceId: null,
    sourceName: "Open-Meteo",
    unitLabel: "W/m²",
  });

  const samples = readSolarForecastSamples(db, "main-house");

  db.close();

  expect(samples).toEqual([
    {
      siteId: "main-house",
      periodStart: "2026-04-07T11:45:00.000Z",
      generatedAt: "2026-04-07T11:50:00.000Z",
      value: 410,
      ghiWm2: 410,
      airTempC: 12.4,
      cloudOpacityPercent: 35,
    },
  ]);

  rmSync(tempDir, { recursive: true, force: true });
});

test("meter and battery samples keep the latest bucket value while solar provider samples store a 15-minute average", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  upsertManagedDeviceTelemetry(db, {
    deviceId: "meter-1",
    siteId: "main-house",
    kind: "meter",
    capacityWh: null,
    powerW: -420,
    productionControlStatus: null,
    socPercent: null,
    state: null,
    observedAt: "2026-04-05T16:46:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "meter-1",
    siteId: "main-house",
    kind: "meter",
    capacityWh: null,
    powerW: -390,
    productionControlStatus: null,
    socPercent: null,
    state: null,
    observedAt: "2026-04-05T16:59:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "battery-1",
    siteId: "main-house",
    kind: "battery",
    capacityWh: 9600,
    powerW: 950,
    productionControlStatus: null,
    socPercent: 62,
    state: "charging",
    observedAt: "2026-04-05T16:47:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "solar-provider-1",
    siteId: "main-house",
    kind: "solar-energy-provider",
    capacityWh: null,
    powerW: 2200,
    productionControlStatus: "enabled",
    socPercent: null,
    state: null,
    observedAt: "2026-04-05T16:52:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "solar-provider-1",
    siteId: "main-house",
    kind: "solar-energy-provider",
    capacityWh: null,
    powerW: 1600,
    productionControlStatus: "enabled",
    socPercent: null,
    state: null,
    observedAt: "2026-04-05T16:58:00.000Z",
  });

  const meterSamples = readP1MeterSamples(db, "main-house");
  const batterySamples = readBatteryPowerSamples(db, "main-house");
  const solarEnergyProviderSamples = readSolarEnergyProviderSamples(
    db,
    "main-house",
  );

  db.close();

  expect(meterSamples).toEqual([
    {
      siteId: "main-house",
      meterId: "meter-1",
      periodStart: "2026-04-05T16:45:00.000Z",
      observedAt: "2026-04-05T16:59:00.000Z",
      powerW: -390,
    },
  ]);
  expect(batterySamples).toEqual([
    {
      siteId: "main-house",
      batteryId: "battery-1",
      periodStart: "2026-04-05T16:45:00.000Z",
      observedAt: "2026-04-05T16:47:00.000Z",
      powerW: 950,
      socPercent: 62,
    },
  ]);
  expect(solarEnergyProviderSamples).toEqual([
    {
      siteId: "main-house",
      providerId: "solar-provider-1",
      periodStart: "2026-04-05T16:45:00.000Z",
      observedAt: "2026-04-05T16:58:00.000Z",
      powerW: 1900,
    },
  ]);

  rmSync(tempDir, { recursive: true, force: true });
});
