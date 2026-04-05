import { Database } from "bun:sqlite";
import {
  type BatteryRecord,
  type ManagedDeviceTelemetryRecord,
  type MeterRecord,
  type SiteRecord,
  ensureParentDirectory,
  getDatabasePath,
} from "@emsd/core";

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

interface DeviceTelemetryRow {
  device_id: string;
  site_id: string;
  kind: ManagedDeviceTelemetryRecord["kind"];
  power_w: number | null;
  soc_percent: number | null;
  gas_m3: number | null;
  state: ManagedDeviceTelemetryRecord["state"];
  observed_at: string;
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_telemetry (
      device_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      power_w REAL,
      soc_percent REAL,
      gas_m3 REAL,
      state TEXT,
      observed_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);

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

export function readManagedDeviceTelemetry(
  db: Database,
): ManagedDeviceTelemetryRecord[] {
  const rows = db
    .query<DeviceTelemetryRow, []>(
      `
        SELECT
          device_id,
          site_id,
          kind,
          power_w,
          soc_percent,
          gas_m3,
          state,
          observed_at
        FROM device_telemetry
        ORDER BY observed_at DESC
      `,
    )
    .all();

  return rows.map((row) => ({
    deviceId: row.device_id,
    siteId: row.site_id,
    kind: row.kind,
    powerW: row.power_w,
    socPercent: row.soc_percent,
    gasM3: row.gas_m3,
    state: row.state,
    observedAt: row.observed_at,
  }));
}

export function upsertManagedDeviceTelemetry(
  db: Database,
  telemetry: ManagedDeviceTelemetryRecord,
): void {
  db.query(
    `
      INSERT INTO device_telemetry (
        device_id,
        site_id,
        kind,
        power_w,
        soc_percent,
        gas_m3,
        state,
        observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        site_id = excluded.site_id,
        kind = excluded.kind,
        power_w = excluded.power_w,
        soc_percent = excluded.soc_percent,
        gas_m3 = excluded.gas_m3,
        state = excluded.state,
        observed_at = excluded.observed_at
    `,
  ).run(
    telemetry.deviceId,
    telemetry.siteId,
    telemetry.kind,
    telemetry.powerW,
    telemetry.socPercent,
    telemetry.gasM3,
    telemetry.state,
    telemetry.observedAt,
  );
}
