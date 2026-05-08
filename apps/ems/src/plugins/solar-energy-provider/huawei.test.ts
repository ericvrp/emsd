import { expect, test } from "bun:test";
import type { SolarEnergyProviderRecord } from "@emsd/core";
import { getHuaweiPorts, getHuaweiUnitId } from "./huawei";

test("getHuaweiPorts tries 6607 then 502 when no port is configured", () => {
  expect(getHuaweiPorts(buildProvider(null))).toEqual([6607, 502]);
});

test("getHuaweiPorts preserves an explicit provider port", () => {
  expect(getHuaweiPorts(buildProvider(5502))).toEqual([5502]);
});

test("getHuaweiUnitId uses Huawei device id 1 on port 502", () => {
  expect(getHuaweiUnitId(502)).toBe(1);
});

test("getHuaweiUnitId uses Huawei device id 0 on port 6607", () => {
  expect(getHuaweiUnitId(6607)).toBe(0);
});

function buildProvider(port: number | null): SolarEnergyProviderRecord {
  return {
    id: "provider-1",
    siteId: "site-1",
    name: "Huawei",
    plugin: "huawei-sun2000-modbus",
    ipAddress: "127.0.0.1",
    port,
    enabled: true,
    connected: true,
    serialNumber: null,
    updatedAt: new Date(0).toISOString(),
  };
}
