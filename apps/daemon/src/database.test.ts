import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDaemonDatabase,
  readBatteries,
  readDiscoveredDevices,
} from "./database";

test("openDaemonDatabase creates the SQLite file and empty batteries table", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");

  const db = openDaemonDatabase(databasePath);
  const batteries = readBatteries(db);

  db.close();

  expect(existsSync(databasePath)).toBe(true);
  expect(batteries).toHaveLength(0);

  rmSync(tempDir, { recursive: true, force: true });
});

test("openDaemonDatabase creates the discovered devices table", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");

  const db = openDaemonDatabase(databasePath);
  const devices = readDiscoveredDevices(db);

  db.close();

  expect(devices).toHaveLength(0);

  rmSync(tempDir, { recursive: true, force: true });
});
