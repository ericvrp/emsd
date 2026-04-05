import { Database } from "bun:sqlite";
import {
  type BatteryRecord,
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
  status: BatteryRecord["status"];
  connected: number;
  updated_at: string;
}

interface MeterRow {
  id: string;
  site_id: string;
  model: string;
  name: string;
  ip_address: string;
  enabled: number;
  connected: number;
  details: string;
  updated_at: string;
}

export function openDaemonDatabase(databasePath = getDatabasePath()): Database {
  ensureParentDirectory(databasePath);

  const db = new Database(databasePath);

  db.exec("PRAGMA journal_mode = WAL;");
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

  ensureDefaultSite(db);

  return db;
}

export function readSites(db: Database): SiteRecord[] {
  const rows = db
    .query<SiteRow, []>(
      `
        SELECT id, name, created_at, updated_at
        FROM sites
        ORDER BY name ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function readBatteries(db: Database): BatteryRecord[] {
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

  return rows.map((row) => ({
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
  }));
}

export function readMeters(db: Database): MeterRecord[] {
  const rows = db
    .query<MeterRow, []>(
      `
        SELECT
          id,
          site_id,
          model,
          name,
          ip_address,
          enabled,
          connected,
          details,
          updated_at
        FROM meters
        ORDER BY name ASC, ip_address ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    model: row.model,
    name: row.name,
    ipAddress: row.ip_address,
    enabled: row.enabled === 1,
    connected: row.connected === 1,
    details: row.details,
    updatedAt: row.updated_at,
  }));
}

function ensureDefaultSite(db: Database): void {
  const existing = db
    .query<{ id: string }, [string]>(
      `
        SELECT id
        FROM sites
        WHERE id = ?1
      `,
    )
    .get(DEFAULT_SITE_ID);

  if (existing) {
    return;
  }

  const now = new Date().toISOString();
  db.query(
    `
      INSERT INTO sites (id, name, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4)
    `,
  ).run(DEFAULT_SITE_ID, DEFAULT_SITE_NAME, now, now);
}
