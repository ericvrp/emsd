import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEms } from "./index";

test("price commands add, list, update, and remove site price sources", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-price-test-"));
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
      runEms(["price", "create", "entsoe", "ENTSO-E", "--site-id", "home"]),
    ).resolves.toBe(0);
    await expect(runEms(["price", "ls", "--site-id", "home"])).resolves.toBe(0);
    await expect(
      runEms([
        "price",
        "edit",
        "entsoe",
        "ENTSO-E Day Ahead",
        "--site-id",
        "home",
      ]),
    ).resolves.toBe(0);
    await expect(
      runEms(["price", "rm", "entsoe", "--site-id", "home"]),
    ).resolves.toBe(0);

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      id: "entsoe",
      provider: "tibber",
      siteId: "home",
      name: "ENTSO-E",
    });
    expect(output[2]).toContain("SOURCE ID | NAME | PROVIDER | UPDATED AT");
    expect(output[2]).toContain("entsoe | ENTSO-E | tibber |");
    expect(JSON.parse(output[3] ?? "{}")).toMatchObject({
      name: "ENTSO-E Day Ahead",
      provider: "tibber",
    });
    expect(JSON.parse(output[4] ?? "{}")).toMatchObject({
      name: "ENTSO-E Day Ahead",
      provider: "tibber",
    });
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
