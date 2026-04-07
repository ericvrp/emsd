import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import {
  type BatteryManualState,
  type BatteryRecord,
  type BatteryStatus,
  type BatteryStrategyMode,
  type DynamicPriceSourceRecord,
  type MeterRecord,
  type SiteRecord,
  type WeatherForecastSourceRecord,
  ensureParentDirectory,
  getDatabasePath,
} from "@emsd/core";

const SITE_REQUIRED_COLUMNS = ["id", "name", "location", "created_at", "updated_at"];
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
const WEATHER_SOURCE_REQUIRED_COLUMNS = ["id", "site_id", "name", "updated_at"];
const DYNAMIC_PRICE_SOURCE_REQUIRED_COLUMNS = [
  "id",
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

interface SourceRow {
  id: string;
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
}

interface UpdateSourceInput {
  name: string;
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

    const linkedResources = getLinkedSiteResources(db, siteId);

    if (linkedResources.length > 0) {
      throw new Error(
        `Cannot remove site ${siteId} until its linked resources are deleted: ${linkedResources.map((resource) => `${resource.count} ${resource.label}`).join(", ")}.`,
      );
    }

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

export function createBattery(
  input: CreateBatteryInput,
  siteId: string,
  databasePath = getDatabasePath(),
): BatteryRecord {
  assertKnownSiteId(siteId, databasePath);
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
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
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
          manualState: resolveManualState(input.manualState ?? input.status ?? null),
          manualChargeTargetSoc: input.manualChargeTargetSoc ?? 100,
          manualDischargeTargetSoc:
            input.manualDischargeTargetSoc ??
            normalizeMinimumDischargePercent(input.minimumDischargePercent),
        }),
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

export function setBatteryStrategy(
  id: string,
  input: UpdateBatteryStrategyInput,
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
        SET
          strategy_mode = ?2,
          manual_state = ?3,
          manual_power_w = ?4,
          manual_charge_target_soc = ?5,
          manual_discharge_target_soc = ?6,
          manual_target_soc = ?7,
          updated_at = ?8
        WHERE id = ?1 AND site_id = ?9
      `,
    ).run(
      id,
      input.strategyMode,
      input.manualState ?? null,
      input.manualPowerW ?? null,
      input.manualChargeTargetSoc ?? null,
      input.manualDischargeTargetSoc ?? null,
      input.manualTargetSoc ?? null,
      new Date().toISOString(),
      siteId,
    );

    return getBatteryByIdOrThrow(db, id, siteId);
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

export function listWeatherForecastSources(
  siteId: string,
  databasePath = getDatabasePath(),
): WeatherForecastSourceRecord[] {
  return listSources(
    "weather_sources",
    siteId,
    WEATHER_SOURCE_REQUIRED_COLUMNS,
    databasePath,
  );
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
  );
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
  );
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
  );
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
  );
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
  );
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
  );
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
  );
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

    db.query(
      `
        INSERT INTO ${tableName} (id, site_id, name, updated_at)
        VALUES (?1, ?2, ?3, ?4)
      `,
    ).run(input.id, siteId, input.name, now);

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

    if (!getSourceById(db, tableName, id, siteId)) {
      return null;
    }

    db.query(
      `
        UPDATE ${tableName}
        SET name = ?2, updated_at = ?3
        WHERE id = ?1 AND site_id = ?4
      `,
    ).run(id, input.name, new Date().toISOString(), siteId);

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
    CREATE TABLE IF NOT EXISTS weather_sources (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_price_sources (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
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
    db.exec("ALTER TABLE batteries ADD COLUMN plugin TEXT NOT NULL DEFAULT 'indevolt-battery';");
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
    db.exec("ALTER TABLE batteries ADD COLUMN manual_discharge_target_soc REAL;");
    db.exec(
      "UPDATE batteries SET manual_discharge_target_soc = COALESCE(minimum_discharge_percent, 10) WHERE manual_discharge_target_soc IS NULL;",
    );
  }
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

function resolveManualState(state: BatteryStatus | BatteryManualState | null): BatteryManualState {
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

  const matched = location
    .trim()
    .match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);

  if (!matched) {
    throw new Error(
      "Site location must be a GPS coordinate in 'latitude, longitude' format.",
    );
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
    throw new Error("Site location is outside valid GPS bounds.");
  }

  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function getLinkedSiteResources(
  db: Database,
  siteId: string,
): Array<{ count: number; label: string }> {
  const linkedTables = [
    { tableName: "batteries", label: "battery plugin(s)" },
    { tableName: "meters", label: "meter(s)" },
    { tableName: "weather_sources", label: "weather source(s)" },
    { tableName: "dynamic_price_sources", label: "dynamic price source(s)" },
  ] as const;
  const resources: Array<{ count: number; label: string }> = [];

  for (const { tableName, label } of linkedTables) {
    if (
      !hasTable(db, tableName) ||
      !getTableColumns(db, tableName).includes("site_id")
    ) {
      continue;
    }

    const row = db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) as count FROM ${tableName} WHERE site_id = ?1`,
      )
      .get(siteId);

    if ((row?.count ?? 0) > 0) {
      resources.push({ count: row?.count ?? 0, label });
    }
  }

  return resources;
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

type SourceRecord = WeatherForecastSourceRecord | DynamicPriceSourceRecord;

function readSources(
  db: Database,
  tableName: "weather_sources" | "dynamic_price_sources",
  siteId: string,
): SourceRecord[] {
  return db
    .query<SourceRow, [string]>(
      `
        SELECT id, site_id, name, updated_at
        FROM ${tableName}
        WHERE site_id = ?1
        ORDER BY name ASC, id ASC
      `,
    )
    .all(siteId)
    .map(mapSourceRow);
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

function getSourceById(
  db: Database,
  tableName: "weather_sources" | "dynamic_price_sources",
  id: string,
  siteId: string,
): SourceRecord | null {
  const row = db
    .query<SourceRow, [string, string]>(
      `
        SELECT id, site_id, name, updated_at
        FROM ${tableName}
        WHERE id = ?1 AND site_id = ?2
      `,
    )
    .get(id, siteId);

  return row ? mapSourceRow(row) : null;
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

function mapSourceRow(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    updatedAt: row.updated_at,
  };
}
