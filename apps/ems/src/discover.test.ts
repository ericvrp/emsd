import { expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import {
  buildSubnetTargets,
  discoverHostDevices,
  formatDiscoveredDevices,
  formatDiscoveryTarget,
  formatHelpText,
  getDiscoverySignatures,
  getLocalIpv4Subnets,
  getPreferredDiscoveryTarget,
  parseDiscoverCommandOptions,
  runDiscoverCommand,
} from "./discover";

test("getDiscoverySignatures exposes the JSON discovery catalog", () => {
  expect(getDiscoverySignatures()).toEqual([
    {
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
  ]);
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
      powerW: 900,
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
