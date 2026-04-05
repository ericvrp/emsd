import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverHostDevices } from "./discover";
import { runEms } from "./index";

test("battery commands add, list, disable, enable, and remove managed batteries", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-battery-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (
      url ===
      "http://192.168.1.15:8080/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D"
    ) {
      return new Response(
        JSON.stringify({
          0: "INV-BAT-123",
          1118: "1.2.3",
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
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    const discoveries = await discoverHostDevices("192.168.1.15", {
      verbose: false,
      host: "192.168.1.15",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();

    await expect(
      runEms(["battery", "add", discoveryId ?? "", "--host", "192.168.1.15"]),
    ).resolves.toBe(0);
    await expect(runEms(["battery", "list"])).resolves.toBe(0);

    const created = JSON.parse(output[0] ?? "{}");
    expect(created.status).toBe("charging");

    expect(output[1]).toContain("Indevolt Battery | charging | yes | yes");

    await expect(runEms(["battery", "disable", created.id])).resolves.toBe(0);
    await expect(runEms(["battery", "enable", created.id])).resolves.toBe(0);
    await expect(runEms(["battery", "remove", created.id])).resolves.toBe(0);

    const disabled = JSON.parse(output[2] ?? "{}");
    const enabled = JSON.parse(output[3] ?? "{}");
    const removed = JSON.parse(output[4] ?? "{}");

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
    CREATE TABLE batteries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      adapter TEXT NOT NULL,
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
    await expect(runEms(["battery", "list"])).resolves.toBe(0);
    expect(output).toEqual(["No batteries configured for the active site."]);
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
