import type {
  BatteryManualState,
  BatteryRecord,
  BatteryStrategyMode,
  NormalizedBatteryInfo,
} from "@emsd/core";
import { deriveBatteryStatusFromPower } from "@emsd/core";
import { fetchWithAction } from "./plugins/shared";

const INDEVOLT_PORT = 8080;
const INDEVOLT_MAX_POWER_W = 2400;
const INDEVOLT_CAPACITY_POINT = 142;
const INDEVOLT_TELEMETRY_POINTS = [6000, 6001, 6002, 7101];
const HOMEWIZARD_PORT = 443;
const SONNEN_MAX_POWER_W = 3300;

interface BatteryStrategyCommand {
  strategyMode: BatteryStrategyMode;
  manualPowerW: number | null;
  manualState: BatteryManualState | null;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
  manualTargetSoc: number | null;
}

export abstract class BatteryPlugin {
  constructor(protected readonly battery: BatteryRecord) {}

  abstract getNormalizedInfo(): Promise<NormalizedBatteryInfo>;

  abstract setStrategy(command: BatteryStrategyCommand): Promise<void>;

  supportsStrategy(mode: BatteryStrategyMode): boolean {
    return mode !== "auto";
  }
}

export function createBatteryPlugin(battery: BatteryRecord): BatteryPlugin {
  if (battery.plugin === "indevolt-battery") {
    return new IndevoltBatteryPlugin(battery);
  }

  if (battery.plugin === "sonnenbatterie") {
    return new SonnenBatteryPlugin(battery);
  }

  if (battery.plugin === "homewizard-battery") {
    return new HomeWizardBatteryPlugin(battery);
  }

  throw new Error(`Unsupported battery plugin: ${battery.plugin}`);
}

class IndevoltBatteryPlugin extends BatteryPlugin {
  async getNormalizedInfo(): Promise<NormalizedBatteryInfo> {
    const payload = await fetchIndevoltTelemetry(this.battery.ipAddress);
    const currentW = parseIndevoltSignedPower(payload);

    return {
      capacityWh: parseNullableKiloWattHours(
        payload?.[String(INDEVOLT_CAPACITY_POINT)],
      ),
      currentW,
      manualChargeTargetSoc: this.battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: this.battery.manualDischargeTargetSoc,
      manualPowerW: this.battery.manualPowerW,
      manualState: this.battery.manualState,
      manualTargetSoc: this.battery.manualTargetSoc,
      model: this.battery.model,
      name: this.battery.name,
      socPercent: parseNullableNumber(payload?.["6002"]),
      status: deriveBatteryStatusFromPower(currentW),
      strategyMode: parseIndevoltStrategyMode(payload?.["7101"]),
    };
  }

  async setStrategy(command: BatteryStrategyCommand): Promise<void> {
    if (!this.supportsStrategy(command.strategyMode)) {
      throw new Error(
        `Battery strategy '${command.strategyMode}' is not supported by ${this.battery.plugin}`,
      );
    }

    if (command.strategyMode === "self-consumption") {
      await setIndevoltData(this.battery.ipAddress, 47005, [1]);
      return;
    }

    const manualState = command.manualState ?? "idle";
    const manualPowerW = clampManualPower(command.manualPowerW);
    const manualTargetSoc = clampTargetSoc(
      command.manualTargetSoc ??
        resolveManualTargetSoc({
          manualState,
          manualChargeTargetSoc: command.manualChargeTargetSoc,
          manualDischargeTargetSoc: command.manualDischargeTargetSoc,
        }) ??
        getDefaultTargetSoc(manualState, this.battery.minimumDischargePercent),
      manualState,
      this.battery.minimumDischargePercent,
    );

    await setIndevoltData(this.battery.ipAddress, 47005, [4]);
    await setIndevoltData(this.battery.ipAddress, 47015, [
      encodeManualState(manualState),
    ]);
    await setIndevoltData(this.battery.ipAddress, 47016, [manualPowerW]);
    await setIndevoltData(this.battery.ipAddress, 47017, [manualTargetSoc]);
  }
}

class SonnenBatteryPlugin extends BatteryPlugin {
  async getNormalizedInfo(): Promise<NormalizedBatteryInfo> {
    const payload = await fetchSonnenJson(
      this.battery.ipAddress,
      "/api/v2/status",
      { authenticated: false },
    );
    const socPercent = parseNullableNumber(payload?.RSOC);
    const remainingCapacityWh = parseNullableNumber(
      payload?.RemainingCapacity_W,
    );
    const currentW = parseSonnenSignedPower(payload);

    return {
      capacityWh: inferSonnenCapacityWh(remainingCapacityWh, socPercent),
      currentW,
      manualChargeTargetSoc: this.battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: this.battery.manualDischargeTargetSoc,
      manualPowerW: this.battery.manualPowerW,
      manualState: this.battery.manualState,
      manualTargetSoc: this.battery.manualTargetSoc,
      model: this.battery.model,
      name: this.battery.name,
      socPercent,
      status: deriveBatteryStatusFromPower(currentW),
      strategyMode: parseSonnenStrategyMode(payload?.OperatingMode),
    };
  }

  async setStrategy(command: BatteryStrategyCommand): Promise<void> {
    if (!this.supportsStrategy(command.strategyMode)) {
      throw new Error(
        `Battery strategy '${command.strategyMode}' is not supported by ${this.battery.plugin}`,
      );
    }

    if (command.strategyMode === "self-consumption") {
      await putSonnenConfiguration(this.battery.ipAddress, {
        EM_OperatingMode: "2",
      });
      return;
    }

    const manualState = command.manualState ?? "idle";
    const manualPowerW = clampSonnenManualPower(command.manualPowerW);

    await putSonnenConfiguration(this.battery.ipAddress, {
      EM_OperatingMode: "1",
    });
    await postSonnenSetpoint(this.battery.ipAddress, manualState, manualPowerW);
  }
}

class HomeWizardBatteryPlugin extends BatteryPlugin {
  async getNormalizedInfo(): Promise<NormalizedBatteryInfo> {
    const payload = await fetchHomeWizardJson(
      this.battery.ipAddress,
      "/api/batteries",
    );

    const currentW = parseInvertedRoundedNumber(payload?.power_w);

    return {
      capacityWh: null,
      currentW,
      manualChargeTargetSoc: this.battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: this.battery.manualDischargeTargetSoc,
      manualPowerW: this.battery.manualPowerW,
      manualState: this.battery.manualState,
      manualTargetSoc: this.battery.manualTargetSoc,
      model: this.battery.model,
      name: this.battery.name,
      socPercent: null,
      status: deriveBatteryStatusFromPower(currentW),
      strategyMode: parseHomeWizardStrategyMode(payload),
    };
  }

  async setStrategy(command: BatteryStrategyCommand): Promise<void> {
    if (!this.supportsStrategy(command.strategyMode)) {
      throw new Error(
        `Battery strategy '${command.strategyMode}' is not supported by ${this.battery.plugin}`,
      );
    }

    if (command.strategyMode === "self-consumption") {
      await putHomeWizardBatteries(this.battery.ipAddress, {
        mode: "zero",
        permissions: ["charge_allowed", "discharge_allowed"],
      });
      return;
    }

    const manualState = command.manualState ?? "idle";

    if (manualState === "charging") {
      await putHomeWizardBatteries(this.battery.ipAddress, {
        mode: "to_full",
      });
      return;
    }

    await putHomeWizardBatteries(this.battery.ipAddress, {
      mode: manualState === "idle" ? "standby" : "zero",
      permissions: manualState === "discharging" ? ["discharge_allowed"] : [],
    });
  }
}

async function fetchIndevoltTelemetry(
  host: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await fetchIndevoltData(host, [
      INDEVOLT_CAPACITY_POINT,
      ...INDEVOLT_TELEMETRY_POINTS,
    ]);
  } catch (error) {
    if (!isBatteryTelemetryTimeout(error)) {
      throw error;
    }

    return fetchIndevoltData(host, INDEVOLT_TELEMETRY_POINTS);
  }
}

async function fetchIndevoltData(
  host: string,
  points: number[],
): Promise<Record<string, unknown> | null> {
  const config = JSON.stringify({ t: points }).replaceAll(" ", "");
  const url = `http://${host}:${INDEVOLT_PORT}/rpc/Indevolt.GetData?config=${encodeURIComponent(config)}`;
  const response = await fetchWithAction(
    url,
    { method: "POST" },
    "Battery telemetry request",
  );

  if (!response.ok) {
    throw new Error(
      `Battery telemetry request failed with HTTP ${response.status} for ${url}`,
    );
  }

  return parseJsonObject(await response.text());
}

function isBatteryTelemetryTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    error.name === "AbortError" ||
    message.startsWith("battery telemetry request timed out ")
  );
}

async function setIndevoltData(
  host: string,
  point: number,
  value: number[],
): Promise<void> {
  const config = JSON.stringify({ f: 16, t: point, v: value }).replaceAll(
    " ",
    "",
  );
  const url = `http://${host}:${INDEVOLT_PORT}/rpc/Indevolt.SetData?config=${encodeURIComponent(config)}`;
  const response = await fetchWithAction(
    url,
    { method: "POST" },
    "Battery control request",
  );

  if (!response.ok) {
    throw new Error(
      `Battery control request failed with HTTP ${response.status} for ${url}`,
    );
  }

  const payload = parseJsonObject(await response.text());

  if (!payload?.result) {
    throw new Error(`Battery control request was rejected by ${host}`);
  }
}

async function fetchSonnenJson(
  host: string,
  path: string,
  options: { authenticated: boolean },
): Promise<Record<string, unknown> | null> {
  const token = options.authenticated ? getSonnenAuthToken(host) : null;
  const url = `http://${host}${path}`;
  const response = await fetchWithAction(
    url,
    {
      method: "GET",
      headers: buildSonnenHeaders(token),
    },
    "Battery telemetry request",
  );

  if (!response.ok) {
    throw new Error(
      `Battery telemetry request failed with HTTP ${response.status} for ${url}`,
    );
  }

  return parseJsonObject(await response.text());
}

async function putSonnenConfiguration(
  host: string,
  values: Record<string, string>,
): Promise<void> {
  const url = `http://${host}/api/v2/configurations`;
  const response = await fetchWithAction(
    url,
    {
      method: "PUT",
      headers: {
        ...buildSonnenHeaders(getSonnenAuthToken(host)),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(values).toString(),
    },
    "Battery control request",
  );

  if (!response.ok) {
    throw new Error(
      `Battery control request failed with HTTP ${response.status} for ${url}`,
    );
  }
}

async function fetchHomeWizardJson(
  host: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  const url = `https://${host}:${HOMEWIZARD_PORT}${path}`;
  const response = await fetchWithAction(
    url,
    {
      method: "GET",
      headers: buildHomeWizardHeaders(host),
    } as RequestInit & { tls?: { rejectUnauthorized: boolean } },
    "Battery telemetry request",
  );

  if (!response.ok) {
    throw new Error(
      `Battery telemetry request failed with HTTP ${response.status} for ${url}`,
    );
  }

  return parseJsonObject(await response.text());
}

async function putHomeWizardBatteries(
  host: string,
  payload: {
    mode: "zero" | "to_full" | "standby";
    permissions?: string[];
  },
): Promise<void> {
  const url = `https://${host}:${HOMEWIZARD_PORT}/api/batteries`;
  const response = await fetchWithAction(
    url,
    {
      method: "PUT",
      headers: {
        ...buildHomeWizardHeaders(host),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    } as RequestInit & { tls?: { rejectUnauthorized: boolean } },
    "Battery control request",
  );

  if (!response.ok) {
    throw new Error(
      `Battery control request failed with HTTP ${response.status} for ${url}`,
    );
  }
}

async function postSonnenSetpoint(
  host: string,
  state: BatteryManualState,
  powerW: number,
): Promise<void> {
  const direction = state === "discharging" ? "discharge" : "charge";
  const url = `http://${host}/api/v2/setpoint/${direction}/${powerW}`;
  const response = await fetchWithAction(
    url,
    {
      method: "POST",
      headers: buildSonnenHeaders(getSonnenAuthToken(host)),
    },
    "Battery control request",
  );

  if (!response.ok) {
    throw new Error(
      `Battery control request failed with HTTP ${response.status} for ${url}`,
    );
  }

  const payload = await response.text();

  if (payload.trim() !== "true") {
    throw new Error(`Battery control request was rejected by ${host}`);
  }
}

function buildSonnenHeaders(token: string | null): Record<string, string> {
  return token === null
    ? { accept: "application/json" }
    : {
        accept: "application/json",
        "Auth-Token": token,
      };
}

function buildHomeWizardHeaders(host: string): Record<string, string> {
  const token = getHomeWizardAuthToken(host);

  return {
    accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-Api-Version": "2",
  };
}

function getSonnenAuthToken(host: string): string {
  const hostKey = host.replaceAll(".", "_");
  const token =
    process.env[`SONNEN_BATTERY_AUTH_TOKEN_${hostKey}`] ??
    process.env.SONNEN_BATTERY_AUTH_TOKEN;

  if (!token || token.trim().length === 0) {
    throw new Error(
      `Missing sonnen auth token for ${host}. Set SONNEN_BATTERY_AUTH_TOKEN or SONNEN_BATTERY_AUTH_TOKEN_${hostKey}.`,
    );
  }

  return token.trim();
}

function getHomeWizardAuthToken(host: string): string {
  const hostKey = host.replaceAll(".", "_");
  const token =
    process.env[`HOMEWIZARD_BATTERY_AUTH_TOKEN_${hostKey}`] ??
    process.env.HOMEWIZARD_BATTERY_AUTH_TOKEN;

  if (!token || token.trim().length === 0) {
    throw new Error(
      `Missing HomeWizard auth token for ${host}. Set HOMEWIZARD_BATTERY_AUTH_TOKEN or HOMEWIZARD_BATTERY_AUTH_TOKEN_${hostKey}.`,
    );
  }

  return token.trim();
}

function parseJsonObject(responseText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(responseText) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
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

function parseNullableKiloWattHours(value: unknown): number | null {
  const parsed = parseNullableNumber(value);

  if (parsed === null) {
    return null;
  }

  return Math.round(parsed * 1000);
}

function parseSonnenSignedPower(
  payload: Record<string, unknown> | null,
): number | null {
  const parsedPower = parseNullableNumber(payload?.Pac_total_W);

  if (parsedPower === null) {
    return null;
  }

  const normalizedPower = Math.abs(Math.round(parsedPower));

  if (payload?.BatteryCharging === true) {
    return -normalizedPower;
  }

  if (payload?.BatteryDischarging === true) {
    return normalizedPower;
  }

  return 0;
}

function parseIndevoltSignedPower(
  payload: Record<string, unknown> | null,
): number | null {
  const parsedPower = parseNullableNumber(payload?.["6000"]);
  const stateCode = String(payload?.["6001"] ?? "");

  if (parsedPower === null) {
    return null;
  }

  const normalizedPower = Math.abs(Math.round(parsedPower));

  switch (stateCode) {
    case "1001":
      return -normalizedPower;
    case "1002":
      return normalizedPower;
    case "1000":
      return 0;
    default:
      return Math.round(parsedPower);
  }
}

function parseIndevoltStrategyMode(value: unknown): BatteryStrategyMode {
  switch (String(value)) {
    case "1":
      return "self-consumption";
    case "4":
      return "manual";
    default:
      return "auto";
  }
}

function parseSonnenStrategyMode(value: unknown): BatteryStrategyMode {
  switch (String(value)) {
    case "1":
      return "manual";
    case "2":
      return "self-consumption";
    default:
      return "auto";
  }
}

function parseHomeWizardStrategyMode(
  payload: Record<string, unknown> | null,
): BatteryStrategyMode {
  const mode = String(payload?.mode ?? "");
  const permissions = new Set(
    Array.isArray(payload?.permissions)
      ? payload.permissions.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  );

  if (mode === "to_full" || mode === "standby") {
    return "manual";
  }

  if (mode === "zero") {
    return permissions.has("charge_allowed") &&
      permissions.has("discharge_allowed")
      ? "self-consumption"
      : "manual";
  }

  return "auto";
}

function inferSonnenCapacityWh(
  remainingCapacityWh: number | null,
  socPercent: number | null,
): number | null {
  if (
    remainingCapacityWh === null ||
    socPercent === null ||
    socPercent <= 0 ||
    socPercent > 100
  ) {
    return null;
  }

  return Math.round(remainingCapacityWh / (socPercent / 100));
}

function clampSonnenManualPower(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(SONNEN_MAX_POWER_W, Math.round(value)));
}

function getStringNumber(value: unknown): number | null {
  const parsed = parseNullableNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function parseInvertedRoundedNumber(value: unknown): number | null {
  const parsed = parseNullableNumber(value);

  if (parsed === null) {
    return null;
  }

  return -Math.round(parsed);
}

function encodeManualState(state: BatteryManualState): number {
  switch (state) {
    case "idle":
      return 0;
    case "charging":
      return 1;
    case "discharging":
      return 2;
  }
}

function clampManualPower(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(INDEVOLT_MAX_POWER_W, Math.round(value)));
}

function clampTargetSoc(
  value: number,
  state: BatteryManualState,
  minimumDischargePercent: number,
): number {
  const minimum = state === "discharging" ? minimumDischargePercent : 5;
  return Math.max(minimum, Math.min(100, Math.round(value)));
}

function getDefaultTargetSoc(
  state: BatteryManualState,
  minimumDischargePercent: number,
): number {
  return state === "discharging" ? minimumDischargePercent : 100;
}

function resolveManualTargetSoc(input: {
  manualState: BatteryManualState;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
}): number | null {
  if (input.manualState === "charging") {
    return input.manualChargeTargetSoc;
  }

  if (input.manualState === "discharging") {
    return input.manualDischargeTargetSoc;
  }

  return null;
}
