import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATTERY_STRATEGY_FIXED_ITEM_COUNT,
  BatteryStrategyTriggerKind,
} from "./battery-strategy-shared";

export * from "./cli-args";
export * from "./score-script-defaults";
export * from "./dynamic-price-target-defaults";
export * from "./dynamic-price-target-reserve";
export * from "./battery-strategy";
export * from "./battery-strategy-shared";
export * from "./site-load";
export { deriveBatteryStatusFromPower } from "./battery-power";
export * from "./price-selection";
export * from "./solar-prediction";
export * from "./solar-prediction-smoothing";

export const EMSD_NAME = "EMSD";

export type BatteryStatus = "idle" | "charging" | "discharging" | "offline";

export type BatteryStrategyMode = "auto" | "manual" | "self-consumption";

export type BatteryManualState = "idle" | "charging" | "discharging";

export type BatteryStrategyHistorySource = "manual" | "automatic";

export type BatteryStrategyHistoryDisplayState =
  | "self-consumption"
  | "charge"
  | "discharge"
  | "idle";

export interface BatteryStrategyRecord {
  strategyMode: BatteryStrategyMode;
  manualPowerW: number | null;
  manualState: BatteryManualState | null;
  manualChargeTargetSoc: number | null;
  manualDischargeTargetSoc: number | null;
  manualTargetSoc: number | null;
}

export type BatteryStrategyPlanItemKind = "default" | "daily";

export type BatteryStrategyTargetMethod =
  | "soc"
  | "duration"
  | "end-time"
  | "auto";

export interface BatteryStrategyPlanItem extends BatteryStrategyRecord {
  enabled: boolean;
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
  activeResolvedManualState?: BatteryManualState | null;
  activeTargetSocPercent?: number | null;
  activeReserveSocPercent?: number | null;
  activeTargetTime?: string | null;
  activeStartedAt: string | null;
  activeObservedAt: string | null;
  activeStartSocPercent: number | null;
  lastTriggeredAtByItemId: Record<string, string>;
  lastPlanAcknowledgedAt?: string | null;
  manualTargetMethod?: BatteryStrategyTargetMethod | null;
  manualTargetDurationMinutes?: number | null;
  manualTargetEndTime?: string | null;
  manualTargetStartedAt?: string | null;
  pendingPlanSavedAt?: string | null;
}

export interface BatteryStrategyHistoryRecord {
  activeItemId: string | null;
  batteryId: string;
  displayLabel: string;
  displayState: BatteryStrategyHistoryDisplayState;
  endedAt: string | null;
  manualState: BatteryManualState | null;
  observedAt: string;
  siteId: string;
  source: BatteryStrategyHistorySource;
  startedAt: string;
  strategyMode: BatteryStrategyMode;
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
  exportDeduction: number;
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
  maximumChargePowerW: number;
  maximumDischargePowerW: number;
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
  batteryStrategyPlanPending: boolean;
  batteryStrategyPlanPendingSince: string | null;
  maximumChargePowerW: number | null;
  maximumDischargePowerW: number | null;
  minimumDischargePercent: number | null;
  updatedAt: string;
}

export interface NormalizedSolarEnergyProviderInfo {
  currentPowerW: number | null;
  productionControlStatus: SolarEnergyProviderProductionControlStatus;
  status: Extract<ManagedDeviceState, "connected" | "offline">;
}

export type SolarEnergyProviderProductionControlStatus =
  | "enabled"
  | "disabled"
  | "unavailable";

export function createBatteryStrategyRuntime(): BatteryStrategyRuntimeRecord {
  return {
    activeItemId: null,
    activeResolvedManualState: null,
    activeTargetSocPercent: null,
    activeReserveSocPercent: null,
    activeTargetTime: null,
    activeStartedAt: null,
    activeObservedAt: null,
    activeStartSocPercent: null,
    lastTriggeredAtByItemId: {},
    lastPlanAcknowledgedAt: null,
    manualTargetMethod: null,
    manualTargetDurationMinutes: null,
    manualTargetEndTime: null,
    manualTargetStartedAt: null,
    pendingPlanSavedAt: null,
  };
}

export function clearActiveBatteryStrategyRuntime(
  value: BatteryStrategyRuntimeRecord,
): BatteryStrategyRuntimeRecord {
  return {
    ...normalizeBatteryStrategyRuntime(value),
    activeItemId: null,
    activeResolvedManualState: null,
    activeTargetSocPercent: null,
    activeReserveSocPercent: null,
    activeTargetTime: null,
    activeStartedAt: null,
    activeObservedAt: null,
    activeStartSocPercent: null,
    manualTargetMethod: null,
    manualTargetDurationMinutes: null,
    manualTargetEndTime: null,
    manualTargetStartedAt: null,
  };
}

export function acknowledgePendingBatteryStrategyPlan(
  value: BatteryStrategyRuntimeRecord,
  now: Date,
): BatteryStrategyRuntimeRecord {
  const runtime = normalizeBatteryStrategyRuntime(value);

  if (runtime.pendingPlanSavedAt === null) {
    return runtime;
  }

  return {
    ...runtime,
    lastPlanAcknowledgedAt: now.toISOString(),
    pendingPlanSavedAt: null,
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
    activeResolvedManualState: null,
    activeTargetSocPercent: null,
    activeReserveSocPercent: null,
    activeTargetTime: null,
    activeStartedAt: null,
    activeObservedAt: null,
    activeStartSocPercent: null,
    lastTriggeredAtByItemId,
    lastPlanAcknowledgedAt: null,
    manualTargetMethod: null,
    manualTargetDurationMinutes: null,
    manualTargetEndTime: null,
    manualTargetStartedAt: null,
    pendingPlanSavedAt: null,
  };
}

export function resolveBatteryStrategyFromPlanItem(input: {
  item: BatteryStrategyPlanItem | null | undefined;
  minimumDischargePercent: number;
  maximumChargePowerW: number;
  maximumDischargePowerW: number;
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
      item.manualState === "charging"
        ? input.maximumChargePowerW
        : item.manualState === "discharging"
          ? input.maximumDischargePowerW
          : null,
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
    createAutomaticBatteryStrategyPlanItem(strategy, minimumDischargePercent),
    createExportSurplusBatteryStrategyPlanItem(),
    createDelayedChargingBatteryStrategyPlanItem(),
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
    enabled: true,
    kind: "default",
    startTime: null,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: null,
    triggerKind: null,
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: input.minimumDischargePercent,
    manualTargetSoc: 100,
  };

  const exportSurplusSourceIndex = restItems.findIndex(
    (item) => item.triggerKind === BatteryStrategyTriggerKind.ExportSurplus,
  );
  const exportSurplusSource =
    exportSurplusSourceIndex === -1
      ? null
      : (restItems[exportSurplusSourceIndex] ?? null);
  const delayedChargingSourceIndex = restItems.findIndex(
    (item, index) =>
      index !== exportSurplusSourceIndex &&
      item.triggerKind === BatteryStrategyTriggerKind.DelayedCharging,
  );
  const delayedChargingSource =
    delayedChargingSourceIndex === -1
      ? null
      : (restItems[delayedChargingSourceIndex] ?? null);
  const normalizedFixedItems = [
    normalizeFixedBatteryStrategyPlanItem({
      fallback: fallback[1] ?? createExportSurplusBatteryStrategyPlanItem(),
      value: exportSurplusSource,
    }),
    normalizeFixedBatteryStrategyPlanItem({
      fallback: fallback[2] ?? createDelayedChargingBatteryStrategyPlanItem(),
      value: delayedChargingSource,
    }),
  ];

  const normalizedRestItems = restItems
    .map((item) => ({
      ...item,
      kind: "daily" as const,
      startTime: isDailyStartTime(item.startTime) ? item.startTime : "08:00",
      triggerKind:
        normalizeTriggerKind(item.triggerKind) ??
        BatteryStrategyTriggerKind.DailyTime,
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
    }))
    .filter(
      (_, index) =>
        index !== exportSurplusSourceIndex &&
        index !== delayedChargingSourceIndex,
    );

  return [normalizedFirstItem, ...normalizedFixedItems, ...normalizedRestItems];
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
    enabled: candidate.enabled !== false,
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
    item.triggerKind !== BatteryStrategyTriggerKind.DailyTime ||
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
    activeResolvedManualState:
      candidate.activeResolvedManualState === "charging" ||
      candidate.activeResolvedManualState === "discharging" ||
      candidate.activeResolvedManualState === "idle"
        ? candidate.activeResolvedManualState
        : null,
    activeTargetSocPercent:
      typeof candidate.activeTargetSocPercent === "number" &&
      Number.isFinite(candidate.activeTargetSocPercent)
        ? candidate.activeTargetSocPercent
        : null,
    activeReserveSocPercent:
      typeof candidate.activeReserveSocPercent === "number" &&
      Number.isFinite(candidate.activeReserveSocPercent)
        ? candidate.activeReserveSocPercent
        : null,
    activeTargetTime:
      typeof candidate.activeTargetTime === "string" &&
      candidate.activeTargetTime.length > 0
        ? candidate.activeTargetTime
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
    lastPlanAcknowledgedAt:
      typeof candidate.lastPlanAcknowledgedAt === "string" &&
      candidate.lastPlanAcknowledgedAt.length > 0
        ? candidate.lastPlanAcknowledgedAt
        : null,
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
    pendingPlanSavedAt:
      typeof candidate.pendingPlanSavedAt === "string" &&
      candidate.pendingPlanSavedAt.length > 0
        ? candidate.pendingPlanSavedAt
        : null,
  };
}

function normalizeTargetMethod(
  value: BatteryStrategyPlanItem["targetMethod"] | undefined,
): BatteryStrategyTargetMethod | null {
  return value === "soc" ||
    value === "duration" ||
    value === "end-time" ||
    value === "auto"
    ? value
    : null;
}

function normalizeTriggerKind(
  value: unknown,
): BatteryStrategyTriggerKind | null {
  if (value === BatteryStrategyTriggerKind.DailyTime) {
    return BatteryStrategyTriggerKind.DailyTime;
  }

  if (value === BatteryStrategyTriggerKind.DelayedCharging) {
    return BatteryStrategyTriggerKind.DelayedCharging;
  }

  if (value === BatteryStrategyTriggerKind.ExportSurplus) {
    return BatteryStrategyTriggerKind.ExportSurplus;
  }

  return null;
}

function createAutomaticBatteryStrategyPlanItem(
  strategy: BatteryStrategyRecord,
  minimumDischargePercent: number,
): BatteryStrategyPlanItem {
  void strategy;

  return {
    enabled: true,
    id: createBatteryStrategyPlanId(),
    kind: "default",
    startTime: null,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: null,
    triggerKind: null,
    strategyMode: "self-consumption",
    manualState: null,
    manualPowerW: null,
    manualChargeTargetSoc: 100,
    manualDischargeTargetSoc: minimumDischargePercent,
    manualTargetSoc: 100,
  };
}

function createExportSurplusBatteryStrategyPlanItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: createBatteryStrategyPlanId(),
    kind: "daily",
    startTime: null,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.ExportSurplus,
    strategyMode: "manual",
    manualState: "discharging",
    manualPowerW: null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: null,
  };
}

function createDelayedChargingBatteryStrategyPlanItem(): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: createBatteryStrategyPlanId(),
    kind: "daily",
    startTime: null,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: BatteryStrategyTriggerKind.DelayedCharging,
    strategyMode: "manual",
    manualState: "charging",
    manualPowerW: null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: null,
  };
}

function normalizeFixedBatteryStrategyPlanItem(input: {
  fallback: BatteryStrategyPlanItem;
  value: BatteryStrategyPlanItem | null;
}): BatteryStrategyPlanItem {
  const source = input.value ?? input.fallback;

  return {
    ...source,
    enabled: input.value?.enabled ?? input.fallback.enabled,
    kind: "daily",
    startTime: null,
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: input.fallback.triggerKind,
    strategyMode: "manual",
    manualState: input.fallback.manualState,
    manualPowerW: null,
    manualChargeTargetSoc: null,
    manualDischargeTargetSoc: null,
    manualTargetSoc: null,
  };
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
  productionControlStatus: SolarEnergyProviderProductionControlStatus | null;
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
  batteryStrategyHistory: BatteryStrategyHistoryRecord[];
  dynamicPriceSamples: DynamicPriceSampleRecord[];
  p1MeterSamples: P1MeterSampleRecord[];
  selectedDayExpectedSiteLoadSamples: Array<{
    periodStart: string;
    value: number | null;
  }>;
  selectedDayKey: string;
  selectedDaySiteLoadSamples: Array<{
    periodStart: string;
    value: number | null;
  }>;
  siteId: string;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
  solarForecastSamples: SolarForecastSampleRecord[];
  solarPredictedGeneration: Array<{
    periodStart: string;
    value: number | null;
  }>;
  solarPredictionAlgorithmVersion: "v2";
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
