import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverHostDevices } from "./discover";
import { runEms } from "./index";

test("battery commands require a persisted site and use it for CRUD", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-battery-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  globalThis.fetch = mockBatteryFetch();
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runEms(["site", "create", "home", "Home"])).resolves.toBe(0);

    const discoveries = await discoverHostDevices("192.168.1.15", {
      verbose: false,
      host: "192.168.1.15",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms([
        "battery",
        "create",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--host",
        "192.168.1.15",
      ]),
    ).resolves.toBe(0);
    await expect(runEms(["battery", "ls", "--site-id", "home"])).resolves.toBe(
      0,
    );

    const created = JSON.parse(output[1] ?? "{}");
    expect(created.id).toBe(discoveryId);
    expect(created.status).toBe("charging");
    expect(created.strategyMode).toBe("manual");
    expect(created.manualState).toBe("charging");
    expect(created.manualPowerW).toBe(900);
    expect(output[2]).toContain(
      "BATTERY ID | NAME | STATUS | STRATEGY | MANUAL STATE | MANUAL W | ENABLED | CONNECTED | MODEL | IP ADDRESS | UPDATED AT",
    );
    expect(output[2]).toContain(
      `${created.id} | Indevolt Battery | charging | manual | charging | 900 | yes | yes`,
    );

    await expect(
      runEms([
        "battery",
        "strategy",
        "set",
        created.id,
        "--site-id",
        "home",
        "--mode",
        "self-consumption",
      ]),
    ).resolves.toBe(0);
    await expect(
      runEms(["battery", "strategy", "get", created.id, "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(
      runEms([
        "battery",
        "strategy",
        "set",
        created.id,
        "--site-id",
        "home",
        "--mode",
        "manual",
        "--state",
        "discharging",
        "--power",
        "2400",
        "--target-soc",
        "15",
      ]),
    ).resolves.toBe(0);

    await expect(
      runEms(["battery", "disable", created.id, "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(
      runEms(["battery", "enable", created.id, "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(
      runEms(["battery", "delete", created.id, "--site-id", "home"]),
    ).resolves.toBe(0);

    const selfConsumption = JSON.parse(output[3] ?? "{}");
    const strategyGet = JSON.parse(output[4] ?? "{}");
    const manual = JSON.parse(output[5] ?? "{}");
    const disabled = JSON.parse(output[6] ?? "{}");
    const enabled = JSON.parse(output[7] ?? "{}");
    const removed = JSON.parse(output[8] ?? "{}");

    expect(selfConsumption.strategyMode).toBe("self-consumption");
    expect(strategyGet.strategyMode).toBe("self-consumption");
    expect(manual.strategyMode).toBe("manual");
    expect(manual.manualState).toBe("discharging");
    expect(manual.manualPowerW).toBe(2400);
    expect(manual.manualTargetSoc).toBe(15);
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

test("battery commands support a sonnen battery plugin", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-sonnen-battery-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalSonnenToken = process.env.SONNEN_BATTERY_AUTH_TOKEN;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  process.env.SONNEN_BATTERY_AUTH_TOKEN = "sona-token";
  globalThis.fetch = mockSonnenBatteryFetch();
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runEms(["site", "create", "home", "Home"])).resolves.toBe(0);

    const discoveries = await discoverHostDevices("192.168.1.88", {
      verbose: false,
      host: "192.168.1.88",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms([
        "battery",
        "create",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--host",
        "192.168.1.88",
      ]),
    ).resolves.toBe(0);
    await expect(
      runEms(["battery", "get", discoveryId ?? "", "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(
      runEms([
        "battery",
        "strategy",
        "set",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--mode",
        "self-consumption",
      ]),
    ).resolves.toBe(0);
    await expect(
      runEms([
        "battery",
        "strategy",
        "set",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--mode",
        "manual",
        "--state",
        "charging",
        "--power",
        "1400",
      ]),
    ).resolves.toBe(0);

    const created = JSON.parse(output[1] ?? "{}");
    const normalized = JSON.parse(output[2] ?? "{}");
    const selfConsumption = JSON.parse(output[3] ?? "{}");
    const manual = JSON.parse(output[4] ?? "{}");

    expect(created.model).toBe("sonnenbatterie");
    expect(created.status).toBe("discharging");
    expect(created.strategyMode).toBe("manual");
    expect(normalized.capacityWh).toBe(9000);
    expect(normalized.currentW).toBe(1300);
    expect(normalized.socPercent).toBe(61);
    expect(selfConsumption.strategyMode).toBe("self-consumption");
    expect(manual.strategyMode).toBe("manual");
    expect(manual.manualState).toBe("charging");
    expect(manual.manualPowerW).toBe(1400);
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    process.env.SONNEN_BATTERY_AUTH_TOKEN = originalSonnenToken;
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("battery list reports no batteries for an older battery table schema", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-battery-schema-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalLog = console.log;
  const output: string[] = [];
  const databasePath = join(tempDir, "emsd.sqlite");

  process.env.EMSD_DB_PATH = databasePath;
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

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
    CREATE TABLE batteries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plugin TEXT NOT NULL,
      model TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      connected INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.close();

  try {
    await expect(
      runEms(["battery", "list", "--site-id", "home"]),
    ).resolves.toBe(0);
    expect(output).toEqual(["No batteries configured for the selected site."]);
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("battery add requires a site id", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalLog = console.log;
  const errors: string[] = [];

  globalThis.fetch = mockBatteryFetch();
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.log = () => {};

  try {
    const discoveries = await discoverHostDevices("192.168.1.15", {
      verbose: false,
      host: "192.168.1.15",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms(["battery", "add", discoveryId ?? "", "--host", "192.168.1.15"]),
    ).resolves.toBe(1);
    expect(errors).toContain("Missing required option: --site-id <site-id>");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
  }
});

test("battery add rejects an unknown site id", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "emsd-ems-battery-unknown-site-test-"),
  );
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
        "battery",
        "add",
        discoveryId ?? "",
        "--site-id",
        "unknown-site",
        "--host",
        "192.168.1.15",
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

test("battery add reports an outdated battery table schema", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "emsd-ems-battery-write-schema-test-"),
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
    CREATE TABLE batteries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plugin TEXT NOT NULL,
      model TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      connected INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.close();

  globalThis.fetch = mockBatteryFetch();
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.log = () => {};

  try {
    const discoveries = await discoverHostDevices("192.168.1.15", {
      verbose: false,
      host: "192.168.1.15",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();
    await expect(
      runEms([
        "battery",
        "add",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--host",
        "192.168.1.15",
      ]),
    ).resolves.toBe(1);
    expect(errors).toContain(
      `Database schema is outdated at ${databasePath}: table 'batteries' is missing 'site_id'. Remove the database file and let the daemon recreate it.`,
    );
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("battery add reports when the discovery id belongs to a meter", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "emsd-ems-battery-mismatch-test-"),
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
        "battery",
        "add",
        discoveryId ?? "",
        "--site-id",
        "home",
        "--host",
        "192.168.1.27",
      ]),
    ).resolves.toBe(1);
    expect(errors).toContain(
      `Discovery id ${discoveryId} is a meter, not a battery; use 'meter add ${discoveryId}' instead`,
    );
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function mockBatteryFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);

    if (
      url ===
        "http://192.168.1.15:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D" ||
      url ===
      "http://192.168.1.15:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B142%2C6000%2C6001%2C6002%2C7101%5D%7D"
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

    if (
      url ===
        "http://192.168.1.15:8080/rpc/Indevolt.SetData?config=%7B%22f%22%3A16%2C%22t%22%3A47005%2C%22v%22%3A%5B1%5D%7D" ||
      url ===
        "http://192.168.1.15:8080/rpc/Indevolt.SetData?config=%7B%22f%22%3A16%2C%22t%22%3A47005%2C%22v%22%3A%5B4%5D%7D" ||
      url ===
        "http://192.168.1.15:8080/rpc/Indevolt.SetData?config=%7B%22f%22%3A16%2C%22t%22%3A47015%2C%22v%22%3A%5B2%5D%7D" ||
      url ===
        "http://192.168.1.15:8080/rpc/Indevolt.SetData?config=%7B%22f%22%3A16%2C%22t%22%3A47016%2C%22v%22%3A%5B2400%5D%7D" ||
      url ===
        "http://192.168.1.15:8080/rpc/Indevolt.SetData?config=%7B%22f%22%3A16%2C%22t%22%3A47017%2C%22v%22%3A%5B15%5D%7D"
    ) {
      return new Response(JSON.stringify({ result: true }), { status: 200 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}

function mockSonnenBatteryFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "http://192.168.1.88:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D") {
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

    if (url === "http://192.168.1.88/api/v2/status") {
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

    if (url === "http://192.168.1.88/api/v2/configurations") {
      expect(init?.headers).toMatchObject({
        "Auth-Token": "sona-token",
        accept: "application/json",
      });

      return new Response(JSON.stringify({ EM_OperatingMode: "2" }), {
        status: 200,
      });
    }

    if (
      url === "http://192.168.1.88/api/v2/setpoint/charge/1400" ||
      url === "http://192.168.1.88/api/v2/setpoint/charge/0"
    ) {
      expect(init?.headers).toMatchObject({
        "Auth-Token": "sona-token",
        accept: "application/json",
      });

      return new Response("true", { status: 201 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}

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
