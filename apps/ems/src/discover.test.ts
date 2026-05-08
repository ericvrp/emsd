import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import {
  buildSubnetTargets,
  discoverHostDevices,
  fetchMeterTelemetry,
  formatDiscoveredDevices,
  formatDiscoveryTarget,
  formatHelpText,
  getDiscoveryId,
  getDiscoverySignatures,
  getLocalIpv4Subnets,
  getPreferredDiscoveryTarget,
  parseDiscoverCommandOptions,
  runDiscoverCommand,
} from "./discover";

const originalFetch = globalThis.fetch;
const originalSkipPortPrecheck = process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK;

process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK = "1";

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK = "1";
});

process.on("exit", () => {
  if (originalSkipPortPrecheck === undefined) {
    delete process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK;
    return;
  }

  process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK = originalSkipPortPrecheck;
});

test("getDiscoverySignatures exposes the discovery plugin catalog", () => {
  expect(getDiscoverySignatures()).toEqual([
    {
      pluginType: "meter",
      category: "meter",
      model: "homewizard-p1",
      name: "HomeWizard P1",
      port: 80,
      schemes: ["http"],
      request: {
        path: "/api",
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
      response: {
        match: [
          '"product_type"\\s*:\\s*"HWE-P1"',
          '"api_version"\\s*:\\s*"v1"',
        ],
      },
    },
    {
      pluginType: "battery",
      category: "battery",
      model: "sonnenbatterie",
      name: "sonnenBatterie",
      port: 80,
      schemes: ["http"],
      request: {
        path: "/api/v2/status",
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
      response: {
        match: [
          '"BackupBuffer"\\s*:',
          '"OperatingMode"\\s*:',
          '"RSOC"\\s*:',
          '"SystemStatus"\\s*:',
          '"Uac"\\s*:',
        ],
      },
    },
    {
      pluginType: "battery",
      category: "battery",
      model: "indevolt-battery",
      name: "Indevolt Battery",
      port: 8080,
      schemes: ["http"],
      request: {
        path: "/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C142%2C6000%2C6001%2C6002%2C7101%5D%7D",
        method: "POST",
        headers: {
          accept: "application/json",
        },
      },
      response: {
        match: [
          '"0"\\s*:',
          '"6002"\\s*:',
          '"6001"\\s*:',
          '"Indevolt"|"1118"\\s*:',
        ],
      },
    },
    {
      pluginType: "battery",
      category: "battery",
      model: "homewizard-battery",
      name: "HomeWizard Battery",
      port: 443,
      schemes: ["https", "http"],
      request: {
        path: "/api/batteries",
        method: "GET",
      },
      response: {
        match: [
          '"battery_count"\\s*:',
          '"mode"\\s*:',
          '"permissions"\\s*:',
          '"power_w"\\s*:',
        ],
      },
    },
    {
      pluginType: "solar-energy-provider",
      category: "solar-energy-provider",
      model: "huawei-sun2000-modbus",
      name: "Huawei SUN2000",
      port: 6607,
      transport: "modbus",
    },
    {
      pluginType: "solar-energy-provider",
      category: "solar-energy-provider",
      model: "solaredge-local",
      name: "SolarEdge Inverter",
      port: 80,
      schemes: ["http"],
      request: {
        path: "/",
        method: "GET",
      },
      response: {
        match: ["SolarEdge", "SetApp"],
      },
    },
    {
      pluginType: "solar-energy-provider",
      category: "solar-energy-provider",
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      port: 80,
      schemes: ["http"],
    },
  ]);
});

test("fetchMeterTelemetry surfaces endpoint-specific connection errors", async () => {
  globalThis.fetch = (async () => {
    throw new Error("Was there a typo in the url or port?");
  }) as unknown as typeof fetch;

  await expect(fetchMeterTelemetry("127.0.0.1")).rejects.toThrow(
    "Meter telemetry request could not connect to http://127.0.0.1:80/api/v1/data",
  );
});

test("parseDiscoverCommandOptions parses verbose and host", () => {
  expect(
    parseDiscoverCommandOptions(["--verbose", "--host", "192.168.1.27"]),
  ).toEqual({
    verbose: true,
    host: "192.168.1.27",
  });
});

test("parseDiscoverCommandOptions rejects an invalid host", () => {
  expect(() =>
    parseDiscoverCommandOptions(["--host", "192.168.1.999"]),
  ).toThrow("Invalid IPv4 address for --host: 192.168.1.999");
});

test("parseDiscoverCommandOptions returns null for help", () => {
  expect(parseDiscoverCommandOptions(["--help"])).toBeNull();
  expect(parseDiscoverCommandOptions(["help"])).toBeNull();
});

test("formatHelpText documents verbose JSON mode", () => {
  expect(formatHelpText()).toContain("--verbose");
  expect(formatHelpText()).not.toContain("--all");
});

test("getLocalIpv4Subnets returns unique external IPv4 /24 prefixes", () => {
  const interfaces: Record<string, NetworkInterfaceInfo[]> = {
    en0: [
      {
        address: "192.168.1.34",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.34/24",
      },
    ],
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
    en1: [
      {
        address: "192.168.1.99",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.99/24",
      },
      {
        address: "10.0.0.15",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "10.0.0.15/24",
      },
    ],
  };

  expect(getLocalIpv4Subnets(interfaces)).toEqual(["10.0.0", "192.168.1"]);
});

test("getPreferredDiscoveryTarget prefers en0", () => {
  const interfaces: Record<string, NetworkInterfaceInfo[]> = {
    en7: [
      {
        address: "10.0.0.20",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "10.0.0.20/24",
      },
    ],
    en0: [
      {
        address: "192.168.1.34",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.34/24",
      },
    ],
  };

  expect(getPreferredDiscoveryTarget(interfaces)).toEqual({
    interfaceName: "en0",
    subnet: "192.168.1",
  });
});

test("buildSubnetTargets expands a /24 into host IPs", () => {
  const targets = buildSubnetTargets(["192.168.1"]);

  expect(targets[0]).toBe("192.168.1.1");
  expect(targets.at(-1)).toBe("192.168.1.254");
  expect(targets).toHaveLength(254);
});

test("formatDiscoveryTarget describes the subnet and interface", () => {
  expect(
    formatDiscoveryTarget({ interfaceName: "en0", subnet: "192.168.1" }),
  ).toBe("192.168.1.0/24 on interface en0");
});

test("formatDiscoveredDevices renders concise one-line summaries", () => {
  const output = formatDiscoveredDevices([
    {
      discoveryId: "bbb222",
      category: "meter",
      capacityWh: null,
      model: "homewizard-p1",
      name: "HomeWizard P1",
      ipAddress: "192.168.1.27",
      port: 80,
      details: "SMR 50",
      powerW: -16,
      socPercent: null,
      state: "connected",
    },
    {
      discoveryId: "aaa111",
      category: "battery",
      capacityWh: 4800,
      model: "indevolt-battery",
      name: "Indevolt Battery",
      ipAddress: "192.168.1.15",
      port: 8080,
      details: "SOC 48%",
      powerW: -900,
      socPercent: 48,
      state: "charging",
    },
  ]);

    expect(output).toContain("Indevolt Battery [aaa111] 192.168.1.15: SOC 48%");
  expect(output).toContain("HomeWizard P1 [bbb222] 192.168.1.27: SMR 50");
});

test("formatDiscoveredDevices renders the empty state", () => {
  expect(formatDiscoveredDevices([])).toBe(
    "No supported devices are reachable right now.",
  );
});

test("getDiscoveryId stays stable when discovery payloads include port", () => {
  expect(
    getDiscoveryId({
      category: "solar-energy-provider",
      capacityWh: null,
      details: "serial 123456789012, port 6607",
      ipAddress: "192.168.1.40",
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      port: 80,
      powerW: 2550,
      socPercent: null,
      state: "connected",
    }),
  ).toBe(
    getDiscoveryId({
      category: "solar-energy-provider",
      capacityWh: null,
      details: "serial 123456789012, port 6607",
      ipAddress: "192.168.1.40",
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      port: null,
      powerW: 2550,
      socPercent: null,
      state: "connected",
    }),
  );
});

test("discoverHostDevices enriches HomeWizard P1 matches with measurement details and discovery id", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === "http://192.168.1.27:80/api") {
      return new Response(
        JSON.stringify({
          product_name: "P1 Meter",
          product_type: "HWE-P1",
          serial: "5c2faf07b31a",
          firmware_version: "6.0206",
          api_version: "v1",
        }),
        { status: 200 },
      );
    }

    if (url === "http://192.168.1.27:80/api/v1/data") {
      return new Response(
        JSON.stringify({
          smr_version: 50,
          meter_model: "ISKRA 2M550E-1011",
          active_power_w: -16,
          total_gas_m3: 12793.849,
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const devices = await discoverHostDevices("192.168.1.27", {
      verbose: false,
      host: "192.168.1.27",
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      category: "meter",
      model: "homewizard-p1",
      name: "HomeWizard P1",
      ipAddress: "192.168.1.27",
      port: 80,
    });
    expect(devices[0]?.discoveryId).toMatch(/^[a-f0-9]{12}$/);
    expect(devices[0]?.details).toContain("SMR 50");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discoverHostDevices matches a sonnen battery from the status endpoint", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (
      url ===
      "http://192.168.1.88:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C142%2C6000%2C6001%2C6002%2C7101%5D%7D"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (url === "http://192.168.1.88:80/api") {
      return new Response("not found", { status: 404 });
    }

    if (url === "http://192.168.1.88:80/api/v2/status") {
      return new Response(
        JSON.stringify({
          Apparent_output: 96,
          BackupBuffer: "12",
          BatteryCharging: false,
          BatteryDischarging: true,
          Consumption_W: 420,
          IsSystemInstalled: 1,
          OperatingMode: "1",
          Pac_total_W: 1300,
          RSOC: 61,
          RemainingCapacity_W: 5490,
          SystemStatus: "OnGrid",
          Timestamp: "2020-03-26 17:10:06",
          Uac: 238,
          Ubat: 209,
          USOC: 12,
          dischargeNotAllowed: false,
          generator_autostart: false,
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const discoveries = await discoverHostDevices("192.168.1.88", {
      verbose: false,
      host: "192.168.1.88",
    });

    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toMatchObject({
      category: "battery",
      model: "sonnenbatterie",
      name: "sonnenBatterie",
      ipAddress: "192.168.1.88",
      port: 80,
      powerW: 1300,
      socPercent: 61,
      state: "discharging",
    });
    expect(discoveries[0]?.details).toContain("SOC 61%");
    expect(discoveries[0]?.details).toContain("mode manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discoverHostDevices includes Indevolt capacity during discovery", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (
      url ===
      "http://192.168.1.15:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C142%2C6000%2C6001%2C6002%2C7101%5D%7D"
    ) {
      return new Response(
        JSON.stringify({
          0: "serial-1",
          142: 4.8,
          1118: "1.2.3",
          6000: 900,
          6001: 1001,
          6002: 48,
          7101: 1,
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const discoveries = await discoverHostDevices("192.168.1.15", {
      verbose: false,
      host: "192.168.1.15",
    });

    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toMatchObject({
      category: "battery",
      capacityWh: 4800,
      model: "indevolt-battery",
      name: "Indevolt Battery",
      ipAddress: "192.168.1.15",
      port: 8080,
      powerW: -900,
      socPercent: 48,
      state: "charging",
    });
    expect(discoveries[0]?.details).toContain("capacity 4.8 kWh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discoverHostDevices matches an Enphase IQ Gateway from info.xml", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === "http://192.168.1.40/info.xml") {
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

    if (url === "http://192.168.1.40/api/v1/production") {
      throw new Error(`Discovery should not fetch production from ${url}`);
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const devices = await discoverHostDevices("192.168.1.40", {
      verbose: false,
      host: "192.168.1.40",
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      category: "solar-energy-provider",
      capacityWh: null,
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      ipAddress: "192.168.1.40",
      port: 80,
      powerW: null,
      state: "connected",
    });
    expect(devices[0]?.details).toContain("serial 123456789012");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discoverHostDevices reads Enphase power from production.json fallback", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === "http://192.168.1.41/info.xml") {
      return new Response(
        "<envoy_info><device><software>D8.2.4222</software><pn>IQ Gateway</pn><sn>123456789013</sn></device></envoy_info>",
        { status: 200 },
      );
    }

    if (url === "http://192.168.1.41/api/v1/production") {
      throw new Error(`Discovery should not fetch production from ${url}`);
    }

    if (url === "http://192.168.1.41/production.json?details=1") {
      throw new Error(`Discovery should not fetch production from ${url}`);
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const devices = await discoverHostDevices("192.168.1.41", {
      verbose: false,
      host: "192.168.1.41",
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      category: "solar-energy-provider",
      capacityWh: null,
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      ipAddress: "192.168.1.41",
      port: 80,
      powerW: null,
      state: "connected",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discoverHostDevices reads Enphase power from HTTPS discovery endpoints", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "http://192.168.1.42/info.xml") {
      throw new Error(`HTTP fallback should not succeed for ${url}`);
    }

    if (url === "http://192.168.1.42/api/v1/production") {
      throw new Error(`HTTP fallback should not succeed for ${url}`);
    }

    if (url === "https://192.168.1.42/info.xml") {
      expect(
        (init as RequestInit & { tls?: { rejectUnauthorized?: boolean } })?.tls,
      ).toEqual({ rejectUnauthorized: false });
      return new Response(
        "<envoy_info><device><software>D8.2.4222</software><pn>IQ Gateway</pn><sn>123456789014</sn></device></envoy_info>",
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.42/api/v1/production") {
      throw new Error(`Discovery should not fetch production from ${url}`);
    }

    if (url.startsWith("http://192.168.1.42:80/")) {
      throw new Error(`HTTP fallback should not be needed for ${url}`);
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const devices = await discoverHostDevices("192.168.1.42", {
      verbose: false,
      host: "192.168.1.42",
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      category: "solar-energy-provider",
      capacityWh: null,
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      ipAddress: "192.168.1.42",
      port: 80,
      powerW: null,
      state: "connected",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discoverHostDevices reads Enphase power through owner-auth discovery when required", async () => {
  const originalFetch = globalThis.fetch;
  const originalUsername = process.env.ENPHASE_ENLIGHTEN_USERNAME;
  const originalPassword = process.env.ENPHASE_ENLIGHTEN_PASSWORD;

  process.env.ENPHASE_ENLIGHTEN_USERNAME = "user@example.com";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "secret";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "http://192.168.1.43/info.xml") {
      throw new Error(`HTTP fallback should not succeed for ${url}`);
    }

    if (url === "http://192.168.1.43/production.json?details=1") {
      throw new Error(`HTTP fallback should not succeed for ${url}`);
    }

    if (url === "https://192.168.1.43/info.xml") {
      expect(
        (init as RequestInit & { tls?: { rejectUnauthorized?: boolean } })?.tls,
      ).toEqual({ rejectUnauthorized: false });
      return new Response(
        "<envoy_info><device><software>D8.2.4222</software><pn>IQ Gateway</pn><sn>123456789015</sn></device></envoy_info>",
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.43/production.json?details=1") {
      throw new Error(`Discovery should not fetch production from ${url}`);
    }

    if (url === "https://enlighten.enphaseenergy.com/login/login.json") {
      return new Response(JSON.stringify({ session_id: "session-1" }), {
        status: 200,
      });
    }

    if (url === "https://entrez.enphaseenergy.com/tokens") {
      return new Response("owner-token", { status: 200 });
    }

    if (url === "https://192.168.1.43/auth/check_jwt") {
      expect(
        (init as RequestInit & { tls?: { rejectUnauthorized?: boolean } })?.tls,
      ).toEqual({ rejectUnauthorized: false });
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer owner-token",
      });
      return new Response("ok", {
        headers: { "set-cookie": "sessionId=abc123; Path=/; HttpOnly" },
        status: 200,
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const devices = await discoverHostDevices("192.168.1.43", {
      verbose: false,
      host: "192.168.1.43",
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      category: "solar-energy-provider",
      capacityWh: null,
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      ipAddress: "192.168.1.43",
      port: 80,
      powerW: null,
      state: "connected",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUsername === undefined) {
      process.env.ENPHASE_ENLIGHTEN_USERNAME = undefined;
    } else {
      process.env.ENPHASE_ENLIGHTEN_USERNAME = originalUsername;
    }

    if (originalPassword === undefined) {
      process.env.ENPHASE_ENLIGHTEN_PASSWORD = undefined;
    } else {
      process.env.ENPHASE_ENLIGHTEN_PASSWORD = originalPassword;
    }
  }
});

test("discoverHostDevices matches a HomeWizard battery controller", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HOMEWIZARD_BATTERY_AUTH_TOKEN;

  process.env.HOMEWIZARD_BATTERY_AUTH_TOKEN = "hw-token";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (
      url ===
      "http://192.168.1.44:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C142%2C6000%2C6001%2C6002%2C7101%5D%7D"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (url === "http://192.168.1.44:80/api/v2/status") {
      return new Response("not found", { status: 404 });
    }

    if (url === "https://192.168.1.44:443/api/batteries") {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer hw-token",
        "X-Api-Version": "2",
        accept: "application/json",
      });

      return new Response(
        JSON.stringify({
          mode: "zero",
          permissions: ["charge_allowed", "discharge_allowed"],
          battery_count: 2,
          power_w: -404,
          target_power_w: -400,
          max_consumption_w: 1600,
          max_production_w: 800,
        }),
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.44:443/api") {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer hw-token",
        "X-Api-Version": "2",
        accept: "application/json",
      });

      return new Response(
        JSON.stringify({
          product_name: "P1 Meter",
          product_type: "HWE-P1",
          serial: "5c2fafaabbcc",
          firmware_version: "6.00",
          api_version: "2.0.0",
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const discoveries = await discoverHostDevices("192.168.1.44", {
      verbose: false,
      host: "192.168.1.44",
    });

    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toMatchObject({
      category: "battery",
      model: "homewizard-battery",
      name: "HomeWizard Battery",
      ipAddress: "192.168.1.44",
      port: 443,
      powerW: 404,
      socPercent: null,
      state: "discharging",
    });
    expect(discoveries[0]?.details).toContain("2 batteries");
    expect(discoveries[0]?.details).toContain("mode self-consumption");
  } finally {
    process.env.HOMEWIZARD_BATTERY_AUTH_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
  }
});

test("runDiscoverCommand prints concise output by default and JSON with --verbose", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === "http://192.168.1.27:80/api") {
      return new Response(
        JSON.stringify({
          product_name: "P1 Meter",
          product_type: "HWE-P1",
          serial: "5c2faf07b31a",
          firmware_version: "6.0206",
          api_version: "v1",
        }),
        { status: 200 },
      );
    }

    if (url === "http://192.168.1.27:80/api/v1/data") {
      return new Response(
        JSON.stringify({
          smr_version: 50,
          meter_model: "ISKRA 2M550E-1011",
          active_power_w: -16,
          total_gas_m3: 12793.849,
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runDiscoverCommand(["--host", "192.168.1.27"])).resolves.toBe(
      0,
    );
    await expect(
      runDiscoverCommand(["--host", "192.168.1.27", "--verbose"]),
    ).resolves.toBe(0);

    expect(output[0]).toContain("HomeWizard P1 [");

    const verboseReport = JSON.parse(output[1] ?? "{}");
    expect(verboseReport).toMatchObject({
      schema: "emsd.discover.report.v1",
      host: "192.168.1.27",
      subnet: null,
      interfaceName: null,
    });
    expect(verboseReport.devices).toHaveLength(1);
    expect(verboseReport.devices[0]?.discoveryId).toMatch(/^[a-f0-9]{12}$/);
    expect(verboseReport.devices[0]?.port).toBe(80);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("discoverHostDevices matches a Huawei SUN2000 over Modbus", async () => {
  const mock = await startHuaweiModbusServer();

  try {
    const devices = await discoverHostDevices("127.0.0.1", {
      verbose: false,
      host: "127.0.0.1",
    });

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      category: "solar-energy-provider",
      model: "huawei-sun2000-modbus",
      name: "Huawei SUN2000",
      ipAddress: "127.0.0.1",
      port: 6607,
      powerW: 2450,
      state: "connected",
    });
    expect(devices[0]?.details).toContain("model SUN2000-5KTL-L1");
    expect(devices[0]?.details).toContain("port 6607");
  } finally {
    mock.server.close();
  }
});

async function startHuaweiModbusServer() {
  let controlLimitW = 5000;
  const server = createServer((socket) => {
    socket.on("data", (data) => {
      const transactionId = data.readUInt16BE(0);
      const unitId = data.readUInt8(6);
      const functionCode = data.readUInt8(7);

      if (functionCode === 0x2b) {
        socket.write(
          buildModbusFrame(
            transactionId,
            unitId,
            Buffer.concat([
              Buffer.from([0x2b, 0x0e, 0x01, 0x01, 0x00, 0x00, 0x03]),
              encodeDeviceIdObject(0x00, "HUAWEI"),
              encodeDeviceIdObject(0x01, "SUN2000"),
              encodeDeviceIdObject(0x02, "V100R001"),
            ]),
          ),
        );
        return;
      }

      if (functionCode === 0x03) {
        const address = data.readUInt16BE(8);
        const quantity = data.readUInt16BE(10);
        const registers =
          address === 30000
            ? encodeStringRegisters("SUN2000-5KTL-L1", quantity)
            : address === 30015
              ? encodeStringRegisters("HV1234567890", quantity)
              : address === 31025
                ? encodeStringRegisters("V100R001", quantity)
                : address === 32080
                  ? encodeUint32Registers(2450)
                  : address === 30075
                    ? encodeUint32Registers(5000)
                    : address === 40126
                      ? encodeUint32Registers(controlLimitW)
                      : new Array(quantity).fill(0);
        const body = Buffer.allocUnsafe(registers.length * 2);

        for (let index = 0; index < registers.length; index += 1) {
          body.writeUInt16BE(registers[index] ?? 0, index * 2);
        }

        socket.write(
          buildModbusFrame(
            transactionId,
            unitId,
            Buffer.concat([Buffer.from([0x03, body.length]), body]),
          ),
        );
        return;
      }

      if (functionCode === 0x10) {
        const address = data.readUInt16BE(8);
        const quantity = data.readUInt16BE(10);

        if (address === 40126 && quantity === 2) {
          controlLimitW = data.readUInt32BE(13);
        }

        socket.write(
          buildModbusFrame(
            transactionId,
            unitId,
            Buffer.from([
              0x10,
              data[8] ?? 0,
              data[9] ?? 0,
              data[10] ?? 0,
              data[11] ?? 0,
            ]),
          ),
        );
      }
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(6607, "127.0.0.1", resolve),
  );
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve mock Huawei Modbus port.");
  }

  return { port: address.port, server };
}

function buildModbusFrame(
  transactionId: number,
  unitId: number,
  pdu: Buffer,
): Buffer {
  const header = Buffer.allocUnsafe(7);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(pdu.length + 1, 4);
  header.writeUInt8(unitId, 6);
  return Buffer.concat([header, pdu]);
}

function encodeDeviceIdObject(objectId: number, value: string): Buffer {
  const text = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([objectId, text.length]), text]);
}

function encodeStringRegisters(value: string, quantity: number): number[] {
  const buffer = Buffer.alloc(quantity * 2);
  Buffer.from(value, "utf8").copy(buffer, 0, 0, quantity * 2);
  const registers: number[] = [];

  for (let index = 0; index < quantity; index += 1) {
    registers.push(buffer.readUInt16BE(index * 2));
  }

  return registers;
}

function encodeUint32Registers(value: number): number[] {
  return [(value >> 16) & 0xffff, value & 0xffff];
}
