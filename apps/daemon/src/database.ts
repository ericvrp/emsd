import { Database } from "bun:sqlite";
import {
  type BatteryPowerSampleRecord,
  type BatteryRecord,
  type BatteryStrategyHistoryRecord,
  type BatteryStrategyRecord,
  type BatteryStrategyRuntimeRecord,
  type DaemonLogLevel,
  type DaemonLogRecord,
  type DynamicPriceSampleRecord,
  type DynamicPriceSnapshotRecord,
  type DynamicPriceSourceRecord,
  type ManagedDeviceTelemetryRecord,
  type MeterRecord,
  type P1MeterSampleRecord,
  type PriceSourceConfig,
  type SiteRecord,
  type SolarEnergyProviderRecord,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
  type WeatherForecastRecord,
  type WeatherForecastSourceRecord,
  createBatteryStrategyRuntime,
  ensureParentDirectory,
  getDatabasePath,
  parseBatteryStrategyPlanJson,
  parseBatteryStrategyRuntimeJson,
  stringifyBatteryStrategyRuntime,
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
  maximum_charge_power_w: number;
  maximum_discharge_power_w: number;
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
  manual_mode_active: number;
  manual_mode_started: number;
  strategy_plan_json: string | null;
  strategy_runtime_json: string | null;
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

interface SolarEnergyProviderRow {
  id: string;
  site_id: string;
  name: string;
  plugin: string;
  ip_address: string;
  port: number | null;
  enabled: number;
  connected: number;
  serial_number: string | null;
  updated_at: string;
}

interface DeviceTelemetryRow {
  device_id: string;
  site_id: string;
  kind: ManagedDeviceTelemetryRecord["kind"];
  capacity_wh: number | null;
  power_w: number | null;
  production_control_status: ManagedDeviceTelemetryRecord["productionControlStatus"];
  soc_percent: number | null;
  gas_m3: number | null;
  state: ManagedDeviceTelemetryRecord["state"];
  observed_at: string;
}

interface WeatherSourceRow {
  id: string;
  site_id: string;
  name: string;
  provider: WeatherForecastSourceRecord["provider"];
  surface: WeatherForecastSourceRecord["surface"];
  updated_at: string;
}

interface DynamicPriceSourceRow {
  home_id: string | null;
  id: string;
  provider: DynamicPriceSourceRecord["provider"];
  export_deduction: number | null;
  config_json: string | null;
  site_id: string;
  name: string;
  updated_at: string;
}

interface WeatherForecastRow {
  site_id: string;
  generated_at: string;
  forecast_json: string;
}

interface DynamicPriceSnapshotRow {
  generated_at: string;
  price_json: string;
  site_id: string;
}

interface DynamicPriceSampleRow {
  site_id: string;
  period_start: string;
  generated_at: string;
  currency: string;
  import_price: number;
}

interface SolarForecastSampleRow {
  site_id: string;
  period_start: string;
  generated_at: string;
  value: number | null;
  ghi_wm2: number | null;
  air_temp_c: number | null;
  cloud_opacity_percent: number | null;
}

interface P1MeterSampleRow {
  site_id: string;
  meter_id: string;
  period_start: string;
  observed_at: string;
  power_w: number | null;
}

interface BatteryPowerSampleRow {
  site_id: string;
  battery_id: string;
  period_start: string;
  observed_at: string;
  power_w: number | null;
  soc_percent: number | null;
}

interface BatteryStrategyHistoryRow {
  id: number;
  active_item_id: string | null;
  battery_id: string;
  display_label: string;
  display_state: BatteryStrategyHistoryRecord["displayState"];
  ended_at: string | null;
  item_label: string | null;
  manual_state: BatteryStrategyHistoryRecord["manualState"];
  observed_at: string;
  site_id: string;
  source: BatteryStrategyHistoryRecord["source"];
  started_at: string;
  strategy_mode: BatteryStrategyHistoryRecord["strategyMode"];
}

interface SolarEnergyProviderSampleRow {
  site_id: string;
  provider_id: string;
  period_start: string;
  observed_at: string;
  power_w: number | null;
  sample_count: number;
}

interface SolarEnergyProviderControlRequestRow {
  id: number;
  site_id: string;
  provider_id: string;
  requested_enabled: number;
  status: "pending" | "running" | "completed" | "failed";
  message: string | null;
  requested_at: string;
  updated_at: string;
}

export type { DaemonLogLevel, DaemonLogRecord };

interface DaemonLogRow {
  category: string;
  id: number;
  level: DaemonLogLevel;
  message: string;
  logged_at: string;
}

export interface SolarEnergyProviderControlRequestRecord {
  id: number;
  siteId: string;
  providerId: string;
  requestedEnabled: boolean;
  status: "pending" | "running" | "completed" | "failed";
  message: string | null;
  requestedAt: string;
  updatedAt: string;
}

const SAMPLE_PERIOD_MINUTES = 15;
const SAMPLE_RETENTION_DAYS = 30;
const SAMPLE_RETENTION_MS = SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

export function openDaemonDatabase(databasePath = getDatabasePath()): Database {
  ensureParentDirectory(databasePath);

  const db = new Database(databasePath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
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
      maximum_charge_power_w REAL NOT NULL DEFAULT 800,
      maximum_discharge_power_w REAL NOT NULL DEFAULT 800,
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
      port INTEGER,
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
  renameTableIfNeeded(db, "dynamic_price_sources", "price_sources");
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_sources (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'tibber',
      home_id TEXT,
      export_deduction REAL NOT NULL DEFAULT 0.13,
      config_json TEXT,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureDynamicPriceSourceColumns(db);
  renameTableIfNeeded(db, "dynamic_price_snapshots", "price_snapshots");
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_telemetry (
      device_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      capacity_wh REAL,
      power_w REAL,
      production_control_status TEXT,
      soc_percent REAL,
      gas_m3 REAL,
      state TEXT,
      observed_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureManagedDeviceTelemetryColumns(db);
  renameTableIfNeeded(db, "dynamic_price_samples", "price_samples");
  db.exec(`
    CREATE TABLE IF NOT EXISTS weather_forecasts (
      site_id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      forecast_json TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_snapshots (
      site_id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      price_json TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_samples (
      site_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      currency TEXT NOT NULL,
      import_price REAL NOT NULL,
      PRIMARY KEY(site_id, period_start),
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_price_samples_site_period
    ON price_samples (site_id, period_start);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS solar_forecast_samples (
      site_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      value REAL,
      ghi_wm2 REAL,
      air_temp_c REAL,
      cloud_opacity_percent REAL,
      PRIMARY KEY(site_id, period_start),
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_solar_forecast_samples_site_period
    ON solar_forecast_samples (site_id, period_start);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS p1_meter_samples (
      site_id TEXT NOT NULL,
      meter_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      power_w REAL,
      PRIMARY KEY(site_id, meter_id, period_start),
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_p1_meter_samples_site_period
    ON p1_meter_samples (site_id, period_start);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS battery_power_samples (
      site_id TEXT NOT NULL,
      battery_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      power_w REAL,
      soc_percent REAL,
      PRIMARY KEY(site_id, battery_id, period_start),
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureBatteryPowerSampleColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_battery_power_samples_site_period
    ON battery_power_samples (site_id, period_start);
  `);
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
      item_label TEXT,
      display_label TEXT NOT NULL,
      display_state TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureBatteryStrategyHistoryColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_battery_strategy_history_site_started
    ON battery_strategy_history (site_id, started_at);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_battery_strategy_history_battery_open
    ON battery_strategy_history (site_id, battery_id, ended_at, started_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS solar_energy_provider_samples (
      site_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      power_w REAL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(site_id, provider_id, period_start),
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  ensureSolarEnergyProviderSampleColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_solar_energy_provider_samples_site_period
    ON solar_energy_provider_samples (site_id, period_start);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS solar_energy_provider_control_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      requested_enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_solar_energy_provider_control_requests_status_requested
    ON solar_energy_provider_control_requests (status, requested_at, id);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS daemon_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'generic',
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      logged_at TEXT NOT NULL
    );
  `);
  ensureDaemonLogColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_daemon_logs_logged_at
    ON daemon_logs (logged_at, id);
  `);

  return db;
}

export function insertDaemonLog(
  db: Database,
  record: Omit<DaemonLogRecord, "id">,
): void {
  db.query(
    `
      INSERT INTO daemon_logs (category, level, message, logged_at)
      VALUES (?1, ?2, ?3, ?4)
    `,
  ).run(record.category, record.level, record.message, record.loggedAt);
}

export function readDaemonLogs(db: Database): DaemonLogRecord[] {
  const rows = db
    .query<DaemonLogRow, []>(
      `
        SELECT id, category, level, message, logged_at
        FROM daemon_logs
        ORDER BY logged_at ASC, id ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    category: row.category,
    id: row.id,
    level: row.level,
    message: row.message,
    loggedAt: row.logged_at,
  }));
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

export function readWeatherForecastSources(
  db: Database,
): WeatherForecastSourceRecord[] {
  const rows = db
    .query<WeatherSourceRow, []>(
      `
        SELECT id, site_id, name, provider, surface, updated_at
        FROM weather_sources
        ORDER BY name ASC, id ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    provider: row.provider,
    surface: row.surface,
    updatedAt: row.updated_at,
  }));
}

export function readDynamicPriceSources(
  db: Database,
): DynamicPriceSourceRecord[] {
  const rows = db
    .query<DynamicPriceSourceRow, []>(
      `
        SELECT id, site_id, name, provider, home_id, export_deduction, config_json, updated_at
        FROM price_sources
        ORDER BY name ASC, id ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    provider: row.provider,
    exportDeduction:
      typeof row.export_deduction === "number" ? row.export_deduction : 0.13,
    config: parsePriceSourceConfig(row.config_json),
    updatedAt: row.updated_at,
  }));
}

export function readSolarEnergyProviders(
  db: Database,
): SolarEnergyProviderRecord[] {
  const rows = db
    .query<SolarEnergyProviderRow, []>(
      `
        SELECT id, site_id, name, plugin, ip_address, port, enabled, connected, serial_number, updated_at
        FROM solar_energy_providers
        ORDER BY name ASC, id ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    plugin: row.plugin,
    ipAddress: row.ip_address,
    port: row.port,
    enabled: row.enabled === 1,
    connected: row.connected === 1,
    serialNumber: row.serial_number,
    updatedAt: row.updated_at,
  }));
}

export function readWeatherForecast(
  db: Database,
  siteId: string,
): WeatherForecastRecord | null {
  const row = db
    .query<WeatherForecastRow, [string]>(
      `
        SELECT site_id, generated_at, forecast_json
        FROM weather_forecasts
        WHERE site_id = ?1
      `,
    )
    .get(siteId);

  if (!row) {
    return null;
  }

  const parsed = JSON.parse(row.forecast_json) as WeatherForecastRecord;
  return { ...parsed, generatedAt: row.generated_at };
}

export function upsertWeatherForecast(
  db: Database,
  siteId: string,
  forecast: WeatherForecastRecord,
): void {
  db.query(
    `
      INSERT INTO weather_forecasts (site_id, generated_at, forecast_json)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(site_id) DO UPDATE SET
        generated_at = excluded.generated_at,
      forecast_json = excluded.forecast_json
    `,
  ).run(siteId, forecast.generatedAt, JSON.stringify(forecast));

  const insertSample = db.query(
    `
      INSERT INTO solar_forecast_samples (
        site_id,
        period_start,
        generated_at,
        value,
        ghi_wm2,
        air_temp_c,
        cloud_opacity_percent
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(site_id, period_start) DO UPDATE SET
        generated_at = excluded.generated_at,
        value = excluded.value,
        ghi_wm2 = excluded.ghi_wm2,
        air_temp_c = excluded.air_temp_c,
        cloud_opacity_percent = excluded.cloud_opacity_percent
    `,
  );

  db.transaction(() => {
    for (const point of forecast.points) {
      insertSample.run(
        siteId,
        getPeriodStartFromPeriodEnd(point.periodEnd, forecast.periodMinutes),
        forecast.generatedAt,
        point.value,
        point.ghiWm2,
        point.airTempC,
        point.cloudOpacityPercent,
      );
    }

    deleteExpiredSamples(db, "solar_forecast_samples");
  })();
}

export function readDynamicPriceSnapshot(
  db: Database,
  siteId: string,
): DynamicPriceSnapshotRecord | null {
  const row = db
    .query<DynamicPriceSnapshotRow, [string]>(
      `
        SELECT site_id, generated_at, price_json
        FROM price_snapshots
        WHERE site_id = ?1
      `,
    )
    .get(siteId);

  if (!row) {
    return null;
  }

  const parsed = JSON.parse(row.price_json) as DynamicPriceSnapshotRecord;
  return { ...parsed, generatedAt: row.generated_at };
}

export function readDynamicPriceSamples(
  db: Database,
  siteId: string,
): DynamicPriceSampleRecord[] {
  const rows = db
    .query<DynamicPriceSampleRow, [string]>(
      `
        SELECT site_id, period_start, generated_at, currency, import_price
        FROM price_samples
        WHERE site_id = ?1
        ORDER BY period_start ASC
      `,
    )
    .all(siteId);

  return rows.map((row) => ({
    siteId: row.site_id,
    periodStart: row.period_start,
    generatedAt: row.generated_at,
    currency: row.currency,
    importPrice: row.import_price,
  }));
}

export function upsertDynamicPriceSnapshot(
  db: Database,
  siteId: string,
  snapshot: DynamicPriceSnapshotRecord,
): void {
  db.query(
    `
      INSERT INTO price_snapshots (site_id, generated_at, price_json)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(site_id) DO UPDATE SET
        generated_at = excluded.generated_at,
      price_json = excluded.price_json
    `,
  ).run(siteId, snapshot.generatedAt, JSON.stringify(snapshot));

  const insertSample = db.query(
    `
      INSERT INTO price_samples (
        site_id,
        period_start,
        generated_at,
        currency,
        import_price
      ) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(site_id, period_start) DO UPDATE SET
        generated_at = excluded.generated_at,
        currency = excluded.currency,
        import_price = excluded.import_price
    `,
  );

  db.transaction(() => {
    for (const point of snapshot.points) {
      insertSample.run(
        siteId,
        normalizePeriodStart(point.startsAt),
        snapshot.generatedAt,
        point.currency,
        point.importPrice,
      );
    }

    deleteExpiredSamples(db, "price_samples");
  })();
}

export function deleteWeatherForecast(db: Database, siteId: string): void {
  db.query(
    `
      DELETE FROM weather_forecasts
      WHERE site_id = ?1
    `,
  ).run(siteId);
}

export function readSolarForecastSamples(
  db: Database,
  siteId: string,
): SolarForecastSampleRecord[] {
  const rows = db
    .query<SolarForecastSampleRow, [string]>(
      `
        SELECT
          site_id,
          period_start,
          generated_at,
          value,
          ghi_wm2,
          air_temp_c,
          cloud_opacity_percent
        FROM solar_forecast_samples
        WHERE site_id = ?1
        ORDER BY period_start ASC
      `,
    )
    .all(siteId);

  return rows.map((row) => ({
    siteId: row.site_id,
    periodStart: row.period_start,
    generatedAt: row.generated_at,
    value: row.value,
    ghiWm2: row.ghi_wm2,
    airTempC: row.air_temp_c,
    cloudOpacityPercent: row.cloud_opacity_percent,
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

function ensureDaemonLogColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(daemon_logs)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("category")) {
    db.exec(
      "ALTER TABLE daemon_logs ADD COLUMN category TEXT NOT NULL DEFAULT 'generic';",
    );
  }
}

function ensureWeatherSourceColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(weather_sources)")
    .all()
    .map((column) => column.name);

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
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(solar_energy_providers)")
    .all()
    .map((column) => column.name);

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

  if (!columns.includes("port")) {
    db.exec("ALTER TABLE solar_energy_providers ADD COLUMN port INTEGER;");
  }
}

function ensureDynamicPriceSourceColumns(db: Database): void {
  renameTableIfNeeded(db, "dynamic_price_sources", "price_sources");
  renameTableIfNeeded(db, "dynamic_price_snapshots", "price_snapshots");
  renameTableIfNeeded(db, "dynamic_price_samples", "price_samples");

  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(price_sources)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("provider")) {
    db.exec(
      "ALTER TABLE price_sources ADD COLUMN provider TEXT NOT NULL DEFAULT 'tibber';",
    );
  }

  if (!columns.includes("home_id")) {
    db.exec("ALTER TABLE price_sources ADD COLUMN home_id TEXT;");
  }

  if (!columns.includes("export_deduction")) {
    db.exec(
      "ALTER TABLE price_sources ADD COLUMN export_deduction REAL NOT NULL DEFAULT 0.13;",
    );
  }

  if (!columns.includes("config_json")) {
    db.exec("ALTER TABLE price_sources ADD COLUMN config_json TEXT;");
  }

  db.exec(`
    UPDATE price_sources
    SET provider = CASE provider
      WHEN 'tibber' THEN 'tibber'
      WHEN 'fixed-import-price' THEN 'fixed-import-price'
      ELSE 'tibber'
    END
  `);
}

function renameTableIfNeeded(
  db: Database,
  oldName: string,
  newName: string,
): void {
  const oldExists = hasTable(db, oldName);

  if (!oldExists) {
    return;
  }

  if (hasTable(db, newName)) {
    throw new Error(
      `Database contains both ${oldName} and ${newName}; refusing to merge price tables automatically.`,
    );
  }

  db.exec(`ALTER TABLE ${oldName} RENAME TO ${newName};`);
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
    )
    .get(tableName);

  return Boolean(row);
}

function parsePriceSourceConfig(value: string | null): PriceSourceConfig {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as PriceSourceConfig;
}

function ensureSolarEnergyProviderSampleColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>(
      "PRAGMA table_info(solar_energy_provider_samples)",
    )
    .all()
    .map((column) => column.name);

  if (!columns.includes("sample_count")) {
    db.exec(
      "ALTER TABLE solar_energy_provider_samples ADD COLUMN sample_count INTEGER NOT NULL DEFAULT 0;",
    );
    db.exec(`
      UPDATE solar_energy_provider_samples
      SET sample_count = CASE
        WHEN power_w IS NULL THEN 0
        ELSE 1
      END
    `);
  }
}

function ensureBatteryPowerSampleColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(battery_power_samples)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("soc_percent")) {
    db.exec("ALTER TABLE battery_power_samples ADD COLUMN soc_percent REAL;");
  }
}

function ensureManagedDeviceTelemetryColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(device_telemetry)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("capacity_wh")) {
    db.exec("ALTER TABLE device_telemetry ADD COLUMN capacity_wh REAL;");
  }

  if (!columns.includes("production_control_status")) {
    db.exec(
      "ALTER TABLE device_telemetry ADD COLUMN production_control_status TEXT;",
    );
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
          maximum_charge_power_w,
          maximum_discharge_power_w,
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
    maximumChargePowerW: row.maximum_charge_power_w,
    maximumDischargePowerW: row.maximum_discharge_power_w,
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
  }));
}

function ensureBatteryStrategyHistoryColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(battery_strategy_history)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("item_label")) {
    db.exec("ALTER TABLE battery_strategy_history ADD COLUMN item_label TEXT;");
  }
}

function ensureBatteryColumns(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(batteries)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("plugin")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN plugin TEXT NOT NULL DEFAULT 'indevolt-battery';",
    );
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

  if (!columns.includes("maximum_charge_power_w")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN maximum_charge_power_w REAL NOT NULL DEFAULT 800;",
    );
  }

  if (!columns.includes("maximum_discharge_power_w")) {
    db.exec(
      "ALTER TABLE batteries ADD COLUMN maximum_discharge_power_w REAL NOT NULL DEFAULT 800;",
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
    db.query(
      "UPDATE batteries SET strategy_runtime_json = ?1 WHERE strategy_runtime_json IS NULL",
    ).run(stringifyBatteryStrategyRuntime(createBatteryStrategyRuntime()));
  }
}

export function updateBatteryStrategyState(
  db: Database,
  input: {
    batteryId: string;
    siteId: string;
    manualModeActive: boolean;
    manualModeStarted?: boolean;
    strategy: BatteryStrategyRecord;
  },
): void {
  db.query(
    `
      UPDATE batteries
      SET
        strategy_mode = ?3,
        manual_state = ?4,
        manual_power_w = ?5,
        manual_charge_target_soc = ?6,
        manual_discharge_target_soc = ?7,
        manual_target_soc = ?8,
        manual_mode_active = ?9,
        manual_mode_started = ?10,
        updated_at = ?11
      WHERE id = ?1 AND site_id = ?2
    `,
  ).run(
    input.batteryId,
    input.siteId,
    input.strategy.strategyMode,
    input.strategy.manualState,
    input.strategy.manualPowerW,
    input.strategy.manualChargeTargetSoc,
    input.strategy.manualDischargeTargetSoc,
    input.strategy.manualTargetSoc,
    input.manualModeActive ? 1 : 0,
    input.manualModeStarted === true ? 1 : 0,
    new Date().toISOString(),
  );
}

export function updateBatteryManualModeStarted(
  db: Database,
  input: { batteryId: string; siteId: string; manualModeStarted: boolean },
): void {
  db.query(
    `
      UPDATE batteries
      SET manual_mode_started = ?3, updated_at = ?4
      WHERE id = ?1 AND site_id = ?2
    `,
  ).run(
    input.batteryId,
    input.siteId,
    input.manualModeStarted ? 1 : 0,
    new Date().toISOString(),
  );
}

export function updateBatteryStrategyRuntime(
  db: Database,
  input: {
    batteryId: string;
    siteId: string;
    strategyRuntime: BatteryStrategyRuntimeRecord;
  },
): void {
  db.query(
    `
      UPDATE batteries
      SET strategy_runtime_json = ?3, updated_at = ?4
      WHERE id = ?1 AND site_id = ?2
    `,
  ).run(
    input.batteryId,
    input.siteId,
    stringifyBatteryStrategyRuntime(input.strategyRuntime),
    new Date().toISOString(),
  );
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
          capacity_wh,
          power_w,
          production_control_status,
          soc_percent,
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
    capacityWh: row.capacity_wh,
    powerW: row.power_w,
    productionControlStatus: row.production_control_status,
    socPercent: row.soc_percent,
    state: row.state,
    observedAt: row.observed_at,
  }));
}

export function readP1MeterSamples(
  db: Database,
  siteId: string,
): P1MeterSampleRecord[] {
  const rows = db
    .query<P1MeterSampleRow, [string]>(
      `
        SELECT site_id, meter_id, period_start, observed_at, power_w
        FROM p1_meter_samples
        WHERE site_id = ?1
        ORDER BY period_start ASC, meter_id ASC
      `,
    )
    .all(siteId);

  return rows.map((row) => ({
    siteId: row.site_id,
    meterId: row.meter_id,
    periodStart: row.period_start,
    observedAt: row.observed_at,
    powerW: row.power_w,
  }));
}

export function readBatteryPowerSamples(
  db: Database,
  siteId: string,
): BatteryPowerSampleRecord[] {
  const rows = db
    .query<BatteryPowerSampleRow, [string]>(
      `
        SELECT site_id, battery_id, period_start, observed_at, power_w, soc_percent
        FROM battery_power_samples
        WHERE site_id = ?1
        ORDER BY period_start ASC, battery_id ASC
      `,
    )
    .all(siteId);

  return rows.map((row) => ({
    siteId: row.site_id,
    batteryId: row.battery_id,
    periodStart: row.period_start,
    observedAt: row.observed_at,
    powerW: row.power_w,
    socPercent: row.soc_percent,
  }));
}

export function readBatteryStrategyHistory(
  db: Database,
  siteId: string,
): BatteryStrategyHistoryRecord[] {
  const rows = db
    .query<BatteryStrategyHistoryRow, [string]>(
      `
        SELECT
          id,
          site_id,
          battery_id,
          started_at,
          ended_at,
          observed_at,
          source,
          strategy_mode,
          manual_state,
          active_item_id,
          item_label,
          display_label,
          display_state
        FROM battery_strategy_history
        WHERE site_id = ?1
        ORDER BY started_at ASC, id ASC
      `,
    )
    .all(siteId);

  return rows.map((row) => ({
    activeItemId: row.active_item_id,
    batteryId: row.battery_id,
    displayLabel: row.display_label,
    displayState: normalizeBatteryStrategyHistoryDisplayState(
      row.display_state,
    ),
    endedAt: row.ended_at,
    ...(row.item_label ? { itemLabel: row.item_label } : {}),
    manualState: row.manual_state,
    observedAt: row.observed_at,
    siteId: row.site_id,
    source: row.source,
    startedAt: row.started_at,
    strategyMode: row.strategy_mode,
  }));
}

export function readBatteryById(
  db: Database,
  siteId: string,
  batteryId: string,
): BatteryRecord | null {
  return (
    readBatteries(db).find(
      (battery) => battery.siteId === siteId && battery.id === batteryId,
    ) ?? null
  );
}

export function upsertBatteryStrategyHistoryState(
  db: Database,
  record: BatteryStrategyHistoryRecord,
): void {
  const latest = db
    .query<BatteryStrategyHistoryRow, [string, string]>(
      `
        SELECT
          id,
          site_id,
          battery_id,
          started_at,
          ended_at,
          observed_at,
          source,
          strategy_mode,
          manual_state,
          active_item_id,
          item_label,
          display_label,
          display_state
        FROM battery_strategy_history
        WHERE site_id = ?1 AND battery_id = ?2
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(record.siteId, record.batteryId);

  if (
    latest &&
    latest.ended_at === null &&
    latest.source === record.source &&
    latest.strategy_mode === record.strategyMode &&
    latest.manual_state === record.manualState &&
    latest.active_item_id === record.activeItemId &&
    latest.item_label === (record.itemLabel ?? null) &&
    latest.display_label === record.displayLabel &&
    normalizeBatteryStrategyHistoryDisplayState(latest.display_state) ===
      record.displayState
  ) {
    db.query(
      `
        UPDATE battery_strategy_history
        SET observed_at = ?2
        WHERE id = ?1
      `,
    ).run(latest.id, record.observedAt);
    return;
  }

  if (latest && latest.ended_at === null) {
    db.query(
      `
        UPDATE battery_strategy_history
        SET ended_at = ?2, observed_at = ?3
        WHERE id = ?1
      `,
    ).run(latest.id, record.startedAt, record.observedAt);
  }

  db.query(
    `
      INSERT INTO battery_strategy_history (
        site_id,
        battery_id,
        started_at,
        ended_at,
        observed_at,
        source,
        strategy_mode,
        manual_state,
        active_item_id,
        item_label,
        display_label,
        display_state
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `,
  ).run(
    record.siteId,
    record.batteryId,
    record.startedAt,
    record.endedAt,
    record.observedAt,
    record.source,
    record.strategyMode,
    record.manualState,
    record.activeItemId,
    record.itemLabel ?? null,
    record.displayLabel,
    record.displayState,
  );

  deleteExpiredHistory(db, "battery_strategy_history", "started_at");
}

function normalizeBatteryStrategyHistoryDisplayState(
  value: string,
): BatteryStrategyHistoryRecord["displayState"] {
  switch (value) {
    case "charging":
      return "charge";
    case "discharging":
      return "discharge";
    case "self-consumption":
    case "charge":
    case "discharge":
    case "idle":
      return value;
    default:
      return "idle";
  }
}

export function readSolarEnergyProviderSamples(
  db: Database,
  siteId: string,
): SolarEnergyProviderSampleRecord[] {
  const rows = db
    .query<SolarEnergyProviderSampleRow, [string]>(
      `
        SELECT site_id, provider_id, period_start, observed_at, power_w, sample_count
        FROM solar_energy_provider_samples
        WHERE site_id = ?1
        ORDER BY period_start ASC, provider_id ASC
      `,
    )
    .all(siteId);

  return rows.map((row) => ({
    siteId: row.site_id,
    providerId: row.provider_id,
    periodStart: row.period_start,
    observedAt: row.observed_at,
    powerW: row.power_w,
  }));
}

export function readPendingSolarEnergyProviderControlRequests(
  db: Database,
): SolarEnergyProviderControlRequestRecord[] {
  const rows = db
    .query<SolarEnergyProviderControlRequestRow, []>(
      `
        SELECT
          id,
          site_id,
          provider_id,
          requested_enabled,
          status,
          message,
          requested_at,
          updated_at
        FROM solar_energy_provider_control_requests
        WHERE status = 'pending'
        ORDER BY requested_at ASC, id ASC
      `,
    )
    .all();

  return rows.map(mapSolarEnergyProviderControlRequestRow);
}

export function readLatestSolarEnergyProviderControlRequests(
  db: Database,
): SolarEnergyProviderControlRequestRecord[] {
  const rows = db
    .query<SolarEnergyProviderControlRequestRow, []>(
      `
        SELECT
          id,
          site_id,
          provider_id,
          requested_enabled,
          status,
          message,
          requested_at,
          updated_at
        FROM solar_energy_provider_control_requests
        ORDER BY requested_at DESC, id DESC
      `,
    )
    .all();

  const latestRequests = new Map<
    string,
    SolarEnergyProviderControlRequestRecord
  >();

  for (const row of rows) {
    const request = mapSolarEnergyProviderControlRequestRow(row);
    const key = `${request.siteId}:${request.providerId}`;

    if (!latestRequests.has(key)) {
      latestRequests.set(key, request);
    }
  }

  return [...latestRequests.values()];
}

export function queueSolarEnergyProviderControlRequest(
  db: Database,
  input: {
    providerId: string;
    requestedAt: string;
    requestedEnabled: boolean;
    siteId: string;
  },
): SolarEnergyProviderControlRequestRecord {
  const result = db
    .query(
      `
        INSERT INTO solar_energy_provider_control_requests (
          site_id,
          provider_id,
          requested_enabled,
          status,
          message,
          requested_at,
          updated_at
        ) VALUES (?1, ?2, ?3, 'pending', NULL, ?4, ?4)
        RETURNING
          id,
          site_id,
          provider_id,
          requested_enabled,
          status,
          message,
          requested_at,
          updated_at
      `,
    )
    .get(
      input.siteId,
      input.providerId,
      input.requestedEnabled ? 1 : 0,
      input.requestedAt,
    ) as SolarEnergyProviderControlRequestRow;

  return mapSolarEnergyProviderControlRequestRow(result);
}

export function markSolarEnergyProviderControlRequestRunning(
  db: Database,
  requestId: number,
  updatedAt: string,
): void {
  db.query(
    `
      UPDATE solar_energy_provider_control_requests
      SET status = 'running', message = NULL, updated_at = ?2
      WHERE id = ?1
    `,
  ).run(requestId, updatedAt);
}

export function completeSolarEnergyProviderControlRequest(
  db: Database,
  input: {
    message?: string | null;
    requestId: number;
    status: "completed" | "failed";
    updatedAt: string;
  },
): void {
  db.query(
    `
      UPDATE solar_energy_provider_control_requests
      SET status = ?2, message = ?3, updated_at = ?4
      WHERE id = ?1
    `,
  ).run(input.requestId, input.status, input.message ?? null, input.updatedAt);
}

export function upsertManagedDeviceTelemetry(
  db: Database,
  telemetry: ManagedDeviceTelemetryRecord,
): void {
  const normalizedState = telemetry.kind === "battery" ? null : telemetry.state;

  db.query(
    `
      INSERT INTO device_telemetry (
        device_id,
        site_id,
        kind,
        capacity_wh,
        power_w,
        production_control_status,
        soc_percent,
        state,
        observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        site_id = excluded.site_id,
        kind = excluded.kind,
        capacity_wh = CASE
          WHEN excluded.kind = 'battery'
            THEN COALESCE(excluded.capacity_wh, device_telemetry.capacity_wh)
          ELSE excluded.capacity_wh
        END,
        power_w = excluded.power_w,
        production_control_status = excluded.production_control_status,
        soc_percent = excluded.soc_percent,
        state = excluded.state,
        observed_at = excluded.observed_at
    `,
  ).run(
    telemetry.deviceId,
    telemetry.siteId,
    telemetry.kind,
    telemetry.capacityWh,
    telemetry.powerW,
    telemetry.productionControlStatus,
    telemetry.socPercent,
    normalizedState,
    telemetry.observedAt,
  );

  const periodStart = getBucketPeriodStart(telemetry.observedAt);

  if (telemetry.kind === "meter") {
    db.query(
      `
        INSERT INTO p1_meter_samples (
          site_id,
          meter_id,
          period_start,
          observed_at,
          power_w
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(site_id, meter_id, period_start) DO UPDATE SET
          observed_at = excluded.observed_at,
          power_w = excluded.power_w
      `,
    ).run(
      telemetry.siteId,
      telemetry.deviceId,
      periodStart,
      telemetry.observedAt,
      telemetry.powerW,
    );
    deleteExpiredSamples(db, "p1_meter_samples");
  }

  if (telemetry.kind === "battery") {
    db.query(
      `
        INSERT INTO battery_power_samples (
          site_id,
          battery_id,
          period_start,
          observed_at,
          power_w,
          soc_percent
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(site_id, battery_id, period_start) DO UPDATE SET
          observed_at = excluded.observed_at,
          power_w = excluded.power_w,
          soc_percent = excluded.soc_percent
      `,
    ).run(
      telemetry.siteId,
      telemetry.deviceId,
      periodStart,
      telemetry.observedAt,
      telemetry.powerW,
      telemetry.socPercent,
    );
    deleteExpiredSamples(db, "battery_power_samples");
  }

  if (telemetry.kind === "solar-energy-provider") {
    db.query(
      `
        INSERT INTO solar_energy_provider_samples (
          site_id,
          provider_id,
          period_start,
          observed_at,
          power_w,
          sample_count
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(site_id, provider_id, period_start) DO UPDATE SET
          observed_at = excluded.observed_at,
          power_w = CASE
            WHEN excluded.sample_count = 0 THEN solar_energy_provider_samples.power_w
            WHEN solar_energy_provider_samples.sample_count = 0 THEN excluded.power_w
            ELSE ((solar_energy_provider_samples.power_w * solar_energy_provider_samples.sample_count) + excluded.power_w) / (solar_energy_provider_samples.sample_count + excluded.sample_count)
          END,
          sample_count = solar_energy_provider_samples.sample_count + excluded.sample_count
      `,
    ).run(
      telemetry.siteId,
      telemetry.deviceId,
      periodStart,
      telemetry.observedAt,
      telemetry.powerW,
      telemetry.powerW === null ? 0 : 1,
    );
    deleteExpiredSamples(db, "solar_energy_provider_samples");
  }
}

function getPeriodStartFromPeriodEnd(
  periodEnd: string,
  periodMinutes: number,
): string {
  const periodEndMs = new Date(periodEnd).getTime();

  if (Number.isNaN(periodEndMs)) {
    throw new Error(`Invalid forecast period end: ${periodEnd}`);
  }

  return new Date(periodEndMs - periodMinutes * 60 * 1_000).toISOString();
}

function mapSolarEnergyProviderControlRequestRow(
  row: SolarEnergyProviderControlRequestRow,
): SolarEnergyProviderControlRequestRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    providerId: row.provider_id,
    requestedEnabled: row.requested_enabled === 1,
    status: row.status,
    message: row.message,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}

function getBucketPeriodStart(timestamp: string): string {
  const timestampMs = new Date(timestamp).getTime();

  if (Number.isNaN(timestampMs)) {
    throw new Error(`Invalid sample timestamp: ${timestamp}`);
  }

  const bucketMs = SAMPLE_PERIOD_MINUTES * 60 * 1_000;
  return new Date(Math.floor(timestampMs / bucketMs) * bucketMs).toISOString();
}

function normalizePeriodStart(timestamp: string): string {
  const timestampMs = new Date(timestamp).getTime();

  if (Number.isNaN(timestampMs)) {
    throw new Error(`Invalid period start timestamp: ${timestamp}`);
  }

  return new Date(timestampMs).toISOString();
}

function getSampleRetentionCutoff(now = new Date()): string {
  return new Date(now.getTime() - SAMPLE_RETENTION_MS).toISOString();
}

function deleteExpiredSamples(db: Database, tableName: string): void {
  db.query(`DELETE FROM ${tableName} WHERE period_start < ?1`).run(
    getSampleRetentionCutoff(),
  );
}

function deleteExpiredHistory(
  db: Database,
  tableName: string,
  timeColumn: string,
): void {
  db.query(`DELETE FROM ${tableName} WHERE ${timeColumn} < ?1`).run(
    getSampleRetentionCutoff(),
  );
}
