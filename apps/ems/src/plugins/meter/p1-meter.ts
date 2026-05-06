import type { MeterTelemetrySample } from "../../discovery-types";
import {
  getStringOrNumber,
  getStringValue,
  matchesPatterns,
  parseJsonObject,
  parseNullableNumber,
} from "../shared";
import type { DiscoveryPlugin } from "../types";

const responseMatch = [
  '"product_type"\\s*:\\s*"HWE-P1"',
  '"api_version"\\s*:\\s*"v1"',
];

export const p1MeterPlugin: DiscoveryPlugin = {
  pluginType: "meter",
  category: "meter",
  model: "homewizard-p1",
  name: "HomeWizard P1",
  port: 80,
  schemes: ["http"],
  request: {
    path: "/api",
    method: "GET",
    headers: {
      accept: "application/json",
    },
  },
  supplementalRequest: {
    path: "/api/v1/data",
    method: "GET",
    headers: {
      accept: "application/json",
    },
  },
  response: {
    match: responseMatch,
  },
  buildDiscoveredDevice({ ipAddress, responseText, supplementalResponseText }) {
    const payload = parseJsonObject(responseText);
    const apiVersion = getStringValue(payload?.api_version);
    const firmwareVersion = getStringValue(payload?.firmware_version);
    const serial = getStringValue(payload?.serial);
    const supplemental = parseJsonObject(supplementalResponseText ?? "");
    const smrVersion = getStringOrNumber(supplemental?.smr_version);
    const meterModel = getStringValue(supplemental?.meter_model);
    const activePower = getStringOrNumber(supplemental?.active_power_w);
    const totalGas = getStringOrNumber(supplemental?.total_gas_m3);
    const detailsParts = smrVersion
      ? [`SMR ${smrVersion}`]
      : apiVersion
        ? [`API ${apiVersion}`]
        : ["fingerprint matched"];

    if (meterModel) {
      detailsParts.push(`meter ${meterModel}`);
    }

    if (activePower) {
      detailsParts.push(`power ${activePower} W`);
    }

    if (totalGas) {
      detailsParts.push(`gas ${totalGas} m3`);
    }

    if (firmwareVersion) {
      detailsParts.push(`firmware ${firmwareVersion}`);
    }

    if (serial) {
      detailsParts.push(`serial ${serial}`);
    }

    return {
      category: "meter",
      model: "homewizard-p1",
      name: "HomeWizard P1",
      ipAddress,
      port: 80,
      details: detailsParts.join(", "),
      powerW: parseNullableNumber(supplemental?.active_power_w),
      socPercent: null,
      state: supplemental ? ("connected" as const) : null,
    };
  },
  parseTelemetry(responseText) {
    const payload = parseJsonObject(responseText);

    return {
      powerW: parseNullableNumber(payload?.active_power_w),
    } satisfies MeterTelemetrySample;
  },
};

export function matchesP1MeterResponse(responseText: string): boolean {
  return matchesPatterns(responseMatch, responseText);
}
