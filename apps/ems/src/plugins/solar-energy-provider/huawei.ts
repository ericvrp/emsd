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
const HUAWEI_DEFAULT_ENABLE_LIMIT_W = 10_000;
const HUAWEI_MODEL_REGISTER = 30000;
const HUAWEI_SERIAL_REGISTER = 30015;
const HUAWEI_FIRMWARE_REGISTER = 31025;
const HUAWEI_ACTIVE_POWER_REGISTER = 32080;
const HUAWEI_MAX_ACTIVE_POWER_REGISTER = 30075;
const HUAWEI_FIXED_POWER_LIMIT_REGISTER = 40126;

interface HuaweiSnapshot {
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

export const huaweiSolarEnergyProviderDiscoveryPlugin: DiscoveryPlugin = {
  pluginType: "solar-energy-provider",
  category: "solar-energy-provider",
  model: HUAWEI_DISCOVERY_MODEL,
  name: HUAWEI_DISCOVERY_NAME,
  port: HUAWEI_DEFAULT_PORT,
  transport: "modbus",
  async probe({ ipAddress }) {
    const snapshot = await readHuaweiSnapshot(
      buildDiscoveryProvider(ipAddress),
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

    details.push(`port ${HUAWEI_DEFAULT_PORT}`);

    return {
      category: "solar-energy-provider",
      details: details.join(", "),
      ipAddress,
      model: HUAWEI_DISCOVERY_MODEL,
      name: HUAWEI_DISCOVERY_NAME,
      port: HUAWEI_DEFAULT_PORT,
      powerW: snapshot.currentPowerW,
      socPercent: null,
      state: "connected",
    };
  },
};

async function readHuaweiSnapshot(
  provider: SolarEnergyProviderRecord,
): Promise<HuaweiSnapshot> {
  return withModbusClient(getConnectionOptions(provider), async (client) => {
    const identity = await client.readDeviceIdentification().catch(() => null);
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
    const productionControlStatus = await readProductionControlStatus(client);

    return {
      currentPowerW,
      firmwareVersion:
        decodeStringRegisters(firmwareRegisters) ?? identity?.revision ?? null,
      modelName:
        decodeStringRegisters(modelRegisters) ?? identity?.productCode ?? null,
      productionControlStatus,
      serialNumber:
        decodeStringRegisters(serialRegisters) ?? provider.serialNumber ?? null,
      status: "connected",
    };
  });
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
  await withModbusClient(getConnectionOptions(provider), async (client) => {
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
      await client.writeMultipleRegisters(HUAWEI_FIXED_POWER_LIMIT_REGISTER, [
        (targetPowerW >> 16) & 0xffff,
        targetPowerW & 0xffff,
      ]);
    } catch (error) {
      if (error instanceof ModbusPermissionError) {
        throw new Error(
          `Huawei production control permission denied for provider ${provider.id} at ${provider.ipAddress}:${provider.port ?? HUAWEI_DEFAULT_PORT}. Check the inverter account or Modbus permissions.`,
        );
      }

      throw error;
    }
  });
}

function buildDiscoveryProvider(ipAddress: string): SolarEnergyProviderRecord {
  return {
    id: "discovery",
    siteId: "discovery",
    name: HUAWEI_DISCOVERY_NAME,
    plugin: HUAWEI_DISCOVERY_MODEL,
    ipAddress,
    port: HUAWEI_DEFAULT_PORT,
    enabled: true,
    connected: true,
    serialNumber: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function getConnectionOptions(provider: SolarEnergyProviderRecord) {
  return {
    host: provider.ipAddress,
    port: provider.port ?? HUAWEI_DEFAULT_PORT,
    unitId: 0,
  };
}
