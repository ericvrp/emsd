import type { ManagedDeviceState } from "@emsd/core";
import type { BatteryTelemetrySample } from "../../discovery-types";
import {
  getStringValue,
  matchesPatterns,
  parseJsonObject,
  parseNullableNumber,
} from "../shared";
import type { DiscoveryPlugin } from "../types";

const responseMatch = [
  '"battery_count"\\s*:',
  '"mode"\\s*:',
  '"permissions"\\s*:',
  '"power_w"\\s*:',
];

export const homeWizardBatteryPlugin: DiscoveryPlugin = {
  pluginType: "battery",
  category: "battery",
  model: "homewizard-battery",
  name: "HomeWizard Battery",
  port: 443,
  schemes: ["https", "http"],
  request: {
    path: "/api/batteries",
    method: "GET",
    headers: buildHomeWizardHeaders,
  },
  supplementalRequest: {
    path: "/api",
    method: "GET",
    headers: buildHomeWizardHeaders,
  },
  response: {
    match: responseMatch,
  },
  buildDiscoveredDevice({ ipAddress, responseText, supplementalResponseText }) {
    const payload = parseJsonObject(responseText);
    const supplemental = parseJsonObject(supplementalResponseText ?? "");
    const batteryCount = parseNullableNumber(payload?.battery_count);
    const powerW = parseRoundedNumber(payload?.power_w);
    const mode = formatHomeWizardStrategyMode(payload);
    const controllerName = getStringValue(supplemental?.product_name);
    const serial = getStringValue(supplemental?.serial);
    const detailsParts =
      batteryCount !== null
        ? [`${batteryCount} ${batteryCount === 1 ? "battery" : "batteries"}`]
        : ["controller detected"];

    if (powerW !== null) {
      detailsParts.push(`power ${powerW} W`);
    }

    detailsParts.push(`state ${formatHomeWizardState(payload)}`);

    if (mode) {
      detailsParts.push(`mode ${mode}`);
    }

    if (controllerName) {
      detailsParts.push(`controller ${controllerName}`);
    }

    if (serial) {
      detailsParts.push(`serial ${serial}`);
    }

    return {
      category: "battery",
      model: "homewizard-battery",
      name: "HomeWizard Battery",
      ipAddress,
      details: detailsParts.join(", "),
      powerW: powerW === null ? null : Math.abs(powerW),
      socPercent: null,
      state: parseHomeWizardManagedState(payload),
    };
  },
  parseTelemetry(responseText) {
    const payload = parseJsonObject(responseText);

    return {
      powerW: parseNullableAbsoluteNumber(payload?.power_w),
      socPercent: null,
      state: parseHomeWizardManagedState(payload),
    } satisfies BatteryTelemetrySample;
  },
};

export function matchesHomeWizardBatteryResponse(responseText: string): boolean {
  return matchesPatterns(responseMatch, responseText);
}

function buildHomeWizardHeaders(
  ipAddress: string,
): Record<string, string> | null {
  const token = getHomeWizardAuthToken(ipAddress);

  if (!token) {
    return null;
  }

  return {
    accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-Api-Version": "2",
  };
}

function getHomeWizardAuthToken(ipAddress: string): string | null {
  const hostKey = ipAddress.replaceAll(".", "_");
  const token =
    process.env[`HOMEWIZARD_BATTERY_AUTH_TOKEN_${hostKey}`] ??
    process.env.HOMEWIZARD_BATTERY_AUTH_TOKEN;

  if (!token || token.trim().length === 0) {
    return null;
  }

  return token.trim();
}

function parseHomeWizardManagedState(
  payload: Record<string, unknown> | null,
): ManagedDeviceState {
  const state = formatHomeWizardState(payload);

  if (state === "charging" || state === "discharging" || state === "idle") {
    return state;
  }

  return "offline";
}

function formatHomeWizardState(
  payload: Record<string, unknown> | null,
): string {
  const powerW = parseRoundedNumber(payload?.power_w);

  if (powerW === null) {
    return "offline";
  }

  if (powerW > 0) {
    return "charging";
  }

  if (powerW < 0) {
    return "discharging";
  }

  return "idle";
}

function formatHomeWizardStrategyMode(
  payload: Record<string, unknown> | null,
): string | null {
  const mode = getStringValue(payload?.mode);
  const permissions = parsePermissions(payload?.permissions);

  if (mode === "to_full") {
    return "manual";
  }

  if (mode === "standby") {
    return "manual";
  }

  if (mode === "zero") {
    if (permissions.has("charge_allowed") && permissions.has("discharge_allowed")) {
      return "self-consumption";
    }

    return "manual";
  }

  return mode;
}

function parsePermissions(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(value.filter((entry): entry is string => typeof entry === "string"));
}

function parseRoundedNumber(value: unknown): number | null {
  const parsed = parseNullableNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function parseNullableAbsoluteNumber(value: unknown): number | null {
  const parsed = parseRoundedNumber(value);
  return parsed === null ? null : Math.abs(parsed);
}
