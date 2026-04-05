import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDaemonDatabase,
  readBatteries,
  readManagedDeviceTelemetry,
  readMeters,
  readSites,
  upsertManagedDeviceTelemetry,
} from "./database";

test("openDaemonDatabase creates the SQLite file and empty managed tables", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");

  const db = openDaemonDatabase(databasePath);
  const sites = readSites(db);
  const batteries = readBatteries(db);
  const meters = readMeters(db);

  db.close();

  expect(existsSync(databasePath)).toBe(true);
  expect(sites).toHaveLength(0);
  expect(batteries).toHaveLength(0);
  expect(meters).toHaveLength(0);

  rmSync(tempDir, { recursive: true, force: true });
});

test("managed device telemetry can be upserted and read back", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  upsertManagedDeviceTelemetry(db, {
    deviceId: "battery-1",
    siteId: "main-house",
    kind: "battery",
    powerW: -950,
    socPercent: 62,
    gasM3: null,
    state: "discharging",
    observedAt: "2026-04-05T16:45:00.000Z",
  });

  const telemetry = readManagedDeviceTelemetry(db);

  db.close();

  expect(telemetry).toEqual([
    {
      deviceId: "battery-1",
      siteId: "main-house",
      kind: "battery",
      powerW: -950,
      socPercent: 62,
      gasM3: null,
      state: "discharging",
      observedAt: "2026-04-05T16:45:00.000Z",
    },
  ]);

  rmSync(tempDir, { recursive: true, force: true });
});
