import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderProductionControlStatus,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import type { DiscoveryPlugin } from "../types";
import {
  ModbusPermissionError,
  type ModbusTcpClient,
  decodeInt32Registers,
  decodeStringRegisters,
  decodeUint32Registers,
  withModbusClient,
} from "./huawei-modbus";

const HUAWEI_DISCOVERY_MODEL = "huawei-sun2000-modbus";
const HUAWEI_DISCOVERY_NAME = "Huawei SUN2000";
const HUAWEI_DEFAULT_PORT = 6607;
const HUAWEI_FALLBACK_PORT = 502;
const HUAWEI_DEFAULT_ENABLE_LIMIT_W = 10_000;
const HUAWEI_MODEL_REGISTER = 30000;
const HUAWEI_SERIAL_REGISTER = 30015;
const HUAWEI_FIRMWARE_REGISTER = 31025;
const HUAWEI_ACTIVE_POWER_REGISTER = 32080;
const HUAWEI_MAX_ACTIVE_POWER_REGISTER = 30075;
const HUAWEI_FIXED_POWER_LIMIT_REGISTER = 40126;

interface HuaweiSnapshot {
  connectionPort: number;
  currentPowerW: number | null;
  firmwareVersion: string | null;
  modelName: string | null;
  productionControlStatus: SolarEnergyProviderProductionControlStatus;
  serialNumber: string | null;
  status: "connected" | "offline";
}

export class HuaweiSun2000SolarEnergyProviderPlugin {
  constructor(private readonly provider: SolarEnergyProviderRecord) {}

  async getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo> {
    const snapshot = await readHuaweiSnapshot(this.provider).catch((error) => {
      console.warn(
        `Huawei provider query failed for ${this.provider.id}: ${error}`,
      );

      return {
        currentPowerW: null,
        firmwareVersion: null,
        modelName: null,
        productionControlStatus: "unavailable" as const,
        serialNumber: this.provider.serialNumber,
        status: "offline" as const,
      };
    });

    return {
      currentPowerW: snapshot.currentPowerW,
      productionControlStatus: snapshot.productionControlStatus,
      status: snapshot.status,
    };
  }

  async setProductionEnabled(
    enabled: boolean,
  ): Promise<NormalizedSolarEnergyProviderInfo> {
    await setHuaweiProductionEnabled(this.provider, enabled);
    return this.getNormalizedInfo();
  }
}

export const huaweiSolarEnergyProviderDiscoveryPlugins: DiscoveryPlugin[] = [
  createHuaweiDiscoveryPlugin(HUAWEI_DEFAULT_PORT),
  createHuaweiDiscoveryPlugin(HUAWEI_FALLBACK_PORT),
];

function createHuaweiDiscoveryPlugin(port: number): DiscoveryPlugin {
  return {
    pluginType: "solar-energy-provider",
    category: "solar-energy-provider",
    model: HUAWEI_DISCOVERY_MODEL,
    name: HUAWEI_DISCOVERY_NAME,
    port,
    transport: "modbus",
    async probe({ ipAddress }) {
      const snapshot = await readHuaweiSnapshot(
        buildDiscoveryProvider(ipAddress, port),
      ).catch(() => null);

      if (!snapshot?.modelName && !snapshot?.serialNumber) {
        return null;
      }

      const details: string[] = [];

      if (snapshot.modelName) {
        details.push(`model ${snapshot.modelName}`);
      }

      if (snapshot.serialNumber) {
        details.push(`serial ${snapshot.serialNumber}`);
      }

      if (snapshot.firmwareVersion) {
        details.push(`firmware ${snapshot.firmwareVersion}`);
      }

      if (snapshot.currentPowerW !== null) {
        details.push(`power ${Math.round(snapshot.currentPowerW)} W`);
      }

      details.push(`port ${snapshot.connectionPort}`);

      return {
        category: "solar-energy-provider",
        capacityWh: null,
        details: details.join(", "),
        ipAddress,
        model: HUAWEI_DISCOVERY_MODEL,
        name: HUAWEI_DISCOVERY_NAME,
        port: snapshot.connectionPort,
        powerW: snapshot.currentPowerW,
        socPercent: null,
        state: "connected",
      };
    },
  };
}

async function readHuaweiSnapshot(
  provider: SolarEnergyProviderRecord,
): Promise<HuaweiSnapshot> {
  let lastError: unknown = null;

  for (const port of getHuaweiPorts(provider)) {
    try {
      return await withModbusClient(
        getConnectionOptions(provider, port),
        async (client) => {
          const modelRegisters = await client.readHoldingRegisters(
            HUAWEI_MODEL_REGISTER,
            15,
          );
          const serialRegisters = await client.readHoldingRegisters(
            HUAWEI_SERIAL_REGISTER,
            10,
          );
          const firmwareRegisters = await client.readHoldingRegisters(
            HUAWEI_FIRMWARE_REGISTER,
            15,
          );
          const powerRegisters = await client.readHoldingRegisters(
            HUAWEI_ACTIVE_POWER_REGISTER,
            2,
          );
          const currentPowerW = decodeInt32Registers(powerRegisters);
          const productionControlStatus =
            await readProductionControlStatus(client);

          return {
            connectionPort: port,
            currentPowerW,
            firmwareVersion: decodeStringRegisters(firmwareRegisters),
            modelName: decodeStringRegisters(modelRegisters),
            productionControlStatus,
            serialNumber:
              decodeStringRegisters(serialRegisters) ??
              provider.serialNumber ??
              null,
            status: "connected",
          };
        },
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function readProductionControlStatus(
  client: ModbusTcpClient,
): Promise<SolarEnergyProviderProductionControlStatus> {
  try {
    const limitRegisters = await client.readHoldingRegisters(
      HUAWEI_FIXED_POWER_LIMIT_REGISTER,
      2,
    );
    const effectiveLimitW = decodeUint32Registers(limitRegisters);
    return effectiveLimitW === 0 ? "disabled" : "enabled";
  } catch (error) {
    if (error instanceof ModbusPermissionError) {
      return "unavailable";
    }

    throw error;
  }
}

async function setHuaweiProductionEnabled(
  provider: SolarEnergyProviderRecord,
  enabled: boolean,
): Promise<void> {
  let lastError: unknown = null;

  for (const port of getHuaweiPorts(provider)) {
    try {
      await withModbusClient(
        getConnectionOptions(provider, port),
        async (client) => {
          const pmaxRegisters = enabled
            ? await client
                .readHoldingRegisters(HUAWEI_MAX_ACTIVE_POWER_REGISTER, 2)
                .catch(() => null)
            : null;
          const fallbackLimit =
            pmaxRegisters !== null
              ? decodeUint32Registers(pmaxRegisters)
              : HUAWEI_DEFAULT_ENABLE_LIMIT_W;
          const targetPowerW = enabled ? Math.max(fallbackLimit, 1) : 0;

          try {
            await client.writeMultipleRegisters(
              HUAWEI_FIXED_POWER_LIMIT_REGISTER,
              [(targetPowerW >> 16) & 0xffff, targetPowerW & 0xffff],
            );
          } catch (error) {
            if (error instanceof ModbusPermissionError) {
              throw new Error(
                `Huawei production control permission denied for provider ${provider.id} at ${provider.ipAddress}:${port}. Check the inverter account or Modbus permissions.`,
              );
            }

            throw error;
          }
        },
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function buildDiscoveryProvider(
  ipAddress: string,
  port: number,
): SolarEnergyProviderRecord {
  return {
    id: "discovery",
    siteId: "discovery",
    name: HUAWEI_DISCOVERY_NAME,
    plugin: HUAWEI_DISCOVERY_MODEL,
    ipAddress,
    port,
    enabled: true,
    connected: true,
    serialNumber: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function getConnectionOptions(
  provider: SolarEnergyProviderRecord,
  port: number,
) {
  return {
    host: provider.ipAddress,
    port,
    requestRetryCount: port === HUAWEI_FALLBACK_PORT ? 1 : 0,
    requestRetryDelayMs: port === HUAWEI_FALLBACK_PORT ? 1_000 : 0,
    unitId: getHuaweiUnitId(port),
  };
}

export function getHuaweiPorts(provider: SolarEnergyProviderRecord): number[] {
  if (provider.port !== null) {
    return [provider.port];
  }

  return [HUAWEI_DEFAULT_PORT, HUAWEI_FALLBACK_PORT];
}

export function getHuaweiUnitId(port: number): number {
  return port === HUAWEI_FALLBACK_PORT ? 1 : 0;
}
