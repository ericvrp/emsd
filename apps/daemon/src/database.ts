import { Database } from "bun:sqlite";
import {
  type BatteryRecord,
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
