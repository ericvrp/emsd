import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BatteryPowerSampleRecord,
  BatteryStrategyPlanRecord,
  BulkDiscoveryAddResult,
  DashboardSnapshot,
  DynamicPriceSampleRecord,
  DynamicPriceSnapshotRecord,
  DynamicPriceSourceRecord,
  HistoryArchive,
  LiveStatusSnapshot,
  ManagedDeviceRecord,
  P1MeterSampleRecord,
  SiteRecord,
  SolarEnergyProviderSampleRecord,
  SolarForecastSampleRecord,
  WeatherForecastRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core";
import { getRepoRoot as resolveRepoRoot } from "@emsd/core";
import type { DiscoveredDevice } from "./discovery-proof";

const repoRootPath = resolveRepoRoot();
const BRIDGE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const daemonEnvFilePath = join(repoRootPath, "apps", "daemon", ".env");

interface BridgeSuccess<T> {
  ok: true;
  data: T;
}

interface BridgeFailure {
  ok: false;
  error: string;
}

type BridgeResponse<T> = BridgeSuccess<T> | BridgeFailure;

interface BridgeProcessResult {
  stderr: string;
  stdout: string;
}

export type {
  BatteryPowerSampleRecord,
  BulkDiscoveryAddResult,
  DashboardSnapshot,
  DynamicPriceSampleRecord,
  HistoryArchive,
  LiveStatusSnapshot,
  P1MeterSampleRecord,
  SolarEnergyProviderSampleRecord,
  SolarForecastSampleRecord,
};

async function runBridge<T>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const tempDirectoryPath = mkdtempSync(join(tmpdir(), "emsd-web-bridge-"));
  const outputFilePath = join(tempDirectoryPath, "response.json");
  let stdout = "";
  let stderr = "";
  let output = "";

  try {
    try {
      const result = await runBridgeProcess(
        [
          "run",
          "ems",
          "--",
          "api",
          action,
          JSON.stringify(input),
          outputFilePath,
        ],
        shouldForwardBridgeStderr(action),
      );

      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      stdout =
        typeof (error as { stdout?: unknown }).stdout === "string"
          ? (error as { stdout: string }).stdout
          : "";
      stderr =
        typeof (error as { stderr?: unknown }).stderr === "string"
          ? (error as { stderr: string }).stderr
          : "";

      if (!stdout.trim() && !existsSync(outputFilePath)) {
        throw error;
      }
    }

    output = existsSync(outputFilePath)
      ? readFileSync(outputFilePath, "utf8").trim()
      : stdout.trim();

    if (!output) {
      throw new Error(
        stderr.trim() || `Bridge action '${action}' returned no output.`,
      );
    }

    let response: BridgeResponse<T>;

    try {
      response = JSON.parse(output) as BridgeResponse<T>;
    } catch (error) {
      throw new Error(
        `Bridge action '${action}' returned invalid JSON (${output.length} bytes). ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    return response.data;
  } finally {
    rmSync(tempDirectoryPath, { recursive: true, force: true });
  }
}

function runBridgeProcess(
  args: string[],
  forwardStderr: boolean,
): Promise<BridgeProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", args, {
      cwd: repoRootPath,
      env: buildBridgeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finishWithError = (error: Error & { stderr?: string; stdout?: string }) => {
      if (settled) {
        return;
      }

      settled = true;
      error.stdout = Buffer.concat(stdoutChunks).toString("utf8");
      error.stderr = Buffer.concat(stderrChunks).toString("utf8");
      reject(error);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;

      if (stdoutBytes > BRIDGE_MAX_BUFFER_BYTES) {
        child.kill();
        finishWithError(new Error("Bridge stdout exceeded max buffer."));
        return;
      }

      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;

      if (stderrBytes > BRIDGE_MAX_BUFFER_BYTES) {
        child.kill();
        finishWithError(new Error("Bridge stderr exceeded max buffer."));
        return;
      }

      stderrChunks.push(chunk);

      if (forwardStderr) {
        process.stderr.write(chunk);
      }
    });

    child.once("error", (error) => {
      finishWithError(error as Error & { stderr?: string; stdout?: string });
    });

    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }

      const reason = signal
        ? `Bridge process exited from signal ${signal}.`
        : `Bridge process exited with code ${code ?? "unknown"}.`;
      const error = new Error(reason) as Error & {
        stderr?: string;
        stdout?: string;
      };
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function shouldForwardBridgeStderr(action: string): boolean {
  return action === "discover";
}

function buildBridgeEnv(): NodeJS.ProcessEnv {
  const daemonEnv = readDotEnvFile(daemonEnvFilePath);

  return {
    ...daemonEnv,
    ...process.env,
  };
}

function readDotEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    parsed[key] = unquoteEnvValue(rawValue);
  }

  return parsed;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
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
  device: DiscoveredDevice;
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

export function setBatteryPowerLimits(input: {
  id: string;
  maximumChargePowerW: number;
  maximumDischargePowerW: number;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("battery-set-power-limits", input);
}

export function deleteBattery(input: { id: string; siteId: string }) {
  return runBridge<ManagedDeviceRecord>("battery-delete", input);
}

export function setHouseStrategy(input: {
  manualLabel?: string | null;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
  manualPowerW: number | null;
  manualState: "idle" | "charging" | "discharging" | null;
  manualTargetSoc: number | null;
  targetMethod?: "soc" | "duration" | "end-time" | "auto" | null;
  targetDurationMinutes?: number | null;
  targetEndTime?: string | null;
  manualModeActive?: boolean;
  siteId: string;
  strategyMode: "auto" | "manual" | "self-consumption";
}) {
  return runBridge<ManagedDeviceRecord[]>("house-strategy-set", input);
}

export function setHouseStrategyPlan(input: {
  siteId: string;
  strategyPlan: BatteryStrategyPlanRecord;
}) {
  return runBridge<ManagedDeviceRecord[]>("house-strategy-plan-set", input);
}

export function createMeterFromDiscovery(input: {
  device: DiscoveredDevice;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("meter-create", input);
}

export function createSolarEnergyProviderFromDiscovery(input: {
  device: DiscoveredDevice;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("solar-energy-provider-create", input);
}

export function addAllFromDiscovery(input: {
  devices: DiscoveredDevice[];
  siteId: string;
}) {
  return runBridge<BulkDiscoveryAddResult>("discovery-add-all", input);
}

export type { DiscoveredDevice };

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

export function deleteSolarEnergyProvider(input: {
  id: string;
  siteId: string;
}) {
  return runBridge<ManagedDeviceRecord>("solar-energy-provider-delete", input);
}

export function setSolarEnergyProviderProductionEnabled(input: {
  enabled: boolean;
  id: string;
  siteId: string;
}) {
  return runBridge<unknown>(
    "solar-energy-provider-set-production-enabled",
    input,
  );
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

export function requestWeatherForecastRefresh(input: { siteId: string }) {
  return runBridge<{ requested: boolean }>("weather-request-refresh", input);
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

export function updateDynamicPriceSourceExportDeduction(input: {
  exportDeduction: number;
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

export function getDynamicPriceSnapshot(input: { siteId: string }) {
  return runBridge<DynamicPriceSnapshotRecord>("price-get-snapshot", input);
}

export function refreshDynamicPriceSnapshot(input: { siteId: string }) {
  return runBridge<DynamicPriceSnapshotRecord>("price-refresh-snapshot", input);
}

export function requestDynamicPriceSnapshotRefresh(input: { siteId: string }) {
  return runBridge<{ requested: boolean }>("price-request-refresh", input);
}

export function getHistoryArchive(input: {
  day?: string | null;
  siteId: string;
}) {
  return runBridge<HistoryArchive>("history-get-archive", input);
}
