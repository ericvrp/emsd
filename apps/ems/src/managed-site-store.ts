import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import {
  type BatteryRecord,
  type BatteryStatus,
  type DynamicPriceSourceRecord,
  type MeterRecord,
  type SiteRecord,
  type WeatherForecastSourceRecord,
  ensureParentDirectory,
  getDatabasePath,
} from "@emsd/core";

const SITE_REQUIRED_COLUMNS = ["id", "name", "created_at", "updated_at"];
const BATTERY_REQUIRED_COLUMNS = [
  "id",
  "site_id",
  "name",
  "adapter",
  "model",
  "ip_address",
  "enabled",
  "status",
  "connected",
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
  name: string;
  created_at: string;
  updated_at: string;
}

interface BatteryRow {
  id: string;
  site_id: string;
  name: string;
  adapter: string;
  model: string;
  ip_address: string;
  enabled: number;
  status: BatteryStatus;
  connected: number;
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
  adapter: string;
  model: string;
  ipAddress: string;
  enabled?: boolean;
  connected?: boolean;
  status?: BatteryStatus;
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
  name: string;
}

interface UpdateSiteInput {
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
          SELECT id, name, created_at, updated_at
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
    db.query(
      `
        INSERT INTO sites (id, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4)
      `,
    ).run(input.id, input.name, now, now);

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

    db.query(
      `
        UPDATE sites
        SET name = ?2, updated_at = ?3
        WHERE id = ?1
      `,
    ).run(siteId, input.name, new Date().toISOString());

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

    const linkedTable = getLinkedSiteTable(db, siteId);

    if (linkedTable) {
      throw new Error(
        `Cannot remove site ${siteId}: ${linkedTable} still reference it`,
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
          adapter,
          model,
          ip_address,
          enabled,
          status,
          connected,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      `,
    ).run(
      input.id,
      siteId,
      input.name,
      input.adapter,
      input.model,
      input.ipAddress,
      input.enabled === false ? 0 : 1,
      input.status ?? "idle",
      input.connected === false ? 0 : 1,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS batteries (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      model TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      connected INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id),
      UNIQUE(site_id, model, ip_address)
    );
  `);
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

function getLinkedSiteTable(db: Database, siteId: string): string | null {
  const linkedTables = [
    "batteries",
    "meters",
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

    const row = db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) as count FROM ${tableName} WHERE site_id = ?1`,
      )
      .get(siteId);

    if ((row?.count ?? 0) > 0) {
      return tableName;
    }
  }

  return null;
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
        SELECT id, site_id, name, adapter, model, ip_address, enabled, status, connected, updated_at
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
        SELECT id, name, created_at, updated_at
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
        SELECT id, site_id, name, adapter, model, ip_address, enabled, status, connected, updated_at
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
    adapter: row.adapter,
    model: row.model,
    ipAddress: row.ip_address,
    enabled: row.enabled === 1,
    status: row.status,
    connected: row.connected === 1,
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
