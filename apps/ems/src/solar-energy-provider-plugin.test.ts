import { afterEach, expect, test } from "bun:test";
import type { SolarEnergyProviderRecord } from "@emsd/core";
import { getSolarEnergyProviderNormalizedInfo } from "./plugins/solar-energy-provider";

const originalFetch = globalThis.fetch;
const originalEnphaseUsername = process.env.ENPHASE_ENLIGHTEN_USERNAME;
const originalEnphasePassword = process.env.ENPHASE_ENLIGHTEN_PASSWORD;

function expectRejectedTls(init?: RequestInit) {
  expect(
    (init as RequestInit & { tls?: { rejectUnauthorized?: boolean } })?.tls,
  ).toEqual({ rejectUnauthorized: false });
}

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalEnphaseUsername === undefined) {
    process.env.ENPHASE_ENLIGHTEN_USERNAME = undefined;
  } else {
    process.env.ENPHASE_ENLIGHTEN_USERNAME = originalEnphaseUsername;
  }

  if (originalEnphasePassword === undefined) {
    process.env.ENPHASE_ENLIGHTEN_PASSWORD = undefined;
  } else {
    process.env.ENPHASE_ENLIGHTEN_PASSWORD = originalEnphasePassword;
  }
});

test("Enphase local solar energy provider fetches current production", async () => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.40/info.xml") {
      expectRejectedTls(init);

      return new Response(
        `
          <envoy_info>
            <device>
              <software>D8.2.4222</software>
              <pn>IQ Gateway</pn>
              <sn>123456789012</sn>
            </device>
          </envoy_info>
        `,
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.40/production.json?details=1") {
      expectRejectedTls(init);

      return new Response(
        JSON.stringify({
          production: [
            {
              activeCount: 20,
              type: "inverters",
              wNow: 2620,
              whLifetime: 1100000,
            },
            {
              measurementType: "production",
              type: "eim",
              wNow: 2550,
              whToday: 12400,
              whLifetime: 1098200,
            },
          ],
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  const info = await getSolarEnergyProviderNormalizedInfo(buildProvider());

  expect(info).toEqual({
    currentPowerW: 2550,
    status: "connected",
  });
});

test("Enphase local provider surfaces missing auth config instead of falling back to HTTP", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.40/info.xml") {
      expectRejectedTls(init);

      return new Response(
        `
          <envoy_info>
            <device>
              <software>D8.2.4222</software>
              <pn>IQ Gateway</pn>
              <sn>123456789012</sn>
            </device>
          </envoy_info>
        `,
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.40/production.json?details=1") {
      expectRejectedTls(init);
      return new Response("unauthorized", { status: 401 });
    }

    if (url.startsWith("http://192.168.1.40/")) {
      throw new Error(
        "HTTP fallback should not be attempted after HTTPS auth challenge",
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    getSolarEnergyProviderNormalizedInfo(buildProvider()),
  ).rejects.toThrow(
    "ENPHASE_ENLIGHTEN_USERNAME and ENPHASE_ENLIGHTEN_PASSWORD",
  );
});

test("Enphase auth bootstrap network errors include the cloud login endpoint", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "user@example.com";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "secret";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.40/info.xml") {
      expectRejectedTls(init);

      return new Response(
        `
          <envoy_info>
            <device>
              <software>D8.2.4222</software>
              <pn>IQ Gateway</pn>
              <sn>123456789012</sn>
            </device>
          </envoy_info>
        `,
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.40/production.json?details=1") {
      expectRejectedTls(init);
      return new Response("unauthorized", { status: 401 });
    }

    if (url === "https://enlighten.enphaseenergy.com/login/login.json") {
      throw new Error("Was there a typo in the url or port?");
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    getSolarEnergyProviderNormalizedInfo(buildProvider()),
  ).rejects.toThrow(
    "Enphase Enlighten login request could not connect to https://enlighten.enphaseenergy.com/login/login.json",
  );
});

test("SolarEdge local solar energy provider fetches current production", async () => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "http://192.168.1.50/web/v1/status") {
      // Simple protobuf response with powerWatt = 1500.0 (field 3, wire type 5)
      // Tag: field 3, wire type 5 => (3 << 3) | 5 = 29 (0x1D)
      // Float 1500.0 = 0x44BB8000 (little endian bytes: 0x00 0x80 0xBB 0x44)
      const bytes = new Uint8Array([0x1d, 0x00, 0x80, 0xbb, 0x44]);
      return new Response(bytes, { status: 200 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  const info = await getSolarEnergyProviderNormalizedInfo(
    buildSolarEdgeProvider(),
  );

  expect(info).toEqual({
    currentPowerW: 1500,
    status: "connected",
  });
});

function buildProvider(): SolarEnergyProviderRecord {
  return {
    id: "solar-provider-1",
    siteId: "home",
    name: "Enphase IQ Gateway",
    plugin: "enphase-local",
    ipAddress: "192.168.1.40",
    enabled: true,
    connected: true,
    serialNumber: "123456789012",
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
}

function buildSolarEdgeProvider(): SolarEnergyProviderRecord {
  return {
    id: "solar-provider-2",
    siteId: "home",
    name: "SolarEdge Inverter",
    plugin: "solaredge-local",
    ipAddress: "192.168.1.50",
    enabled: true,
    connected: true,
    serialNumber: "SE3000H-123456",
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
}
