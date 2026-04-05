import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverHostDevices } from "./discover";
import { runEms } from "./index";

test("meter commands add, list, disable, enable, and remove managed meters", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-meter-test-"));
  const originalDatabasePath = process.env.EMSD_DB_PATH;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  process.env.EMSD_DB_PATH = join(tempDir, "emsd.sqlite");
  globalThis.fetch = (async (input: string | URL | Request) => {
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
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    const discoveries = await discoverHostDevices("192.168.1.27", {
      verbose: false,
      host: "192.168.1.27",
    });
    const discoveryId = discoveries[0]?.discoveryId;

    expect(discoveryId).toBeTruthy();

    await expect(
      runEms(["meter", "add", discoveryId ?? "", "--host", "192.168.1.27"]),
    ).resolves.toBe(0);
    await expect(runEms(["meter", "list"])).resolves.toBe(0);

    const created = JSON.parse(output[0] ?? "{}");
    expect(created.model).toBe("homewizard-p1");

    expect(output[1]).toContain("HomeWizard P1 | yes | yes | homewizard-p1");

    await expect(runEms(["meter", "disable", created.id])).resolves.toBe(0);
    await expect(runEms(["meter", "enable", created.id])).resolves.toBe(0);
    await expect(runEms(["meter", "remove", created.id])).resolves.toBe(0);

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
