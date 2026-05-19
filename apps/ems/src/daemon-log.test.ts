import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertDaemonLog, openDaemonDatabase } from "../../daemon/src/database";
import { runEms } from "./index";

test("daemon logs command lists a filtered selection", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-daemon-log-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  const db = openDaemonDatabase(process.env.EMSD_DB_PATH);
  insertDaemonLog(db, {
    level: "info",
    message: "daemon started",
    loggedAt: "2026-05-19T10:00:00.000Z",
  });
  insertDaemonLog(db, {
    level: "warn",
    message: "battery offline",
    loggedAt: "2026-05-19T10:05:00.000Z",
  });
  insertDaemonLog(db, {
    level: "error",
    message: "poll failed",
    loggedAt: "2026-05-19T10:10:00.000Z",
  });
  db.close();

  try {
    await expect(
      runEms(["daemon", "logs", "--level", "warn", "--limit", "1"]),
    ).resolves.toBe(0);

    expect(output[0]).toContain("LOGGED AT | LEVEL | MESSAGE");
    expect(output[0]).toContain(
      "2026-05-19T10:05:00.000Z | WARN | battery offline",
    );
    expect(output[0]).not.toContain("daemon started");
    expect(output[0]).not.toContain("poll failed");
  } finally {
    console.log = originalLog;
    process.env.EMSD_DB_PATH = originalDatabasePath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daemon logs command reports no logs for missing database", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-daemon-log-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "missing.sqlite");
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runEms(["daemon", "logs"])).resolves.toBe(0);

    expect(output[0]).toBe("No daemon logs found.");
  } finally {
    console.log = originalLog;
    process.env.EMSD_DB_PATH = originalDatabasePath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
