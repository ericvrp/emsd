import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type {
  DynamicPriceSourceRecord,
  ManagedDeviceRecord,
  ManagedDeviceStatusRecord,
  SiteRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core";

const execFileAsync = promisify(execFile);
const bridgeScriptPath = resolve(process.cwd(), "server/ems-web-api.ts");

interface BridgeSuccess<T> {
  ok: true;
  data: T;
}

interface BridgeFailure {
  ok: false;
  error: string;
}

type BridgeResponse<T> = BridgeSuccess<T> | BridgeFailure;

export interface DashboardSnapshot {
  generatedAt: string;
  sites: Array<
    SiteRecord & {
      devices: ManagedDeviceRecord[];
      dynamicPriceSources: DynamicPriceSourceRecord[];
      weatherSources: WeatherForecastSourceRecord[];
    }
  >;
}

export interface LiveStatusSnapshot {
  daemon: {
    pid: number | null;
    running: boolean;
  };
  generatedAt: string;
  sites: Array<
    SiteRecord & {
      devices: ManagedDeviceStatusRecord[];
      dynamicPriceSources: DynamicPriceSourceRecord[];
      weatherSources: WeatherForecastSourceRecord[];
    }
  >;
}

export interface DiscoveredDevice {
  category: "battery" | "meter";
  details: string;
  discoveryId: string;
  ipAddress: string;
  model: string;
  name: string;
}

export interface BulkDiscoveryAddResult {
  addedBatteries: number;
  addedMeters: number;
  skippedDevices: number;
}

async function runBridge<T>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const { stdout, stderr } = await execFileAsync(
    "bun",
    ["run", bridgeScriptPath, action, JSON.stringify(input)],
    {
      cwd: process.cwd(),
      env: process.env,
    },
  );

  const output = stdout.trim();

  if (!output) {
    throw new Error(
      stderr.trim() || `Bridge action '${action}' returned no output.`,
    );
  }

  const response = JSON.parse(output) as BridgeResponse<T>;

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data;
}

export function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  return runBridge<DashboardSnapshot>("snapshot");
}

export function getLiveStatus(): Promise<LiveStatusSnapshot> {
  return runBridge<LiveStatusSnapshot>("live-status");
}

export function discoverDevices(
  host: string | null,
): Promise<DiscoveredDevice[]> {
  return runBridge<DiscoveredDevice[]>("discover", { host });
}

export function createSite(input: { id: string; name: string }) {
  return runBridge<SiteRecord>("site-create", input);
}

export function updateSite(input: { id: string; name: string }) {
  return runBridge<SiteRecord>("site-update", input);
}

export function deleteSite(input: { id: string }) {
  return runBridge<SiteRecord>("site-delete", input);
}

export function createBatteryFromDiscovery(input: {
  discoveryId: string;
  host: string | null;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("battery-create", input);
}

export function setBatteryEnabled(input: {
  enabled: boolean;
  id: string;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("battery-set-enabled", input);
}

export function deleteBattery(input: { id: string; siteId: string }) {
  return runBridge<ManagedDeviceRecord>("battery-delete", input);
}

export function createMeterFromDiscovery(input: {
  discoveryId: string;
  host: string | null;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("meter-create", input);
}

export function addAllFromDiscovery(input: {
  discoveryIds: string[];
  host: string | null;
  siteId: string;
}) {
  return runBridge<BulkDiscoveryAddResult>("discovery-add-all", input);
}

export function setMeterEnabled(input: {
  enabled: boolean;
  id: string;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("meter-set-enabled", input);
}

export function deleteMeter(input: { id: string; siteId: string }) {
  return runBridge<ManagedDeviceRecord>("meter-delete", input);
}

export function createWeatherForecastSource(input: {
  id: string;
  name: string;
  siteId: string;
}) {
  return runBridge<WeatherForecastSourceRecord>("weather-create", input);
}

export function updateWeatherForecastSource(input: {
  id: string;
  name: string;
  siteId: string;
}) {
  return runBridge<WeatherForecastSourceRecord>("weather-update", input);
}

export function deleteWeatherForecastSource(input: {
  id: string;
  siteId: string;
}) {
  return runBridge<WeatherForecastSourceRecord>("weather-delete", input);
}

export function createDynamicPriceSource(input: {
  id: string;
  name: string;
  siteId: string;
}) {
  return runBridge<DynamicPriceSourceRecord>("price-create", input);
}

export function updateDynamicPriceSource(input: {
  id: string;
  name: string;
  siteId: string;
}) {
  return runBridge<DynamicPriceSourceRecord>("price-update", input);
}

export function deleteDynamicPriceSource(input: {
  id: string;
  siteId: string;
}) {
  return runBridge<DynamicPriceSourceRecord>("price-delete", input);
}
