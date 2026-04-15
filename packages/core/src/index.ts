import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export * from "./price-selection";

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
  activeObservedAt: string | null;
  activeStartSocPercent: number | null;
  lastTriggeredAtByItemId: Record<string, string>;
  manualTargetMethod?: BatteryStrategyTargetMethod | null;
  manualTargetDurationMinutes?: number | null;
  manualTargetEndTime?: string | null;
  manualTargetStartedAt?: string | null;
}

export interface NormalizedBatteryInfo extends BatteryStrategyRecord {
  capacityWh: number | null;
  currentW: number | null;
  model: string;
  name: string;
  socPercent: number | null;
  status: BatteryStatus;
}

export type DiscoveryCategory = "battery" | "meter" | "solar-energy-provider";

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
            enum: ["battery", "meter", "solar-energy-provider"],
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
  manualModeActive: boolean;
  manualModeStarted: boolean;
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

export interface SolarEnergyProviderRecord {
  id: string;
  siteId: string;
  name: string;
  plugin: string;
  ipAddress: string;
  enabled: boolean;
  connected: boolean;
  serialNumber: string | null;
  updatedAt: string;
}

export type ManagedDeviceKind = "battery" | "meter" | "solar-energy-provider";

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
  batteryStrategySummary: string | null;
  batteryManualTargetMethod: BatteryStrategyTargetMethod | null;
  batteryManualTargetDurationMinutes: number | null;
  batteryManualTargetEndTime: string | null;
  batteryManualModeActive: boolean;
  minimumDischargePercent: number | null;
  updatedAt: string;
}

export interface NormalizedSolarEnergyProviderInfo {
  currentPowerW: number | null;
  status: Extract<ManagedDeviceState, "connected" | "offline">;
}

export function createBatteryStrategyRuntime(): BatteryStrategyRuntimeRecord {
  return {
    activeItemId: null,
    activeStartedAt: null,
    activeObservedAt: null,
    activeStartSocPercent: null,
    lastTriggeredAtByItemId: {},
    manualTargetMethod: null,
    manualTargetDurationMinutes: null,
    manualTargetEndTime: null,
    manualTargetStartedAt: null,
  };
}

export function clearActiveBatteryStrategyRuntime(
  value: BatteryStrategyRuntimeRecord,
): BatteryStrategyRuntimeRecord {
  return {
    ...normalizeBatteryStrategyRuntime(value),
    activeItemId: null,
    activeStartedAt: null,
    activeObservedAt: null,
    activeStartSocPercent: null,
    manualTargetMethod: null,
    manualTargetDurationMinutes: null,
    manualTargetEndTime: null,
    manualTargetStartedAt: null,
  };
}

export function createBatteryStrategyRuntimeForPlanApply(
  plan: BatteryStrategyPlanRecord,
  now: Date,
): BatteryStrategyRuntimeRecord {
  const lastTriggeredAtByItemId: Record<string, string> = {};

  for (const item of plan.slice(1)) {
    const triggerAt = getBatteryStrategyPlanTriggerAt(item, now);

    if (triggerAt === null || triggerAt.getTime() >= now.getTime()) {
      continue;
    }

    lastTriggeredAtByItemId[item.id] = triggerAt.toISOString();
  }

  return {
    activeItemId: null,
    activeStartedAt: null,
    activeObservedAt: null,
    activeStartSocPercent: null,
    lastTriggeredAtByItemId,
    manualTargetMethod: null,
    manualTargetDurationMinutes: null,
    manualTargetEndTime: null,
    manualTargetStartedAt: null,
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
  const minimumSocTarget =
    strategyMode === "manual" &&
    (manualState === "discharging" || manualState === "idle")
      ? minimumDischargePercent
      : 5;

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
        ? clampPercent(candidate.manualTargetSoc, minimumSocTarget)
        : hasSocTarget
          ? strategyMode === "manual" &&
              (manualState === "discharging" || manualState === "idle")
            ? minimumDischargePercent
            : 100
          : null,
  };
}

function getBatteryStrategyPlanTriggerAt(
  item: BatteryStrategyPlanItem,
  now: Date,
): Date | null {
  if (
    item.kind !== "daily" ||
    item.triggerKind !== "daily-time" ||
    !isDailyStartTime(item.startTime)
  ) {
    return null;
  }

  const [hoursPart, minutesPart] = item.startTime.split(":");
  const triggerAt = new Date(now);
  triggerAt.setHours(
    Number(hoursPart ?? "0"),
    Number(minutesPart ?? "0"),
    0,
    0,
  );
  return triggerAt;
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
    activeObservedAt:
      typeof candidate.activeObservedAt === "string" &&
      candidate.activeObservedAt.length > 0
        ? candidate.activeObservedAt
        : null,
    activeStartSocPercent:
      typeof candidate.activeStartSocPercent === "number" &&
      Number.isFinite(candidate.activeStartSocPercent)
        ? candidate.activeStartSocPercent
        : null,
    lastTriggeredAtByItemId,
    manualTargetMethod: normalizeTargetMethod(candidate.manualTargetMethod),
    manualTargetDurationMinutes:
      normalizeTargetMethod(candidate.manualTargetMethod) === "duration"
        ? normalizeTargetDurationMinutes(candidate.manualTargetDurationMinutes)
        : null,
    manualTargetEndTime:
      normalizeTargetMethod(candidate.manualTargetMethod) === "end-time" &&
      isDailyStartTime(candidate.manualTargetEndTime ?? null)
        ? (candidate.manualTargetEndTime ?? null)
        : null,
    manualTargetStartedAt:
      typeof candidate.manualTargetStartedAt === "string" &&
      candidate.manualTargetStartedAt.length > 0
        ? candidate.manualTargetStartedAt
        : null,
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
  capacityWh: number | null;
  powerW: number | null;
  socPercent: number | null;
  state: ManagedDeviceState | null;
  observedAt: string;
}

export interface ManagedDeviceStatusRecord extends ManagedDeviceRecord {
  telemetry: ManagedDeviceTelemetryRecord | null;
}

export interface DynamicPriceSampleRecord {
  siteId: string;
  periodStart: string;
  generatedAt: string;
  currency: string;
  importPrice: number;
}

export interface SolarForecastSampleRecord {
  siteId: string;
  periodStart: string;
  generatedAt: string;
  value: number | null;
  ghiWm2: number | null;
  airTempC: number | null;
  cloudOpacityPercent: number | null;
}

export interface P1MeterSampleRecord {
  siteId: string;
  meterId: string;
  periodStart: string;
  observedAt: string;
  powerW: number | null;
}

export interface BatteryPowerSampleRecord {
  siteId: string;
  batteryId: string;
  periodStart: string;
  observedAt: string;
  powerW: number | null;
  socPercent: number | null;
}

export interface SolarEnergyProviderSampleRecord {
  siteId: string;
  providerId: string;
  periodStart: string;
  observedAt: string;
  powerW: number | null;
}

export interface PredictedSolarGenerationPoint {
  periodStart: string;
  value: number | null;
}

export const MAX_SOLAR_PREDICTION_PRECEDING_DAYS = 7;
export const SOLAR_PREDICTION_MATCH_TOLERANCE_MS = 7.5 * 60 * 1_000;

export interface DashboardSiteRecord extends SiteRecord {
  devices: ManagedDeviceStatusRecord[];
  dynamicPriceSources: DynamicPriceSourceRecord[];
  weatherSources: WeatherForecastSourceRecord[];
}

export interface DashboardSnapshot {
  generatedAt: string;
  sites: DashboardSiteRecord[];
}

export interface LiveStatusSnapshot extends DashboardSnapshot {
  daemon: {
    pid: number | null;
    running: boolean;
  };
}

export interface BulkDiscoveryAddResult {
  addedBatteries: number;
  addedMeters: number;
  addedSolarEnergyProviders: number;
  skippedDevices: number;
}

export interface HistoryArchive {
  batteryPowerSamples: BatteryPowerSampleRecord[];
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  siteId: string;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  solarForecastSamples: SolarForecastSampleRecord[];
}

export function buildPredictedSolarGenerationSeries(input: {
  forecastSamples: SolarForecastSampleRecord[];
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  targetForecastSamples?: SolarForecastSampleRecord[];
  maxPrecedingDays?: number;
  matchToleranceMs?: number;
}): PredictedSolarGenerationPoint[] {
  const forecastIndex = buildTimestampedValueIndex(
    input.forecastSamples.map((sample) => ({
      timestamp: sample.periodStart,
      value: sample.ghiWm2 ?? sample.value,
    })),
  );
  const generationIndex = buildTimestampedValueIndex(
    aggregateSolarGenerationByPeriodStart(input.solarEnergyProviderSamples),
  );
  const targetSamples = input.targetForecastSamples ?? input.forecastSamples;
  const maxPrecedingDays =
    input.maxPrecedingDays ?? MAX_SOLAR_PREDICTION_PRECEDING_DAYS;
  const matchToleranceMs =
    input.matchToleranceMs ?? SOLAR_PREDICTION_MATCH_TOLERANCE_MS;

  return targetSamples.map((sample) => ({
    periodStart: sample.periodStart,
    value: predictSolarGenerationForForecastSample({
      forecastIndex,
      generationIndex,
      forecastValue: sample.ghiWm2 ?? sample.value,
      maxPrecedingDays,
      matchToleranceMs,
      periodStart: sample.periodStart,
    }),
  }));
}

function predictSolarGenerationForForecastSample(input: {
  forecastIndex: TimestampedValueIndex;
  generationIndex: TimestampedValueIndex;
  forecastValue: number | null;
  maxPrecedingDays: number;
  matchToleranceMs: number;
  periodStart: string;
}): number | null {
  if (input.forecastValue === null) {
    return null;
  }

  if (input.forecastValue === 0) {
    return 0;
  }

  const targetDate = new Date(input.periodStart);

  if (Number.isNaN(targetDate.getTime())) {
    return null;
  }

  const ratios: number[] = [];

  for (let dayOffset = 1; dayOffset <= input.maxPrecedingDays; dayOffset += 1) {
    const historicalDate = new Date(targetDate);
    historicalDate.setDate(historicalDate.getDate() - dayOffset);

    const historicalTimestampMs = historicalDate.getTime();
    const forecastMatch = findClosestTimestampedValueWithin(
      input.forecastIndex,
      historicalTimestampMs,
      input.matchToleranceMs,
    );
    const generationMatch = findClosestTimestampedValueWithin(
      input.generationIndex,
      historicalTimestampMs,
      input.matchToleranceMs,
    );

    if (
      forecastMatch === null ||
      generationMatch === null ||
      forecastMatch.value === null ||
      generationMatch.value === null ||
      forecastMatch.value <= 0
    ) {
      continue;
    }

    ratios.push(generationMatch.value / forecastMatch.value);
  }

  if (ratios.length === 0) {
    return null;
  }

  const averageRatio = ratios.reduce((total, ratio) => total + ratio, 0) /
    ratios.length;
  return input.forecastValue * averageRatio;
}

interface TimestampedValuePoint {
  timestampMs: number;
  value: number | null;
}

interface TimestampedValueIndex {
  points: TimestampedValuePoint[];
  timestampsMs: number[];
}

function aggregateSolarGenerationByPeriodStart(
  samples: SolarEnergyProviderSampleRecord[],
): Array<{ timestamp: string; value: number | null }> {
  const aggregated = new Map<string, { hasValue: boolean; total: number }>();

  for (const sample of samples) {
    const current = aggregated.get(sample.periodStart) ?? {
      hasValue: false,
      total: 0,
    };

    if (typeof sample.powerW === "number") {
      current.hasValue = true;
      current.total += sample.powerW;
    }

    aggregated.set(sample.periodStart, current);
  }

  return [...aggregated.entries()]
    .map(([timestamp, entry]) => ({
      timestamp,
      value: entry.hasValue ? entry.total : null,
    }))
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );
}

function buildTimestampedValueIndex(
  values: Array<{ timestamp: string; value: number | null }>,
): TimestampedValueIndex {
  const points = values
    .map((value) => ({
      timestampMs: new Date(value.timestamp).getTime(),
      value: value.value,
    }))
    .filter((value) => Number.isFinite(value.timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  return {
    points,
    timestampsMs: points.map((point) => point.timestampMs),
  };
}

function findClosestTimestampedValueWithin(
  index: TimestampedValueIndex,
  targetTimestampMs: number,
  maxDeltaMs: number,
): TimestampedValuePoint | null {
  if (!Number.isFinite(targetTimestampMs) || index.points.length === 0) {
    return null;
  }

  const insertionIndex = findTimestampInsertionIndex(
    index.timestampsMs,
    targetTimestampMs,
  );
  let closest: TimestampedValuePoint | null = null;

  for (const candidateIndex of [insertionIndex - 1, insertionIndex]) {
    const candidate = index.points[candidateIndex];

    if (!candidate) {
      continue;
    }

    if (
      closest === null ||
      Math.abs(candidate.timestampMs - targetTimestampMs) <
        Math.abs(closest.timestampMs - targetTimestampMs)
    ) {
      closest = candidate;
    }
  }

  if (
    closest === null ||
    Math.abs(closest.timestampMs - targetTimestampMs) > maxDeltaMs
  ) {
    return null;
  }

  return closest;
}

function findTimestampInsertionIndex(
  timestampsMs: number[],
  targetTimestampMs: number,
): number {
  let low = 0;
  let high = timestampsMs.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const value = timestampsMs[middle];

    if (value === undefined) {
      break;
    }

    if (value < targetTimestampMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export const PRICE_SELECTION_WINDOW_MS = 60 * 60 * 1_000;

export interface PriceSelectionPoint {
  periodStart: string;
  value: number;
}

export function findPriceSelections(
  samples: Array<{ periodStart: string; value: number | null }>,
  windowMs: number = PRICE_SELECTION_WINDOW_MS,
): {
  lowest: PriceSelectionPoint[];
  highest: PriceSelectionPoint[];
} {
  if (samples.length === 0) {
    return { lowest: [], highest: [] };
  }

  const validSamples = samples
    .map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.value,
    }))
    .filter(
      (sample): sample is { periodStart: string; value: number } =>
        typeof sample.value === "number" && Number.isFinite(sample.value),
    )
    .sort(
      (left, right) =>
        new Date(left.periodStart).getTime() -
        new Date(right.periodStart).getTime(),
    );

  if (validSamples.length === 0) {
    return { lowest: [], highest: [] };
  }

  const lowest: PriceSelectionPoint[] = [];
  const highest: PriceSelectionPoint[] = [];

  for (let i = 0; i < validSamples.length; i++) {
    const current = validSamples[i];
    if (!current) {
      continue;
    }
    const windowStart = new Date(current.periodStart).getTime();
    const windowEnd = windowStart + windowMs;

    const windowSamples = validSamples.filter((sample) => {
      const sampleTime = new Date(sample.periodStart).getTime();
      return sampleTime >= windowStart && sampleTime < windowEnd;
    });

    if (windowSamples.length === 0) {
      continue;
    }

    const windowValues = windowSamples.map((s) => s.value);
    const windowMin = Math.min(...windowValues);
    const windowMax = Math.max(...windowValues);

    const minSamples = windowSamples.filter((s) => s.value === windowMin);
    const maxSamples = windowSamples.filter((s) => s.value === windowMax);

    for (const sample of minSamples) {
      if (!lowest.some((l) => l.periodStart === sample.periodStart)) {
        lowest.push({ periodStart: sample.periodStart, value: sample.value });
      }
    }

    for (const sample of maxSamples) {
      if (!highest.some((h) => h.periodStart === sample.periodStart)) {
        highest.push({ periodStart: sample.periodStart, value: sample.value });
      }
    }
  }

  lowest.sort(
    (left, right) =>
      new Date(left.periodStart).getTime() -
      new Date(right.periodStart).getTime(),
  );
  highest.sort(
    (left, right) =>
      new Date(left.periodStart).getTime() -
      new Date(right.periodStart).getTime(),
  );

  return { lowest, highest };
}

export function getRepoRoot(): string {
  if (process.env.EMSD_REPO_ROOT) {
    return resolve(process.env.EMSD_REPO_ROOT);
  }

  const modulePath = fileURLToPath(import.meta.url);
  return resolve(dirname(modulePath), "../../..");
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
