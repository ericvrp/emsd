import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEms } from "./index";

test("site commands add, list, update, and remove sites", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-site-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await expect(runEms(["site", "add", "home", "Home"])).resolves.toBe(0);
    await expect(runEms(["site", "ls"])).resolves.toBe(0);
    await expect(runEms(["site", "edit", "home", "Main Home"])).resolves.toBe(
      0,
    );
    await expect(runEms(["site", "rm", "home"])).resolves.toBe(0);

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      id: "home",
      name: "Home",
    });
    expect(output[1]).toContain("SITE ID | NAME | UPDATED AT");
    expect(output[1]).toContain("home | Home");
    expect(JSON.parse(output[2] ?? "{}")).toMatchObject({
      id: "home",
      name: "Main Home",
    });
    expect(JSON.parse(output[3] ?? "{}")).toMatchObject({
      id: "home",
      name: "Main Home",
    });
  } finally {
    process.env.EMSD_DB_PATH = originalDatabasePath;
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
