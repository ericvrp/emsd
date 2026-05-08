import { createHash } from "node:crypto";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import type { DiscoverReport, DiscoverReportDevice } from "@emsd/core";
import type {
  BatteryTelemetrySample,
  DiscoveredDevice,
  MeterTelemetrySample,
} from "./discovery-types";
import {
  type DiscoveryPlugin,
  type DiscoveryRequestDefinition,
  type DiscoverySignatureDefinition,
  discoveryPlugins,
} from "./plugins";
import { fetchWithLanFallback, formatFetchError } from "./plugins/shared";

export type {
  BatteryTelemetrySample,
  DiscoveredDevice,
  MeterTelemetrySample,
} from "./discovery-types";

export interface DiscoveryScanTarget {
  interfaceName: string;
  subnet: string;
}

export interface DiscoverCommandOptions {
  verbose: boolean;
  host: string | null;
  logProgress?: boolean;
  hostConcurrency?: number;
}

interface DiscoverySupplementalPayload {
  responseText: string;
  scheme: "https" | "http";
}

const HOST_SCAN_START = 1;
const HOST_SCAN_END = 254;
const REQUEST_TIMEOUT_MS = 2000;
const DEFAULT_HOST_CONCURRENCY = 32;
const DISCOVERY_PROGRESS_INTERVAL_MS = 1000;

interface DiscoveryProgressLogger {
  hostMatched(ipAddress: string, model: string): void;
  hostStarted(ipAddress: string): void;
  hostStage(ipAddress: string, stage: string): void;
  hostFinished(ipAddress: string): void;
  stop(): void;
}

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
  return discoveryPlugins.map(
    ({
      buildDiscoveredDevice,
      parseTelemetry,
      probe,
      supplementalRequest,
      ...signature
    }) => ({
      ...signature,
      ...(signature.request
        ? {
            request: {
              path: signature.request.path,
              method: signature.request.method,
              ...(typeof signature.request.headers === "function"
                ? {}
                : signature.request.headers
                  ? { headers: signature.request.headers }
                  : {}),
            },
          }
        : {}),
    }),
  );
}

export async function fetchBatteryTelemetry(
  ipAddress: string,
): Promise<BatteryTelemetrySample | null> {
  const plugin = requirePlugin("indevolt-battery");
  const request = requirePluginRequest(plugin);
  const response = await fetchDiscoveryResponse(ipAddress, plugin, request, {
    host: ipAddress,
    verbose: false,
  });

  if (!response || !plugin.parseTelemetry) {
    return null;
  }

  return plugin.parseTelemetry(response.responseText) as BatteryTelemetrySample;
}

export async function fetchMeterTelemetry(
  ipAddress: string,
): Promise<MeterTelemetrySample | null> {
  const plugin = requirePlugin("homewizard-p1");

  if (!plugin.supplementalRequest) {
    return null;
  }

  const response = await fetchTelemetryResponse(
    ipAddress,
    plugin,
    plugin.supplementalRequest,
    "Meter telemetry request",
  );

  if (!response || !plugin.parseTelemetry) {
    return null;
  }

  return plugin.parseTelemetry(response.responseText) as MeterTelemetrySample;
}

async function fetchTelemetryResponse(
  ipAddress: string,
  plugin: DiscoveryPlugin,
  request: DiscoveryRequestDefinition,
  action: string,
): Promise<{
  responseText: string;
  scheme: "https" | "http";
  url: string;
}> {
  const configuredSchemes = plugin.schemes ?? ["https", "http"];
  const schemes: Array<"https" | "http"> = configuredSchemes.includes("https")
    ? ["https", ...configuredSchemes.filter((scheme) => scheme !== "https")]
    : [...configuredSchemes];
  let lastFailure = `${action} failed for ${ipAddress}.`;

  for (const scheme of schemes) {
    const url = buildRequestUrl(
      ipAddress,
      plugin,
      request,
      scheme as "https" | "http",
    );
    const headers = resolveRequestHeaders(request, ipAddress);

    try {
      const response = await fetchWithLanFallback(url, {
        method: request.method,
        ...(headers ? { headers } : {}),
        ...(scheme === "https"
          ? ({ tls: { rejectUnauthorized: false } } as RequestInit)
          : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        lastFailure = `${action} failed with HTTP ${response.status} for ${url}`;
        continue;
      }

      const responseText = await response.text().catch(() => null);

      if (responseText === null) {
        lastFailure = `${action} could not read the response body from ${url}`;
        continue;
      }

      return {
        responseText,
        scheme,
        url,
      };
    } catch (error) {
      lastFailure = formatFetchError(url, error, action);
    }
  }

  throw new Error(lastFailure);
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
      : device.category === "solar-energy-provider"
        ? ["power ", "serial ", "firmware "]
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
  const hostConcurrency = Math.max(
    1,
    Math.min(options.hostConcurrency ?? DEFAULT_HOST_CONCURRENCY, targets.length),
  );
  const progressLogger = createDiscoveryProgressLogger(
    targets,
    hostConcurrency,
    options,
  );
  const results = await mapWithConcurrency(targets, hostConcurrency, async (target) => {
    progressLogger.hostStarted(target);

    try {
      return await probeTarget(target, options, progressLogger);
    } finally {
      progressLogger.hostFinished(target);
    }
  }).finally(() => {
    progressLogger.stop();
  });

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
        `Using ${discoveryPlugins.length} discovery fingerprint(s): ${discoveryPlugins.map((plugin) => plugin.model).join(", ")}`,
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
      `Using ${discoveryPlugins.length} discovery fingerprint(s): ${discoveryPlugins.map((plugin) => plugin.model).join(", ")}`,
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
  const progressLogger = createDiscoveryProgressLogger([host], 1, options);
  progressLogger.hostStarted(host);
  const device = await probeTarget(host, options, progressLogger).finally(() => {
    progressLogger.hostFinished(host);
    progressLogger.stop();
  });
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
  progressLogger: DiscoveryProgressLogger,
): Promise<DiscoveredDevice | null> {
  for (const plugin of discoveryPlugins) {
    progressLogger.hostStage(ipAddress, plugin.model);

    if (plugin.probe) {
      const device = await plugin.probe({
        ipAddress,
        verbose: options.verbose,
      });

      if (device) {
        progressLogger.hostMatched(ipAddress, plugin.model);

        if (options.verbose) {
          console.error(`Matched ${plugin.model} at ${ipAddress}`);
        }

        return {
          ...device,
          discoveryId: getDiscoveryId(device),
        };
      }

      continue;
    }

    const request = requirePluginRequest(plugin);
    const primaryResponse = await fetchDiscoveryResponse(
      ipAddress,
      plugin,
      request,
      options,
    );

    if (primaryResponse === null) {
      continue;
    }

    if (!matchesSignatureResponse(plugin, primaryResponse.responseText)) {
      if (options.verbose) {
        console.error(
          `Response from ${primaryResponse.url} did not match ${plugin.model}`,
        );
      }
      continue;
    }

    progressLogger.hostMatched(ipAddress, plugin.model);

    if (options.verbose) {
      console.error(`Matched ${plugin.model} at ${ipAddress}`);
    }

    const supplementalPayload = await fetchSupplementalPayload(
      plugin,
      ipAddress,
      primaryResponse.scheme,
      options,
    );

    return buildDiscoveredDevice(
      plugin,
      ipAddress,
      primaryResponse.responseText,
      supplementalPayload,
    );
  }

  return null;
}

function createDiscoveryProgressLogger(
  targets: string[],
  hostConcurrency: number,
  options: DiscoverCommandOptions,
): DiscoveryProgressLogger {
  if (!options.logProgress) {
    return createNoopDiscoveryProgressLogger();
  }

  const activeStages = new Map<string, string>();
  let completedHosts = 0;
  let matchedHosts = 0;
  const startedHosts = new Set<string>();

  console.error(
    `Discovery scan starting for ${targets.length} host${targets.length === 1 ? "" : "s"} with host concurrency ${hostConcurrency}. ${discoveryPlugins.length} plugin fingerprint${discoveryPlugins.length === 1 ? "" : "s"} will be checked sequentially per host.`,
  );

  const interval = setInterval(() => {
    const activeCount = activeStages.size;
    const activeStageCounts = new Map<string, number>();

    for (const stage of activeStages.values()) {
      activeStageCounts.set(stage, (activeStageCounts.get(stage) ?? 0) + 1);
    }

    const activeSummary = [...activeStageCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 4)
      .map(([stage, count]) => `${count}x ${stage}`)
      .join(", ");

    console.error(
      `Discovery progress: started ${startedHosts.size}/${targets.length}, completed ${completedHosts}/${targets.length}, active ${activeCount}, matched ${matchedHosts}.${activeSummary ? ` Active stages: ${activeSummary}.` : ""}`,
    );
  }, DISCOVERY_PROGRESS_INTERVAL_MS);
  interval.unref?.();

  return {
    hostStarted(ipAddress) {
      startedHosts.add(ipAddress);
      activeStages.set(ipAddress, "starting");
    },
    hostStage(ipAddress, stage) {
      activeStages.set(ipAddress, stage);
    },
    hostMatched(ipAddress, model) {
      matchedHosts += 1;
      activeStages.set(ipAddress, `${model} matched`);
      console.error(`Discovery matched ${model} at ${ipAddress}.`);
    },
    hostFinished(ipAddress) {
      completedHosts += 1;
      activeStages.delete(ipAddress);
    },
    stop() {
      clearInterval(interval);
      console.error(
        `Discovery scan finished. Completed ${completedHosts}/${targets.length} host${targets.length === 1 ? "" : "s"} with ${matchedHosts} match${matchedHosts === 1 ? "" : "es"}.`,
      );
    },
  };
}

function createNoopDiscoveryProgressLogger(): DiscoveryProgressLogger {
  return {
    hostMatched() {},
    hostStarted() {},
    hostStage() {},
    hostFinished() {},
    stop() {},
  };
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex] as TItem, currentIndex);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

async function fetchDiscoveryResponse(
  ipAddress: string,
  plugin: DiscoveryPlugin,
  request: DiscoveryRequestDefinition,
  options: DiscoverCommandOptions,
  preferredScheme: "https" | "http" = "https",
): Promise<{
  responseText: string;
  scheme: "https" | "http";
  url: string;
} | null> {
  const configuredSchemes = plugin.schemes ?? ["https", "http"];
  const schemes = configuredSchemes.includes(preferredScheme)
    ? [
        preferredScheme,
        ...configuredSchemes.filter((scheme) => scheme !== preferredScheme),
      ]
    : [...configuredSchemes];

  for (const scheme of schemes) {
    const requestUrl = buildRequestUrl(ipAddress, plugin, request, scheme);
    const headers = resolveRequestHeaders(request, ipAddress);

    if (options.verbose) {
      console.error(`Probing ${requestUrl} for ${plugin.model}...`);
    }

    const responseResult = await fetchWithLanFallback(requestUrl, {
      method: request.method,
      ...(headers ? { headers } : {}),
      ...(scheme === "https"
        ? ({ tls: { rejectUnauthorized: false } } as RequestInit)
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

function resolveRequestHeaders(
  request: DiscoveryRequestDefinition,
  ipAddress: string,
): Record<string, string> | null {
  if (!request.headers) {
    return null;
  }

  return typeof request.headers === "function"
    ? request.headers(ipAddress)
    : request.headers;
}

async function fetchSupplementalPayload(
  plugin: DiscoveryPlugin,
  ipAddress: string,
  preferredScheme: "https" | "http",
  options: DiscoverCommandOptions,
): Promise<DiscoverySupplementalPayload | null> {
  if (!plugin.supplementalRequest) {
    return null;
  }

  const supplementalResponse = await fetchDiscoveryResponse(
    ipAddress,
    plugin,
    plugin.supplementalRequest,
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
  plugin: DiscoveryPlugin,
  request: DiscoveryRequestDefinition,
  scheme: "https" | "http" = "https",
): string {
  return `${scheme}://${ipAddress}:${plugin.port}${request.path}`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }

  return String(error);
}

function requirePlugin(model: string): DiscoveryPlugin {
  const plugin = discoveryPlugins.find(
    (candidate) => candidate.model === model,
  );

  if (!plugin) {
    throw new Error(`Discovery plugin not found for model: ${model}`);
  }

  return plugin;
}

function requirePluginRequest(
  plugin: DiscoveryPlugin,
): DiscoveryRequestDefinition {
  if (!plugin.request) {
    throw new Error(
      `Discovery plugin ${plugin.model} does not define an HTTP request.`,
    );
  }

  return plugin.request;
}

function matchesSignatureResponse(
  plugin: DiscoveryPlugin,
  responseText: string,
): boolean {
  return (
    plugin.response?.match.every((pattern) =>
      new RegExp(pattern).test(responseText),
    ) ?? false
  );
}

function buildDiscoveredDevice(
  plugin: DiscoveryPlugin,
  ipAddress: string,
  responseText: string,
  supplementalPayload: DiscoverySupplementalPayload | null,
): DiscoveredDevice {
  if (!plugin.buildDiscoveredDevice) {
    throw new Error(
      `Discovery plugin ${plugin.model} did not provide a discovered-device builder.`,
    );
  }

  const device = plugin.buildDiscoveredDevice({
    ipAddress,
    responseText,
    supplementalResponseText: supplementalPayload?.responseText ?? null,
  });

  return {
    ...device,
    discoveryId: getDiscoveryId(device),
  };
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
        port: device.port,
        details: device.details,
      }),
    ),
  };
}
