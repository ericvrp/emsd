import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  EMSD_NAME,
  type ManagedDeviceTelemetryRecord,
  type NormalizedBatteryInfo,
  createBatteryStrategyRuntime,
  ensureParentDirectory,
  getDaemonLockPath,
  getDatabasePath,
  resolveBatteryStrategyFromPlanItem,
} from "@emsd/core";
import { createBatteryPlugin } from "../../ems/src/battery-plugins";
import { fetchMeterTelemetry } from "../../ems/src/discover";
import { formatDaemonHelpText, parseDaemonOptions } from "./daemon-options";
import {
  openDaemonDatabase,
  readBatteries,
  readMeters,
  updateBatteryNowModeStarted,
  updateBatteryStrategyRuntime,
  updateBatteryStrategyState,
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
  const parsedOptions = parseDaemonOptions(process.argv.slice(2));

  if (parsedOptions === null) {
    console.log(formatDaemonHelpText("daemon"));
    return;
  }

  const options = parsedOptions;

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
  if (options.verbose) {
    console.log("Verbose strategy logging enabled.");
  }

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
          const sample = await createBatteryPlugin(battery)
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

          if (shouldMarkNowModeStarted(battery, sample)) {
            updateBatteryNowModeStarted(db, {
              batteryId: battery.id,
              siteId: battery.siteId,
              nowModeStarted: true,
            });
          }

          if (shouldRestoreDefaultStrategy(battery, sample)) {
            const fallbackStrategy = resolveBatteryStrategyFromPlanItem({
              item: battery.strategyPlan[0],
              minimumDischargePercent: battery.minimumDischargePercent,
            });

            logVerbose(
              options.verbose,
              `restoring default strategy for ${battery.id} after now mode completed: ${describeStrategyPlanItem(battery.strategyPlan[0])}`,
            );

            await createBatteryPlugin(battery)
              .setStrategy(fallbackStrategy)
              .then(() => {
                updateBatteryStrategyState(db, {
                  batteryId: battery.id,
                  siteId: battery.siteId,
                  nowModeActive: false,
                  nowModeStarted: false,
                  strategy: fallbackStrategy,
                });
              })
              .catch((error: unknown) => {
                console.error(
                  `[${new Date().toISOString()}] failed to restore default strategy for ${battery.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
              });
          }

          if (!battery.nowModeActive) {
            await runScheduledStrategy(
              db,
              battery,
              sample,
              new Date(),
              options.verbose,
            );
          } else {
            logVerbose(
              options.verbose,
              `skipping scheduled strategy for ${battery.id} because now mode is active`,
            );
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

function shouldMarkNowModeStarted(
  battery: BatteryRecord,
  sample: NormalizedBatteryInfo,
): boolean {
  return (
    battery.nowModeActive &&
    !battery.nowModeStarted &&
    ((battery.manualState === "charging" && sample.status === "charging") ||
      (battery.manualState === "discharging" &&
        sample.status === "discharging"))
  );
}

function shouldRestoreDefaultStrategy(
  battery: BatteryRecord,
  sample: NormalizedBatteryInfo,
): boolean {
  if (
    !battery.nowModeActive ||
    !battery.nowModeStarted ||
    battery.strategyMode !== "manual"
  ) {
    return false;
  }

  if (battery.manualState === "charging") {
    if (
      sample.socPercent !== null &&
      battery.manualChargeTargetSoc !== null &&
      sample.socPercent >= battery.manualChargeTargetSoc
    ) {
      return true;
    }

    return sample.status !== "charging";
  }

  if (battery.manualState === "discharging") {
    if (
      sample.socPercent !== null &&
      battery.manualDischargeTargetSoc !== null &&
      sample.socPercent <= battery.manualDischargeTargetSoc
    ) {
      return true;
    }

    return sample.status !== "discharging";
  }

  return true;
}

async function runScheduledStrategy(
  db: ReturnType<typeof openDaemonDatabase>,
  battery: BatteryRecord,
  sample: NormalizedBatteryInfo,
  now: Date,
  verbose: boolean,
): Promise<void> {
  const activeItem = getActiveStrategyPlanItem(battery);

  if (battery.strategyRuntime.activeItemId && activeItem === null) {
    logVerbose(
      verbose,
      `restoring default strategy for ${battery.id} because active item ${battery.strategyRuntime.activeItemId} is no longer in the plan`,
    );
    await restoreFallbackStrategy(
      db,
      battery,
      battery.strategyRuntime.activeItemId,
    );
    return;
  }

  if (activeItem) {
    if (
      !shouldCompleteScheduledItem({ battery, item: activeItem, now, sample })
    ) {
      logVerbose(
        verbose,
        `keeping active strategy item for ${battery.id}: ${describeStrategyPlanItem(activeItem)}`,
      );
      return;
    }

    logVerbose(
      verbose,
      `completed active strategy item for ${battery.id}: ${describeStrategyPlanItem(activeItem)}`,
    );
    await restoreFallbackStrategy(db, battery, activeItem.id, verbose);
    return;
  }

  const dueItems = battery.strategyPlan.slice(1);
  let runtime = battery.strategyRuntime;

  for (const item of dueItems) {
    const triggerAt = getTodayTriggerAt(item, now);

    if (!triggerAt || now.getTime() < triggerAt.getTime()) {
      continue;
    }

    const lastTriggeredAt = runtime.lastTriggeredAtByItemId[item.id];

    if (
      lastTriggeredAt &&
      new Date(lastTriggeredAt).getTime() >= triggerAt.getTime()
    ) {
      continue;
    }

    if (shouldSkipScheduledItem(item, triggerAt, now)) {
      logVerbose(
        verbose,
        `skipping expired strategy item for ${battery.id}: ${describeStrategyPlanItem(item)}`,
      );
      runtime = {
        ...runtime,
        lastTriggeredAtByItemId: {
          ...runtime.lastTriggeredAtByItemId,
          [item.id]: triggerAt.toISOString(),
        },
      };
      updateBatteryStrategyRuntime(db, {
        batteryId: battery.id,
        siteId: battery.siteId,
        strategyRuntime: runtime,
      });
      continue;
    }

    const strategy = resolveBatteryStrategyFromPlanItem({
      item,
      minimumDischargePercent: battery.minimumDischargePercent,
    });

    logVerbose(
      verbose,
      `activating strategy item for ${battery.id}: ${describeStrategyPlanItem(item)}`,
    );

    await createBatteryPlugin(battery).setStrategy(strategy);

    const nextRuntime = {
      activeItemId: needsCompletionTracking(item) ? item.id : null,
      activeStartedAt: needsCompletionTracking(item) ? now.toISOString() : null,
      lastTriggeredAtByItemId: {
        ...runtime.lastTriggeredAtByItemId,
        [item.id]: triggerAt.toISOString(),
      },
    };

    updateBatteryStrategyState(db, {
      batteryId: battery.id,
      siteId: battery.siteId,
      nowModeActive: false,
      nowModeStarted: false,
      strategy,
    });
    updateBatteryStrategyRuntime(db, {
      batteryId: battery.id,
      siteId: battery.siteId,
      strategyRuntime: nextRuntime,
    });
    return;
  }
}

function getActiveStrategyPlanItem(
  battery: BatteryRecord,
): BatteryStrategyPlanItem | null {
  const activeItemId = battery.strategyRuntime.activeItemId;

  if (!activeItemId) {
    return null;
  }

  return battery.strategyPlan.find((item) => item.id === activeItemId) ?? null;
}

function shouldCompleteScheduledItem(input: {
  battery: BatteryRecord;
  item: BatteryStrategyPlanItem;
  now: Date;
  sample: NormalizedBatteryInfo;
}): boolean {
  const { battery, item, now, sample } = input;
  const startedAt = battery.strategyRuntime.activeStartedAt;

  if (!startedAt) {
    return true;
  }

  if (item.targetMethod === "duration") {
    if (item.targetDurationMinutes === null) {
      return true;
    }

    return (
      now.getTime() >=
      new Date(startedAt).getTime() + item.targetDurationMinutes * 60000
    );
  }

  if (item.targetMethod === "end-time") {
    const endAt = getScheduledEndAt(item, startedAt);
    return endAt === null ? true : now.getTime() >= endAt.getTime();
  }

  if (battery.manualState === "charging") {
    if (
      sample.socPercent !== null &&
      battery.manualChargeTargetSoc !== null &&
      sample.socPercent >= battery.manualChargeTargetSoc
    ) {
      return true;
    }

    return sample.status !== "charging";
  }

  if (battery.manualState === "discharging") {
    if (
      sample.socPercent !== null &&
      battery.manualDischargeTargetSoc !== null &&
      sample.socPercent <= battery.manualDischargeTargetSoc
    ) {
      return true;
    }

    return sample.status !== "discharging";
  }

  return false;
}

function shouldSkipScheduledItem(
  item: BatteryStrategyPlanItem,
  triggerAt: Date,
  now: Date,
): boolean {
  if (item.targetMethod === "duration") {
    return (
      item.targetDurationMinutes !== null &&
      now.getTime() >= triggerAt.getTime() + item.targetDurationMinutes * 60000
    );
  }

  if (item.targetMethod === "end-time") {
    const endAt = getScheduledEndAt(item, triggerAt.toISOString());
    return endAt !== null && now.getTime() >= endAt.getTime();
  }

  return false;
}

function getTodayTriggerAt(
  item: BatteryStrategyPlanItem,
  now: Date,
): Date | null {
  if (
    item.kind !== "daily" ||
    item.triggerKind !== "daily-time" ||
    !item.startTime
  ) {
    return null;
  }

  const [hoursPart, minutesPart] = item.startTime.split(":");
  const triggerAt = new Date(now);
  triggerAt.setHours(
    Number(hoursPart ?? "0"),
    Number(minutesPart ?? "0"),
    0,
    0,
  );
  return triggerAt;
}

function getScheduledEndAt(
  item: BatteryStrategyPlanItem,
  startedAt: string,
): Date | null {
  if (item.targetEndTime === null) {
    return null;
  }

  const [hoursPart, minutesPart] = item.targetEndTime.split(":");
  const startDate = new Date(startedAt);
  const endAt = new Date(startDate);
  endAt.setHours(Number(hoursPart ?? "0"), Number(minutesPart ?? "0"), 0, 0);

  if (endAt.getTime() <= startDate.getTime()) {
    endAt.setDate(endAt.getDate() + 1);
  }

  return endAt;
}

function needsCompletionTracking(item: BatteryStrategyPlanItem): boolean {
  return (
    item.strategyMode === "manual" &&
    item.manualState !== null &&
    item.manualState !== "idle" &&
    item.targetMethod !== null
  );
}

async function restoreFallbackStrategy(
  db: ReturnType<typeof openDaemonDatabase>,
  battery: BatteryRecord,
  completedItemId: string,
  verbose = false,
): Promise<void> {
  const fallbackStrategy = resolveBatteryStrategyFromPlanItem({
    item: battery.strategyPlan[0],
    minimumDischargePercent: battery.minimumDischargePercent,
  });

  logVerbose(
    verbose,
    `applying fallback strategy for ${battery.id}: ${describeStrategyPlanItem(battery.strategyPlan[0])}`,
  );

  await createBatteryPlugin(battery).setStrategy(fallbackStrategy);

  updateBatteryStrategyState(db, {
    batteryId: battery.id,
    siteId: battery.siteId,
    nowModeActive: false,
    nowModeStarted: false,
    strategy: fallbackStrategy,
  });
  updateBatteryStrategyRuntime(db, {
    batteryId: battery.id,
    siteId: battery.siteId,
    strategyRuntime: {
      ...battery.strategyRuntime,
      activeItemId: null,
      activeStartedAt: null,
      lastTriggeredAtByItemId: {
        ...battery.strategyRuntime.lastTriggeredAtByItemId,
        [completedItemId]:
          battery.strategyRuntime.lastTriggeredAtByItemId[completedItemId] ??
          new Date().toISOString(),
      },
    },
  });
}

function logVerbose(enabled: boolean, message: string): void {
  if (!enabled) {
    return;
  }

  console.log(`[${new Date().toISOString()}] ${message}`);
}

function describeStrategyPlanItem(
  item: BatteryStrategyPlanItem | null | undefined,
): string {
  if (!item) {
    return "<none>";
  }

  const parts = [
    `id=${item.id}`,
    `kind=${item.kind}`,
    `mode=${item.strategyMode}`,
  ];

  if (item.triggerKind) {
    parts.push(`trigger=${item.triggerKind}`);
  }

  if (item.startTime) {
    parts.push(`start=${item.startTime}`);
  }

  if (item.manualState) {
    parts.push(`state=${item.manualState}`);
  }

  if (item.targetMethod) {
    parts.push(`target=${item.targetMethod}`);
  }

  if (item.targetDurationMinutes !== null) {
    parts.push(`duration=${item.targetDurationMinutes}m`);
  }

  if (item.targetEndTime) {
    parts.push(`end=${item.targetEndTime}`);
  }

  if (item.manualChargeTargetSoc !== null) {
    parts.push(`chargeSoc=${item.manualChargeTargetSoc}`);
  }

  if (item.manualDischargeTargetSoc !== null) {
    parts.push(`dischargeSoc=${item.manualDischargeTargetSoc}`);
  }

  if (item.manualPowerW !== null) {
    parts.push(`powerW=${item.manualPowerW}`);
  }

  return parts.join(" ");
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
