import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EMSD_NAME = "EMSD";

export type BatteryStatus = "idle" | "charging" | "discharging" | "offline";

export type BatteryStrategyMode = "auto" | "manual" | "self-consumption";

export type BatteryManualState = "idle" | "charging" | "discharging";

export interface BatteryStrategyRecord {
  strategyMode: BatteryStrategyMode;
  manualPowerW: number | null;
  manualState: BatteryManualState | null;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
  manualTargetSoc: number | null;
}

export type BatteryStrategyPlanItemKind = "default" | "daily";

export type BatteryStrategyTargetMethod = "soc" | "duration" | "end-time";

export type BatteryStrategyTriggerKind =
  | "daily-time"
  | "dynamic-price"
  | "weather"
  | "expected-solar";

export interface BatteryStrategyPlanItem extends BatteryStrategyRecord {
  id: string;
  kind: BatteryStrategyPlanItemKind;
  startTime: string | null;
  targetDurationMinutes: number | null;
  targetEndTime: string | null;
  targetMethod: BatteryStrategyTargetMethod | null;
  triggerKind: BatteryStrategyTriggerKind | null;
}

export type BatteryStrategyPlanRecord = BatteryStrategyPlanItem[];

export interface BatteryStrategyRuntimeRecord {
  activeItemId: string | null;
  activeStartedAt: string | null;
  lastTriggeredAtByItemId: Record<string, string>;
}

export interface NormalizedBatteryInfo extends BatteryStrategyRecord {
  capacityWh: number | null;
  currentW: number | null;
  model: string;
  name: string;
  socPercent: number | null;
  status: BatteryStatus;
}

export type DiscoveryCategory = "battery" | "meter";

export interface DiscoverReportDevice {
  discoveryId: string;
  category: DiscoveryCategory;
  model: string;
  name: string;
  ipAddress: string;
  details: string;
}

export interface SiteRecord {
  id: string;
  location: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type WeatherProvider = "open-meteo";

export type WeatherForecastSurface = "open-meteo-shortwave-radiation";

export interface WeatherForecastSourceRecord {
  id: string;
  siteId: string;
  name: string;
  provider: WeatherProvider;
  surface: WeatherForecastSurface;
  updatedAt: string;
}

export interface WeatherForecastPointRecord {
  airTempC: number | null;
  cloudOpacityPercent: number | null;
  ghiWm2: number | null;
  period: string;
  periodEnd: string;
  value: number | null;
}

export interface WeatherForecastRecord {
  generatedAt: string;
  hours: number;
  location: string;
  metricLabel: string;
  periodMinutes: number;
  points: WeatherForecastPointRecord[];
  provider: WeatherProvider;
  providerLabel: string;
  sourceId: string | null;
  sourceName: string;
  unitLabel: string;
}

export interface DynamicPriceSourceRecord {
  id: string;
  homeId: string | null;
  siteId: string;
  name: string;
  provider: "tibber";
  updatedAt: string;
}

export interface DynamicPricePointRecord {
  currency: string;
  importPrice: number;
  startsAt: string;
}

export interface DynamicPriceSnapshotRecord {
  currency: string;
  generatedAt: string;
  points: DynamicPricePointRecord[];
  provider: "tibber";
  providerLabel: string;
  siteId: string;
  sourceId: string | null;
  sourceName: string;
}

export interface DiscoverReport {
  schema: "emsd.discover.report.v1";
  reportedAt: string;
  host: string | null;
  subnet: string | null;
  interfaceName: string | null;
  devices: DiscoverReportDevice[];
}

export const discoverReportJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://emsd.local/schemas/discover-report.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "reportedAt",
    "host",
    "subnet",
    "interfaceName",
    "devices",
  ],
  properties: {
    schema: {
      type: "string",
      const: "emsd.discover.report.v1",
    },
    reportedAt: {
      type: "string",
      format: "date-time",
    },
    host: {
      type: ["string", "null"],
      format: "ipv4",
    },
    subnet: {
      type: ["string", "null"],
    },
    interfaceName: {
      type: ["string", "null"],
    },
    devices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "discoveryId",
          "category",
          "model",
          "name",
          "ipAddress",
          "details",
        ],
        properties: {
          discoveryId: {
            type: "string",
            minLength: 1,
          },
          category: {
            type: "string",
            enum: ["battery", "meter"],
          },
          model: {
            type: "string",
            minLength: 1,
          },
          name: {
            type: "string",
            minLength: 1,
          },
          ipAddress: {
            type: "string",
            format: "ipv4",
          },
          details: {
            type: "string",
          },
        },
      },
    },
  },
} as const;

export interface BatteryRecord extends BatteryStrategyRecord {
  id: string;
  siteId: string;
  name: string;
  plugin: string;
  model: string;
  ipAddress: string;
  enabled: boolean;
  status: BatteryStatus;
  connected: boolean;
  minimumDischargePercent: number;
  nowModeActive: boolean;
  nowModeStarted: boolean;
  strategyPlan: BatteryStrategyPlanRecord;
  strategyRuntime: BatteryStrategyRuntimeRecord;
  updatedAt: string;
}

export interface MeterRecord {
  id: string;
  siteId: string;
  name: string;
  model: string;
  ipAddress: string;
  enabled: boolean;
  connected: boolean;
  details: string;
  updatedAt: string;
}

export type ManagedDeviceKind = "battery" | "meter";

export type ManagedDeviceState =
  | "idle"
  | "charging"
  | "discharging"
  | "connected"
  | "offline";

export interface ManagedDeviceRecord {
  id: string;
  siteId: string;
  kind: ManagedDeviceKind;
  name: string;
  model: string;
  address: string;
  enabled: boolean;
  connected: boolean;
  state: ManagedDeviceState;
  batteryStrategy: BatteryStrategyRecord | null;
  batteryStrategyPlan: BatteryStrategyPlanRecord | null;
  batteryNowModeActive: boolean;
  minimumDischargePercent: number | null;
  note: string | null;
  updatedAt: string;
}

export function createBatteryStrategyRuntime(): BatteryStrategyRuntimeRecord {
  return {
    activeItemId: null,
    activeStartedAt: null,
    lastTriggeredAtByItemId: {},
  };
}

export function resolveBatteryStrategyFromPlanItem(input: {
  item: BatteryStrategyPlanItem | null | undefined;
  minimumDischargePercent: number;
}): BatteryStrategyRecord {
  const item = input.item;

  if (!item || item.strategyMode === "self-consumption") {
    return {
      strategyMode: "self-consumption",
      manualState: null,
      manualPowerW: null,
      manualTargetSoc: 100,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: input.minimumDischargePercent,
    };
  }

  return {
    strategyMode: "manual",
    manualState: item.manualState ?? "idle",
    manualPowerW:
      item.manualState === "idle" ? null : (item.manualPowerW ?? 2400),
    manualTargetSoc:
      item.manualState === "discharging"
        ? (item.manualDischargeTargetSoc ?? input.minimumDischargePercent)
        : (item.manualChargeTargetSoc ?? 100),
    manualChargeTargetSoc: item.manualChargeTargetSoc ?? 100,
    manualDischargeTargetSoc:
      item.manualDischargeTargetSoc ?? input.minimumDischargePercent,
  };
}

export function createBatteryStrategyPlanId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createDefaultBatteryStrategyPlan(
  strategy: BatteryStrategyRecord,
  minimumDischargePercent: number,
): BatteryStrategyPlanRecord {
  return [
    {
      id: createBatteryStrategyPlanId(),
      kind: "default",
      startTime: null,
      targetDurationMinutes: null,
      targetEndTime: null,
      targetMethod: null,
      triggerKind: null,
      strategyMode:
        strategy.strategyMode === "self-consumption"
          ? "self-consumption"
          : "manual",
      manualState: strategy.strategyMode === "self-consumption" ? null : "idle",
      manualPowerW: null,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: minimumDischargePercent,
      manualTargetSoc: 100,
    },
  ];
}

export function normalizeBatteryStrategyPlan(input: {
  minimumDischargePercent: number;
  strategy: BatteryStrategyRecord;
  value: unknown;
}): BatteryStrategyPlanRecord {
  const fallback = createDefaultBatteryStrategyPlan(
    input.strategy,
    input.minimumDischargePercent,
  );

  if (!Array.isArray(input.value)) {
    return fallback;
  }

  const items = input.value
    .map((entry, index) =>
      normalizeBatteryStrategyPlanItem(entry, input.minimumDischargePercent),
    )
    .filter((entry): entry is BatteryStrategyPlanItem => entry !== null);

  if (items.length === 0) {
    return fallback;
  }

  const firstItem = items[0];

  if (!firstItem) {
    return fallback;
  }

  const restItems = items.slice(1);
  const normalizedFirstItem: BatteryStrategyPlanItem = {
    ...firstItem,
    kind: "default",
    startTime: null,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: null,
    triggerKind: null,
    strategyMode:
      firstItem.strategyMode === "self-consumption"
        ? "self-consumption"
        : "manual",
    manualState: firstItem.strategyMode === "self-consumption" ? null : "idle",
    manualPowerW: null,
  };

  const normalizedRestItems = restItems.map((item) => ({
    ...item,
    kind: "daily" as const,
    startTime: isDailyStartTime(item.startTime) ? item.startTime : "08:00",
    triggerKind: normalizeTriggerKind(item.triggerKind) ?? "daily-time",
    targetMethod: normalizeTargetMethod(item.targetMethod),
    targetDurationMinutes:
      normalizeTargetMethod(item.targetMethod) === "duration"
        ? normalizeTargetDurationMinutes(item.targetDurationMinutes)
        : null,
    targetEndTime:
      normalizeTargetMethod(item.targetMethod) === "end-time" &&
      isDailyStartTime(item.targetEndTime)
        ? item.targetEndTime
        : null,
  }));

  return [normalizedFirstItem, ...normalizedRestItems];
}

export function parseBatteryStrategyPlanJson(input: {
  minimumDischargePercent: number;
  strategy: BatteryStrategyRecord;
  value: string | null | undefined;
}): BatteryStrategyPlanRecord {
  if (!input.value) {
    return createDefaultBatteryStrategyPlan(
      input.strategy,
      input.minimumDischargePercent,
    );
  }

  try {
    return normalizeBatteryStrategyPlan({
      minimumDischargePercent: input.minimumDischargePercent,
      strategy: input.strategy,
      value: JSON.parse(input.value),
    });
  } catch {
    return createDefaultBatteryStrategyPlan(
      input.strategy,
      input.minimumDischargePercent,
    );
  }
}

export function stringifyBatteryStrategyPlan(
  plan: BatteryStrategyPlanRecord,
  strategy: BatteryStrategyRecord,
  minimumDischargePercent: number,
): string {
  return JSON.stringify(
    normalizeBatteryStrategyPlan({
      minimumDischargePercent,
      strategy,
      value: plan,
    }),
  );
}

function normalizeBatteryStrategyPlanItem(
  value: unknown,
  minimumDischargePercent: number,
): BatteryStrategyPlanItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BatteryStrategyPlanItem>;
  const strategyMode =
    candidate.strategyMode === "self-consumption" ||
    candidate.strategyMode === "manual"
      ? candidate.strategyMode
      : null;

  if (strategyMode === null) {
    return null;
  }

  const manualState =
    candidate.manualState === "idle" ||
    candidate.manualState === "charging" ||
    candidate.manualState === "discharging"
      ? candidate.manualState
      : strategyMode === "manual"
        ? "idle"
        : null;
  const targetMethod = normalizeTargetMethod(candidate.targetMethod);
  const hasSocTarget = targetMethod === null || targetMethod === "soc";

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : createBatteryStrategyPlanId(),
    kind: candidate.kind === "daily" ? "daily" : "default",
    startTime:
      typeof candidate.startTime === "string" &&
      isDailyStartTime(candidate.startTime)
        ? candidate.startTime
        : null,
    triggerKind: normalizeTriggerKind(candidate.triggerKind),
    targetDurationMinutes:
      targetMethod === "duration"
        ? normalizeTargetDurationMinutes(candidate.targetDurationMinutes)
        : null,
    targetEndTime:
      targetMethod === "end-time" &&
      isDailyStartTime(candidate.targetEndTime ?? null)
        ? (candidate.targetEndTime ?? null)
        : null,
    targetMethod,
    strategyMode,
    manualState,
    manualPowerW:
      typeof candidate.manualPowerW === "number" &&
      Number.isFinite(candidate.manualPowerW)
        ? candidate.manualPowerW
        : null,
    manualChargeTargetSoc:
      hasSocTarget &&
      typeof candidate.manualChargeTargetSoc === "number" &&
      Number.isFinite(candidate.manualChargeTargetSoc)
        ? clampPercent(candidate.manualChargeTargetSoc, 5)
        : hasSocTarget &&
            strategyMode === "manual" &&
            manualState === "charging"
          ? 100
          : null,
    manualDischargeTargetSoc:
      hasSocTarget &&
      typeof candidate.manualDischargeTargetSoc === "number" &&
      Number.isFinite(candidate.manualDischargeTargetSoc)
        ? clampPercent(
            candidate.manualDischargeTargetSoc,
            minimumDischargePercent,
          )
        : hasSocTarget &&
            strategyMode === "manual" &&
            manualState === "discharging"
          ? minimumDischargePercent
          : null,
    manualTargetSoc:
      hasSocTarget &&
      typeof candidate.manualTargetSoc === "number" &&
      Number.isFinite(candidate.manualTargetSoc)
        ? clampPercent(candidate.manualTargetSoc, 5)
        : hasSocTarget
          ? strategyMode === "manual" && manualState === "discharging"
            ? minimumDischargePercent
            : 100
          : null,
  };
}

export function parseBatteryStrategyRuntimeJson(
  value: string | null | undefined,
): BatteryStrategyRuntimeRecord {
  if (!value) {
    return createBatteryStrategyRuntime();
  }

  try {
    return normalizeBatteryStrategyRuntime(JSON.parse(value));
  } catch {
    return createBatteryStrategyRuntime();
  }
}

export function stringifyBatteryStrategyRuntime(
  value: BatteryStrategyRuntimeRecord,
): string {
  return JSON.stringify(normalizeBatteryStrategyRuntime(value));
}

function normalizeBatteryStrategyRuntime(
  value: unknown,
): BatteryStrategyRuntimeRecord {
  if (!value || typeof value !== "object") {
    return createBatteryStrategyRuntime();
  }

  const candidate = value as Partial<BatteryStrategyRuntimeRecord>;
  const lastTriggeredAtByItemId =
    candidate.lastTriggeredAtByItemId &&
    typeof candidate.lastTriggeredAtByItemId === "object"
      ? Object.fromEntries(
          Object.entries(candidate.lastTriggeredAtByItemId).filter(
            ([itemId, triggeredAt]) =>
              typeof itemId === "string" && typeof triggeredAt === "string",
          ),
        )
      : {};

  return {
    activeItemId:
      typeof candidate.activeItemId === "string" &&
      candidate.activeItemId.length > 0
        ? candidate.activeItemId
        : null,
    activeStartedAt:
      typeof candidate.activeStartedAt === "string" &&
      candidate.activeStartedAt.length > 0
        ? candidate.activeStartedAt
        : null,
    lastTriggeredAtByItemId,
  };
}

function normalizeTargetMethod(
  value: BatteryStrategyPlanItem["targetMethod"] | undefined,
): BatteryStrategyTargetMethod | null {
  return value === "soc" || value === "duration" || value === "end-time"
    ? value
    : null;
}

function normalizeTriggerKind(
  value: BatteryStrategyPlanItem["triggerKind"] | undefined,
): BatteryStrategyTriggerKind | null {
  return value === "daily-time" ||
    value === "dynamic-price" ||
    value === "weather" ||
    value === "expected-solar"
    ? value
    : null;
}

function normalizeTargetDurationMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function isDailyStartTime(value: string | null): value is string {
  return value !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function clampPercent(value: number, minimum: number): number {
  return Math.max(minimum, Math.min(100, Math.round(value)));
}

export function formatManagedDeviceState(state: ManagedDeviceState): string {
  return state.replace(/-/g, " ");
}

export function parseGpsCoordinate(
  value: string,
): { latitude: number; longitude: number } | null {
  const matched = value
    .trim()
    .match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);

  if (!matched) {
    return null;
  }

  const latitude = Number(matched[1]);
  const longitude = Number(matched[2]);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
}

export interface ManagedDeviceTelemetryRecord {
  deviceId: string;
  siteId: string;
  kind: ManagedDeviceKind;
  powerW: number | null;
  socPercent: number | null;
  gasM3: number | null;
  state: ManagedDeviceState | null;
  observedAt: string;
}

export interface ManagedDeviceStatusRecord extends ManagedDeviceRecord {
  telemetry: ManagedDeviceTelemetryRecord | null;
}

export function getRepoRoot(): string {
  if (process.env.EMSD_REPO_ROOT) {
    return resolve(process.env.EMSD_REPO_ROOT);
  }

  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");
}

export function getDatabasePath(): string {
  const configuredPath = process.env.EMSD_DB_PATH;

  if (!configuredPath) {
    return resolve(getRepoRoot(), "data/emsd.sqlite");
  }

  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(getRepoRoot(), configuredPath);
}

export function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function getRuntimePath(...segments: string[]): string {
  return resolve(getRepoRoot(), "var/run", ...segments);
}

export function getDaemonLockPath(): string {
  return getRuntimePath("emsd.lock");
}
