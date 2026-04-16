import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import { fetchWithAction } from "../shared";
import type { DiscoveryPlugin } from "../types";

const SOLAREDGE_DISCOVERY_MODEL = "solaredge-local";
const SOLAREDGE_DISCOVERY_NAME = "SolarEdge Inverter";

export class SolarEdgeSolarEnergyProviderPlugin {
  constructor(private readonly provider: SolarEnergyProviderRecord) {}

  async getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo> {
    const production = await fetchProductionInfo(this.provider);

    return {
      currentPowerW: production.currentPowerW,
      status: production.currentPowerW === null ? "offline" : "connected",
    };
  }
}

export const solaredgeSolarEnergyProviderDiscoveryPlugin: DiscoveryPlugin = {
  pluginType: "solar-energy-provider",
  category: "solar-energy-provider",
  model: SOLAREDGE_DISCOVERY_MODEL,
  name: SOLAREDGE_DISCOVERY_NAME,
  port: 80,
  schemes: ["http"],
  request: {
    path: "/",
    method: "GET",
  },
  supplementalRequest: {
    path: "/web/v1/status",
    method: "GET",
  },
  response: {
    match: ["SolarEdge", "SetApp"],
  },
  buildDiscoveredDevice({ ipAddress, responseText, supplementalResponseText }) {
    const details: string[] = [];
    const powerW = parsePowerFromProtobuf(supplementalResponseText ?? "");

    if (powerW !== null) {
      details.push(`power ${Math.round(powerW)} W`);
    }

    details.push("SolarEdge inverter");

    return {
      category: "solar-energy-provider",
      details: details.join(", "),
      ipAddress,
      model: SOLAREDGE_DISCOVERY_MODEL,
      name: SOLAREDGE_DISCOVERY_NAME,
      powerW,
      socPercent: null,
      state: powerW === null ? null : "connected",
    };
  },
};

type SolarEdgeProductionInfo = {
  currentPowerW: number | null;
};

async function fetchProductionInfo(
  provider: SolarEnergyProviderRecord,
): Promise<SolarEdgeProductionInfo> {
  const url = `http://${provider.ipAddress}/web/v1/status`;

  try {
    const response = await fetchWithAction(
      url,
      {
        method: "GET",
      },
      "SolarEdge status request",
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const parsed = decodeStatusProto(data);

    return {
      currentPowerW: parsed.powerWatt ?? null,
    };
  } catch (error) {
    console.warn(`SolarEdge local API query failed: ${error}`);
    return { currentPowerW: null };
  }
}

function parsePowerFromProtobuf(protobufText: string): number | null {
  // For discovery, we get text but the actual endpoint returns binary
  // Try to parse if it looks like binary data
  if (protobufText.length === 0) {
    return null;
  }

  // Check if it looks like binary data (non-printable characters)
  const isBinary = protobufText
    .split("")
    .some(
      (char) =>
        char.charCodeAt(0) < 32 &&
        char.charCodeAt(0) !== 10 &&
        char.charCodeAt(0) !== 13 &&
        char.charCodeAt(0) !== 9,
    );

  if (isBinary) {
    const bytes = new Uint8Array(protobufText.length);
    for (let i = 0; i < protobufText.length; i++) {
      bytes[i] = protobufText.charCodeAt(i);
    }
    const parsed = decodeStatusProto(bytes);
    return parsed.powerWatt ?? null;
  }

  return null;
}

// Minimal Protobuf decoder for SolarEdge status message
interface DecodedStatus {
  powerWatt?: number;
  voltage?: number;
  frequencyHz?: number;
  energyToday?: number;
  energyThisMonth?: number;
  energyThisYear?: number;
  energyTotal?: number;
}

function decodeStatusProto(data: Uint8Array): DecodedStatus {
  const result: DecodedStatus = {};
  let pos = 0;

  while (pos < data.length) {
    const { fieldNumber, wireType, bytesRead } = decodeVarintAndWireType(
      data,
      pos,
    );
    pos += bytesRead;

    switch (wireType) {
      case 0: {
        // varint
        const { bytesRead: varintBytes } = decodeVarint(data, pos);
        pos += varintBytes;
        // We don't need varint fields for now
        break;
      }

      case 1: {
        // 64-bit
        pos += 8; // Skip 64-bit values
        break;
      }

      case 2: {
        // length-delimited (string, bytes, or nested message)
        const { value: length, bytesRead: lengthBytes } = decodeVarint(
          data,
          pos,
        );
        pos += lengthBytes;

        if (fieldNumber === 15) {
          // energy message (field 15)
          const energyData = data.slice(pos, pos + length);
          const energy = decodeEnergyProto(energyData);
          if (energy.today !== undefined) result.energyToday = energy.today;
          if (energy.thisMonth !== undefined)
            result.energyThisMonth = energy.thisMonth;
          if (energy.thisYear !== undefined)
            result.energyThisYear = energy.thisYear;
          if (energy.total !== undefined) result.energyTotal = energy.total;
        }
        // Skip other length-delimited fields
        pos += length;
        break;
      }

      case 5: {
        // 32-bit (float)
        if (pos + 4 > data.length) {
          return result; // Incomplete data
        }

        const value = new DataView(
          data.buffer,
          data.byteOffset + pos,
          4,
        ).getFloat32(0, true);
        pos += 4;

        // Map field numbers to result properties
        switch (fieldNumber) {
          case 3: // powerWatt
            result.powerWatt = value;
            break;
          case 4: // voltage
            result.voltage = value;
            break;
          case 5: // frequencyHz
            result.frequencyHz = value;
            break;
        }
        break;
      }

      default:
        // Unknown wire type, skip field
        pos = skipField(data, pos, wireType);
        continue;
    }
  }

  return result;
}

function decodeEnergyProto(data: Uint8Array): {
  today?: number;
  thisMonth?: number;
  thisYear?: number;
  total?: number;
} {
  const result: {
    today?: number;
    thisMonth?: number;
    thisYear?: number;
    total?: number;
  } = {};
  let pos = 0;

  while (pos < data.length) {
    const { fieldNumber, wireType, bytesRead } = decodeVarintAndWireType(
      data,
      pos,
    );
    pos += bytesRead;

    if (wireType === 5 && pos + 4 <= data.length) {
      // float
      const value = new DataView(
        data.buffer,
        data.byteOffset + pos,
        4,
      ).getFloat32(0, true);
      pos += 4;

      switch (fieldNumber) {
        case 1: // today
          result.today = value;
          break;
        case 2: // thisMonth
          result.thisMonth = value;
          break;
        case 3: // thisYear
          result.thisYear = value;
          break;
        case 4: // total
          result.total = value;
          break;
      }
    } else {
      // Skip other wire types
      if (wireType === 0) {
        // varint
        const { bytesRead: varintBytes } = decodeVarint(data, pos);
        pos += varintBytes;
      } else if (wireType === 1) {
        // 64-bit
        pos += 8;
      } else if (wireType === 2) {
        // length-delimited
        const { value: length, bytesRead: lengthBytes } = decodeVarint(
          data,
          pos,
        );
        pos += lengthBytes + length;
      } else {
        pos = skipField(data, pos, wireType);
      }
    }
  }

  return result;
}

function skipField(data: Uint8Array, pos: number, wireType: number): number {
  switch (wireType) {
    case 0: {
      // varint
      const { bytesRead: varintBytes } = decodeVarint(data, pos);
      return pos + varintBytes;
    }
    case 1: {
      // 64-bit
      return pos + 8;
    }
    case 2: {
      // length-delimited
      const { value: length, bytesRead: lengthBytes } = decodeVarint(data, pos);
      return pos + lengthBytes + length;
    }
    case 5: {
      // 32-bit
      return pos + 4;
    }
    default:
      // Unknown wire type, cannot skip safely
      return data.length; // Skip to end
  }
}

function decodeVarintAndWireType(
  data: Uint8Array,
  pos: number,
): {
  fieldNumber: number;
  wireType: number;
  bytesRead: number;
} {
  const { value, bytesRead } = decodeVarint(data, pos);
  const wireType = value & 0x07;
  const fieldNumber = value >>> 3;
  return { fieldNumber, wireType, bytesRead };
}

function decodeVarint(
  data: Uint8Array,
  pos: number,
): {
  value: number;
  bytesRead: number;
} {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  for (let i = pos; i < data.length; i++) {
    const byte = data[i];
    if (byte === undefined) break;
    value |= (byte & 0x7f) << shift;
    bytesRead++;

    if ((byte & 0x80) === 0) {
      break;
    }

    shift += 7;
    if (shift >= 28) {
      // Protect against malformed data
      break;
    }
  }

  return { value, bytesRead };
}
