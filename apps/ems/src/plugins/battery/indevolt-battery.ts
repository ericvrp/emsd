import type { ManagedDeviceState } from "@emsd/core";
import type { BatteryTelemetrySample } from "../../discovery-types";
import {
  getStringOrNumber,
  getStringValue,
  parseJsonObject,
  parseNullableNumber,
  matchesPatterns,
} from "../shared";
import type { DiscoveryPlugin } from "../types";

const responseMatch = [
  '"0"\\s*:',
  '"6002"\\s*:',
  '"6001"\\s*:',
  '"Indevolt"|"1118"\\s*:',
];

export const indevoltBatteryPlugin: DiscoveryPlugin = {
  pluginType: "battery",
  category: "battery",
  model: "indevolt-battery",
  name: "Indevolt Battery",
  port: 8080,
  schemes: ["http"],
  request: {
    path: "/rpc/Indevolt.GetData?config=%7B%22t%22%3A%5B0%2C1118%2C6000%2C6001%2C6002%2C7101%5D%7D",
    method: "POST",
    headers: {
      accept: "application/json",
    },
  },
  response: {
    match: responseMatch,
  },
  buildDiscoveredDevice({ ipAddress, responseText }) {
    const payload = parseJsonObject(responseText);
    const serial = getStringValue(payload?.["0"]);
    const firmwareVersion = getStringValue(payload?.["1118"]);
    const batteryPower = getStringOrNumber(payload?.["6000"]);
    const batteryState = formatDefaultBatteryState(payload?.["6001"]);
    const batterySoc = getStringOrNumber(payload?.["6002"]);
    const workMode = formatDefaultBatteryWorkMode(payload?.["7101"]);
    const detailsParts = batterySoc
      ? [`SOC ${batterySoc}%`]
      : ["fingerprint matched"];

    if (batteryPower) {
      detailsParts.push(`power ${batteryPower} W`);
    }

    if (batteryState) {
      detailsParts.push(`state ${batteryState}`);
    }

    if (workMode) {
      detailsParts.push(`mode ${workMode}`);
    }

    if (firmwareVersion) {
      detailsParts.push(`EMS firmware ${firmwareVersion}`);
    }

    if (serial) {
      detailsParts.push(`serial ${serial}`);
    }

    return {
      category: "battery",
      model: "indevolt-battery",
      name: "Indevolt Battery",
      ipAddress,
      details: detailsParts.join(", "),
      powerW: parseNullableNumber(payload?.["6000"]),
      socPercent: parseNullableNumber(payload?.["6002"]),
      state: parseDefaultBatteryState(payload?.["6001"]),
    };
  },
  parseTelemetry(responseText) {
    const payload = parseJsonObject(responseText);

    return {
      powerW: parseNullableNumber(payload?.["6000"]),
      socPercent: parseNullableNumber(payload?.["6002"]),
      state: parseDefaultBatteryState(payload?.["6001"]),
    } satisfies BatteryTelemetrySample;
  },
};

export function matchesIndevoltBatteryResponse(responseText: string): boolean {
  return matchesPatterns(responseMatch, responseText);
}

function parseDefaultBatteryState(value: unknown): ManagedDeviceState {
  const state = formatDefaultBatteryState(value);

  if (state === "idle" || state === "charging" || state === "discharging") {
    return state;
  }

  return "offline";
}

function formatDefaultBatteryState(value: unknown): string | null {
  const stateCode = getStringOrNumber(value);

  switch (stateCode) {
    case "1000":
      return "idle";
    case "1001":
      return "charging";
    case "1002":
      return "discharging";
    default:
      return stateCode ? `code ${stateCode}` : null;
  }
}

function formatDefaultBatteryWorkMode(value: unknown): string | null {
  const modeCode = getStringOrNumber(value);

  switch (modeCode) {
    case "1":
      return "self-consumption";
    case "4":
      return "real-time control";
    case "5":
      return "charge/discharge schedule";
    default:
      return modeCode ? `code ${modeCode}` : null;
  }
}
