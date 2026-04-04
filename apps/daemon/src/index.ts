import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  EMSD_NAME,
  ensureParentDirectory,
  getDatabasePath,
  getDaemonLockPath,
} from "@emsd/core";
import { openDaemonDatabase, readBatteries } from "./database";

const lockPath = getDaemonLockPath();

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

  console.log(`${EMSD_NAME} daemon started.`);
  console.log(`SQLite database: ${getDatabasePath()}`);
  console.log(`Connected batteries: ${batteries.length}`);

  const heartbeat = setInterval(() => {
    console.log(`[${new Date().toISOString()}] daemon heartbeat`);
  }, 60_000);

  function shutdown(signal: string): void {
    clearInterval(heartbeat);
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
