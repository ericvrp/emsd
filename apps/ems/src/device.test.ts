import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEms } from "./index";

test("device CRUD commands manage discovered devices as JSON", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-device-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(
      runEms([
        "device",
        "create",
        "--category",
        "meter",
        "--model",
        "homewizard-p1",
        "--name",
        "HomeWizard P1",
        "--ip-address",
        "192.168.1.27",
        "--details",
        "SMR 50",
      ]),
    ).resolves.toBe(0);

    const created = JSON.parse(output[0] ?? "{}");

    await expect(runEms(["device", "get", created.id])).resolves.toBe(0);
    await expect(runEms(["device", "list"])).resolves.toBe(0);
    await expect(
      runEms([
        "device",
        "update",
        created.id,
        "--details",
        "SMR 50, serial abc",
      ]),
    ).resolves.toBe(0);
    await expect(runEms(["device", "delete", created.id])).resolves.toBe(0);

    const fetched = JSON.parse(output[1] ?? "{}");
    const listed = JSON.parse(output[2] ?? "[]");
    const updated = JSON.parse(output[3] ?? "{}");
    const deleted = JSON.parse(output[4] ?? "{}");

    expect(fetched.id).toBe(created.id);
    expect(listed).toHaveLength(1);
    expect(updated.details).toBe("SMR 50, serial abc");
    expect(deleted.id).toBe(created.id);
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
