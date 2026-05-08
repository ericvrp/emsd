import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverHostDevices } from "./discover";
import { runEms } from "./index";

const originalSkipPortPrecheck = process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK;

process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK = "1";

process.on("exit", () => {
  process.env.EMSD_SKIP_DISCOVERY_PORT_PRECHECK = originalSkipPortPrecheck;
});

test("meter commands require a persisted site and use it for CRUD", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-meter-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  globalThis.fetch = mockMeterFetch();
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runEms(["site", "create", "home", "Home"])).resolves.toBe(0);

    const discoveries = await discoverHostDevices("192.168.1.27", {
      verbose: false,
      host: "192.168.1.27",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms([
        "meter",
        "create",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--host",
        "192.168.1.27",
      ]),
    ).resolves.toBe(0);
    await expect(runEms(["meter", "ls", "--site-id", "home"])).resolves.toBe(0);

    const created = JSON.parse(output[1] ?? "{}");
    expect(created.id).toBe(discoveryId);
    expect(created.model).toBe("homewizard-p1");
    expect(output[2]).toContain(
      "DISCOVERY ID | NAME | ENABLED | CONNECTED | MODEL | IP ADDRESS | DETAILS | UPDATED AT",
    );
    expect(output[2]).toContain(
      `${created.id} | HomeWizard P1 | yes | yes | homewizard-p1`,
    );

    await expect(
      runEms(["meter", "disable", created.id, "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(
      runEms(["meter", "enable", created.id, "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(
      runEms(["meter", "delete", created.id, "--site-id", "home"]),
    ).resolves.toBe(0);

    const disabled = JSON.parse(output[3] ?? "{}");
    const enabled = JSON.parse(output[4] ?? "{}");
    const removed = JSON.parse(output[5] ?? "{}");

    expect(disabled.enabled).toBe(false);
    expect(enabled.enabled).toBe(true);
    expect(removed.id).toBe(created.id);
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("meter add requires a site id", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalLog = console.log;
  const errors: string[] = [];

  globalThis.fetch = mockMeterFetch();
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.log = () => {};

  try {
    const discoveries = await discoverHostDevices("192.168.1.27", {
      verbose: false,
      host: "192.168.1.27",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms(["meter", "add", discoveryId ?? "", "--host", "192.168.1.27"]),
    ).resolves.toBe(1);
    expect(errors).toContain("Missing required option: --site-id <site-id>");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
  }
});

test("meter add rejects an unknown site id", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "emsd-ems-meter-unknown-site-test-"),
  );
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalLog = console.log;
  const errors: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  globalThis.fetch = mockMeterFetch();
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.log = () => {};

  try {
    await expect(runEms(["site", "add", "home", "Home"])).resolves.toBe(0);
    const discoveries = await discoverHostDevices("192.168.1.27", {
      verbose: false,
      host: "192.168.1.27",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms([
        "meter",
        "add",
        discoveryId ?? "",
        "--site-id",
        "unknown-site",
        "--host",
        "192.168.1.27",
      ]),
    ).resolves.toBe(1);
    expect(errors).toContain(
      "Unknown site id: unknown-site. Known site ids: home",
    );
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("meter add reports when the discovery id belongs to a battery", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-meter-mismatch-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalLog = console.log;
  const errors: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  globalThis.fetch = mockBatteryFetch();
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.log = () => {};

  try {
    await expect(runEms(["site", "add", "home", "Home"])).resolves.toBe(0);
    const discoveries = await discoverHostDevices("192.168.1.15", {
      verbose: false,
      host: "192.168.1.15",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms([
        "meter",
        "add",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--host",
        "192.168.1.15",
      ]),
    ).resolves.toBe(1);
    expect(errors).toContain(
      `Discovery id ${discoveryId} is a battery, not a meter; use 'battery add ${discoveryId}' instead`,
    );
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("meter add reports an outdated meter table schema", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "emsd-ems-meter-write-schema-test-"),
  );
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalLog = console.log;
  const databasePath = join(tempDir, "emsd.sqlite");
  const errors: string[] = [];

  process.env.EMSD_DB_PATH = databasePath;

  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO sites (id, name, location, created_at, updated_at)
    VALUES ('home', 'Home', '52.367600, 4.904100', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
    CREATE TABLE meters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      connected INTEGER NOT NULL,
      details TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.close();

  globalThis.fetch = mockMeterFetch();
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.log = () => {};

  try {
    const discoveries = await discoverHostDevices("192.168.1.27", {
      verbose: false,
      host: "192.168.1.27",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms([
        "meter",
        "add",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--host",
        "192.168.1.27",
      ]),
    ).resolves.toBe(1);
    expect(errors).toContain(
      `Database schema is outdated at ${databasePath}: table 'meters' is missing 'site_id'. Remove the database file and let the daemon recreate it.`,
    );
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function mockMeterFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
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
}

function mockBatteryFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);

    if (
      url ===
      "http://192.168.1.15:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C142%2C6000%2C6001%2C6002%2C7101%5D%7D"
    ) {
      return new Response(
        JSON.stringify({
          0: "INV-BAT-123",
          1118: "1.2.3",
          142: 4.8,
          6000: 900,
          6001: 1001,
          6002: 48,
          7101: 4,
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}
