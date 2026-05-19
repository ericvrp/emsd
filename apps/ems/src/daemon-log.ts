import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { getDatabasePath } from "@emsd/core";
import type { DaemonLogLevel, DaemonLogRecord } from "../../daemon/src/database";
import { logEmsError } from "./logging";

interface DaemonLogRow {
  id: number;
  level: DaemonLogLevel;
  message: string;
  logged_at: string;
}

export interface DaemonLogListOptions {
  level: DaemonLogLevel | null;
  limit: number;
  since: string | null;
  until: string | null;
}

const DAEMON_LOG_LEVELS = new Set<DaemonLogLevel>([
  "info",
  "warn",
  "error",
  "verbose",
]);
const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 1_000;

export function formatDaemonLogHelpText(): string {
  return [
    "Usage:",
    "  daemon logs [--limit <count>] [--level <level>] [--since <iso>] [--until <iso>]",
    "  daemon log [--limit <count>] [--level <level>] [--since <iso>] [--until <iso>]",
    "",
    "Levels:",
    "  info, warn, error, verbose",
  ].join("\n");
}

export function formatDaemonLogs(logs: DaemonLogRecord[]): string {
  if (logs.length === 0) {
    return "No daemon logs found.";
  }

  const header = ["LOGGED AT", "LEVEL", "MESSAGE"].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = logs.map((log) =>
    [log.loggedAt, log.level.toUpperCase(), log.message].join(" | "),
  );

  return [header, separator, ...rows].join("\n");
}

export async function runDaemonLogCommand(
  args: string[] = [],
): Promise<number> {
  try {
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args[0] === "--help" ||
      args[0] === "-h"
    ) {
      console.log(formatDaemonLogHelpText());
      return 0;
    }

    if (args[0] === "logs" || args[0] === "log") {
      const options = parseDaemonLogListOptions(args.slice(1));
      console.log(formatDaemonLogs(readSelectedDaemonLogs(options)));
      return 0;
    }

    throw new Error(`Unknown daemon command: ${args[0]}`);
  } catch (error) {
    logEmsError(error instanceof Error ? error.message : String(error));
    console.log(formatDaemonLogHelpText());
    return 1;
  }
}

export function readSelectedDaemonLogs(
  options: DaemonLogListOptions,
  databasePath = getDatabasePath(),
): DaemonLogRecord[] {
  if (!existsSync(databasePath)) {
    return [];
  }

  const db = new Database(databasePath, { readonly: true });

  try {
    if (!hasDaemonLogTable(db)) {
      return [];
    }

    const where: string[] = [];
    const params: (number | string)[] = [];

    if (options.level !== null) {
      params.push(options.level);
      where.push(`level = ?${params.length}`);
    }

    if (options.since !== null) {
      params.push(options.since);
      where.push(`logged_at >= ?${params.length}`);
    }

    if (options.until !== null) {
      params.push(options.until);
      where.push(`logged_at <= ?${params.length}`);
    }

    params.push(options.limit);

    const rows = db
      .query<DaemonLogRow, (number | string)[]>(
        `
          SELECT id, level, message, logged_at
          FROM daemon_logs
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY logged_at DESC, id DESC
          LIMIT ?${params.length}
        `,
      )
      .all(...params);

    return rows.reverse().map((row) => ({
      id: row.id,
      level: row.level,
      message: row.message,
      loggedAt: row.logged_at,
    }));
  } finally {
    db.close();
  }
}

function parseDaemonLogListOptions(args: string[]): DaemonLogListOptions {
  const options: DaemonLogListOptions = {
    level: null,
    limit: DEFAULT_LOG_LIMIT,
    since: null,
    until: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--limit") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("Missing value for --limit");
      }

      options.limit = parseLimit(value);
      index += 1;
      continue;
    }

    if (arg === "--level") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("Missing value for --level");
      }

      options.level = parseDaemonLogLevel(value);
      index += 1;
      continue;
    }

    if (arg === "--since") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("Missing value for --since");
      }

      options.since = parseIsoTimestamp("--since", value);
      index += 1;
      continue;
    }

    if (arg === "--until") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("Missing value for --until");
      }

      options.until = parseIsoTimestamp("--until", value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown daemon logs option: ${arg}`);
  }

  return options;
}

function parseLimit(value: string): number {
  const limit = Number.parseInt(value, 10);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) {
    throw new Error(`--limit must be between 1 and ${MAX_LOG_LIMIT}`);
  }

  return limit;
}

function parseDaemonLogLevel(value: string): DaemonLogLevel {
  if (!DAEMON_LOG_LEVELS.has(value as DaemonLogLevel)) {
    throw new Error(`Unknown daemon log level: ${value}`);
  }

  return value as DaemonLogLevel;
}

function parseIsoTimestamp(optionName: string, value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${optionName} must be an ISO timestamp`);
  }

  return date.toISOString();
}

function hasDaemonLogTable(db: Database): boolean {
  const row = db
    .query<{ name: string }, [string]>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?1
      `,
    )
    .get("daemon_logs");

  return row !== null;
}
