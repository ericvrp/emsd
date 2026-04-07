import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDaemonDatabase,
  readBatteries,
  readWeatherForecast,
  readManagedDeviceTelemetry,
  readMeters,
  readSites,
  upsertWeatherForecast,
  upsertManagedDeviceTelemetry,
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
    gasM3: null,
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
      gasM3: null,
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
