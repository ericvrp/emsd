import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEms } from "./index";

test("weather commands add, list, update, and remove site weather sources", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-weather-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runEms(["site", "add", "home", "Home"])).resolves.toBe(0);
    await expect(
      runEms(["weather", "create", "metno", "Met Norway", "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(runEms(["weather", "ls", "--site-id", "home"])).resolves.toBe(
      0,
    );
    await expect(
      runEms(["weather", "edit", "metno", "Met.no API", "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(
      runEms(["weather", "delete", "metno", "--site-id", "home"]),
    ).resolves.toBe(0);

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      id: "metno",
      siteId: "home",
      name: "Met Norway",
    });
    expect(output[2]).toContain("SOURCE ID | NAME | UPDATED AT");
    expect(output[2]).toContain("metno | Met Norway");
    expect(JSON.parse(output[3] ?? "{}")).toMatchObject({ name: "Met.no API" });
    expect(JSON.parse(output[4] ?? "{}")).toMatchObject({ name: "Met.no API" });
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
