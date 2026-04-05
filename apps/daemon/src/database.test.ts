import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDaemonDatabase,
  readBatteries,
  readMeters,
  readSites,
} from "./database";

test("openDaemonDatabase creates the SQLite file, default site, and empty managed tables", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-daemon-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");

  const db = openDaemonDatabase(databasePath);
  const sites = readSites(db);
  const batteries = readBatteries(db);
  const meters = readMeters(db);

  db.close();

  expect(existsSync(databasePath)).toBe(true);
  expect(sites).toHaveLength(1);
  expect(batteries).toHaveLength(0);
  expect(meters).toHaveLength(0);

  rmSync(tempDir, { recursive: true, force: true });
});
