import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDaemonDatabase,
  readBatteries,
  readBatteryPowerSamples,
  readDynamicPriceSamples,
  readManagedDeviceTelemetry,
  readMeters,
  readP1MeterSamples,
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
    powerW: -950,
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
      powerW: -950,
      socPercent: 62,
      state: "discharging",
      observedAt: "2026-04-05T16:45:00.000Z",
    },
  ]);

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
    powerW: -420,
    socPercent: null,
    state: null,
    observedAt: "2026-04-05T16:46:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "meter-1",
    siteId: "main-house",
    kind: "meter",
    powerW: -390,
    socPercent: null,
    state: null,
    observedAt: "2026-04-05T16:59:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "battery-1",
    siteId: "main-house",
    kind: "battery",
    powerW: 950,
    socPercent: 62,
    state: "charging",
    observedAt: "2026-04-05T16:47:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "solar-provider-1",
    siteId: "main-house",
    kind: "solar-energy-provider",
    powerW: 2200,
    socPercent: null,
    state: null,
    observedAt: "2026-04-05T16:52:00.000Z",
  });
  upsertManagedDeviceTelemetry(db, {
    deviceId: "solar-provider-1",
    siteId: "main-house",
    kind: "solar-energy-provider",
    powerW: 1600,
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
