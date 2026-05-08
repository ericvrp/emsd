import { expect, test } from "bun:test";
import type { ManagedDeviceTelemetryRecord } from "@emsd/core";
import type { SolarEnergyProviderControlRequestRecord } from "./database";
import { resolveEffectiveSolarProductionControlStatus } from "./solar-production-control";

test("resolveEffectiveSolarProductionControlStatus prefers provider-reported state", () => {
  expect(
    resolveEffectiveSolarProductionControlStatus(
      createProviderTelemetry("disabled"),
      createControlRequest(true),
    ),
  ).toBe("disabled");
});

test("resolveEffectiveSolarProductionControlStatus falls back to the latest requested state when control is unavailable", () => {
  expect(
    resolveEffectiveSolarProductionControlStatus(
      createProviderTelemetry("unavailable"),
      createControlRequest(false),
    ),
  ).toBe("disabled");
});

test("resolveEffectiveSolarProductionControlStatus defaults unsupported providers to enabled", () => {
  expect(resolveEffectiveSolarProductionControlStatus(null, null)).toBe(
    "enabled",
  );
  expect(
    resolveEffectiveSolarProductionControlStatus(
      createProviderTelemetry("unavailable"),
      null,
    ),
  ).toBe("enabled");
});

function createProviderTelemetry(
  productionControlStatus: ManagedDeviceTelemetryRecord["productionControlStatus"],
): ManagedDeviceTelemetryRecord {
  return {
    deviceId: "solar-provider-1",
    siteId: "home",
    kind: "solar-energy-provider",
    capacityWh: null,
    powerW: 1500,
    productionControlStatus,
    socPercent: null,
    state: "connected",
    observedAt: "2026-05-08T20:00:00.000Z",
  };
}

function createControlRequest(
  requestedEnabled: boolean,
): SolarEnergyProviderControlRequestRecord {
  return {
    id: 1,
    siteId: "home",
    providerId: "solar-provider-1",
    requestedEnabled,
    status: "failed",
    message: "unsupported",
    requestedAt: "2026-05-08T20:05:00.000Z",
    updatedAt: "2026-05-08T20:05:01.000Z",
  };
}
