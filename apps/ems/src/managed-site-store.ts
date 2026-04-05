import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  type BatteryRecord,
  type BatteryStatus,
  type MeterRecord,
  type SiteRecord,
  ensureParentDirectory,
  getDatabasePath,
} from "@emsd/core";

const DEFAULT_SITE_ID = "default-site";
const DEFAULT_SITE_NAME = "Default Site";

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

interface CreateBatteryInput {
  name: string;
  adapter: string;
  model: string;
  ipAddress: string;
  enabled?: boolean;
  connected?: boolean;
  status?: BatteryStatus;
}

interface CreateMeterInput {
  name: string;
  model: string;
  ipAddress: string;
  enabled?: boolean;
  connected?: boolean;
  details?: string;
}

export function listBatteries(
  databasePath = getDatabasePath(),
): BatteryRecord[] {
  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "batteries") ||
      !hasColumns(db, "batteries", [
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
      ])
    ) {
      return [];
    }

    return readBatteries(db);
  } finally {
    db.close();
  }
}

export function listMeters(databasePath = getDatabasePath()): MeterRecord[] {
  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (
      !hasTable(db, "meters") ||
      !hasColumns(db, "meters", [
        "id",
        "site_id",
        "name",
        "model",
        "ip_address",
        "enabled",
        "connected",
        "details",
        "updated_at",
      ])
    ) {
      return [];
    }

    return readMeters(db);
  } finally {
    db.close();
  }
}

export function createBattery(
  input: CreateBatteryInput,
  databasePath = getDatabasePath(),
): BatteryRecord {
  const db = openWritableDatabase(databasePath);

  try {
    const site = ensureDefaultSite(db);
    const now = new Date().toISOString();
    const id = randomUUID();

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
      id,
      site.id,
      input.name,
      input.adapter,
      input.model,
      input.ipAddress,
      input.enabled === false ? 0 : 1,
      input.status ?? "idle",
      input.connected === false ? 0 : 1,
      now,
    );

    return getBatteryByIdOrThrow(db, id);
  } finally {
    db.close();
  }
}

export function createMeter(
  input: CreateMeterInput,
  databasePath = getDatabasePath(),
): MeterRecord {
  const db = openWritableDatabase(databasePath);

  try {
    const site = ensureDefaultSite(db);
    const now = new Date().toISOString();
    const id = randomUUID();

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
      id,
      site.id,
      input.name,
      input.model,
      input.ipAddress,
      input.enabled === false ? 0 : 1,
      input.connected === false ? 0 : 1,
      input.details ?? "",
      now,
    );

    return getMeterByIdOrThrow(db, id);
  } finally {
    db.close();
  }
}

export function setBatteryEnabled(
  id: string,
  enabled: boolean,
  databasePath = getDatabasePath(),
): BatteryRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    const existing = getBatteryById(db, id);

    if (!existing) {
      return null;
    }

    db.query(
      `
        UPDATE batteries
        SET enabled = ?2, updated_at = ?3
        WHERE id = ?1
      `,
    ).run(id, enabled ? 1 : 0, new Date().toISOString());

    return getBatteryByIdOrThrow(db, id);
  } finally {
    db.close();
  }
}

export function setMeterEnabled(
  id: string,
  enabled: boolean,
  databasePath = getDatabasePath(),
): MeterRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    const existing = getMeterById(db, id);

    if (!existing) {
      return null;
    }

    db.query(
      `
        UPDATE meters
        SET enabled = ?2, updated_at = ?3
        WHERE id = ?1
      `,
    ).run(id, enabled ? 1 : 0, new Date().toISOString());

    return getMeterByIdOrThrow(db, id);
  } finally {
    db.close();
  }
}

export function deleteBattery(
  id: string,
  databasePath = getDatabasePath(),
): BatteryRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    const existing = getBatteryById(db, id);

    if (!existing) {
      return null;
    }

    db.query("DELETE FROM batteries WHERE id = ?1").run(id);
    return existing;
  } finally {
    db.close();
  }
}

export function deleteMeter(
  id: string,
  databasePath = getDatabasePath(),
): MeterRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    const existing = getMeterById(db, id);

    if (!existing) {
      return null;
    }

    db.query("DELETE FROM meters WHERE id = ?1").run(id);
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
      provider TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
}

function ensureDefaultSite(db: Database): SiteRecord {
  const existing = db
    .query<SiteRow, [string]>(
      `
        SELECT id, name, created_at, updated_at
        FROM sites
        WHERE id = ?1
      `,
    )
    .get(DEFAULT_SITE_ID);

  if (existing) {
    return mapSiteRow(existing);
  }

  const now = new Date().toISOString();
  db.query(
    `
      INSERT INTO sites (id, name, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4)
    `,
  ).run(DEFAULT_SITE_ID, DEFAULT_SITE_NAME, now, now);

  return {
    id: DEFAULT_SITE_ID,
    name: DEFAULT_SITE_NAME,
    createdAt: now,
    updatedAt: now,
  };
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
  const columns = db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => column.name);

  return requiredColumns.every((column) => columns.includes(column));
}

function readBatteries(db: Database): BatteryRecord[] {
  const rows = db
    .query<BatteryRow, []>(
      `
        SELECT
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
        FROM batteries
        ORDER BY name ASC
      `,
    )
    .all();

  return rows.map(mapBatteryRow);
}

function readMeters(db: Database): MeterRecord[] {
  const rows = db
    .query<MeterRow, []>(
      `
        SELECT
          id,
          site_id,
          name,
          model,
          ip_address,
          enabled,
          connected,
          details,
          updated_at
        FROM meters
        ORDER BY name ASC
      `,
    )
    .all();

  return rows.map(mapMeterRow);
}

function getBatteryById(db: Database, id: string): BatteryRecord | null {
  const row = db
    .query<BatteryRow, [string]>(
      `
        SELECT
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
        FROM batteries
        WHERE id = ?1
      `,
    )
    .get(id);

  return row ? mapBatteryRow(row) : null;
}

function getMeterById(db: Database, id: string): MeterRecord | null {
  const row = db
    .query<MeterRow, [string]>(
      `
        SELECT
          id,
          site_id,
          name,
          model,
          ip_address,
          enabled,
          connected,
          details,
          updated_at
        FROM meters
        WHERE id = ?1
      `,
    )
    .get(id);

  return row ? mapMeterRow(row) : null;
}

function getBatteryByIdOrThrow(db: Database, id: string): BatteryRecord {
  const battery = getBatteryById(db, id);

  if (!battery) {
    throw new Error(`Managed battery not found after write: ${id}`);
  }

  return battery;
}

function getMeterByIdOrThrow(db: Database, id: string): MeterRecord {
  const meter = getMeterById(db, id);

  if (!meter) {
    throw new Error(`Managed meter not found after write: ${id}`);
  }

  return meter;
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
