import type { ManagedDeviceState } from "@emsd/core";
import type { BatteryTelemetrySample } from "../../discovery-types";
import {
  getStringOrNumber,
  parseJsonObject,
  parseNullableNumber,
  matchesPatterns,
} from "../shared";
import type { DiscoveryPlugin } from "../types";

const responseMatch = [
  '"BackupBuffer"\\s*:',
  '"OperatingMode"\\s*:',
  '"RSOC"\\s*:',
  '"SystemStatus"\\s*:',
  '"Uac"\\s*:',
];

export const sonnenBatteryPlugin: DiscoveryPlugin = {
  pluginType: "battery",
  category: "battery",
  model: "sonnenbatterie",
  name: "sonnenBatterie",
  port: 80,
  schemes: ["http"],
  request: {
    path: "/api/v2/status",
    method: "GET",
    headers: {
      accept: "application/json",
    },
  },
  response: {
    match: responseMatch,
  },
  buildDiscoveredDevice({ ipAddress, responseText }) {
    const payload = parseJsonObject(responseText);
    const batteryPower = parseSonnenBatteryPower(payload);
    const batteryState = formatSonnenBatteryState(payload);
    const batterySoc = parseNullableNumber(payload?.RSOC);
    const operatingMode = formatSonnenOperatingMode(payload?.OperatingMode);
    const backupBuffer = getStringOrNumber(payload?.BackupBuffer);
    const systemStatus = getStringOrNumber(payload?.SystemStatus);
    const detailsParts = batterySoc !== null ? [`SOC ${batterySoc}%`] : [];

    if (batteryPower !== null) {
      detailsParts.push(`power ${batteryPower} W`);
    }

    if (batteryState) {
      detailsParts.push(`state ${batteryState}`);
    }

    if (operatingMode) {
      detailsParts.push(`mode ${operatingMode}`);
    }

    if (backupBuffer) {
      detailsParts.push(`backup ${backupBuffer}%`);
    }

    if (systemStatus) {
      detailsParts.push(`system ${systemStatus}`);
    }

    if (detailsParts.length === 0) {
      detailsParts.push("status endpoint matched");
    }

    return {
      category: "battery",
      model: "sonnenbatterie",
      name: "sonnenBatterie",
      ipAddress,
      details: detailsParts.join(", "),
      powerW: batteryPower,
      socPercent: batterySoc,
      state: parseSonnenManagedState(payload),
    };
  },
  parseTelemetry(responseText) {
    const payload = parseJsonObject(responseText);

    return {
      powerW: parseSonnenBatteryPower(payload),
      socPercent: parseNullableNumber(payload?.RSOC),
      state: parseSonnenManagedState(payload),
    } satisfies BatteryTelemetrySample;
  },
};

export function matchesSonnenBatteryResponse(responseText: string): boolean {
  return matchesPatterns(responseMatch, responseText);
}

function parseSonnenBatteryPower(
  payload: Record<string, unknown> | null,
): number | null {
  const power = parseNullableNumber(payload?.Pac_total_W);
  return power === null ? null : Math.abs(Math.round(power));
}

function parseSonnenManagedState(
  payload: Record<string, unknown> | null,
): ManagedDeviceState {
  const state = formatSonnenBatteryState(payload);

  if (state === "charging" || state === "discharging" || state === "idle") {
    return state;
  }

  return "offline";
}

function formatSonnenBatteryState(
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload) {
    return null;
  }

  if (payload.BatteryCharging === true) {
    return "charging";
  }

  if (payload.BatteryDischarging === true) {
    return "discharging";
  }

  const installed = getStringOrNumber(payload.IsSystemInstalled);
  return installed === "1" ? "idle" : null;
}

function formatSonnenOperatingMode(value: unknown): string | null {
  const modeCode = getStringOrNumber(value);

  switch (modeCode) {
    case "1":
      return "manual";
    case "2":
      return "self-consumption";
    default:
      return modeCode ? `code ${modeCode}` : null;
  }
}
