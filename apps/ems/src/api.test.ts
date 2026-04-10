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
import { createBattery, createSite, getBattery } from "./managed-site-store";

const originalDatabasePath = process.env.EMSD_DB_PATH;
const originalFetch = globalThis.fetch;
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

  globalThis.fetch = originalFetch;
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
      capacityWh: 9600,
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
      capacityWh: 9600,
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
      capacityWh: 9600,
      deviceId: "battery-1",
      kind: "battery",
      observedAt: "2026-04-09T08:30:00.000Z",
      powerW: -950,
      siteId: "home",
      socPercent: 62,
      state: "discharging",
    });

    upsertManagedDeviceTelemetry(db, {
      capacityWh: null,
      deviceId: "meter-1",
      kind: "meter",
      observedAt: "2026-04-09T08:30:00.000Z",
      powerW: 420,
      siteId: "home",
      socPercent: null,
      state: null,
    });

    upsertManagedDeviceTelemetry(db, {
      capacityWh: null,
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
  expect(archive.batteryPowerSamples[0]).toMatchObject({
    powerW: -950,
    socPercent: 62,
  });
  expect(archive.p1MeterSamples).toHaveLength(1);
  expect(archive.solarEnergyProviderSamples).toHaveLength(1);
  expect(archive.solarForecastSamples).toHaveLength(1);
  expect(archive.dynamicPriceSamples).toHaveLength(1);
});

test("house-strategy-plan-set applies the fallback and skips earlier same-day items", async () => {
  const databasePath = createTempDatabase();
  const fetchCalls: string[] = [];
  const now = new Date();
  const morningTime = formatEarlierTodayTime(now);
  const eveningTime = formatLaterTodayTime(now);

  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      fetchCalls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );

      return new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
    {
      preconnect: originalFetch.preconnect.bind(originalFetch),
    },
  ) as typeof fetch;

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

  await runApiAction("house-strategy-plan-set", {
    siteId: "home",
    strategyPlan: [
      {
        id: "default",
        kind: "default",
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption",
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      },
      {
        id: "morning",
        kind: "daily",
        startTime: morningTime,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 40,
        manualTargetSoc: 40,
      },
      {
        id: "evening",
        kind: "daily",
        startTime: eveningTime,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: "daily-time",
        strategyMode: "manual",
        manualState: "discharging",
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 20,
        manualTargetSoc: 20,
      },
    ],
  });

  const updated = getBattery("battery-1", "home", databasePath);

  expect(fetchCalls).toHaveLength(1);
  expect(updated).not.toBeNull();
  expect(updated?.strategyMode).toBe("self-consumption");
  expect(updated?.manualModeActive).toBe(false);
  expect(
    Object.keys(updated?.strategyRuntime.lastTriggeredAtByItemId ?? {}),
  ).toEqual(["morning"]);
});

function formatEarlierTodayTime(now: Date): string {
  const value = new Date(now);

  if (value.getMinutes() > 0) {
    value.setMinutes(value.getMinutes() - 1, 0, 0);
  } else if (value.getHours() > 0) {
    value.setHours(value.getHours() - 1, 59, 0, 0);
  } else {
    value.setHours(0, 0, 0, 0);
  }

  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function formatLaterTodayTime(now: Date): string {
  const value = new Date(now);

  if (value.getMinutes() < 59) {
    value.setMinutes(value.getMinutes() + 1, 0, 0);
  } else if (value.getHours() < 23) {
    value.setHours(value.getHours() + 1, 0, 0, 0);
  } else {
    value.setHours(23, 59, 0, 0);
  }

  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
