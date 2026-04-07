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
  status: BatteryRecord["status"];
  connected: number;
  minimum_discharge_percent: BatteryRecord["minimumDischargePercent"];
  strategy_mode: BatteryRecord["strategyMode"] | "self-consumption";
  manual_state: BatteryRecord["manualState"];
  manual_power_w: BatteryRecord["manualPowerW"];
  manual_charge_target_soc: BatteryRecord["manualChargeTargetSoc"];
  manual_discharge_target_soc: BatteryRecord["manualDischargeTargetSoc"];
  manual_target_soc: BatteryRecord["manualTargetSoc"];
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
        SELECT id, name, location, created_at, updated_at
        FROM sites
        ORDER BY name ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    location: row.location,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function ensureSiteColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(sites)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("location")) {
    db.exec("ALTER TABLE sites ADD COLUMN location TEXT NOT NULL DEFAULT '';");
  }
}

export function readBatteries(db: Database): BatteryRecord[] {
  const rows = db
    .query<BatteryRow, []>(
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
        ORDER BY name ASC
      `,
    )
    .all();

  return rows.map((row) => ({
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
  }));
}

function ensureBatteryColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(batteries)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("plugin")) {
    db.exec("ALTER TABLE batteries ADD COLUMN plugin TEXT NOT NULL DEFAULT 'indevolt-battery';");
  }

  if (!columns.includes("minimum_discharge_percent")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN minimum_discharge_percent REAL NOT NULL DEFAULT 10;",
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
