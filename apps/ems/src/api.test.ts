import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardSnapshot, HistoryArchive } from "@emsd/core";
import {
  openDaemonDatabase,
  upsertDynamicPriceSnapshot,
  upsertManagedDeviceTelemetry,
  upsertWeatherForecast,
} from "../../daemon/src/database";
import { runApiAction } from "./api";
import { createBattery, createSite } from "./managed-site-store";

const originalDatabasePath = process.env.EMSD_DB_PATH;
let currentTempDir: string | null = null;

afterEach(() => {
  if (originalDatabasePath === undefined) {
    process.env.EMSD_DB_PATH = undefined;
  } else {
    process.env.EMSD_DB_PATH = originalDatabasePath;
  }

  if (currentTempDir) {
    rmSync(currentTempDir, { recursive: true, force: true });
    currentTempDir = null;
  }
});

function createTempDatabase(): string {
  currentTempDir = mkdtempSync(join(tmpdir(), "emsd-api-test-"));
  const databasePath = join(currentTempDir, "emsd.sqlite");
  process.env.EMSD_DB_PATH = databasePath;

  const db = openDaemonDatabase(databasePath);
  db.close();

  return databasePath;
}

test("api snapshot returns managed devices with telemetry", async () => {
  const databasePath = createTempDatabase();

  createSite(
    {
      id: "home",
      location: "52.367600, 4.904100",
      name: "Home",
    },
    databasePath,
  );
  createBattery(
    {
      connected: true,
      enabled: true,
      id: "battery-1",
      ipAddress: "192.168.1.10",
      minimumDischargePercent: 10,
      model: "indevolt-battery",
      name: "Battery",
      plugin: "indevolt-battery",
      status: "idle",
    },
    "home",
    databasePath,
  );

  const db = openDaemonDatabase(databasePath);

  try {
    upsertManagedDeviceTelemetry(db, {
      deviceId: "battery-1",
      kind: "battery",
      observedAt: "2026-04-09T08:30:00.000Z",
      powerW: -950,
      siteId: "home",
      socPercent: 62,
      state: "discharging",
    });
  } finally {
    db.close();
  }

  const snapshot = (await runApiAction("snapshot")) as DashboardSnapshot;

  expect(snapshot.sites).toHaveLength(1);
  expect(snapshot.sites[0]?.id).toBe("home");
  expect(snapshot.sites[0]?.devices).toHaveLength(1);
  expect(snapshot.sites[0]?.devices[0]).toMatchObject({
    id: "battery-1",
    kind: "battery",
    telemetry: {
      kind: "battery",
      powerW: -950,
      socPercent: 62,
      state: "discharging",
    },
  });
});

test("api history archive returns stored battery, price, and forecast data", async () => {
  const databasePath = createTempDatabase();

  createSite(
    {
      id: "home",
      location: "52.367600, 4.904100",
      name: "Home",
    },
    databasePath,
  );

  const db = openDaemonDatabase(databasePath);

  try {
    upsertManagedDeviceTelemetry(db, {
      deviceId: "battery-1",
      kind: "battery",
      observedAt: "2026-04-09T08:30:00.000Z",
      powerW: -950,
      siteId: "home",
      socPercent: 62,
      state: "discharging",
    });

    upsertManagedDeviceTelemetry(db, {
      deviceId: "meter-1",
      kind: "meter",
      observedAt: "2026-04-09T08:30:00.000Z",
      powerW: 420,
      siteId: "home",
      socPercent: null,
      state: null,
    });

    upsertManagedDeviceTelemetry(db, {
      deviceId: "solar-1",
      kind: "solar-energy-provider",
      observedAt: "2026-04-09T08:30:00.000Z",
      powerW: 1800,
      siteId: "home",
      socPercent: null,
      state: "connected",
    });

    upsertWeatherForecast(db, "home", {
      generatedAt: "2026-04-09T08:00:00.000Z",
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
          periodEnd: "2026-04-09T08:15:00.000Z",
          value: 410,
        },
      ],
      provider: "open-meteo",
      providerLabel: "Open-Meteo",
      sourceId: null,
      sourceName: "Open-Meteo",
      unitLabel: "W/m²",
    });

    upsertDynamicPriceSnapshot(db, "home", {
      currency: "EUR",
      generatedAt: "2026-04-09T08:00:00.000Z",
      points: [
        {
          currency: "EUR",
          importPrice: 0.31,
          startsAt: "2026-04-09T08:00:00.000Z",
        },
      ],
      provider: "tibber",
      providerLabel: "Tibber",
      siteId: "home",
      sourceId: null,
      sourceName: "Tibber",
    });
  } finally {
    db.close();
  }

  const archive = (await runApiAction("history-get-archive", {
    siteId: "home",
  })) as HistoryArchive;

  expect(archive.siteId).toBe("home");
  expect(archive.batteryPowerSamples).toHaveLength(1);
  expect(archive.p1MeterSamples).toHaveLength(1);
  expect(archive.solarEnergyProviderSamples).toHaveLength(1);
  expect(archive.solarForecastSamples).toHaveLength(1);
  expect(archive.dynamicPriceSamples).toHaveLength(1);
});
