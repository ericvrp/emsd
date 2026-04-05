import { Database } from "bun:sqlite";
import {
  type BatteryRecord,
  type DiscoveredDeviceRecord,
  ensureParentDirectory,
  getDatabasePath,
} from "@emsd/core";

interface BatteryRow {
  id: string;
  name: string;
  adapter: string;
  status: BatteryRecord["status"];
  connected: number;
  updated_at: string;
}

interface DiscoveredDeviceRow {
  id: string;
  category: DiscoveredDeviceRecord["category"];
  model: string;
  name: string;
  ip_address: string;
  details: string;
  first_seen_at: string;
  last_seen_at: string;
}

export function openDaemonDatabase(databasePath = getDatabasePath()): Database {
  ensureParentDirectory(databasePath);

  const db = new Database(databasePath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS batteries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      status TEXT NOT NULL,
      connected INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_devices (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      model TEXT NOT NULL,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      details TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(category, model, ip_address)
    );
  `);

  return db;
}

export function readBatteries(db: Database): BatteryRecord[] {
  const rows = db
    .query<BatteryRow, []>(
      `
        SELECT id, name, adapter, status, connected, updated_at
        FROM batteries
        ORDER BY name ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    adapter: row.adapter,
    status: row.status,
    connected: row.connected === 1,
    updatedAt: row.updated_at,
  }));
}

export function readDiscoveredDevices(db: Database): DiscoveredDeviceRecord[] {
  const rows = db
    .query<DiscoveredDeviceRow, []>(
      `
        SELECT
          id,
          category,
          model,
          name,
          ip_address,
          details,
          first_seen_at,
          last_seen_at
        FROM discovered_devices
        ORDER BY name ASC, ip_address ASC
      `,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    model: row.model,
    name: row.name,
    ipAddress: row.ip_address,
    details: row.details,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }));
}
