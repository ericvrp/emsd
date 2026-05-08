import { afterEach, expect, test } from "bun:test";
import type { BatteryRecord } from "@emsd/core";
import { createBatteryPlugin } from "./battery-plugins";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Indevolt battery connection errors include the telemetry endpoint", async () => {
  globalThis.fetch = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;

  await expect(
    createBatteryPlugin(buildBattery()).getNormalizedInfo(),
  ).rejects.toThrow(
    "Battery telemetry request could not connect to http://192.168.1.232:8080/rpc/Indevolt.GetData",
  );

  await expect(
    createBatteryPlugin(buildBattery()).getNormalizedInfo(),
  ).rejects.toThrow(
    "Check that the device is reachable on the LAN and that the protocol and port are correct.",
  );
});

test("Indevolt battery normalization signs discharge power from state code", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        142: 4.8,
        6000: 900,
        6001: 1002,
        6002: 48,
        7101: 4,
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  await expect(
    createBatteryPlugin(buildBattery()).getNormalizedInfo(),
  ).resolves.toMatchObject({
    capacityWh: 4800,
    currentW: 900,
    socPercent: 48,
    status: "discharging",
    strategyMode: "manual",
  });
});

test("Indevolt battery telemetry falls back to degraded polling after capacity timeout", async () => {
  const requestedUrls: string[] = [];
  const battery = buildBattery({ ipAddress: "192.168.1.236" });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("142%2C6000%2C6001%2C6002%2C7101")) {
      throw new Error("Request timed out");
    }

    return new Response(
      JSON.stringify({
        6000: 350,
        6001: 1002,
        6002: 72,
        7101: 1,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  await expect(
    createBatteryPlugin(battery).getNormalizedInfo(),
  ).resolves.toMatchObject({
    capacityWh: null,
    currentW: 350,
    socPercent: 72,
    status: "discharging",
    strategyMode: "self-consumption",
  });

  expect(requestedUrls).toEqual([
    "http://192.168.1.236:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B142%2C6000%2C6001%2C6002%2C7101%5D%7D",
    "http://192.168.1.236:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B6000%2C6001%2C6002%2C7101%5D%7D",
  ]);
});

test("Indevolt battery telemetry fails when degraded polling also times out", async () => {
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    throw new Error("Request timed out");
  }) as unknown as typeof fetch;

  await expect(
    createBatteryPlugin(
      buildBattery({ ipAddress: "192.168.1.234" }),
    ).getNormalizedInfo(),
  ).rejects.toThrow("Battery telemetry request timed out");

  expect(requestedUrls).toEqual([
    "http://192.168.1.234:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B142%2C6000%2C6001%2C6002%2C7101%5D%7D",
    "http://192.168.1.234:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B6000%2C6001%2C6002%2C7101%5D%7D",
  ]);
});

test("Indevolt battery telemetry reuses cached capacity after degraded timeout fallback", async () => {
  const battery = buildBattery({ ipAddress: "192.168.1.235" });
  let requestCount = 0;

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestCount += 1;
    const url = String(input);

    if (requestCount === 1) {
      return new Response(
        JSON.stringify({
          142: 6,
          6000: 350,
          6001: 1002,
          6002: 72,
          7101: 1,
        }),
        { status: 200 },
      );
    }

    if (url.includes("142%2C6000%2C6001%2C6002%2C7101")) {
      throw new Error("Request timed out");
    }

    return new Response(
      JSON.stringify({
        6000: 250,
        6001: 1002,
        6002: 68,
        7101: 1,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  await expect(
    createBatteryPlugin(battery).getNormalizedInfo(),
  ).resolves.toMatchObject({
    capacityWh: 6000,
    currentW: 350,
    socPercent: 72,
  });

  await expect(
    createBatteryPlugin(battery).getNormalizedInfo(),
  ).resolves.toMatchObject({
    capacityWh: 6000,
    currentW: 250,
    socPercent: 68,
  });
});

test("Indevolt battery telemetry reuses cached capacity when payload omits it", async () => {
  let requestCount = 0;
  const battery = buildBattery({ ipAddress: "192.168.1.233" });

  globalThis.fetch = (async () => {
    requestCount += 1;

    return new Response(
      JSON.stringify({
        ...(requestCount === 1 ? { 142: 6 } : {}),
        6000: requestCount === 1 ? 350 : 250,
        6001: 1002,
        6002: requestCount === 1 ? 72 : 68,
        7101: 1,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  await expect(
    createBatteryPlugin(battery).getNormalizedInfo(),
  ).resolves.toMatchObject({
    capacityWh: 6000,
    currentW: 350,
    socPercent: 72,
  });

  await expect(
    createBatteryPlugin(battery).getNormalizedInfo(),
  ).resolves.toMatchObject({
    capacityWh: 6000,
    currentW: 250,
    socPercent: 68,
  });
});

function buildBattery(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  return {
    id: "battery-1",
    siteId: "home",
    name: "Indevolt Battery",
    plugin: "indevolt-battery",
    model: "Indevolt Battery",
    ipAddress: "192.168.1.232",
    maximumChargePowerW: 800,
    maximumDischargePowerW: 800,
    enabled: true,
    status: "idle",
    connected: true,
    minimumDischargePercent: 10,
    strategyMode: "self-consumption",
    manualPowerW: null,
    manualState: null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: null,
    manualModeActive: false,
    manualModeStarted: false,
    strategyPlan: [],
    strategyRuntime: {
      activeItemId: null,
      activeStartedAt: null,
      activeObservedAt: null,
      activeStartSocPercent: null,
      lastTriggeredAtByItemId: {},
    },
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...overrides,
  };
}
