import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:net";
import type { SolarEnergyProviderRecord } from "@emsd/core";
import {
  getSolarEnergyProviderNormalizedInfo,
  setSolarEnergyProviderProductionEnabled,
} from "./plugins/solar-energy-provider";

const originalFetch = globalThis.fetch;
const originalEnphaseUsername = process.env.ENPHASE_ENLIGHTEN_USERNAME;
const originalEnphasePassword = process.env.ENPHASE_ENLIGHTEN_PASSWORD;

function expectRejectedTls(init?: RequestInit) {
  expect(
    (init as RequestInit & { tls?: { rejectUnauthorized?: boolean } })?.tls,
  ).toEqual({ rejectUnauthorized: false });
}

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalEnphaseUsername === undefined) {
    process.env.ENPHASE_ENLIGHTEN_USERNAME = undefined;
  } else {
    process.env.ENPHASE_ENLIGHTEN_USERNAME = originalEnphaseUsername;
  }

  if (originalEnphasePassword === undefined) {
    process.env.ENPHASE_ENLIGHTEN_PASSWORD = undefined;
  } else {
    process.env.ENPHASE_ENLIGHTEN_PASSWORD = originalEnphasePassword;
  }
});

test("Enphase local solar energy provider fetches current production", async () => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.40/info.xml") {
      expectRejectedTls(init);

      return new Response(
        `
          <envoy_info>
            <device>
              <software>D8.2.4222</software>
              <pn>IQ Gateway</pn>
              <sn>123456789012</sn>
            </device>
          </envoy_info>
        `,
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.40/production.json?details=1") {
      expectRejectedTls(init);

      return new Response(
        JSON.stringify({
          production: [
            {
              activeCount: 20,
              type: "inverters",
              wNow: 2620,
              whLifetime: 1100000,
            },
            {
              measurementType: "production",
              type: "eim",
              wNow: 2550,
              whToday: 12400,
              whLifetime: 1098200,
            },
          ],
        }),
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.40/ivp/ss/dpel") {
      expectRejectedTls(init);
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  const info = await getSolarEnergyProviderNormalizedInfo(buildProvider());

  expect(info).toEqual({
    currentPowerW: 2550,
    productionControlStatus: "enabled",
    status: "connected",
  });
});

test("Enphase local provider maps missing production control endpoint to unavailable", async () => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.43/production.json?details=1") {
      expectRejectedTls(init);
      return new Response(
        JSON.stringify({
          production: [{ type: "inverters", wNow: 1800 }],
        }),
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.43/ivp/ss/dpel") {
      expectRejectedTls(init);
      return new Response("not found", { status: 404 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    getSolarEnergyProviderNormalizedInfo(buildProvider("192.168.1.43")),
  ).resolves.toEqual({
    currentPowerW: 1800,
    productionControlStatus: "unavailable",
    status: "connected",
  });
});

test("Enphase local provider posts updated production control payload", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "user@example.com";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "secret";
  let currentEnabled = true;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.44/ivp/ss/dpel") {
      expectRejectedTls(init);

      if (init?.method === "GET") {
        const headers = init.headers as Record<string, string> | undefined;

        if (!headers?.Authorization) {
          return new Response("unauthorized", { status: 401 });
        }

        return new Response(
          JSON.stringify({ enabled: currentEnabled, source: "local" }),
          { status: 200 },
        );
      }

      if (init?.method === "POST") {
        const headers = init.headers as Record<string, string> | undefined;

        if (!headers?.Authorization) {
          return new Response("unauthorized", { status: 401 });
        }

        expect(init?.headers).toMatchObject({
          Authorization: "Bearer owner-token",
          "content-type": "application/json",
          Cookie: "sessionId=abc123",
        });
        expect(init?.body).toBe(
          JSON.stringify({ enabled: false, source: "local" }),
        );
        currentEnabled = false;
        return new Response("ok", { status: 200 });
      }
    }

    if (url === "https://192.168.1.44/info.xml") {
      expectRejectedTls(init);
      return new Response(
        "<envoy_info><device><sn>123456789012</sn></device></envoy_info>",
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.44/production.json?details=1") {
      expectRejectedTls(init);
      return new Response(
        JSON.stringify({
          production: [{ type: "inverters", wNow: 1600 }],
        }),
        { status: 200 },
      );
    }

    if (url === "https://enlighten.enphaseenergy.com/login/login.json") {
      return new Response(JSON.stringify({ session_id: "session-1" }), {
        status: 200,
      });
    }

    if (url === "https://entrez.enphaseenergy.com/tokens") {
      return new Response("owner-token", { status: 200 });
    }

    if (url === "https://192.168.1.44/auth/check_jwt") {
      expectRejectedTls(init);
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer owner-token",
      });
      return new Response("ok", {
        headers: { "set-cookie": "sessionId=abc123; Path=/; HttpOnly" },
        status: 200,
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await setSolarEnergyProviderProductionEnabled(
    buildProvider("192.168.1.44"),
    false,
  );
});

test("Enphase local provider ignores nested dynamic PEL flags", async () => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.47/production.json?details=1") {
      expectRejectedTls(init);
      return new Response(
        JSON.stringify({
          production: [{ type: "inverters", wNow: 2100 }],
        }),
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.47/ivp/ss/dpel") {
      expectRejectedTls(init);
      return new Response(
        JSON.stringify({
          date: "2024-08-02 08:15:25",
          dynamic_pel_settings: {
            enable: false,
          },
          filename: "site_settings",
          version: "00.00.01",
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    getSolarEnergyProviderNormalizedInfo(buildProvider("192.168.1.47")),
  ).resolves.toEqual({
    currentPowerW: 2100,
    productionControlStatus: "unavailable",
    status: "connected",
  });
});

test("Enphase local provider refuses to guess writes for nested dynamic PEL payloads", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "user@example.com";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "secret";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.48/ivp/ss/dpel") {
      expectRejectedTls(init);

      if (init?.method === "GET") {
        const headers = init.headers as Record<string, string> | undefined;

        if (!headers?.Authorization) {
          return new Response("unauthorized", { status: 401 });
        }

        return new Response(
          JSON.stringify({
            date: "2024-08-02 08:15:25",
            dynamic_pel_settings: {
              enable: false,
            },
            filename: "site_settings",
            version: "00.00.01",
          }),
          { status: 200 },
        );
      }

      throw new Error("POST should not be attempted for unknown payload shape");
    }

    if (url === "https://192.168.1.48/info.xml") {
      expectRejectedTls(init);
      return new Response(
        "<envoy_info><device><sn>123456789012</sn></device></envoy_info>",
        { status: 200 },
      );
    }

    if (url === "https://enlighten.enphaseenergy.com/login/login.json") {
      return new Response(JSON.stringify({ session_id: "session-1" }), {
        status: 200,
      });
    }

    if (url === "https://entrez.enphaseenergy.com/tokens") {
      return new Response("owner-token", { status: 200 });
    }

    if (url === "https://192.168.1.48/auth/check_jwt") {
      expectRejectedTls(init);
      return new Response("ok", {
        headers: { "set-cookie": "sessionId=abc123; Path=/; HttpOnly" },
        status: 200,
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    setSolarEnergyProviderProductionEnabled(
      buildProvider("192.168.1.48"),
      true,
    ),
  ).rejects.toThrow("recognized top-level production control field");
});

test("Enphase production control auth errors explain that telemetry can still work", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "user@example.com";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "secret";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.45/ivp/ss/dpel") {
      expectRejectedTls(init);

      if (init?.method === "GET") {
        const headers = init.headers as Record<string, string> | undefined;

        if (!headers?.Authorization) {
          return new Response("unauthorized", { status: 401 });
        }

        return new Response("still unauthorized", { status: 401 });
      }
    }

    if (url === "https://192.168.1.45/info.xml") {
      expectRejectedTls(init);
      return new Response(
        "<envoy_info><device><sn>123456789012</sn></device></envoy_info>",
        { status: 200 },
      );
    }

    if (url === "https://enlighten.enphaseenergy.com/login/login.json") {
      return new Response(JSON.stringify({ session_id: "session-1" }), {
        status: 200,
      });
    }

    if (url === "https://entrez.enphaseenergy.com/tokens") {
      return new Response("owner-token", { status: 200 });
    }

    if (url === "https://192.168.1.45/auth/check_jwt") {
      expectRejectedTls(init);
      return new Response("ok", {
        headers: { "set-cookie": "sessionId=abc123; Path=/; HttpOnly" },
        status: 200,
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    setSolarEnergyProviderProductionEnabled(
      buildProvider("192.168.1.45"),
      false,
    ),
  ).rejects.toThrow("telemetry is reachable");
});

test("Enphase local provider surfaces missing auth config instead of falling back to HTTP", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.41/info.xml") {
      expectRejectedTls(init);

      return new Response(
        `
          <envoy_info>
            <device>
              <software>D8.2.4222</software>
              <pn>IQ Gateway</pn>
              <sn>123456789012</sn>
            </device>
          </envoy_info>
        `,
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.41/production.json?details=1") {
      expectRejectedTls(init);
      return new Response("unauthorized", { status: 401 });
    }

    if (url.startsWith("http://192.168.1.41/")) {
      throw new Error(
        "HTTP fallback should not be attempted after HTTPS auth challenge",
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    getSolarEnergyProviderNormalizedInfo(buildProvider("192.168.1.41")),
  ).rejects.toThrow(
    "ENPHASE_ENLIGHTEN_USERNAME and ENPHASE_ENLIGHTEN_PASSWORD",
  );
});

test("Enphase production control missing auth explains daemon and bridge env split", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.46/info.xml") {
      expectRejectedTls(init);
      return new Response(
        "<envoy_info><device><sn>123456789012</sn></device></envoy_info>",
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.46/ivp/ss/dpel") {
      expectRejectedTls(init);
      return new Response("unauthorized", { status: 401 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    setSolarEnergyProviderProductionEnabled(
      buildProvider("192.168.1.46"),
      false,
    ),
  ).rejects.toThrow("EMS bridge process");
});

test("Enphase auth bootstrap network errors include the cloud login endpoint", async () => {
  process.env.ENPHASE_ENLIGHTEN_USERNAME = "user@example.com";
  process.env.ENPHASE_ENLIGHTEN_PASSWORD = "secret";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "https://192.168.1.42/info.xml") {
      expectRejectedTls(init);

      return new Response(
        `
          <envoy_info>
            <device>
              <software>D8.2.4222</software>
              <pn>IQ Gateway</pn>
              <sn>123456789012</sn>
            </device>
          </envoy_info>
        `,
        { status: 200 },
      );
    }

    if (url === "https://192.168.1.42/production.json?details=1") {
      expectRejectedTls(init);
      return new Response("unauthorized", { status: 401 });
    }

    if (url === "https://enlighten.enphaseenergy.com/login/login.json") {
      throw new Error("Was there a typo in the url or port?");
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  await expect(
    getSolarEnergyProviderNormalizedInfo(buildProvider("192.168.1.42")),
  ).rejects.toThrow(
    "Enphase Enlighten login request could not connect to https://enlighten.enphaseenergy.com/login/login.json",
  );
});

test("SolarEdge local solar energy provider fetches current production", async () => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    if (url === "http://192.168.1.50/web/v1/status") {
      // Simple protobuf response with powerWatt = 1500.0 (field 3, wire type 5)
      // Tag: field 3, wire type 5 => (3 << 3) | 5 = 29 (0x1D)
      // Float 1500.0 = 0x44BB8000 (little endian bytes: 0x00 0x80 0xBB 0x44)
      const bytes = new Uint8Array([0x1d, 0x00, 0x80, 0xbb, 0x44]);
      return new Response(bytes, { status: 200 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  const info = await getSolarEnergyProviderNormalizedInfo(
    buildSolarEdgeProvider(),
  );

  expect(info).toEqual({
    currentPowerW: 1500,
    productionControlStatus: "unavailable",
    status: "connected",
  });
});

test("Huawei SUN2000 Modbus provider reads production and control state", async () => {
  const mock = await startHuaweiModbusServer();

  try {
    await expect(
      getSolarEnergyProviderNormalizedInfo(buildHuaweiProvider(mock.port)),
    ).resolves.toEqual({
      currentPowerW: 2450,
      productionControlStatus: "enabled",
      status: "connected",
    });
  } finally {
    mock.server.close();
  }
});

test("Huawei SUN2000 Modbus provider writes fixed power derate for disable", async () => {
  const mock = await startHuaweiModbusServer();

  try {
    await expect(
      setSolarEnergyProviderProductionEnabled(
        buildHuaweiProvider(mock.port),
        false,
      ),
    ).resolves.toEqual({
      currentPowerW: 2450,
      productionControlStatus: "disabled",
      status: "connected",
    });
    expect(mock.getControlLimit()).toBe(0);
  } finally {
    mock.server.close();
  }
});

function buildProvider(ipAddress = "192.168.1.40"): SolarEnergyProviderRecord {
  return {
    id: "solar-provider-1",
    siteId: "home",
    name: "Enphase IQ Gateway",
    plugin: "enphase-local",
    ipAddress,
    port: null,
    enabled: true,
    connected: true,
    serialNumber: "123456789012",
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
}

function buildSolarEdgeProvider(): SolarEnergyProviderRecord {
  return {
    id: "solar-provider-2",
    siteId: "home",
    name: "SolarEdge Inverter",
    plugin: "solaredge-local",
    ipAddress: "192.168.1.50",
    port: null,
    enabled: true,
    connected: true,
    serialNumber: "SE3000H-123456",
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
}

function buildHuaweiProvider(port: number): SolarEnergyProviderRecord {
  return {
    id: "solar-provider-3",
    siteId: "home",
    name: "Huawei SUN2000",
    plugin: "huawei-sun2000-modbus",
    ipAddress: "127.0.0.1",
    port,
    enabled: true,
    connected: true,
    serialNumber: "HV1234567890",
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
}

async function startHuaweiModbusServer({
  expectedUnitId = 0,
  ignoreFirstRequest = false,
}: {
  expectedUnitId?: number;
  ignoreFirstRequest?: boolean;
} = {}) {
  let controlLimitW = 5000;
  let requestCount = 0;
  const server = createServer((socket) => {
    socket.on("data", (data) => {
      requestCount += 1;

      if (ignoreFirstRequest && requestCount === 1) {
        return;
      }

      const transactionId = data.readUInt16BE(0);
      const unitId = data.readUInt8(6);
      const functionCode = data.readUInt8(7);

      if (unitId !== expectedUnitId) {
        return;
      }

      if (functionCode === 0x2b) {
        socket.write(
          buildModbusFrame(
            transactionId,
            unitId,
            Buffer.concat([
              Buffer.from([0x2b, 0x0e, 0x01, 0x01, 0x00, 0x00, 0x03]),
              encodeDeviceIdObject(0x00, "HUAWEI"),
              encodeDeviceIdObject(0x01, "SUN2000"),
              encodeDeviceIdObject(0x02, "V100R001"),
            ]),
          ),
        );
        return;
      }

      if (functionCode === 0x03) {
        const address = data.readUInt16BE(8);
        const quantity = data.readUInt16BE(10);
        const registers =
          address === 30000
            ? encodeStringRegisters("SUN2000-5KTL-L1", quantity)
            : address === 30015
              ? encodeStringRegisters("HV1234567890", quantity)
              : address === 31025
                ? encodeStringRegisters("V100R001", quantity)
                : address === 32080
                  ? encodeInt32Registers(2450)
                  : address === 30075
                    ? encodeUint32Registers(5000)
                    : address === 40126
                      ? encodeUint32Registers(controlLimitW)
                      : new Array(quantity).fill(0);
        const body = Buffer.allocUnsafe(registers.length * 2);

        for (let index = 0; index < registers.length; index += 1) {
          body.writeUInt16BE(registers[index] ?? 0, index * 2);
        }

        socket.write(
          buildModbusFrame(
            transactionId,
            unitId,
            Buffer.concat([Buffer.from([0x03, body.length]), body]),
          ),
        );
        return;
      }

      if (functionCode === 0x10) {
        const address = data.readUInt16BE(8);
        const quantity = data.readUInt16BE(10);

        if (address === 40126 && quantity === 2) {
          controlLimitW = data.readUInt32BE(13);
        }

        socket.write(
          buildModbusFrame(
            transactionId,
            unitId,
            Buffer.from([
              0x10,
              data[8] ?? 0,
              data[9] ?? 0,
              data[10] ?? 0,
              data[11] ?? 0,
            ]),
          ),
        );
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve mock Huawei Modbus port.");
  }

  return {
    server,
    port: address.port,
    getControlLimit: () => controlLimitW,
  };
}

function buildModbusFrame(
  transactionId: number,
  unitId: number,
  pdu: Buffer,
): Buffer {
  const header = Buffer.allocUnsafe(7);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(pdu.length + 1, 4);
  header.writeUInt8(unitId, 6);
  return Buffer.concat([header, pdu]);
}

function encodeDeviceIdObject(objectId: number, value: string): Buffer {
  const text = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([objectId, text.length]), text]);
}

function encodeStringRegisters(value: string, quantity: number): number[] {
  const buffer = Buffer.alloc(quantity * 2);
  Buffer.from(value, "utf8").copy(buffer, 0, 0, quantity * 2);
  const registers: number[] = [];

  for (let index = 0; index < quantity; index += 1) {
    registers.push(buffer.readUInt16BE(index * 2));
  }

  return registers;
}

function encodeUint32Registers(value: number): number[] {
  return [(value >> 16) & 0xffff, value & 0xffff];
}

function encodeInt32Registers(value: number): number[] {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeInt32BE(value, 0);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
}
