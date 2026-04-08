import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type {
  BatteryStrategyPlanRecord,
  DynamicPriceSnapshotRecord,
  DynamicPriceSourceRecord,
  ManagedDeviceRecord,
  ManagedDeviceStatusRecord,
  NormalizedBatteryInfo,
  SiteRecord,
  WeatherForecastRecord,
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
      devices: ManagedDeviceStatusRecord[];
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
  powerW: number | null;
  socPercent: number | null;
  state: "idle" | "charging" | "discharging" | "connected" | "offline" | null;
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
  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync(
      "bun",
      ["run", bridgeScriptPath, action, JSON.stringify(input)],
      {
        cwd: process.cwd(),
        env: process.env,
      },
    );

    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = typeof (error as { stdout?: unknown }).stdout === "string"
      ? ((error as { stdout: string }).stdout)
      : "";
    stderr = typeof (error as { stderr?: unknown }).stderr === "string"
      ? ((error as { stderr: string }).stderr)
      : "";

    if (!stdout.trim()) {
      throw error;
    }
  }

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

export function createSite(input: {
  id: string;
  location: string;
  name: string;
}) {
  return runBridge<SiteRecord>("site-create", input);
}

export function updateSite(input: {
  id: string;
  location: string;
  name: string;
}) {
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

export function setBatteryMinimumDischargePercent(input: {
  id: string;
  minimumDischargePercent: number;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>(
    "battery-set-minimum-discharge-percent",
    input,
  );
}

export function deleteBattery(input: { id: string; siteId: string }) {
  return runBridge<ManagedDeviceRecord>("battery-delete", input);
}

export function setBatteryStrategy(input: {
  id: string;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
  manualPowerW: number | null;
  manualState: "idle" | "charging" | "discharging" | null;
  manualTargetSoc: number | null;
  nowModeActive?: boolean;
  siteId: string;
  strategyMode: "auto" | "manual" | "self-consumption";
}) {
  return runBridge<ManagedDeviceRecord>("battery-set-strategy", input);
}

export function setBatteryStrategyPlan(input: {
  id: string;
  siteId: string;
  strategyPlan: BatteryStrategyPlanRecord;
}) {
  return runBridge<ManagedDeviceRecord>("battery-set-strategy-plan", input);
}

export function getBatteryNormalizedInfo(input: {
  id: string;
  siteId: string;
}) {
  return runBridge<NormalizedBatteryInfo>("battery-get-normalized-info", input);
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
  provider?: "open-meteo";
  surface?: "open-meteo-shortwave-radiation";
  siteId: string;
}) {
  return runBridge<WeatherForecastSourceRecord>("weather-create", input);
}

export function updateWeatherForecastSource(input: {
  id: string;
  name: string;
  provider?: "open-meteo";
  surface?: "open-meteo-shortwave-radiation";
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

export function getWeatherForecast(input: {
  hours: number;
  periodMinutes: number;
  siteId: string;
}) {
  return runBridge<WeatherForecastRecord>("weather-get-forecast", input);
}

export function refreshWeatherForecast(input: { siteId: string }) {
  return runBridge<WeatherForecastRecord>("weather-refresh-forecast", input);
}

export function createDynamicPriceSource(input: {
  id: string;
  name: string;
  provider?: "tibber";
  siteId: string;
}) {
  return runBridge<DynamicPriceSourceRecord>("price-create", input);
}

export function updateDynamicPriceSource(input: {
  id: string;
  name: string;
  provider?: "tibber";
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

export function getDynamicPriceSnapshot(input: { siteId: string }) {
  return runBridge<DynamicPriceSnapshotRecord>("price-get-snapshot", input);
}

export function refreshDynamicPriceSnapshot(input: { siteId: string }) {
  return runBridge<DynamicPriceSnapshotRecord>("price-refresh-snapshot", input);
}
