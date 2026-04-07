import type {
  BatteryManualState,
  BatteryRecord,
  BatteryStrategyMode,
  NormalizedBatteryInfo,
} from "@emsd/core";

const INDEVOLT_PORT = 8080;
const INDEVOLT_MAX_POWER_W = 2400;

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

  throw new Error(`Unsupported battery plugin: ${battery.plugin}`);
}

class IndevoltBatteryPlugin extends BatteryPlugin {
  async getNormalizedInfo(): Promise<NormalizedBatteryInfo> {
    const payload = await fetchIndevoltData(
      this.battery.ipAddress,
      [142, 6000, 6001, 6002, 7101],
    );

    return {
      capacityWh: parseNullableKiloWattHours(payload?.["142"]),
      currentW: parseNullableNumber(payload?.["6000"]),
      manualChargeTargetSoc: this.battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: this.battery.manualDischargeTargetSoc,
      manualPowerW: this.battery.manualPowerW,
      manualState: this.battery.manualState,
      manualTargetSoc: this.battery.manualTargetSoc,
      model: this.battery.model,
      name: this.battery.name,
      socPercent: parseNullableNumber(payload?.["6002"]),
      status: parseIndevoltBatteryStatus(payload?.["6001"]),
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

async function fetchIndevoltData(
  host: string,
  points: number[],
): Promise<Record<string, unknown> | null> {
  const config = JSON.stringify({ t: points }).replaceAll(" ", "");
  const response = await fetch(
    `http://${host}:${INDEVOLT_PORT}/rpc/Indevolt.GetData?config=${encodeURIComponent(config)}`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(
      `Battery telemetry request failed with HTTP ${response.status}`,
    );
  }

  return parseJsonObject(await response.text());
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
  const response = await fetch(
    `http://${host}:${INDEVOLT_PORT}/rpc/Indevolt.SetData?config=${encodeURIComponent(config)}`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(
      `Battery control request failed with HTTP ${response.status}`,
    );
  }

  const payload = parseJsonObject(await response.text());

  if (!payload?.result) {
    throw new Error(`Battery control request was rejected by ${host}`);
  }
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

function parseIndevoltBatteryStatus(
  value: unknown,
): NormalizedBatteryInfo["status"] {
  switch (String(value)) {
    case "1000":
      return "idle";
    case "1001":
      return "charging";
    case "1002":
      return "discharging";
    default:
      return "offline";
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
