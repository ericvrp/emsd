import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardSnapshot, HistoryArchive } from "@emsd/core";
import {
  BatteryStrategyTriggerKind,
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  applySolarSeriesSmoothing,
  buildPredictedSolarGenerationSeries,
} from "@emsd/core";
import {
  openDaemonDatabase,
  readBatteryStrategyHistory,
  upsertBatteryStrategyHistoryState,
  upsertDynamicPriceSnapshot,
  upsertManagedDeviceTelemetry,
  upsertWeatherForecast,
} from "../../daemon/src/database";
import { runApiAction } from "./api";
import {
  SINGLE_BATTERY_LIMIT_ERROR,
  createBattery,
  createSite,
  getBattery,
} from "./managed-site-store";

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
    upsertBatteryStrategyHistoryState(db, {
      activeItemId: null,
      batteryId: "battery-1",
      displayLabel: "Self-consumption",
      displayState: "self-consumption",
      endedAt: null,
      manualState: null,
      observedAt: "2026-04-09T08:30:00.000Z",
      siteId: "home",
      source: "automatic",
      startedAt: "2026-04-09T08:25:00.000Z",
      strategyMode: "self-consumption",
    });
  } finally {
    db.close();
  }

  const snapshot = (await runApiAction("snapshot")) as DashboardSnapshot;

  expect(snapshot.sites).toHaveLength(1);
  expect(snapshot.sites[0]?.id).toBe("home");
  expect(snapshot.sites[0]?.devices).toHaveLength(1);
  expect(snapshot.sites[0]?.devices[0]).toMatchObject({
    batteryStrategySummary: "Self-consumption",
    id: "battery-1",
    kind: "battery",
    maximumChargePowerW: 800,
    maximumDischargePowerW: 800,
    state: "charging",
    telemetry: {
      capacityWh: 9600,
      kind: "battery",
      powerW: -950,
      socPercent: 62,
      state: null,
    },
  });
});

test("battery-set-power-limits persists battery-level charge and discharge caps", async () => {
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

  const updated = (await runApiAction("battery-set-power-limits", {
    id: "battery-1",
    maximumChargePowerW: 1200,
    maximumDischargePowerW: 1800,
    siteId: "home",
  })) as DashboardSnapshot["sites"][number]["devices"][number];

  expect(updated).toMatchObject({
    id: "battery-1",
    kind: "battery",
    maximumChargePowerW: 1200,
    maximumDischargePowerW: 1800,
  });
  expect(getBattery("battery-1", "home", databasePath)).toMatchObject({
    maximumChargePowerW: 1200,
    maximumDischargePowerW: 1800,
  });
});

test("only one battery can be created for a site", () => {
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
      name: "Battery 1",
      plugin: "indevolt-battery",
      status: "idle",
    },
    "home",
    databasePath,
  );

  expect(() =>
    createBattery(
      {
        connected: true,
        enabled: true,
        id: "battery-2",
        ipAddress: "192.168.1.11",
        minimumDischargePercent: 10,
        model: "indevolt-battery",
        name: "Battery 2",
        plugin: "indevolt-battery",
        status: "idle",
      },
      "home",
      databasePath,
    ),
  ).toThrow(SINGLE_BATTERY_LIMIT_ERROR);
});

test("discovery add all rejects selecting multiple new batteries", async () => {
  createTempDatabase();

  createSite({
    id: "home",
    location: "52.367600, 4.904100",
    name: "Home",
  });

  await expect(
    runApiAction("discovery-add-all", {
      devices: [
        {
          category: "battery",
          details: "status charging power 800W",
          discoveryId: "battery-1",
          ipAddress: "192.168.1.10",
          model: "indevolt-battery",
          name: "Battery 1",
          powerW: 800,
          socPercent: 60,
          state: "charging",
        },
        {
          category: "battery",
          details: "status idle power 0W",
          discoveryId: "battery-2",
          ipAddress: "192.168.1.11",
          model: "indevolt-battery",
          name: "Battery 2",
          powerW: 0,
          socPercent: 65,
          state: "idle",
        },
      ],
      siteId: "home",
    }),
  ).rejects.toThrow(SINGLE_BATTERY_LIMIT_ERROR);
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
    upsertBatteryStrategyHistoryState(db, {
      activeItemId: null,
      batteryId: "battery-1",
      displayLabel: "Self-consumption",
      displayState: "self-consumption",
      endedAt: null,
      manualState: null,
      observedAt: "2026-04-09T08:30:00.000Z",
      siteId: "home",
      source: "automatic",
      startedAt: "2026-04-09T08:25:00.000Z",
      strategyMode: "self-consumption",
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
    day: "2026-04-09",
    siteId: "home",
  })) as HistoryArchive;

  expect(archive.siteId).toBe("home");
  expect(archive.batteryPowerSamples).toHaveLength(1);
  expect(archive.batteryPowerSamples[0]).toMatchObject({
    powerW: -950,
    socPercent: 62,
  });
  expect(archive.batteryStrategyHistory).toHaveLength(1);
  expect(archive.batteryStrategyHistory[0]).toMatchObject({
    displayLabel: "Self-consumption",
    source: "automatic",
  });
  expect(archive.p1MeterSamples).toHaveLength(1);
  expect(archive.selectedDayKey).toBe("2026-04-09");
  expect(archive.selectedDaySiteLoadSamples).toHaveLength(96);
  expect(archive.selectedDayExpectedSiteLoadSamples).toHaveLength(96);
  expect(archive.solarEnergyProviderSamples).toHaveLength(1);
  expect(archive.solarForecastSamples).toHaveLength(1);
  expect(archive.dynamicPriceSamples).toHaveLength(1);
});

test("house-strategy-set persists manual target method metadata", async () => {
  const databasePath = createTempDatabase();

  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
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

  await runApiAction("house-strategy-set", {
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 10,
    manualModeActive: true,
    manualPowerW: 2400,
    manualState: "discharging",
    manualTargetSoc: 10,
    siteId: "home",
    strategyMode: "manual",
    targetDurationMinutes: 6,
    targetEndTime: null,
    targetMethod: "duration",
  });

  const updated = getBattery("battery-1", "home", databasePath);

  expect(updated?.strategyRuntime.manualTargetMethod).toBe("duration");
  expect(updated?.strategyRuntime.manualTargetDurationMinutes).toBe(6);
  expect(updated?.strategyRuntime.manualTargetEndTime).toBeNull();
  expect(updated?.strategyRuntime.manualTargetStartedAt).toEqual(
    expect.any(String),
  );

  const snapshot = (await runApiAction("snapshot")) as DashboardSnapshot;
  const device = snapshot.sites[0]?.devices[0];

  expect(device?.batteryManualTargetMethod).toBe("duration");
  expect(device?.batteryManualTargetDurationMinutes).toBe(6);
  expect(device?.batteryManualTargetEndTime).toBeNull();

  const db = openDaemonDatabase(databasePath);

  try {
    expect(readBatteryStrategyHistory(db, "home")).toEqual([
      expect.objectContaining({
        activeItemId: null,
        batteryId: "battery-1",
        displayLabel: "Discharge",
        displayState: "discharge",
        source: "manual",
        strategyMode: "manual",
      }),
    ]);
  } finally {
    db.close();
  }
});

test("house-strategy-set supports auto manual discharge targets", async () => {
  const databasePath = createTempDatabase();

  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
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

  await runApiAction("house-strategy-set", {
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualModeActive: true,
    manualPowerW: 2400,
    manualState: "discharging",
    manualTargetSoc: null,
    siteId: "home",
    strategyMode: "manual",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
  });

  const updated = getBattery("battery-1", "home", databasePath);

  expect(updated?.strategyRuntime.manualTargetMethod).toBe("auto");
  expect(updated?.strategyRuntime.manualTargetDurationMinutes).toBeNull();
  expect(updated?.strategyRuntime.manualTargetEndTime).toBeNull();
  expect(updated?.strategyRuntime.activeTargetSocPercent).toBe(10);
  expect(updated?.manualDischargeTargetSoc).toBe(10);
  expect(updated?.manualTargetSoc).toBe(10);

  const snapshot = (await runApiAction("snapshot")) as DashboardSnapshot;
  const device = snapshot.sites[0]?.devices[0];

  expect(device?.batteryManualTargetMethod).toBe("auto");
});

test("house-strategy-set preserves manual target metadata for self-consumption", async () => {
  const databasePath = createTempDatabase();

  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
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
      minimumDischargePercent: 11,
      model: "indevolt-battery",
      name: "Battery",
      plugin: "indevolt-battery",
      status: "idle",
      strategyMode: "manual",
      manualState: "discharging",
      manualPowerW: 2400,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: 25,
      manualTargetSoc: 25,
    },
    "home",
    databasePath,
  );

  await runApiAction("house-strategy-set", {
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 25,
    manualModeActive: true,
    manualPowerW: null,
    manualState: null,
    manualTargetSoc: 55,
    siteId: "home",
    strategyMode: "self-consumption",
    targetDurationMinutes: 6,
    targetEndTime: null,
    targetMethod: "duration",
  });

  const updated = getBattery("battery-1", "home", databasePath);

  expect(updated?.strategyMode).toBe("self-consumption");
  expect(updated?.manualState).toBeNull();
  expect(updated?.manualPowerW).toBeNull();
  expect(updated?.manualChargeTargetSoc).toBe(100);
  expect(updated?.manualDischargeTargetSoc).toBe(11);
  expect(updated?.manualTargetSoc).toBe(55);
  expect(updated?.manualModeStarted).toBe(true);
  expect(updated?.strategyRuntime.manualTargetMethod).toBe("duration");
  expect(updated?.strategyRuntime.manualTargetDurationMinutes).toBe(6);
  expect(updated?.strategyRuntime.manualTargetEndTime).toBeNull();

  const snapshot = (await runApiAction("snapshot")) as DashboardSnapshot;
  const device = snapshot.sites[0]?.devices[0];

  expect(device?.batteryManualTargetMethod).toBe("duration");
  expect(device?.batteryManualTargetDurationMinutes).toBe(6);
  expect(device?.batteryManualTargetEndTime).toBeNull();
});

test("house-strategy-set preserves manual target metadata for idle", async () => {
  const databasePath = createTempDatabase();

  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
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
      minimumDischargePercent: 11,
      model: "indevolt-battery",
      name: "Battery",
      plugin: "indevolt-battery",
      status: "idle",
    },
    "home",
    databasePath,
  );

  await runApiAction("house-strategy-set", {
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: 11,
    manualModeActive: true,
    manualPowerW: null,
    manualState: "idle",
    manualTargetSoc: 35,
    siteId: "home",
    strategyMode: "manual",
    targetDurationMinutes: null,
    targetEndTime: "13:30",
    targetMethod: "end-time",
  });

  const updated = getBattery("battery-1", "home", databasePath);

  expect(updated?.strategyMode).toBe("manual");
  expect(updated?.manualState).toBe("idle");
  expect(updated?.manualPowerW).toBeNull();
  expect(updated?.manualChargeTargetSoc).toBe(100);
  expect(updated?.manualDischargeTargetSoc).toBe(11);
  expect(updated?.manualTargetSoc).toBe(35);
  expect(updated?.manualModeStarted).toBe(true);
  expect(updated?.strategyRuntime.manualTargetMethod).toBe("end-time");
  expect(updated?.strategyRuntime.manualTargetDurationMinutes).toBeNull();
  expect(updated?.strategyRuntime.manualTargetEndTime).toBe("13:30");

  const snapshot = (await runApiAction("snapshot")) as DashboardSnapshot;
  const device = snapshot.sites[0]?.devices[0];

  expect(device?.batteryManualTargetMethod).toBe("end-time");
  expect(device?.batteryManualTargetDurationMinutes).toBeNull();
  expect(device?.batteryManualTargetEndTime).toBe("13:30");
});

test("history-get-archive applies default prediction smoothing server-side", async () => {
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
          ghiWm2: 200,
          period: "PT15M",
          periodEnd: "2026-04-08T10:15:00.000Z",
          value: 200,
        },
        {
          airTempC: 13.1,
          cloudOpacityPercent: 30,
          ghiWm2: 300,
          period: "PT15M",
          periodEnd: "2026-04-08T10:30:00.000Z",
          value: 300,
        },
        {
          airTempC: 13.7,
          cloudOpacityPercent: 25,
          ghiWm2: 400,
          period: "PT15M",
          periodEnd: "2026-04-08T10:45:00.000Z",
          value: 400,
        },
        {
          airTempC: 14.2,
          cloudOpacityPercent: 20,
          ghiWm2: 200,
          period: "PT15M",
          periodEnd: "2026-04-09T10:15:00.000Z",
          value: 200,
        },
        {
          airTempC: 14.8,
          cloudOpacityPercent: 18,
          ghiWm2: 300,
          period: "PT15M",
          periodEnd: "2026-04-09T10:30:00.000Z",
          value: 300,
        },
        {
          airTempC: 15.1,
          cloudOpacityPercent: 15,
          ghiWm2: 400,
          period: "PT15M",
          periodEnd: "2026-04-09T10:45:00.000Z",
          value: 400,
        },
      ],
      provider: "open-meteo",
      providerLabel: "Open-Meteo",
      sourceId: null,
      sourceName: "Open-Meteo",
      unitLabel: "W/m²",
    });

    upsertManagedDeviceTelemetry(db, {
      capacityWh: null,
      deviceId: "solar-1",
      kind: "solar-energy-provider",
      observedAt: "2026-04-08T10:00:00.000Z",
      powerW: 100,
      siteId: "home",
      socPercent: null,
      state: "connected",
    });
    upsertManagedDeviceTelemetry(db, {
      capacityWh: null,
      deviceId: "solar-1",
      kind: "solar-energy-provider",
      observedAt: "2026-04-08T10:15:00.000Z",
      powerW: 300,
      siteId: "home",
      socPercent: null,
      state: "connected",
    });
    upsertManagedDeviceTelemetry(db, {
      capacityWh: null,
      deviceId: "solar-1",
      kind: "solar-energy-provider",
      observedAt: "2026-04-08T10:30:00.000Z",
      powerW: 200,
      siteId: "home",
      socPercent: null,
      state: "connected",
    });
  } finally {
    db.close();
  }

  const archive = (await runApiAction("history-get-archive", {
    day: "2026-04-09",
    siteId: "home",
  })) as HistoryArchive;

  const expected = applySolarSeriesSmoothing(
    buildPredictedSolarGenerationSeries({
      forecastSamples: archive.solarForecastSamples,
      solarEnergyProviderSamples: archive.solarEnergyProviderSamples,
    }),
    DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  );

  expect(archive.solarPredictionAlgorithmVersion).toBe("v2");
  expect(archive.solarPredictedGeneration).toEqual(expected);
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

  const db = openDaemonDatabase(databasePath);

  try {
    expect(readBatteryStrategyHistory(db, "home")).toEqual([
      expect.objectContaining({
        activeItemId: null,
        batteryId: "battery-1",
        displayLabel: "Self-consumption",
        displayState: "self-consumption",
        source: "automatic",
        strategyMode: "self-consumption",
      }),
    ]);
  } finally {
    db.close();
  }
});

test("house-strategy-plan-set accepts low and high price triggers", async () => {
  const databasePath = createTempDatabase();

  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    {
      preconnect: originalFetch.preconnect.bind(originalFetch),
    },
  ) as typeof fetch;

  createSite(
    {
      id: "home",
      location: "52.3676,4.9041",
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
        enabled: false,
        id: "cheap",
        kind: "daily",
        startTime: "08:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
        strategyMode: "manual",
        manualState: "charging",
        manualPowerW: 2400,
        manualChargeTargetSoc: 90,
        manualDischargeTargetSoc: null,
        manualTargetSoc: 90,
      },
      {
        enabled: true,
        id: "expensive",
        kind: "daily",
        startTime: "08:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc",
        triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
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

  expect(updated?.strategyPlan[1]?.triggerKind).toBe(
    BatteryStrategyTriggerKind.ExportSurplus,
  );
  expect(updated?.strategyPlan[1]?.enabled).toBe(true);
  expect(updated?.strategyPlan[2]?.triggerKind).toBe(
    BatteryStrategyTriggerKind.DelayedCharging,
  );
  expect(updated?.strategyPlan[2]?.enabled).toBe(false);
});

test("house-strategy-plan-set marks past same-day export-surplus markers as already triggered", async () => {
  const databasePath = createTempDatabase();

  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    {
      preconnect: originalFetch.preconnect.bind(originalFetch),
    },
  ) as typeof fetch;

  await withFrozenDate("2026-04-18T10:30:00.000Z", async () => {
    createSite(
      {
        id: "home",
        location: "52.3676,4.9041",
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
      upsertDynamicPriceSnapshot(db, "home", {
        currency: "EUR",
        generatedAt: "2026-04-18T09:50:00.000Z",
        points: [
          {
            currency: "EUR",
            importPrice: 0.1,
            startsAt: "2026-04-18T06:00:00.000Z",
          },
          {
            currency: "EUR",
            importPrice: 0.4,
            startsAt: "2026-04-18T10:00:00.000Z",
          },
          {
            currency: "EUR",
            importPrice: 0.1,
            startsAt: "2026-04-18T14:00:00.000Z",
          },
          {
            currency: "EUR",
            importPrice: 0.1,
            startsAt: "2026-04-18T18:00:00.000Z",
          },
          {
            currency: "EUR",
            importPrice: 0.5,
            startsAt: "2026-04-18T21:00:00.000Z",
          },
          {
            currency: "EUR",
            importPrice: 0.1,
            startsAt: "2026-04-18T23:00:00.000Z",
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

    await runApiAction("house-strategy-plan-set", {
      siteId: "home",
      strategyPlan: [
        {
          enabled: true,
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
          enabled: true,
          id: "expensive",
          kind: "daily",
          startTime: "08:00",
          targetDurationMinutes: null,
          targetEndTime: null,
          targetMethod: "soc",
          triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
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

    expect(updated?.strategyRuntime.lastTriggeredAtByItemId.expensive).toBe(
      "2026-04-18T10:00:00.000Z",
    );
  });
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

async function withFrozenDate<T>(
  isoString: string,
  run: () => Promise<T>,
): Promise<T> {
  const RealDate = Date;
  const frozenTime = new RealDate(isoString).getTime();

  class FrozenDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value === undefined ? frozenTime : value);
    }

    static now(): number {
      return frozenTime;
    }
  }

  globalThis.Date = FrozenDate as DateConstructor;

  try {
    return await run();
  } finally {
    globalThis.Date = RealDate;
  }
}
