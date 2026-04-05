import { expect, test } from "bun:test";
import { formatBatteryList } from "./battery-list";

test("formatBatteryList renders the empty-state message", () => {
  expect(formatBatteryList([])).toBe(
    "No batteries found in the daemon database.",
  );
});

test("formatBatteryList renders a table row for a battery", () => {
  const output = formatBatteryList([
    {
      id: "battery-1",
      name: "Mock Battery",
      adapter: "mock-adapter",
      status: "idle",
      connected: true,
      updatedAt: "2026-04-04T12:00:00.000Z",
    },
  ]);

  expect(output).toContain("Mock Battery | idle | yes | mock-adapter");
});
