import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  EMSD_NAME,
  type ManagedDeviceTelemetryRecord,
  ensureParentDirectory,
  getDaemonLockPath,
  getDatabasePath,
} from "@emsd/core";
import { createBatteryAdapter } from "../../ems/src/battery-adapters";
import { fetchMeterTelemetry } from "../../ems/src/discover";
import {
  openDaemonDatabase,
  readBatteries,
  readMeters,
  upsertManagedDeviceTelemetry,
} from "./database";

const lockPath = getDaemonLockPath();
const POLL_INTERVAL_MS = 5_000;

class DaemonStartupError extends Error {}

function acquireDaemonLock(): void {
  ensureParentDirectory(lockPath);

  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, `${process.pid}\n`);
    return;
  } catch (error) {
    const existingPid = Number.parseInt(readFileSync(lockPath, "utf8"), 10);

    if (!Number.isNaN(existingPid)) {
      try {
        process.kill(existingPid, 0);
        throw new DaemonStartupError(
          `${EMSD_NAME} daemon is already running with PID ${existingPid}.`,
        );
      } catch (signalError) {
        if ((signalError as NodeJS.ErrnoException).code !== "ESRCH") {
          throw signalError;
        }
      }
    }

    rmSync(lockPath, { force: true });

    const retryFd = openSync(lockPath, "wx");
    writeFileSync(retryFd, `${process.pid}\n`);
  }
}

function main(): void {
  acquireDaemonLock();

  const db = openDaemonDatabase();
  const batteries = readBatteries(db);
  const meters = readMeters(db);

  console.log(`${EMSD_NAME} daemon started.`);
  console.log(`SQLite database: ${getDatabasePath()}`);
  console.log(`Connected batteries: ${batteries.length}`);
  console.log(`Connected meters: ${meters.length}`);
  console.log(
    `Polling managed devices every ${POLL_INTERVAL_MS / 1000} seconds.`,
  );

  let pollInFlight = false;

  async function pollTelemetry(): Promise<void> {
    if (pollInFlight) {
      return;
    }

    pollInFlight = true;

    try {
      const polledBatteries = readBatteries(db);
      const polledMeters = readMeters(db);

      await Promise.all([
        ...polledBatteries.map(async (battery) => {
          const sample = await createBatteryAdapter(battery)
            .getNormalizedInfo()
            .catch((error: unknown) => {
              console.error(
                `[${new Date().toISOString()}] battery telemetry poll failed for ${battery.id} at ${battery.ipAddress}: ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            });

          if (!sample) {
            return;
          }

          upsertManagedDeviceTelemetry(db, {
            deviceId: battery.id,
            siteId: battery.siteId,
            kind: "battery",
            powerW: sample.currentW,
            socPercent: sample.socPercent,
            gasM3: null,
            state: sample.status,
            observedAt: new Date().toISOString(),
          } satisfies ManagedDeviceTelemetryRecord);
        }),
        ...polledMeters.map(async (meter) => {
          const sample = await fetchMeterTelemetry(meter.ipAddress).catch(
            (error: unknown) => {
              console.error(
                `[${new Date().toISOString()}] meter telemetry poll failed for ${meter.id} at ${meter.ipAddress}: ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            },
          );

          if (!sample) {
            return;
          }

          upsertManagedDeviceTelemetry(db, {
            deviceId: meter.id,
            siteId: meter.siteId,
            kind: "meter",
            powerW: sample.powerW,
            socPercent: null,
            gasM3: sample.gasM3,
            state: sample.state,
            observedAt: new Date().toISOString(),
          } satisfies ManagedDeviceTelemetryRecord);
        }),
      ]);
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] telemetry poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      pollInFlight = false;
    }
  }

  void pollTelemetry();

  const heartbeat = setInterval(() => {
    console.log(`[${new Date().toISOString()}] daemon heartbeat`);
  }, 60_000);
  const poller = setInterval(() => {
    void pollTelemetry();
  }, POLL_INTERVAL_MS);

  function shutdown(signal: string): void {
    clearInterval(heartbeat);
    clearInterval(poller);
    db.close();
    rmSync(lockPath, { force: true });
    console.log(`${EMSD_NAME} daemon stopped after ${signal}.`);
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

try {
  main();
} catch (error) {
  if (error instanceof DaemonStartupError) {
    console.error(error.message);
    process.exit(1);
  }

  throw error;
}
