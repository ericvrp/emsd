import { createHash } from "node:crypto";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import type {
  DiscoverReport,
  DiscoverReportDevice,
  DiscoveryCategory,
  ManagedDeviceState,
} from "@emsd/core";
import discoverySignaturesJson from "./discovery-signatures.json";

export interface DiscoveredDevice {
  discoveryId: string;
  category: DiscoveryCategory;
  model: string;
  name: string;
  ipAddress: string;
  details: string;
  powerW: number | null;
  socPercent: number | null;
  state: ManagedDeviceState | null;
}

export interface DiscoveryScanTarget {
  interfaceName: string;
  subnet: string;
}

export interface DiscoverCommandOptions {
  verbose: boolean;
  host: string | null;
}

export interface BatteryTelemetrySample {
  powerW: number | null;
  socPercent: number | null;
  state: ManagedDeviceState;
}

export interface MeterTelemetrySample {
  gasM3: number | null;
  powerW: number | null;
  state: Extract<ManagedDeviceState, "connected" | "offline">;
}

interface DiscoveryRequestDefinition {
  path: string;
  method: string;
  headers?: Record<string, string>;
}

interface DiscoveryResponseDefinition {
  match: string[];
}

interface DiscoverySupplementalPayload {
  responseText: string;
  scheme: "https" | "http";
}

interface DiscoverySignatureDefinition {
  category: DiscoveryCategory;
  model: string;
  name: string;
  port: number;
  schemes?: Array<"https" | "http">;
  request: DiscoveryRequestDefinition;
  response: DiscoveryResponseDefinition;
}

const HOST_SCAN_START = 1;
const HOST_SCAN_END = 254;
const REQUEST_TIMEOUT_MS = 2000;

const discoverySignatures =
  discoverySignaturesJson as DiscoverySignatureDefinition[];

export function formatHelpText(): string {
  return [
    "Usage:",
    "  discover [--verbose] [--host <ipv4>]  Scan for supported devices",
    "",
    "Options:",
    "  --verbose             Emit full JSON output for the current scan",
    "  --host <ipv4>         Probe a single host instead of scanning /24",
  ].join("\n");
}

export function parseDiscoverCommandOptions(
  args: string[],
): DiscoverCommandOptions | null {
  const options: DiscoverCommandOptions = {
    verbose: false,
    host: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg === "--host") {
      const host = args[index + 1];

      if (!host) {
        throw new Error("Missing value for --host");
      }

      if (!isIpv4Address(host)) {
        throw new Error(`Invalid IPv4 address for --host: ${host}`);
      }

      options.host = host;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h" || arg === "help") {
      return null;
    }

    throw new Error(`Unknown discover option: ${arg}`);
  }

  return options;
}

export function getDiscoverySignatures(): DiscoverySignatureDefinition[] {
  return [...discoverySignatures];
}

export async function fetchBatteryTelemetry(
  ipAddress: string,
): Promise<BatteryTelemetrySample | null> {
  const signature = requireSignature("indevolt-battery");
  const response = await fetchDiscoveryResponse(
    ipAddress,
    signature,
    signature.request.path,
    { host: ipAddress, verbose: false },
  );

  if (!response) {
    return null;
  }

  return parseBatteryTelemetry(response.responseText);
}

export async function fetchMeterTelemetry(
  ipAddress: string,
): Promise<MeterTelemetrySample | null> {
  const signature = requireSignature("homewizard-p1");
  const response = await fetchDiscoveryResponse(
    ipAddress,
    {
      ...signature,
      request: {
        path: "/api/v1/data",
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
    },
    "/api/v1/data",
    { host: ipAddress, verbose: false },
  );

  if (!response) {
    return null;
  }

  return parseMeterTelemetry(response.responseText);
}

export function getLocalIpv4Subnets(
  interfaces = networkInterfaces(),
): string[] {
  const subnets = new Set<string>();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!isUsableIpv4Interface(entry)) {
        continue;
      }

      const octets = entry.address.split(".");

      if (octets.length !== 4) {
        continue;
      }

      subnets.add(`${octets[0]}.${octets[1]}.${octets[2]}`);
    }
  }

  return [...subnets].sort();
}

export function getPreferredDiscoveryTarget(
  interfaces = networkInterfaces(),
): DiscoveryScanTarget | null {
  const candidates: DiscoveryScanTarget[] = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (!isUsableIpv4Interface(entry)) {
        continue;
      }

      const octets = entry.address.split(".");

      if (octets.length !== 4) {
        continue;
      }

      candidates.push({
        interfaceName,
        subnet: `${octets[0]}.${octets[1]}.${octets[2]}`,
      });
      break;
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const en0Candidate = candidates.find(
    (candidate) => candidate.interfaceName === "en0",
  );

  if (en0Candidate) {
    return en0Candidate;
  }

  const wifiNamedCandidate = candidates.find((candidate) =>
    isWifiEquivalentInterface(candidate.interfaceName),
  );

  if (wifiNamedCandidate) {
    return wifiNamedCandidate;
  }

  return candidates.sort(compareDiscoveryTargets)[0] ?? null;
}

export function buildSubnetTargets(subnets: string[]): string[] {
  const targets: string[] = [];

  for (const subnet of subnets) {
    for (
      let lastOctet = HOST_SCAN_START;
      lastOctet <= HOST_SCAN_END;
      lastOctet += 1
    ) {
      targets.push(`${subnet}.${lastOctet}`);
    }
  }

  return targets;
}

export function formatDiscoveredDevices(devices: DiscoveredDevice[]): string {
  if (devices.length === 0) {
    return "No supported devices are reachable right now.";
  }

  return [...devices]
    .sort(compareDiscoveredDevices)
    .map(
      (device) =>
        `${device.name} [${device.discoveryId}] ${device.ipAddress}${formatConciseDetails(device)}`,
    )
    .join("\n");
}

function formatConciseDetails(device: DiscoveredDevice): string {
  if (!device.details) {
    return "";
  }

  const detailParts = device.details.split(", ");
  const preferredPrefixes =
    device.category === "battery"
      ? ["SOC ", "power ", "state "]
      : ["SMR ", "power ", "gas "];
  const conciseParts = preferredPrefixes
    .map((prefix) => detailParts.find((part) => part.startsWith(prefix)))
    .filter((part): part is string => part !== undefined);
  const summary = (
    conciseParts.length > 0 ? conciseParts : detailParts.slice(0, 3)
  ).join(", ");

  return summary ? `: ${summary}` : "";
}

export async function discoverDevices(
  subnets = getDefaultDiscoverySubnets(),
  options: DiscoverCommandOptions = { verbose: false, host: null },
): Promise<DiscoveredDevice[]> {
  const targets = buildSubnetTargets(subnets);
  const results = await Promise.all(
    targets.map((target) => probeTarget(target, options)),
  );

  return results.filter(
    (result): result is DiscoveredDevice => result !== null,
  );
}

export async function runDiscoverCommand(args: string[] = []): Promise<number> {
  let options: DiscoverCommandOptions | null;

  try {
    options = parseDiscoverCommandOptions(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(formatHelpText());
    return 1;
  }

  if (options === null) {
    console.log(formatHelpText());
    return 0;
  }

  if (options.host) {
    if (options.verbose) {
      console.error(
        `Using ${discoverySignatures.length} discovery fingerprint(s): ${discoverySignatures.map((signature) => signature.model).join(", ")}`,
      );
    }

    const devices = await discoverHostDevices(options.host, options);
    emitDiscoverOutput(devices, options, {
      host: options.host,
      subnet: null,
      interfaceName: null,
    });
    return 0;
  }

  const target = getPreferredDiscoveryTarget();

  if (target === null) {
    emitDiscoverOutput([], options, {
      host: null,
      subnet: null,
      interfaceName: null,
    });
    return 0;
  }

  if (options.verbose) {
    console.error(
      `Using ${discoverySignatures.length} discovery fingerprint(s): ${discoverySignatures.map((signature) => signature.model).join(", ")}`,
    );
  }

  const devices = await discoverDevices([target.subnet], options);

  emitDiscoverOutput(devices, options, {
    host: null,
    subnet: target.subnet,
    interfaceName: target.interfaceName,
  });
  return 0;
}

export async function discoverHostDevices(
  host: string,
  options: DiscoverCommandOptions = { verbose: false, host: null },
): Promise<DiscoveredDevice[]> {
  const device = await probeTarget(host, options);
  return device ? [device] : [];
}

export function getDiscoveryId(
  device: Omit<DiscoveredDevice, "discoveryId">,
): string {
  return createHash("sha1")
    .update(`${device.category}:${device.model}:${device.ipAddress}`)
    .digest("hex")
    .slice(0, 12);
}

function emitDiscoverOutput(
  devices: DiscoveredDevice[],
  options: DiscoverCommandOptions,
  target: {
    host: string | null;
    subnet: string | null;
    interfaceName: string | null;
  },
): void {
  if (options.verbose) {
    console.log(JSON.stringify(buildDiscoverReport(devices, target), null, 2));
    return;
  }

  console.log(formatDiscoveredDevices(devices));
}

export function formatDiscoveryTarget(target: DiscoveryScanTarget): string {
  return `${target.subnet}.0/24 on interface ${target.interfaceName}`;
}

function getDefaultDiscoverySubnets(): string[] {
  const target = getPreferredDiscoveryTarget();

  return target ? [target.subnet] : [];
}

function isUsableIpv4Interface(entry: NetworkInterfaceInfo): boolean {
  return entry.family === "IPv4" && !entry.internal;
}

function isWifiEquivalentInterface(interfaceName: string): boolean {
  return /^(en|wl|wlan|wifi)/i.test(interfaceName);
}

function isIpv4Address(value: string): boolean {
  const octets = value.split(".");

  if (octets.length !== 4) {
    return false;
  }

  return octets.every((octet) => {
    if (!/^\d+$/.test(octet)) {
      return false;
    }

    const parsed = Number(octet);
    return parsed >= 0 && parsed <= 255;
  });
}

function compareDiscoveryTargets(
  left: DiscoveryScanTarget,
  right: DiscoveryScanTarget,
): number {
  const interfaceNameDifference = left.interfaceName.localeCompare(
    right.interfaceName,
  );

  if (interfaceNameDifference !== 0) {
    return interfaceNameDifference;
  }

  return left.subnet.localeCompare(right.subnet);
}

async function probeTarget(
  ipAddress: string,
  options: DiscoverCommandOptions,
): Promise<DiscoveredDevice | null> {
  for (const signature of discoverySignatures) {
    const primaryResponse = await fetchDiscoveryResponse(
      ipAddress,
      signature,
      signature.request.path,
      options,
    );

    if (primaryResponse === null) {
      continue;
    }

    if (!matchesSignatureResponse(signature, primaryResponse.responseText)) {
      if (options.verbose) {
        console.error(
          `Response from ${primaryResponse.url} did not match ${signature.model}`,
        );
      }
      continue;
    }

    if (options.verbose) {
      console.error(`Matched ${signature.model} at ${ipAddress}`);
    }

    const supplementalPayload = await fetchSupplementalPayload(
      signature,
      ipAddress,
      primaryResponse.scheme,
      options,
    );

    return buildDiscoveredDevice(
      signature,
      ipAddress,
      primaryResponse.responseText,
      supplementalPayload,
    );
  }

  return null;
}

async function fetchDiscoveryResponse(
  ipAddress: string,
  signature: DiscoverySignatureDefinition,
  path: string,
  options: DiscoverCommandOptions,
  preferredScheme: "https" | "http" = "https",
): Promise<{
  responseText: string;
  scheme: "https" | "http";
  url: string;
} | null> {
  const configuredSchemes = signature.schemes ?? ["https", "http"];
  const schemes = configuredSchemes.includes(preferredScheme)
    ? [
        preferredScheme,
        ...configuredSchemes.filter((scheme) => scheme !== preferredScheme),
      ]
    : [...configuredSchemes];

  for (const scheme of schemes) {
    const requestUrl = buildRequestUrl(ipAddress, signature, path, scheme);

    if (options.verbose) {
      console.error(`Probing ${requestUrl} for ${signature.model}...`);
    }

    const responseResult = await fetch(requestUrl, {
      method: signature.request.method,
      ...(signature.request.headers
        ? { headers: signature.request.headers }
        : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
      .then((response) => ({ response, error: null }))
      .catch((error: unknown) => ({ response: null, error }));

    if (responseResult.response === null) {
      if (options.verbose) {
        console.error(
          `Request failed for ${requestUrl}: ${formatUnknownError(responseResult.error)}`,
        );
      }
      continue;
    }

    const response = responseResult.response;

    if (!response.ok) {
      if (options.verbose) {
        console.error(`Received HTTP ${response.status} from ${requestUrl}`);
      }
      continue;
    }

    const responseText = await response.text().catch(() => null);

    if (responseText === null) {
      if (options.verbose) {
        console.error(`Could not read response body from ${requestUrl}`);
      }
      continue;
    }

    return {
      responseText,
      scheme,
      url: requestUrl,
    };
  }

  return null;
}

async function fetchSupplementalPayload(
  signature: DiscoverySignatureDefinition,
  ipAddress: string,
  preferredScheme: "https" | "http",
  options: DiscoverCommandOptions,
): Promise<DiscoverySupplementalPayload | null> {
  if (signature.model !== "homewizard-p1") {
    return null;
  }

  const supplementalResponse = await fetchDiscoveryResponse(
    ipAddress,
    {
      ...signature,
      request: {
        path: "/api/v1/data",
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
    },
    "/api/v1/data",
    options,
    preferredScheme,
  );

  if (supplementalResponse === null) {
    return null;
  }

  if (options.verbose) {
    console.error(
      `Supplemental probe returned data from ${supplementalResponse.url}`,
    );
  }

  return {
    responseText: supplementalResponse.responseText,
    scheme: supplementalResponse.scheme,
  };
}

function buildRequestUrl(
  ipAddress: string,
  signature: DiscoverySignatureDefinition,
  path = signature.request.path,
  scheme: "https" | "http" = "https",
): string {
  return `${scheme}://${ipAddress}:${signature.port}${path}`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }

  return String(error);
}

function requireSignature(model: string): DiscoverySignatureDefinition {
  const signature = discoverySignatures.find(
    (candidate) => candidate.model === model,
  );

  if (!signature) {
    throw new Error(`Discovery signature not found for model: ${model}`);
  }

  return signature;
}

function matchesSignatureResponse(
  signature: DiscoverySignatureDefinition,
  responseText: string,
): boolean {
  return signature.response.match.every((pattern) =>
    new RegExp(pattern).test(responseText),
  );
}

function buildDiscoveredDevice(
  signature: DiscoverySignatureDefinition,
  ipAddress: string,
  responseText: string,
  supplementalPayload: DiscoverySupplementalPayload | null,
): DiscoveredDevice {
  if (signature.model === "indevolt-battery") {
    return buildIndevoltDiscoveredDevice(signature, ipAddress, responseText);
  }

  const payload = parseJsonObject(responseText);
  const apiVersion = getStringValue(payload?.api_version);
  const firmwareVersion = getStringValue(payload?.firmware_version);
  const serial = getStringValue(payload?.serial);
  const supplemental = parseJsonObject(supplementalPayload?.responseText ?? "");
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

  const device = {
    category: signature.category,
    model: signature.model,
    name: signature.name,
    ipAddress,
    details: detailsParts.join(", "),
    powerW: parseNullableNumber(supplemental?.active_power_w),
    socPercent: null,
    state: supplemental ? ("connected" as const) : null,
  };

  return {
    ...device,
    discoveryId: getDiscoveryId(device),
  };
}

function buildIndevoltDiscoveredDevice(
  signature: DiscoverySignatureDefinition,
  ipAddress: string,
  responseText: string,
): DiscoveredDevice {
  const payload = parseJsonObject(responseText);
  const serial = getStringValue(payload?.["0"]);
  const firmwareVersion = getStringValue(payload?.["1118"]);
  const batteryPower = getStringOrNumber(payload?.["6000"]);
  const batteryState = formatIndevoltBatteryState(payload?.["6001"]);
  const batterySoc = getStringOrNumber(payload?.["6002"]);
  const workMode = formatIndevoltWorkMode(payload?.["7101"]);
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

  const device = {
    category: signature.category,
    model: signature.model,
    name: signature.name,
    ipAddress,
    details: detailsParts.join(", "),
    powerW: parseNullableNumber(payload?.["6000"]),
    socPercent: parseNullableNumber(payload?.["6002"]),
    state: parseIndevoltBatteryState(payload?.["6001"]),
  };

  return {
    ...device,
    discoveryId: getDiscoveryId(device),
  };
}

function parseBatteryTelemetry(responseText: string): BatteryTelemetrySample {
  const payload = parseJsonObject(responseText);

  return {
    powerW: parseNullableNumber(payload?.["6000"]),
    socPercent: parseNullableNumber(payload?.["6002"]),
    state: parseIndevoltBatteryState(payload?.["6001"]),
  };
}

function parseMeterTelemetry(responseText: string): MeterTelemetrySample {
  const payload = parseJsonObject(responseText);
  return {
    gasM3: parseNullableNumber(payload?.total_gas_m3),
    powerW: parseNullableNumber(payload?.active_power_w),
    state: payload ? "connected" : "offline",
  };
}

function parseJsonObject(responseText: string): Record<string, unknown> | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function getStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getStringOrNumber(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseIndevoltBatteryState(value: unknown): ManagedDeviceState {
  const state = formatIndevoltBatteryState(value);

  if (state === "idle" || state === "charging" || state === "discharging") {
    return state;
  }

  return "offline";
}

function formatIndevoltBatteryState(value: unknown): string | null {
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

function formatIndevoltWorkMode(value: unknown): string | null {
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

function compareDiscoveredDevices(
  left: DiscoveredDevice,
  right: DiscoveredDevice,
): number {
  return compareIpv4Addresses(left.ipAddress, right.ipAddress);
}

function compareIpv4Addresses(left: string, right: string): number {
  const leftOctets = left.split(".").map(Number);
  const rightOctets = right.split(".").map(Number);

  for (let index = 0; index < 4; index += 1) {
    const difference = (leftOctets[index] ?? 0) - (rightOctets[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function buildDiscoverReport(
  devices: DiscoveredDevice[],
  target: {
    host: string | null;
    subnet: string | null;
    interfaceName: string | null;
  },
): DiscoverReport {
  return {
    schema: "emsd.discover.report.v1",
    reportedAt: new Date().toISOString(),
    host: target.host,
    subnet: target.subnet,
    interfaceName: target.interfaceName,
    devices: devices.map(
      (device): DiscoverReportDevice => ({
        discoveryId: device.discoveryId,
        category: device.category,
        model: device.model,
        name: device.name,
        ipAddress: device.ipAddress,
        details: device.details,
      }),
    ),
  };
}
