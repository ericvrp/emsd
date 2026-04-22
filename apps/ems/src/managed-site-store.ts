import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import {
  type BatteryManualState,
  type BatteryRecord,
  type BatteryStrategyHistoryDisplayState,
  type BatteryStatus,
  type BatteryStrategyMode,
  type BatteryStrategyPlanRecord,
  type BatteryStrategyRecord,
  type BatteryStrategyRuntimeRecord,
  type BatteryStrategyTargetMethod,
  type DynamicPriceSourceRecord,
  type MeterRecord,
  type SiteRecord,
  type SolarEnergyProviderRecord,
  type WeatherForecastSourceRecord,
  type WeatherForecastSurface,
  type WeatherProvider,
  clearActiveBatteryStrategyRuntime,
  createBatteryStrategyRuntime,
  ensureParentDirectory,
  getDatabasePath,
  parseBatteryStrategyPlanJson,
  parseBatteryStrategyRuntimeJson,
  parseGpsCoordinate,
  stringifyBatteryStrategyPlan,
  stringifyBatteryStrategyRuntime,
} from "@emsd/core";
import { upsertBatteryStrategyHistoryState } from "../../daemon/src/database";

const SITE_REQUIRED_COLUMNS = [
  "id",
  "name",
  "location",
  "created_at",
  "updated_at",
];
const BATTERY_REQUIRED_COLUMNS = [
  "id",
  "site_id",
  "name",
  "plugin",
  "model",
  "ip_address",
  "enabled",
  "status",
  "connected",
  "minimum_discharge_percent",
  "strategy_mode",
  "manual_state",
  "manual_power_w",
  "manual_charge_target_soc",
  "manual_discharge_target_soc",
  "manual_target_soc",
  "manual_mode_active",
  "manual_mode_started",
  "strategy_plan_json",
  "strategy_runtime_json",
  "updated_at",
];
const METER_REQUIRED_COLUMNS = [
  "id",
  "site_id",
  "name",
  "model",
  "ip_address",
  "enabled",
  "connected",
  "details",
  "updated_at",
];
const SOLAR_ENERGY_PROVIDER_REQUIRED_COLUMNS = [
  "id",
  "site_id",
  "name",
  "plugin",
  "ip_address",
  "enabled",
  "connected",
  "serial_number",
  "updated_at",
];
const WEATHER_SOURCE_REQUIRED_COLUMNS = [
  "id",
  "site_id",
  "name",
  "provider",
  "surface",
  "updated_at",
];
const DYNAMIC_PRICE_SOURCE_REQUIRED_COLUMNS = [
  "id",
  "home_id",
  "provider",
  "export_deduction",
  "site_id",
  "name",
  "updated_at",
];

interface SiteRow {
  id: string;
  location: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface BatteryRow {
  id: string;
  site_id: string;
  name: string;
  plugin: string;
  model: string;
  ip_address: string;
  enabled: number;
  status: BatteryStatus;
  connected: number;
  minimum_discharge_percent: number;
  strategy_mode: BatteryStrategyMode | "self-consumption";
  manual_state: BatteryManualState | null;
  manual_power_w: number | null;
  manual_charge_target_soc: number | null;
  manual_discharge_target_soc: number | null;
  manual_target_soc: number | null;
  manual_mode_active: number;
  manual_mode_started: number;
  strategy_plan_json: string | null;
  strategy_runtime_json: string | null;
  updated_at: string;
}

interface MeterRow {
  id: string;
  site_id: string;
  name: string;
  model: string;
  ip_address: string;
  enabled: number;
  connected: number;
  details: string;
  updated_at: string;
}

interface SolarEnergyProviderRow {
  id: string;
  site_id: string;
  name: string;
  plugin: string;
  ip_address: string;
  enabled: number;
  connected: number;
  serial_number: string | null;
  updated_at: string;
}

interface SourceRow {
  home_id: string | null;
  id: string;
  provider: string | null;
  surface: string | null;
  export_deduction: number | null;
  site_id: string;
  name: string;
  updated_at: string;
}

interface CreateBatteryInput {
  id: string;
  name: string;
  plugin: string;
  model: string;
  ipAddress: string;
  enabled?: boolean;
  connected?: boolean;
  minimumDischargePercent?: number;
  status?: BatteryStatus;
  strategyMode?: BatteryStrategyMode;
  manualState?: BatteryManualState | null;
  manualPowerW?: number | null;
  manualChargeTargetSoc?: number | null;
  manualDischargeTargetSoc?: number | null;
  manualTargetSoc?: number | null;
}

interface UpdateBatteryStrategyInput {
  strategyMode: BatteryStrategyMode;
  manualState?: BatteryManualState | null;
  manualPowerW?: number | null;
  manualChargeTargetSoc?: number | null;
  manualDischargeTargetSoc?: number | null;
  manualTargetSoc?: number | null;
  manualTargetMethod?: BatteryStrategyTargetMethod | null;
  manualTargetDurationMinutes?: number | null;
  manualTargetEndTime?: string | null;
  manualAutoTargetByBatteryId?: Record<
    string,
    {
      targetSocPercent: number | null;
      targetTime: string | null;
    }
  > | null;
  manualModeActive?: boolean;
}

interface UpdateBatteryStrategyPlanInput {
  strategyPlan: BatteryStrategyPlanRecord;
  strategy?: BatteryStrategyRecord;
  strategyRuntime?: BatteryStrategyRuntimeRecord;
}

interface UpdateBatteryMinimumDischargeInput {
  minimumDischargePercent: number;
}

interface CreateMeterInput {
  id: string;
  name: string;
  model: string;
  ipAddress: string;
  enabled?: boolean;
  connected?: boolean;
  details?: string;
}

interface CreateSolarEnergyProviderInput {
  id: string;
  name: string;
  plugin: string;
  ipAddress: string;
  enabled?: boolean;
  connected?: boolean;
  serialNumber?: string | null;
}

interface CreateSiteInput {
  id: string;
  location?: string;
  name: string;
}

interface UpdateSiteInput {
  location?: string;
  name: string;
}

interface CreateSourceInput {
  id: string;
  name: string;
  provider?: WeatherProvider | "tibber";
  surface?: WeatherForecastSurface;
  exportDeduction?: number | undefined;
}

interface UpdateSourceInput {
  name: string;
  provider?: WeatherProvider | "tibber";
  surface?: WeatherForecastSurface;
  exportDeduction?: number | undefined;
}

export function listSites(databasePath = getDatabasePath()): SiteRecord[] {
  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "sites") ||
      !hasColumns(db, "sites", SITE_REQUIRED_COLUMNS)
    ) {
      return [];
    }

    return db
      .query<SiteRow, []>(
        `
          SELECT id, name, location, created_at, updated_at
          FROM sites
          ORDER BY name ASC, id ASC
        `,
      )
      .all()
      .map(mapSiteRow);
  } finally {
    db.close();
  }
}

export function createSite(
  input: CreateSiteInput,
  databasePath = getDatabasePath(),
): SiteRecord {
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, "sites", SITE_REQUIRED_COLUMNS);
    const existing = getSiteById(db, input.id);

    if (existing) {
      throw new Error(`Site already exists: ${input.id}`);
    }

    const now = new Date().toISOString();
    const location = normalizeSiteLocation(input.location);
    db.query(
      `
        INSERT INTO sites (id, name, location, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `,
    ).run(input.id, input.name, location, now, now);

    return getSiteByIdOrThrow(db, input.id);
  } finally {
    db.close();
  }
}

export function updateSite(
  siteId: string,
  input: UpdateSiteInput,
  databasePath = getDatabasePath(),
): SiteRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, "sites", SITE_REQUIRED_COLUMNS);

    if (!getSiteById(db, siteId)) {
      return null;
    }

    const location =
      input.location === undefined
        ? getSiteByIdOrThrow(db, siteId).location
        : normalizeSiteLocation(input.location);

    db.query(
      `
        UPDATE sites
        SET name = ?2, location = ?3, updated_at = ?4
        WHERE id = ?1
      `,
    ).run(siteId, input.name, location, new Date().toISOString());

    return getSiteByIdOrThrow(db, siteId);
  } finally {
    db.close();
  }
}

export function deleteSite(
  siteId: string,
  databasePath = getDatabasePath(),
): SiteRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, "sites", SITE_REQUIRED_COLUMNS);
    const site = getSiteById(db, siteId);

    if (!site) {
      return null;
    }

    deleteLinkedSiteResources(db, siteId);
    db.query("DELETE FROM sites WHERE id = ?1").run(siteId);
    return site;
  } finally {
    db.close();
  }
}

export function assertKnownSiteId(
  siteId: string,
  databasePath = getDatabasePath(),
): void {
  const knownSiteIds = listSites(databasePath).map((site) => site.id);

  if (knownSiteIds.includes(siteId)) {
    return;
  }

  const suffix =
    knownSiteIds.length > 0
      ? ` Known site ids: ${knownSiteIds.join(", ")}`
      : " No sites exist yet. Create one first with 'site add <site-id> <name>'.";

  throw new Error(`Unknown site id: ${siteId}.${suffix}`);
}

export function listBatteries(
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord[] {
  assertKnownSiteId(siteId, databasePath);

  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "batteries") ||
      !hasColumns(db, "batteries", BATTERY_REQUIRED_COLUMNS)
    ) {
      return [];
    }

    return readBatteries(db, siteId);
  } finally {
    db.close();
  }
}

export function listMeters(
  siteId: string,
  databasePath = getDatabasePath(),
): MeterRecord[] {
  assertKnownSiteId(siteId, databasePath);

  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "meters") ||
      !hasColumns(db, "meters", METER_REQUIRED_COLUMNS)
    ) {
      return [];
    }

    return readMeters(db, siteId);
  } finally {
    db.close();
  }
}

export function listSolarEnergyProviders(
  siteId: string,
  databasePath = getDatabasePath(),
): SolarEnergyProviderRecord[] {
  assertKnownSiteId(siteId, databasePath);

  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "solar_energy_providers") ||
      !hasColumns(
        db,
        "solar_energy_providers",
        SOLAR_ENERGY_PROVIDER_REQUIRED_COLUMNS,
      )
    ) {
      return [];
    }

    return readSolarEnergyProviders(db, siteId);
  } finally {
    db.close();
  }
}

export const SINGLE_BATTERY_LIMIT_ERROR =
  "Only one battery is supported right now. Remove the existing battery before adding another.";

function assertBatteryCreationAllowed(
  siteId: string,
  databasePath = getDatabasePath(),
): void {
  if (listBatteries(siteId, databasePath).length > 0) {
    throw new Error(SINGLE_BATTERY_LIMIT_ERROR);
  }
}

export function createBattery(
  input: CreateBatteryInput,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord {
  assertKnownSiteId(siteId, databasePath);
  assertBatteryCreationAllowed(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "batteries",
      BATTERY_REQUIRED_COLUMNS,
    );
    const now = new Date().toISOString();

    db.query(
      `
        INSERT INTO batteries (
          id,
          site_id,
          name,
          plugin,
          model,
          ip_address,
          enabled,
          status,
          connected,
          minimum_discharge_percent,
          strategy_mode,
          manual_state,
          manual_power_w,
          manual_charge_target_soc,
          manual_discharge_target_soc,
          manual_target_soc,
          manual_mode_active,
          manual_mode_started,
          strategy_plan_json,
          strategy_runtime_json,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
      `,
    ).run(
      input.id,
      siteId,
      input.name,
      input.plugin,
      input.model,
      input.ipAddress,
      input.enabled === false ? 0 : 1,
      input.status ?? "idle",
      input.connected === false ? 0 : 1,
      normalizeMinimumDischargePercent(input.minimumDischargePercent),
      input.strategyMode ?? "self-consumption",
      resolveManualState(input.manualState ?? input.status ?? null),
      input.manualPowerW ?? null,
      input.manualChargeTargetSoc ?? 100,
      input.manualDischargeTargetSoc ??
        normalizeMinimumDischargePercent(input.minimumDischargePercent),
      input.manualTargetSoc ??
        resolveManualTargetSoc({
          manualState: resolveManualState(
            input.manualState ?? input.status ?? null,
          ),
          manualChargeTargetSoc: input.manualChargeTargetSoc ?? 100,
          manualDischargeTargetSoc:
            input.manualDischargeTargetSoc ??
            normalizeMinimumDischargePercent(input.minimumDischargePercent),
        }),
      0,
      0,
      null,
      stringifyBatteryStrategyRuntime(parseBatteryStrategyRuntimeJson(null)),
      now,
    );

    return getBatteryByIdOrThrow(db, input.id, siteId);
  } finally {
    db.close();
  }
}

export function createMeter(
  input: CreateMeterInput,
  siteId: string,
  databasePath = getDatabasePath(),
): MeterRecord {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, "meters", METER_REQUIRED_COLUMNS);
    const now = new Date().toISOString();

    db.query(
      `
        INSERT INTO meters (
          id,
          site_id,
          name,
          model,
          ip_address,
          enabled,
          connected,
          details,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `,
    ).run(
      input.id,
      siteId,
      input.name,
      input.model,
      input.ipAddress,
      input.enabled === false ? 0 : 1,
      input.connected === false ? 0 : 1,
      input.details ?? "",
      now,
    );

    return getMeterByIdOrThrow(db, input.id, siteId);
  } finally {
    db.close();
  }
}

export function createSolarEnergyProvider(
  input: CreateSolarEnergyProviderInput,
  siteId: string,
  databasePath = getDatabasePath(),
): SolarEnergyProviderRecord {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "solar_energy_providers",
      SOLAR_ENERGY_PROVIDER_REQUIRED_COLUMNS,
    );
    const now = new Date().toISOString();
    const columns = getTableColumns(db, "solar_energy_providers");
    const usesLegacyColumns =
      columns.includes("model") && columns.includes("details");

    if (usesLegacyColumns) {
      db.query(
        `
          INSERT INTO solar_energy_providers (
            id,
            site_id,
            name,
            plugin,
            model,
            ip_address,
            enabled,
            connected,
            details,
            serial_number,
            updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        `,
      ).run(
        input.id,
        siteId,
        input.name,
        input.plugin,
        input.plugin,
        input.ipAddress,
        input.enabled === false ? 0 : 1,
        input.connected === false ? 0 : 1,
        input.serialNumber ? `serial ${input.serialNumber}` : "",
        input.serialNumber ?? null,
        now,
      );
    } else {
      db.query(
        `
          INSERT INTO solar_energy_providers (
            id,
            site_id,
            name,
            plugin,
            ip_address,
            enabled,
            connected,
            serial_number,
            updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        `,
      ).run(
        input.id,
        siteId,
        input.name,
        input.plugin,
        input.ipAddress,
        input.enabled === false ? 0 : 1,
        input.connected === false ? 0 : 1,
        input.serialNumber ?? null,
        now,
      );
    }

    return getSolarEnergyProviderByIdOrThrow(db, input.id, siteId);
  } finally {
    db.close();
  }
}

export function setBatteryEnabled(
  id: string,
  enabled: boolean,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "batteries",
      BATTERY_REQUIRED_COLUMNS,
    );

    if (!getBatteryById(db, id, siteId)) {
      return null;
    }

    db.query(
      `
        UPDATE batteries
        SET enabled = ?2, updated_at = ?3
        WHERE id = ?1 AND site_id = ?4
      `,
    ).run(id, enabled ? 1 : 0, new Date().toISOString(), siteId);

    return getBatteryByIdOrThrow(db, id, siteId);
  } finally {
    db.close();
  }
}

export function getBattery(
  id: string,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord | null {
  assertKnownSiteId(siteId, databasePath);

  if (!existsSync(databasePath)) {
    return null;
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "batteries") ||
      !hasColumns(db, "batteries", BATTERY_REQUIRED_COLUMNS)
    ) {
      return null;
    }

    return getBatteryById(db, id, siteId);
  } finally {
    db.close();
  }
}

export function getSolarEnergyProvider(
  id: string,
  siteId: string,
  databasePath = getDatabasePath(),
): SolarEnergyProviderRecord | null {
  assertKnownSiteId(siteId, databasePath);

  if (!existsSync(databasePath)) {
    return null;
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "solar_energy_providers") ||
      !hasColumns(
        db,
        "solar_energy_providers",
        SOLAR_ENERGY_PROVIDER_REQUIRED_COLUMNS,
      )
    ) {
      return null;
    }

    return getSolarEnergyProviderById(db, id, siteId);
  } finally {
    db.close();
  }
}

export function setHouseStrategy(
  input: UpdateBatteryStrategyInput,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord[] {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "batteries",
      BATTERY_REQUIRED_COLUMNS,
    );

    const batteries = readBatteries(db, siteId);

    if (batteries.length === 0) {
      return [];
    }

    const observedAt = new Date().toISOString();

    for (const battery of batteries) {
      const manualAutoTarget =
        input.manualTargetMethod === "auto"
          ? (input.manualAutoTargetByBatteryId?.[battery.id] ?? null)
          : null;
      const manualChargeTargetSoc =
        manualAutoTarget !== null &&
        input.strategyMode === "manual" &&
        input.manualState === "charging"
          ? manualAutoTarget.targetSocPercent
          : (input.manualChargeTargetSoc ?? null);
      const manualDischargeTargetSoc =
        manualAutoTarget !== null &&
        input.strategyMode === "manual" &&
        input.manualState === "discharging"
          ? manualAutoTarget.targetSocPercent
          : (input.manualDischargeTargetSoc ?? null);
      const manualTargetSoc =
        manualAutoTarget !== null &&
        input.strategyMode === "manual" &&
        (input.manualState === "charging" ||
          input.manualState === "discharging")
          ? manualAutoTarget.targetSocPercent
          : (input.manualTargetSoc ?? null);
      const baseRuntime = clearActiveBatteryStrategyRuntime(
        battery.strategyRuntime,
      );
      const nextRuntime = stringifyBatteryStrategyRuntime({
        ...baseRuntime,
        manualTargetMethod:
          input.manualModeActive === true &&
          input.strategyMode === "manual" &&
          (input.manualState === "charging" ||
            input.manualState === "discharging")
            ? (input.manualTargetMethod ?? "soc")
            : null,
        manualTargetDurationMinutes:
          input.manualModeActive === true &&
          input.strategyMode === "manual" &&
          (input.manualState === "charging" ||
            input.manualState === "discharging") &&
          input.manualTargetMethod === "duration"
            ? (input.manualTargetDurationMinutes ?? null)
            : null,
        manualTargetEndTime:
          input.manualModeActive === true &&
          input.strategyMode === "manual" &&
          (input.manualState === "charging" ||
            input.manualState === "discharging") &&
          input.manualTargetMethod === "end-time"
            ? (input.manualTargetEndTime ?? null)
            : null,
        activeTargetSocPercent:
          input.manualModeActive === true &&
          input.strategyMode === "manual" &&
          (input.manualState === "charging" ||
            input.manualState === "discharging") &&
          input.manualTargetMethod === "auto"
            ? (manualAutoTarget?.targetSocPercent ?? null)
            : null,
        activeTargetTime:
          input.manualModeActive === true &&
          input.strategyMode === "manual" &&
          (input.manualState === "charging" ||
            input.manualState === "discharging") &&
          input.manualTargetMethod === "auto"
            ? (manualAutoTarget?.targetTime ?? null)
            : null,
        manualTargetStartedAt:
          input.manualModeActive === true &&
          input.strategyMode === "manual" &&
          (input.manualState === "charging" ||
            input.manualState === "discharging")
            ? observedAt
            : null,
      });

      db.query(
        `
          UPDATE batteries
          SET
            strategy_mode = ?2,
            manual_state = ?3,
            manual_power_w = ?4,
            manual_charge_target_soc = ?5,
            manual_discharge_target_soc = ?6,
            manual_target_soc = ?7,
            manual_mode_active = ?8,
            manual_mode_started = ?9,
            strategy_runtime_json = ?10,
            updated_at = ?11
          WHERE id = ?1 AND site_id = ?12
        `,
      ).run(
        battery.id,
        input.strategyMode,
        input.manualState ?? null,
        input.manualPowerW ?? null,
        manualChargeTargetSoc,
        manualDischargeTargetSoc,
        manualTargetSoc,
        input.manualModeActive === true ? 1 : 0,
        0,
        nextRuntime,
        observedAt,
        siteId,
      );

      const updatedBattery = getBatteryByIdOrThrow(db, battery.id, siteId);
      upsertBatteryStrategyHistoryState(
        db,
        buildBatteryStrategyHistoryRecord(updatedBattery, observedAt),
      );
    }

    return readBatteries(db, siteId);
  } finally {
    db.close();
  }
}

export function setHouseStrategyPlan(
  input: UpdateBatteryStrategyPlanInput,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord[] {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "batteries",
      BATTERY_REQUIRED_COLUMNS,
    );

    const batteries = readBatteries(db, siteId);

    if (batteries.length === 0) {
      return [];
    }

    const observedAt = new Date().toISOString();

    for (const battery of batteries) {
      const strategy = input.strategy ?? {
        strategyMode: battery.strategyMode,
        manualState: battery.manualState,
        manualPowerW: battery.manualPowerW,
        manualChargeTargetSoc: battery.manualChargeTargetSoc,
        manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
        manualTargetSoc: battery.manualTargetSoc,
      };
      const strategyRuntime =
        input.strategyRuntime ?? createBatteryStrategyRuntime();

      db.query(
        `
          UPDATE batteries
          SET
            strategy_plan_json = ?2,
            strategy_mode = ?3,
            manual_state = ?4,
            manual_power_w = ?5,
            manual_charge_target_soc = ?6,
            manual_discharge_target_soc = ?7,
            manual_target_soc = ?8,
            strategy_runtime_json = ?9,
            manual_mode_active = 0,
            manual_mode_started = 0,
            updated_at = ?10
          WHERE id = ?1 AND site_id = ?11
        `,
      ).run(
        battery.id,
        stringifyBatteryStrategyPlan(
          input.strategyPlan,
          strategy,
          battery.minimumDischargePercent,
        ),
        strategy.strategyMode,
        strategy.manualState ?? null,
        strategy.manualPowerW ?? null,
        strategy.manualChargeTargetSoc ?? null,
        strategy.manualDischargeTargetSoc ?? null,
        strategy.manualTargetSoc ?? null,
        stringifyBatteryStrategyRuntime(strategyRuntime),
        observedAt,
        siteId,
      );

      const updatedBattery = getBatteryByIdOrThrow(db, battery.id, siteId);
      upsertBatteryStrategyHistoryState(
        db,
        buildBatteryStrategyHistoryRecord(updatedBattery, observedAt),
      );
    }

    return readBatteries(db, siteId);
  } finally {
    db.close();
  }
}

export function setBatteryMinimumDischargePercent(
  id: string,
  input: UpdateBatteryMinimumDischargeInput,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "batteries",
      BATTERY_REQUIRED_COLUMNS,
    );

    if (!getBatteryById(db, id, siteId)) {
      return null;
    }

    db.query(
      `
        UPDATE batteries
        SET minimum_discharge_percent = ?2, updated_at = ?3
        WHERE id = ?1 AND site_id = ?4
      `,
    ).run(
      id,
      normalizeMinimumDischargePercent(input.minimumDischargePercent),
      new Date().toISOString(),
      siteId,
    );

    return getBatteryByIdOrThrow(db, id, siteId);
  } finally {
    db.close();
  }
}

export function setMeterEnabled(
  id: string,
  enabled: boolean,
  siteId: string,
  databasePath = getDatabasePath(),
): MeterRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, "meters", METER_REQUIRED_COLUMNS);

    if (!getMeterById(db, id, siteId)) {
      return null;
    }

    db.query(
      `
        UPDATE meters
        SET enabled = ?2, updated_at = ?3
        WHERE id = ?1 AND site_id = ?4
      `,
    ).run(id, enabled ? 1 : 0, new Date().toISOString(), siteId);

    return getMeterByIdOrThrow(db, id, siteId);
  } finally {
    db.close();
  }
}

export function deleteBattery(
  id: string,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "batteries",
      BATTERY_REQUIRED_COLUMNS,
    );
    const existing = getBatteryById(db, id, siteId);

    if (!existing) {
      return null;
    }

    db.query("DELETE FROM batteries WHERE id = ?1 AND site_id = ?2").run(
      id,
      siteId,
    );
    return existing;
  } finally {
    db.close();
  }
}

export function deleteMeter(
  id: string,
  siteId: string,
  databasePath = getDatabasePath(),
): MeterRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, "meters", METER_REQUIRED_COLUMNS);
    const existing = getMeterById(db, id, siteId);

    if (!existing) {
      return null;
    }

    db.query("DELETE FROM meters WHERE id = ?1 AND site_id = ?2").run(
      id,
      siteId,
    );
    return existing;
  } finally {
    db.close();
  }
}

export function deleteSolarEnergyProvider(
  id: string,
  siteId: string,
  databasePath = getDatabasePath(),
): SolarEnergyProviderRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(
      db,
      databasePath,
      "solar_energy_providers",
      SOLAR_ENERGY_PROVIDER_REQUIRED_COLUMNS,
    );
    const existing = getSolarEnergyProviderById(db, id, siteId);

    if (!existing) {
      return null;
    }

    db.query(
      "DELETE FROM solar_energy_providers WHERE id = ?1 AND site_id = ?2",
    ).run(id, siteId);
    return existing;
  } finally {
    db.close();
  }
}

export function listWeatherForecastSources(
  siteId: string,
  databasePath = getDatabasePath(),
): WeatherForecastSourceRecord[] {
  return listSources(
    "weather_sources",
    siteId,
    WEATHER_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as WeatherForecastSourceRecord[];
}

export function createWeatherForecastSource(
  input: CreateSourceInput,
  siteId: string,
  databasePath = getDatabasePath(),
): WeatherForecastSourceRecord {
  return createSource(
    "weather_sources",
    input,
    siteId,
    WEATHER_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as WeatherForecastSourceRecord;
}

export function updateWeatherForecastSource(
  id: string,
  input: UpdateSourceInput,
  siteId: string,
  databasePath = getDatabasePath(),
): WeatherForecastSourceRecord | null {
  return updateSource(
    "weather_sources",
    id,
    input,
    siteId,
    WEATHER_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as WeatherForecastSourceRecord | null;
}

export function deleteWeatherForecastSource(
  id: string,
  siteId: string,
  databasePath = getDatabasePath(),
): WeatherForecastSourceRecord | null {
  return deleteSource(
    "weather_sources",
    id,
    siteId,
    WEATHER_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as WeatherForecastSourceRecord | null;
}

export function listDynamicPriceSources(
  siteId: string,
  databasePath = getDatabasePath(),
): DynamicPriceSourceRecord[] {
  return listSources(
    "dynamic_price_sources",
    siteId,
    DYNAMIC_PRICE_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as DynamicPriceSourceRecord[];
}

export function createDynamicPriceSource(
  input: CreateSourceInput,
  siteId: string,
  databasePath = getDatabasePath(),
): DynamicPriceSourceRecord {
  return createSource(
    "dynamic_price_sources",
    input,
    siteId,
    DYNAMIC_PRICE_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as DynamicPriceSourceRecord;
}

export function updateDynamicPriceSource(
  id: string,
  input: UpdateSourceInput,
  siteId: string,
  databasePath = getDatabasePath(),
): DynamicPriceSourceRecord | null {
  return updateSource(
    "dynamic_price_sources",
    id,
    input,
    siteId,
    DYNAMIC_PRICE_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as DynamicPriceSourceRecord | null;
}

export function deleteDynamicPriceSource(
  id: string,
  siteId: string,
  databasePath = getDatabasePath(),
): DynamicPriceSourceRecord | null {
  return deleteSource(
    "dynamic_price_sources",
    id,
    siteId,
    DYNAMIC_PRICE_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  ) as DynamicPriceSourceRecord | null;
}

function listSources(
  tableName: "weather_sources" | "dynamic_price_sources",
  siteId: string,
  requiredColumns: string[],
  databasePath: string,
): SourceRecord[] {
  assertKnownSiteId(siteId, databasePath);

  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, tableName) ||
      !hasColumns(db, tableName, requiredColumns)
    ) {
      return [];
    }

    return readSources(db, tableName, siteId);
  } finally {
    db.close();
  }
}

function createSource(
  tableName: "weather_sources" | "dynamic_price_sources",
  input: CreateSourceInput,
  siteId: string,
  requiredColumns: string[],
  databasePath: string,
): SourceRecord {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, tableName, requiredColumns);
    const now = new Date().toISOString();

    if (tableName === "weather_sources") {
      db.query(
        `
          INSERT INTO weather_sources (id, site_id, name, provider, surface, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `,
      ).run(
        input.id,
        siteId,
        input.name,
        normalizeWeatherProvider(input.provider as WeatherProvider | undefined),
        normalizeWeatherSurface(
          input.surface,
          input.provider as WeatherProvider | undefined,
        ),
        now,
      );
    } else {
      db.query(
        `
          INSERT INTO dynamic_price_sources (id, site_id, name, provider, home_id, export_deduction, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        `,
      ).run(
        input.id,
        siteId,
        input.name,
        normalizeDynamicPriceProvider(null),
        null,
        input.exportDeduction ?? 0.13,
        now,
      );
    }

    return getSourceByIdOrThrow(db, tableName, input.id, siteId);
  } finally {
    db.close();
  }
}

function updateSource(
  tableName: "weather_sources" | "dynamic_price_sources",
  id: string,
  input: UpdateSourceInput,
  siteId: string,
  requiredColumns: string[],
  databasePath: string,
): SourceRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, tableName, requiredColumns);

    const existing = getSourceById(db, tableName, id, siteId);

    if (!existing) {
      return null;
    }

    if (tableName === "weather_sources") {
      const existingWeatherSource = existing as WeatherForecastSourceRecord;

      db.query(
        `
          UPDATE weather_sources
          SET name = ?2, provider = ?3, surface = ?4, updated_at = ?5
          WHERE id = ?1 AND site_id = ?6
        `,
      ).run(
        id,
        input.name,
        normalizeWeatherProvider(
          (input.provider ?? existingWeatherSource.provider) as WeatherProvider,
        ),
        normalizeWeatherSurface(
          input.surface ?? existingWeatherSource.surface,
          (input.provider ?? existingWeatherSource.provider) as WeatherProvider,
        ),
        new Date().toISOString(),
        siteId,
      );
    } else {
      const existingPriceSource = existing as DynamicPriceSourceRecord;

      db.query(
        `
          UPDATE dynamic_price_sources
          SET name = ?2, provider = ?3, home_id = ?4, export_deduction = ?5, updated_at = ?6
          WHERE id = ?1 AND site_id = ?7
        `,
      ).run(
        id,
        input.name,
        normalizeDynamicPriceProvider(existingPriceSource.provider),
        null,
        input.exportDeduction ?? existingPriceSource.exportDeduction,
        new Date().toISOString(),
        siteId,
      );
    }

    return getSourceByIdOrThrow(db, tableName, id, siteId);
  } finally {
    db.close();
  }
}

function deleteSource(
  tableName: "weather_sources" | "dynamic_price_sources",
  id: string,
  siteId: string,
  requiredColumns: string[],
  databasePath: string,
): SourceRecord | null {
  assertKnownSiteId(siteId, databasePath);
  const db = openWritableDatabase(databasePath);

  try {
    assertWritableSchema(db, databasePath, tableName, requiredColumns);
    const existing = getSourceById(db, tableName, id, siteId);

    if (!existing) {
      return null;
    }

    db.query(`DELETE FROM ${tableName} WHERE id = ?1 AND site_id = ?2`).run(
      id,
      siteId,
    );
    return existing;
  } finally {
    db.close();
  }
}

function openWritableDatabase(databasePath: string): Database {
  ensureParentDirectory(databasePath);

  const db = new Database(databasePath);
  db.exec("PRAGMA busy_timeout = 5000;");
  ensureSchema(db);
  return db;
}

function assertWritableSchema(
  db: Database,
  databasePath: string,
  tableName: string,
  requiredColumns: string[],
): void {
  if (!hasTable(db, tableName)) {
    assertSiteSchema(db, databasePath);
    return;
  }

  const missingColumns = getMissingColumns(db, tableName, requiredColumns);

  if (missingColumns.length === 0) {
    assertSiteSchema(db, databasePath);
    return;
  }

  throw new Error(
    `Database schema is outdated at ${databasePath}: table '${tableName}' is missing ${formatColumnList(missingColumns)}. Remove the database file and let the daemon recreate it.`,
  );
}

function ensureSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureSiteColumns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS batteries (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      plugin TEXT NOT NULL,
      model TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      connected INTEGER NOT NULL,
      minimum_discharge_percent REAL NOT NULL DEFAULT 10,
      strategy_mode TEXT NOT NULL DEFAULT 'self-consumption',
      manual_state TEXT,
      manual_power_w REAL,
      manual_charge_target_soc REAL,
      manual_discharge_target_soc REAL,
      manual_target_soc REAL,
      manual_mode_active INTEGER NOT NULL DEFAULT 0,
      manual_mode_started INTEGER NOT NULL DEFAULT 0,
      strategy_plan_json TEXT,
      strategy_runtime_json TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id),
      UNIQUE(site_id, model, ip_address)
    );
  `);
  ensureBatteryColumns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meters (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      model TEXT NOT NULL,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      connected INTEGER NOT NULL,
      details TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id),
      UNIQUE(site_id, model, ip_address)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS solar_energy_providers (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      plugin TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      connected INTEGER NOT NULL,
      serial_number TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id),
      UNIQUE(site_id, plugin, ip_address)
    );
  `);
  ensureSolarEnergyProviderColumns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS weather_sources (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'open-meteo',
      surface TEXT NOT NULL DEFAULT 'open-meteo-shortwave-radiation',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureWeatherSourceColumns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_price_sources (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'tibber',
      home_id TEXT,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureDynamicPriceSourceColumns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS battery_strategy_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      battery_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      observed_at TEXT NOT NULL,
      source TEXT NOT NULL,
      strategy_mode TEXT NOT NULL,
      manual_state TEXT,
      active_item_id TEXT,
      display_label TEXT NOT NULL,
      display_state TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureBatteryStrategyHistoryColumns(db);
}

function assertSiteSchema(db: Database, databasePath: string): void {
  if (!hasTable(db, "sites")) {
    return;
  }

  const missingColumns = getMissingColumns(db, "sites", SITE_REQUIRED_COLUMNS);

  if (missingColumns.length > 0) {
    throw new Error(
      `Database schema is outdated at ${databasePath}: table 'sites' is missing ${formatColumnList(missingColumns)}. Remove the database file and let the daemon recreate it.`,
    );
  }
}

function ensureBatteryColumns(db: Database): void {
  if (!hasTable(db, "batteries")) {
    return;
  }

  const columns = getTableColumns(db, "batteries");

  if (!columns.includes("plugin")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN plugin TEXT NOT NULL DEFAULT 'indevolt-battery';",
    );
  }

  if (!columns.includes("strategy_mode")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN strategy_mode TEXT NOT NULL DEFAULT 'self-consumption';",
    );
  }

  if (!columns.includes("manual_state")) {
    db.exec("ALTER TABLE batteries ADD COLUMN manual_state TEXT;");
  }

  if (!columns.includes("manual_power_w")) {
    db.exec("ALTER TABLE batteries ADD COLUMN manual_power_w REAL;");
  }

  if (!columns.includes("minimum_discharge_percent")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN minimum_discharge_percent REAL NOT NULL DEFAULT 10;",
    );
  }

  if (!columns.includes("manual_target_soc")) {
    db.exec("ALTER TABLE batteries ADD COLUMN manual_target_soc REAL;");
    db.exec(
      "UPDATE batteries SET manual_target_soc = 100 WHERE manual_target_soc IS NULL;",
    );
  }

  if (!columns.includes("manual_charge_target_soc")) {
    db.exec("ALTER TABLE batteries ADD COLUMN manual_charge_target_soc REAL;");
    db.exec(
      "UPDATE batteries SET manual_charge_target_soc = COALESCE(manual_target_soc, 100) WHERE manual_charge_target_soc IS NULL;",
    );
  }

  if (!columns.includes("manual_discharge_target_soc")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN manual_discharge_target_soc REAL;",
    );
    db.exec(
      "UPDATE batteries SET manual_discharge_target_soc = COALESCE(minimum_discharge_percent, 10) WHERE manual_discharge_target_soc IS NULL;",
    );
  }

  if (!columns.includes("manual_mode_active")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN manual_mode_active INTEGER NOT NULL DEFAULT 0;",
    );

    if (columns.includes("now_mode_active")) {
      db.exec(
        "UPDATE batteries SET manual_mode_active = now_mode_active WHERE manual_mode_active IS NULL OR manual_mode_active = 0;",
      );
    }
  }

  if (!columns.includes("manual_mode_started")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN manual_mode_started INTEGER NOT NULL DEFAULT 0;",
    );

    if (columns.includes("now_mode_started")) {
      db.exec(
        "UPDATE batteries SET manual_mode_started = now_mode_started WHERE manual_mode_started IS NULL OR manual_mode_started = 0;",
      );
    }
  }

  if (!columns.includes("strategy_plan_json")) {
    db.exec("ALTER TABLE batteries ADD COLUMN strategy_plan_json TEXT;");
  }

  if (!columns.includes("strategy_runtime_json")) {
    db.exec("ALTER TABLE batteries ADD COLUMN strategy_runtime_json TEXT;");
  }
}

function ensureWeatherSourceColumns(db: Database): void {
  if (!hasTable(db, "weather_sources")) {
    return;
  }

  const columns = getTableColumns(db, "weather_sources");

  if (!columns.includes("provider")) {
    db.exec(
      "ALTER TABLE weather_sources ADD COLUMN provider TEXT NOT NULL DEFAULT 'open-meteo';",
    );
  }

  if (!columns.includes("surface")) {
    db.exec(
      "ALTER TABLE weather_sources ADD COLUMN surface TEXT NOT NULL DEFAULT 'open-meteo-shortwave-radiation';",
    );
  }

  db.exec(`
    UPDATE weather_sources
    SET provider = CASE provider
      WHEN 'open-meteo' THEN 'open-meteo'
      ELSE 'open-meteo'
    END
  `);
  db.exec(`
    UPDATE weather_sources
    SET surface = CASE surface
      WHEN 'open-meteo-shortwave-radiation' THEN 'open-meteo-shortwave-radiation'
      ELSE 'open-meteo-shortwave-radiation'
    END
  `);
}

function ensureSolarEnergyProviderColumns(db: Database): void {
  if (!hasTable(db, "solar_energy_providers")) {
    return;
  }

  const columns = getTableColumns(db, "solar_energy_providers");

  if (!columns.includes("plugin")) {
    db.exec(
      "ALTER TABLE solar_energy_providers ADD COLUMN plugin TEXT NOT NULL DEFAULT 'enphase-local';",
    );
  }

  if (!columns.includes("serial_number")) {
    db.exec(
      "ALTER TABLE solar_energy_providers ADD COLUMN serial_number TEXT;",
    );

    if (columns.includes("details")) {
      db.exec(`
        UPDATE solar_energy_providers
        SET serial_number = NULLIF(
          TRIM(
            SUBSTR(
              details,
              INSTR(details, 'serial ') + LENGTH('serial '),
              CASE
                WHEN INSTR(SUBSTR(details, INSTR(details, 'serial ') + LENGTH('serial ')), ',') > 0
                  THEN INSTR(SUBSTR(details, INSTR(details, 'serial ') + LENGTH('serial ')), ',') - 1
                ELSE LENGTH(details)
              END
            )
          ),
          ''
        )
        WHERE details LIKE '%serial %' AND (serial_number IS NULL OR serial_number = '')
      `);
    }
  }
}

function normalizeWeatherProvider(
  provider: WeatherProvider | null | undefined,
): WeatherProvider {
  return "open-meteo";
}

function normalizeWeatherSurface(
  surface: WeatherForecastSurface | null | undefined,
  provider: WeatherProvider | null | undefined,
): WeatherForecastSurface {
  void surface;
  void provider;
  return "open-meteo-shortwave-radiation";
}

function normalizeDynamicPriceProvider(
  provider: string | null | undefined,
): "tibber" {
  void provider;
  return "tibber";
}

function ensureDynamicPriceSourceColumns(db: Database): void {
  if (!hasTable(db, "dynamic_price_sources")) {
    return;
  }

  const columns = getTableColumns(db, "dynamic_price_sources");

  if (!columns.includes("provider")) {
    db.exec(
      "ALTER TABLE dynamic_price_sources ADD COLUMN provider TEXT NOT NULL DEFAULT 'tibber';",
    );
  }

  if (!columns.includes("home_id")) {
    db.exec("ALTER TABLE dynamic_price_sources ADD COLUMN home_id TEXT;");
  }

  if (!columns.includes("export_deduction")) {
    db.exec(
      "ALTER TABLE dynamic_price_sources ADD COLUMN export_deduction REAL NOT NULL DEFAULT 0.13;",
    );
  }

  db.exec(`
    UPDATE dynamic_price_sources
    SET provider = CASE provider
      WHEN 'tibber' THEN 'tibber'
      ELSE 'tibber'
    END
  `);
}

function ensureBatteryStrategyHistoryColumns(db: Database): void {
  if (!hasTable(db, "battery_strategy_history")) {
    return;
  }

  const columns = getTableColumns(db, "battery_strategy_history");

  if (!columns.includes("manual_state")) {
    db.exec(
      "ALTER TABLE battery_strategy_history ADD COLUMN manual_state TEXT;",
    );
  }

  if (!columns.includes("active_item_id")) {
    db.exec(
      "ALTER TABLE battery_strategy_history ADD COLUMN active_item_id TEXT;",
    );
  }

  if (!columns.includes("display_state")) {
    db.exec(
      "ALTER TABLE battery_strategy_history ADD COLUMN display_state TEXT NOT NULL DEFAULT 'idle';",
    );
  }

  db.exec(`
    UPDATE battery_strategy_history
    SET display_state = CASE display_label
      WHEN 'Self-consumption' THEN 'self-consumption'
      WHEN 'Charge' THEN 'charge'
      WHEN 'Discharge' THEN 'discharge'
      ELSE 'idle'
    END
    WHERE display_state IS NULL OR display_state = ''
  `);

  db.exec(`
    UPDATE battery_strategy_history
    SET source = CASE source
      WHEN 'manual' THEN 'manual'
      ELSE 'automatic'
    END,
    strategy_mode = CASE strategy_mode
      WHEN 'manual' THEN 'manual'
      WHEN 'self-consumption' THEN 'self-consumption'
      ELSE 'auto'
    END,
    manual_state = CASE manual_state
      WHEN 'charging' THEN 'charging'
      WHEN 'discharging' THEN 'discharging'
      WHEN 'idle' THEN 'idle'
      ELSE NULL
    END,
    display_state = CASE display_state
      WHEN 'self-consumption' THEN 'self-consumption'
      WHEN 'charge' THEN 'charge'
      WHEN 'discharge' THEN 'discharge'
      ELSE 'idle'
    END
  `);
}

function resolveManualTargetSoc(input: {
  manualState: BatteryManualState | null;
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

function resolveManualState(
  state: BatteryStatus | BatteryManualState | null,
): BatteryManualState {
  if (state === "charging" || state === "discharging") {
    return state;
  }

  return "idle";
}

function normalizeMinimumDischargePercent(value: number | undefined): number {
  const nextValue = value ?? 10;

  if (!Number.isFinite(nextValue)) {
    throw new Error("Minimum discharge percentage must be a number.");
  }

  return Math.max(10, Math.min(100, Math.round(nextValue)));
}

function ensureSiteColumns(db: Database): void {
  if (!hasTable(db, "sites")) {
    return;
  }

  const columns = getTableColumns(db, "sites");

  if (!columns.includes("location")) {
    db.exec("ALTER TABLE sites ADD COLUMN location TEXT NOT NULL DEFAULT '';");
  }
}

function normalizeSiteLocation(location: string | undefined): string {
  if (location === undefined) {
    return "";
  }

  const coordinate = parseGpsCoordinate(location);

  if (!coordinate) {
    throw new Error(
      "Site location must be a GPS coordinate in 'latitude, longitude' format.",
    );
  }

  return `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`;
}

function deleteLinkedSiteResources(db: Database, siteId: string): void {
  const linkedTables = [
    "device_telemetry",
    "battery_strategy_history",
    "weather_forecasts",
    "dynamic_price_snapshots",
    "dynamic_price_samples",
    "solar_forecast_samples",
    "p1_meter_samples",
    "battery_power_samples",
    "solar_energy_provider_samples",
    "batteries",
    "meters",
    "solar_energy_providers",
    "weather_sources",
    "dynamic_price_sources",
  ] as const;

  for (const tableName of linkedTables) {
    if (
      !hasTable(db, tableName) ||
      !getTableColumns(db, tableName).includes("site_id")
    ) {
      continue;
    }

    db.query(`DELETE FROM ${tableName} WHERE site_id = ?1`).run(siteId);
  }
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .query<{ name: string }, [string]>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?1
      `,
    )
    .get(tableName);

  return row !== null && row !== undefined;
}

function hasColumns(
  db: Database,
  tableName: string,
  requiredColumns: string[],
): boolean {
  const columns = getTableColumns(db, tableName);
  return requiredColumns.every((column) => columns.includes(column));
}

function getMissingColumns(
  db: Database,
  tableName: string,
  requiredColumns: string[],
): string[] {
  const columns = getTableColumns(db, tableName);
  return requiredColumns.filter((column) => !columns.includes(column));
}

function getTableColumns(db: Database, tableName: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => column.name);
}

function formatColumnList(columns: string[]): string {
  return columns.map((column) => `'${column}'`).join(", ");
}

function buildBatteryStrategyHistoryRecord(
  battery: BatteryRecord,
  observedAt: string,
): import("@emsd/core").BatteryStrategyHistoryRecord {
  return {
    activeItemId: battery.strategyRuntime.activeItemId,
    batteryId: battery.id,
    displayLabel: getBatteryStrategyDisplayLabel(battery),
    displayState: getBatteryStrategyDisplayState(battery),
    endedAt: null,
    manualState: battery.manualState,
    observedAt,
    siteId: battery.siteId,
    source: battery.manualModeActive ? "manual" : "automatic",
    startedAt: observedAt,
    strategyMode: battery.strategyMode,
  };
}

function getBatteryStrategyDisplayState(
  battery: Pick<BatteryRecord, "strategyMode" | "manualState">,
): BatteryStrategyHistoryDisplayState {
  if (battery.strategyMode === "self-consumption") {
    return "self-consumption";
  }

  if (battery.manualState === "charging") {
    return "charge";
  }

  if (battery.manualState === "discharging") {
    return "discharge";
  }

  return "idle";
}

function getBatteryStrategyDisplayLabel(
  battery: Pick<BatteryRecord, "strategyMode" | "manualState">,
): string {
  const displayState = getBatteryStrategyDisplayState(battery);

  switch (displayState) {
    case "self-consumption":
      return "Self-consumption";
    case "charge":
      return "Charge";
    case "discharge":
      return "Discharge";
    case "idle":
      return "Idle";
  }
}

function readBatteries(db: Database, siteId: string): BatteryRecord[] {
  return db
    .query<BatteryRow, [string]>(
      `
        SELECT
          id,
          site_id,
          name,
          plugin,
          model,
          ip_address,
          enabled,
          status,
          connected,
          minimum_discharge_percent,
          strategy_mode,
          manual_state,
          manual_power_w,
          manual_charge_target_soc,
          manual_discharge_target_soc,
          manual_target_soc,
          manual_mode_active,
          manual_mode_started,
          strategy_plan_json,
          strategy_runtime_json,
          updated_at
        FROM batteries
        WHERE site_id = ?1
        ORDER BY name ASC, id ASC
      `,
    )
    .all(siteId)
    .map(mapBatteryRow);
}

function readMeters(db: Database, siteId: string): MeterRecord[] {
  return db
    .query<MeterRow, [string]>(
      `
        SELECT id, site_id, name, model, ip_address, enabled, connected, details, updated_at
        FROM meters
        WHERE site_id = ?1
        ORDER BY name ASC, id ASC
      `,
    )
    .all(siteId)
    .map(mapMeterRow);
}

function readSolarEnergyProviders(
  db: Database,
  siteId: string,
): SolarEnergyProviderRecord[] {
  return db
    .query<SolarEnergyProviderRow, [string]>(
      `
        SELECT id, site_id, name, plugin, ip_address, enabled, connected, serial_number, updated_at
        FROM solar_energy_providers
        WHERE site_id = ?1
        ORDER BY name ASC, id ASC
      `,
    )
    .all(siteId)
    .map(mapSolarEnergyProviderRow);
}

type SourceRecord = WeatherForecastSourceRecord | DynamicPriceSourceRecord;

function readSources(
  db: Database,
  tableName: "weather_sources" | "dynamic_price_sources",
  siteId: string,
): SourceRecord[] {
  return db
    .query<SourceRow, [string]>(
      tableName === "weather_sources"
        ? `
            SELECT id, site_id, name, provider, surface, NULL as home_id, updated_at
            FROM weather_sources
            WHERE site_id = ?1
            ORDER BY name ASC, id ASC
          `
        : `
            SELECT id, site_id, name, provider, NULL as surface, home_id, export_deduction, updated_at
            FROM dynamic_price_sources
            WHERE site_id = ?1
            ORDER BY name ASC, id ASC
          `,
    )
    .all(siteId)
    .map((row) => mapSourceRow(tableName, row));
}

function getSiteById(db: Database, siteId: string): SiteRecord | null {
  const row = db
    .query<SiteRow, [string]>(
      `
        SELECT id, name, location, created_at, updated_at
        FROM sites
        WHERE id = ?1
      `,
    )
    .get(siteId);

  return row ? mapSiteRow(row) : null;
}

function getBatteryById(
  db: Database,
  id: string,
  siteId: string,
): BatteryRecord | null {
  const row = db
    .query<BatteryRow, [string, string]>(
      `
        SELECT
          id,
          site_id,
          name,
          plugin,
          model,
          ip_address,
          enabled,
          status,
          connected,
          minimum_discharge_percent,
          strategy_mode,
          manual_state,
          manual_power_w,
          manual_charge_target_soc,
          manual_discharge_target_soc,
          manual_target_soc,
          manual_mode_active,
          manual_mode_started,
          strategy_plan_json,
          strategy_runtime_json,
          updated_at
        FROM batteries
        WHERE id = ?1 AND site_id = ?2
      `,
    )
    .get(id, siteId);

  return row ? mapBatteryRow(row) : null;
}

function getMeterById(
  db: Database,
  id: string,
  siteId: string,
): MeterRecord | null {
  const row = db
    .query<MeterRow, [string, string]>(
      `
        SELECT id, site_id, name, model, ip_address, enabled, connected, details, updated_at
        FROM meters
        WHERE id = ?1 AND site_id = ?2
      `,
    )
    .get(id, siteId);

  return row ? mapMeterRow(row) : null;
}

function getSolarEnergyProviderById(
  db: Database,
  id: string,
  siteId: string,
): SolarEnergyProviderRecord | null {
  const row = db
    .query<SolarEnergyProviderRow, [string, string]>(
      `
        SELECT id, site_id, name, plugin, ip_address, enabled, connected, serial_number, updated_at
        FROM solar_energy_providers
        WHERE id = ?1 AND site_id = ?2
      `,
    )
    .get(id, siteId);

  return row ? mapSolarEnergyProviderRow(row) : null;
}

function getSourceById(
  db: Database,
  tableName: "weather_sources" | "dynamic_price_sources",
  id: string,
  siteId: string,
): SourceRecord | null {
  const row = db
    .query<SourceRow, [string, string]>(
      tableName === "weather_sources"
        ? `
            SELECT id, site_id, name, provider, surface, NULL as home_id, updated_at
            FROM weather_sources
            WHERE id = ?1 AND site_id = ?2
          `
        : `
            SELECT id, site_id, name, provider, NULL as surface, home_id, export_deduction, updated_at
            FROM dynamic_price_sources
            WHERE id = ?1 AND site_id = ?2
          `,
    )
    .get(id, siteId);

  return row ? mapSourceRow(tableName, row) : null;
}

function getSiteByIdOrThrow(db: Database, siteId: string): SiteRecord {
  const site = getSiteById(db, siteId);

  if (!site) {
    throw new Error(`Site not found after write: ${siteId}`);
  }

  return site;
}

function getBatteryByIdOrThrow(
  db: Database,
  id: string,
  siteId: string,
): BatteryRecord {
  const battery = getBatteryById(db, id, siteId);

  if (!battery) {
    throw new Error(`Managed battery not found after write: ${id}`);
  }

  return battery;
}

function getMeterByIdOrThrow(
  db: Database,
  id: string,
  siteId: string,
): MeterRecord {
  const meter = getMeterById(db, id, siteId);

  if (!meter) {
    throw new Error(`Managed meter not found after write: ${id}`);
  }

  return meter;
}

function getSolarEnergyProviderByIdOrThrow(
  db: Database,
  id: string,
  siteId: string,
): SolarEnergyProviderRecord {
  const provider = getSolarEnergyProviderById(db, id, siteId);

  if (!provider) {
    throw new Error(
      `Managed solar energy provider not found after write: ${id}`,
    );
  }

  return provider;
}

function getSourceByIdOrThrow(
  db: Database,
  tableName: "weather_sources" | "dynamic_price_sources",
  id: string,
  siteId: string,
): SourceRecord {
  const source = getSourceById(db, tableName, id, siteId);

  if (!source) {
    throw new Error(`Managed source not found after write: ${id}`);
  }

  return source;
}

function mapSiteRow(row: SiteRow): SiteRecord {
  return {
    id: row.id,
    location: row.location,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBatteryRow(row: BatteryRow): BatteryRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    plugin: row.plugin,
    model: row.model,
    ipAddress: row.ip_address,
    enabled: row.enabled === 1,
    status: row.status,
    connected: row.connected === 1,
    minimumDischargePercent: row.minimum_discharge_percent,
    strategyMode: row.strategy_mode,
    manualState: row.manual_state,
    manualPowerW: row.manual_power_w,
    manualChargeTargetSoc: row.manual_charge_target_soc,
    manualDischargeTargetSoc: row.manual_discharge_target_soc,
    manualTargetSoc: row.manual_target_soc,
    manualModeActive: row.manual_mode_active === 1,
    manualModeStarted: row.manual_mode_started === 1,
    strategyPlan: parseBatteryStrategyPlanJson({
      minimumDischargePercent: row.minimum_discharge_percent,
      strategy: {
        strategyMode: row.strategy_mode,
        manualState: row.manual_state,
        manualPowerW: row.manual_power_w,
        manualChargeTargetSoc: row.manual_charge_target_soc,
        manualDischargeTargetSoc: row.manual_discharge_target_soc,
        manualTargetSoc: row.manual_target_soc,
      },
      value: row.strategy_plan_json,
    }),
    strategyRuntime: parseBatteryStrategyRuntimeJson(row.strategy_runtime_json),
    updatedAt: row.updated_at,
  };
}

function mapMeterRow(row: MeterRow): MeterRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    model: row.model,
    ipAddress: row.ip_address,
    enabled: row.enabled === 1,
    connected: row.connected === 1,
    details: row.details,
    updatedAt: row.updated_at,
  };
}

function mapSolarEnergyProviderRow(
  row: SolarEnergyProviderRow,
): SolarEnergyProviderRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    plugin: row.plugin,
    ipAddress: row.ip_address,
    enabled: row.enabled === 1,
    connected: row.connected === 1,
    serialNumber: row.serial_number,
    updatedAt: row.updated_at,
  };
}

function mapSourceRow(
  tableName: "weather_sources" | "dynamic_price_sources",
  row: SourceRow,
): SourceRecord {
  if (tableName === "weather_sources") {
    return {
      id: row.id,
      siteId: row.site_id,
      name: row.name,
      provider: normalizeWeatherProvider(
        row.provider as WeatherProvider | null,
      ),
      surface: normalizeWeatherSurface(
        row.surface as WeatherForecastSurface | null,
        row.provider as WeatherProvider | null,
      ),
      updatedAt: row.updated_at,
    } satisfies WeatherForecastSourceRecord;
  }

  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    provider: normalizeDynamicPriceProvider(row.provider),
    exportDeduction:
      typeof row.export_deduction === "number" ? row.export_deduction : 0.13,
    updatedAt: row.updated_at,
  } satisfies DynamicPriceSourceRecord;
}
