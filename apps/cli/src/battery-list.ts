import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { type BatteryRecord, getDatabasePath } from "@emsd/core";

interface BatteryRow {
  id: string;
  name: string;
  adapter: string;
  status: BatteryRecord["status"];
  connected: number;
  updated_at: string;
}

export function getBatteryList(
  databasePath = getDatabasePath(),
): BatteryRecord[] {
  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
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
  } finally {
    db.close();
  }
}

export function formatBatteryList(batteries: BatteryRecord[]): string {
  if (batteries.length === 0) {
    return "No batteries found in the daemon database.";
  }

  const header = ["NAME", "STATUS", "CONNECTED", "ADAPTER", "UPDATED AT"].join(
    " | ",
  );
  const separator = "-".repeat(header.length);
  const rows = batteries.map((battery) =>
    [
      battery.name,
      battery.status,
      battery.connected ? "yes" : "no",
      battery.adapter,
      battery.updatedAt,
    ].join(" | "),
  );

  return [header, separator, ...rows].join("\n");
}

export function runBatteryListCommand(): number {
  console.log(formatBatteryList(getBatteryList()));
  return 0;
}
