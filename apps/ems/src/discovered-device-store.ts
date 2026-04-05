import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  type DiscoverReportDevice,
  type DiscoveredDeviceRecord,
  type DiscoveryCategory,
  ensureParentDirectory,
  getDatabasePath,
} from "@emsd/core";

interface DiscoveredDeviceRow {
  id: string;
  category: DiscoveryCategory;
  model: string;
  name: string;
  ip_address: string;
  details: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface CreateDiscoveredDeviceInput {
  category: DiscoveryCategory;
  model: string;
  name: string;
  ipAddress: string;
  details: string;
}

export interface UpdateDiscoveredDeviceInput {
  category?: DiscoveryCategory;
  model?: string;
  name?: string;
  ipAddress?: string;
  details?: string;
}

export function listDiscoveredDevices(
  databasePath = getDatabasePath(),
): DiscoveredDeviceRecord[] {
  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (!hasDiscoveredDevicesTable(db)) {
      return [];
    }

    return readDiscoveredDevices(db);
  } finally {
    db.close();
  }
}

export function getDiscoveredDevice(
  id: string,
  databasePath = getDatabasePath(),
): DiscoveredDeviceRecord | null {
  if (!existsSync(databasePath)) {
    return null;
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (!hasDiscoveredDevicesTable(db)) {
      return null;
    }

    const row = db
      .query<DiscoveredDeviceRow, [string]>(
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
          WHERE id = ?1
        `,
      )
      .get(id);

    return row ? mapDiscoveredDeviceRow(row) : null;
  } finally {
    db.close();
  }
}

export function createDiscoveredDevice(
  input: CreateDiscoveredDeviceInput,
  databasePath = getDatabasePath(),
): DiscoveredDeviceRecord {
  const db = openWritableDatabase(databasePath);

  try {
    const now = new Date().toISOString();
    const id = randomUUID();

    db.query(
      `
        INSERT INTO discovered_devices (
          id,
          category,
          model,
          name,
          ip_address,
          details,
          first_seen_at,
          last_seen_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      `,
    ).run(
      id,
      input.category,
      input.model,
      input.name,
      input.ipAddress,
      input.details,
      now,
      now,
    );

    return getRequiredDiscoveredDevice(db, id);
  } finally {
    db.close();
  }
}

export function updateDiscoveredDevice(
  id: string,
  input: UpdateDiscoveredDeviceInput,
  databasePath = getDatabasePath(),
): DiscoveredDeviceRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    const existing = getDiscoveredDeviceById(db, id);

    if (!existing) {
      return null;
    }

    db.query(
      `
        UPDATE discovered_devices
        SET
          category = ?2,
          model = ?3,
          name = ?4,
          ip_address = ?5,
          details = ?6,
          last_seen_at = ?7
        WHERE id = ?1
      `,
    ).run(
      id,
      input.category ?? existing.category,
      input.model ?? existing.model,
      input.name ?? existing.name,
      input.ipAddress ?? existing.ipAddress,
      input.details ?? existing.details,
      new Date().toISOString(),
    );

    return getRequiredDiscoveredDevice(db, id);
  } finally {
    db.close();
  }
}

export function deleteDiscoveredDevice(
  id: string,
  databasePath = getDatabasePath(),
): DiscoveredDeviceRecord | null {
  const db = openWritableDatabase(databasePath);

  try {
    const existing = getDiscoveredDeviceById(db, id);

    if (!existing) {
      return null;
    }

    db.query("DELETE FROM discovered_devices WHERE id = ?1").run(id);
    return existing;
  } finally {
    db.close();
  }
}

export function saveDiscoveryResults(
  devices: Array<{
    category: DiscoveryCategory;
    model: string;
    name: string;
    ipAddress: string;
    details: string;
  }>,
  databasePath = getDatabasePath(),
): DiscoverReportDevice[] {
  const db = openWritableDatabase(databasePath);

  try {
    const upsert = db.query(
      `
        INSERT INTO discovered_devices (
          id,
          category,
          model,
          name,
          ip_address,
          details,
          first_seen_at,
          last_seen_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(category, model, ip_address)
        DO UPDATE SET
          name = excluded.name,
          details = excluded.details,
          last_seen_at = excluded.last_seen_at
      `,
    );
    const selectByKey = db.query<
      DiscoveredDeviceRow,
      [DiscoveryCategory, string, string]
    >(
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
        WHERE category = ?1 AND model = ?2 AND ip_address = ?3
      `,
    );
    const results: DiscoverReportDevice[] = [];

    for (const device of devices) {
      const existing = selectByKey.get(
        device.category,
        device.model,
        device.ipAddress,
      );
      const now = new Date().toISOString();

      upsert.run(
        existing?.id ?? randomUUID(),
        device.category,
        device.model,
        device.name,
        device.ipAddress,
        device.details,
        existing?.first_seen_at ?? now,
        now,
      );

      const stored = selectByKey.get(
        device.category,
        device.model,
        device.ipAddress,
      );

      if (!stored) {
        continue;
      }

      results.push({
        ...mapDiscoveredDeviceRow(stored),
        isNew: existing === null || existing === undefined,
      });
    }

    return results.sort(compareDiscoveredDeviceRecords);
  } finally {
    db.close();
  }
}

function openWritableDatabase(databasePath: string): Database {
  ensureParentDirectory(databasePath);

  const db = new Database(databasePath);
  ensureDiscoveredDevicesTable(db);
  return db;
}

function ensureDiscoveredDevicesTable(db: Database): void {
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
}

function hasDiscoveredDevicesTable(db: Database): boolean {
  const row = db
    .query<{ name: string }, []>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'discovered_devices'
      `,
    )
    .get();

  return row !== null && row !== undefined;
}

function readDiscoveredDevices(db: Database): DiscoveredDeviceRecord[] {
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

  return rows.map(mapDiscoveredDeviceRow);
}

function getDiscoveredDeviceById(
  db: Database,
  id: string,
): DiscoveredDeviceRecord | null {
  const row = db
    .query<DiscoveredDeviceRow, [string]>(
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
        WHERE id = ?1
      `,
    )
    .get(id);

  return row ? mapDiscoveredDeviceRow(row) : null;
}

function getRequiredDiscoveredDevice(
  db: Database,
  id: string,
): DiscoveredDeviceRecord {
  const device = getDiscoveredDeviceById(db, id);

  if (!device) {
    throw new Error(`Discovered device not found after write: ${id}`);
  }

  return device;
}

function mapDiscoveredDeviceRow(
  row: DiscoveredDeviceRow,
): DiscoveredDeviceRecord {
  return {
    id: row.id,
    category: row.category,
    model: row.model,
    name: row.name,
    ipAddress: row.ip_address,
    details: row.details,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function compareDiscoveredDeviceRecords(
  left: DiscoveredDeviceRecord,
  right: DiscoveredDeviceRecord,
): number {
  const nameDifference = left.name.localeCompare(right.name);

  if (nameDifference !== 0) {
    return nameDifference;
  }

  return left.ipAddress.localeCompare(right.ipAddress);
}
