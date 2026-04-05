import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSubnetTargets,
  discoverDevices,
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

test("parseDiscoverCommandOptions enables verbose mode", () => {
  expect(parseDiscoverCommandOptions(["--verbose"])).toEqual({
    verbose: true,
    host: null,
    all: false,
  });
});

test("parseDiscoverCommandOptions accepts a single host", () => {
  expect(parseDiscoverCommandOptions(["--host", "192.168.1.27"])).toEqual({
    verbose: false,
    host: "192.168.1.27",
    all: false,
  });
});

test("parseDiscoverCommandOptions enables all output", () => {
  expect(parseDiscoverCommandOptions(["--all"])).toEqual({
    verbose: false,
    host: null,
    all: true,
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

test("formatHelpText describes verbose discovery output", () => {
  expect(formatHelpText()).toContain("--verbose");
  expect(formatHelpText()).toContain("--all");
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
      {
        address: "fe80::1",
        netmask: "ffff:ffff:ffff:ffff::",
        family: "IPv6",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "fe80::1/64",
        scopeid: 0,
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
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "192.168.1.99/24",
      },
      {
        address: "10.0.0.12",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "10.0.0.12/24",
      },
    ],
  };

  expect(getLocalIpv4Subnets(interfaces)).toEqual(["10.0.0", "192.168.1"]);
});

test("getPreferredDiscoveryTarget prefers en0 when it has a valid IPv4 address", () => {
  const interfaces: Record<string, NetworkInterfaceInfo[]> = {
    en1: [
      {
        address: "10.0.0.12",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "10.0.0.12/24",
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

test("getPreferredDiscoveryTarget falls back when en0 has no valid IPv4 address", () => {
  const interfaces: Record<string, NetworkInterfaceInfo[]> = {
    en0: [
      {
        address: "fe80::1",
        netmask: "ffff:ffff:ffff:ffff::",
        family: "IPv6",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "fe80::1/64",
        scopeid: 0,
      },
    ],
    en1: [
      {
        address: "192.168.50.20",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "192.168.50.20/24",
      },
    ],
  };

  expect(getPreferredDiscoveryTarget(interfaces)).toEqual({
    interfaceName: "en1",
    subnet: "192.168.50",
  });
});

test("buildSubnetTargets expands each subnet to host addresses", () => {
  const targets = buildSubnetTargets(["192.168.50"]);

  expect(targets).toHaveLength(254);
  expect(targets[0]).toBe("192.168.50.1");
  expect(targets[253]).toBe("192.168.50.254");
});

test("formatDiscoveryTarget includes subnet and interface", () => {
  expect(
    formatDiscoveryTarget({ interfaceName: "en0", subnet: "192.168.1" }),
  ).toBe("192.168.1.0/24 on interface en0");
});

test("formatDiscoveredDevices renders sorted discovered devices", () => {
  const output = formatDiscoveredDevices([
    {
      category: "meter",
      model: "homewizard-p1",
      name: "HomeWizard P1",
      ipAddress: "192.168.1.120",
      details: "SMR 5.0, serial abc",
    },
    {
      category: "meter",
      model: "homewizard-p1",
      name: "HomeWizard P1",
      ipAddress: "192.168.1.12",
      details: "SMR 5.0, serial def",
    },
  ]);

  expect(output).toContain("TYPE | NAME | IP ADDRESS | DETAILS");
  expect(output.indexOf("192.168.1.12")).toBeLessThan(
    output.indexOf("192.168.1.120"),
  );
});

test("formatDiscoveredDevices renders a generic empty state", () => {
  expect(formatDiscoveredDevices([])).toBe("No supported devices found.");
});

test("discoverDevices enriches HomeWizard P1 matches with measurement details", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);

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

    throw new Error("unreachable");
  }) as typeof fetch;

  try {
    await expect(
      discoverDevices(["192.168.1"], {
        verbose: false,
        host: null,
        all: false,
      }),
    ).resolves.toEqual([
      {
        category: "meter",
        model: "homewizard-p1",
        name: "HomeWizard P1",
        ipAddress: "192.168.1.27",
        details:
          "SMR 50, meter ISKRA 2M550E-1011, power -16 W, gas 12793.849 m3, firmware 6.0206, serial 5c2faf07b31a",
      },
    ]);
    expect(requestedUrls.filter((url) => url.includes("192.168.1.27"))).toEqual(
      [
        "http://192.168.1.27:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D",
        "http://192.168.1.27:80/api",
        "http://192.168.1.27:80/api/v1/data",
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discoverDevices detects Indevolt batteries over HTTP OpenData", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);

    if (
      url ===
      "http://192.168.1.232:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D"
    ) {
      return new Response(
        JSON.stringify({
          0: "IVT-232",
          1118: "PG2000Series EMS V1406.07.002E",
          6000: -850,
          6001: 1002,
          6002: 74,
          7101: 4,
        }),
        { status: 200 },
      );
    }

    throw new Error("unreachable");
  }) as typeof fetch;

  try {
    await expect(
      discoverDevices(["192.168.1"], {
        verbose: false,
        host: null,
        all: false,
      }),
    ).resolves.toContainEqual({
      category: "battery",
      model: "indevolt-battery",
      name: "Indevolt Battery",
      ipAddress: "192.168.1.232",
      details:
        "SOC 74%, power -850 W, state discharging, mode real-time control, EMS firmware PG2000Series EMS V1406.07.002E, serial IVT-232",
    });
    expect(requestedUrls).toContain(
      "http://192.168.1.232:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runDiscoverCommand shows detailed verbose probe failures for a host", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const output: string[] = [];
  const errors: string[] = [];
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-discover-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");

  globalThis.fetch = (async () => {
    throw new TypeError("connect ECONNREFUSED 192.168.1.27:80");
  }) as unknown as typeof fetch;

  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  try {
    await expect(
      runDiscoverCommand(["--host", "192.168.1.27", "--verbose"]),
    ).resolves.toBe(0);

    expect(errors).toContain(
      "Probing http://192.168.1.27:80/api for homewizard-p1...",
    );
    expect(errors).toContain(
      "Request failed for http://192.168.1.27:80/api: TypeError: connect ECONNREFUSED 192.168.1.27:80",
    );
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      schema: "emsd.discover.report.v1",
      filter: "new",
      host: "192.168.1.27",
      devices: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    process.env.EMSD_DB_PATH = originalDatabasePath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runDiscoverCommand defaults to reporting only newly discovered devices and supports --all", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-discover-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");

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

    throw new Error("unreachable");
  }) as typeof fetch;

  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runDiscoverCommand(["--host", "192.168.1.27"])).resolves.toBe(
      0,
    );
    await expect(runDiscoverCommand(["--host", "192.168.1.27"])).resolves.toBe(
      0,
    );
    await expect(
      runDiscoverCommand(["--host", "192.168.1.27", "--all"]),
    ).resolves.toBe(0);

    const firstReport = JSON.parse(output[0] ?? "{}");
    const secondReport = JSON.parse(output[1] ?? "{}");
    const thirdReport = JSON.parse(output[2] ?? "{}");

    expect(firstReport.filter).toBe("new");
    expect(firstReport.devices).toHaveLength(1);
    expect(firstReport.devices[0]?.isNew).toBe(true);
    expect(secondReport.filter).toBe("new");
    expect(secondReport.devices).toHaveLength(0);
    expect(thirdReport.filter).toBe("all");
    expect(thirdReport.devices).toHaveLength(1);
    expect(thirdReport.devices[0]?.isNew).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    process.env.EMSD_DB_PATH = originalDatabasePath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
