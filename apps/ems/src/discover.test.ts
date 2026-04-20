import { afterEach, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import {
  buildSubnetTargets,
  discoverHostDevices,
  fetchMeterTelemetry,
  formatDiscoveredDevices,
  formatDiscoveryTarget,
  formatHelpText,
  getDiscoverySignatures,
  getLocalIpv4Subnets,
  getPreferredDiscoveryTarget,
  parseDiscoverCommandOptions,
  runDiscoverCommand,
} from "./discover";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("getDiscoverySignatures exposes the discovery plugin catalog", () => {
  expect(getDiscoverySignatures()).toEqual([
    {
      pluginType: "battery",
      category: "battery",
      model: "indevolt-battery",
      name: "Indevolt Battery",
      port: 8080,
      schemes: ["http"],
      request: {
        path: "/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D",
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
      pluginType: "solar-energy-provider",
      category: "solar-energy-provider",
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      port: 80,
      schemes: ["http"],
      request: {
        path: "/info.xml",
        method: "GET",
      },
      response: {
        match: ["<sn>\\d+</sn>", "<(software|pn)>"],
      },
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
  ]);
});

test("fetchMeterTelemetry surfaces endpoint-specific connection errors", async () => {
  globalThis.fetch = (async () => {
    throw new Error("Was there a typo in the url or port?");
  }) as unknown as typeof fetch;

  await expect(fetchMeterTelemetry("192.168.1.27")).rejects.toThrow(
    "Meter telemetry request could not connect to http://192.168.1.27:80/api/v1/data",
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
      model: "homewizard-p1",
      name: "HomeWizard P1",
      ipAddress: "192.168.1.27",
      details: "SMR 50",
      powerW: -16,
      socPercent: null,
      state: "connected",
    },
    {
      discoveryId: "aaa111",
      category: "battery",
      model: "indevolt-battery",
      name: "Indevolt Battery",
      ipAddress: "192.168.1.15",
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
      "http://192.168.1.88:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D"
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

test("discoverHostDevices matches an Enphase IQ Gateway from info.xml", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === "http://192.168.1.40:80/info.xml") {
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

    if (url === "http://192.168.1.40:80/api/v1/production") {
      return new Response(
        JSON.stringify({
          wattHoursLifetime: 1100000,
          wattHoursToday: 12400,
          wattsNow: 2550,
        }),
        { status: 200 },
      );
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
      model: "enphase-local",
      name: "Enphase IQ Gateway",
      ipAddress: "192.168.1.40",
      powerW: 2550,
      state: "connected",
    });
    expect(devices[0]?.details).toContain("serial 123456789012");
  } finally {
    globalThis.fetch = originalFetch;
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
      "http://192.168.1.44:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D"
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
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});
