import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  type DynamicPriceSnapshotRecord,
  type DynamicPriceSourceRecord,
  EMSD_NAME,
  type ManagedDeviceTelemetryRecord,
  type NormalizedBatteryInfo,
  type SiteRecord,
  type WeatherForecastRecord,
  type WeatherForecastSourceRecord,
  clearActiveBatteryStrategyRuntime,
  ensureParentDirectory,
  getDaemonLockPath,
  getDatabasePath,
  resolveBatteryStrategyFromPlanItem,
} from "@emsd/core";
import { createBatteryPlugin } from "../../ems/src/battery-plugins";
import { fetchMeterTelemetry } from "../../ems/src/discover";
import { getDynamicPriceSnapshot } from "../../ems/src/plugins/price";
import { getWeatherForecast } from "../../ems/src/plugins/solar-forecast";
import { formatDaemonHelpText, parseDaemonOptions } from "./daemon-options";
import {
  openDaemonDatabase,
  readBatteries,
  readDynamicPriceSnapshot,
  readDynamicPriceSources,
  readMeters,
  readSites,
  readWeatherForecast,
  readWeatherForecastSources,
  updateBatteryManualModeStarted,
  updateBatteryStrategyRuntime,
  updateBatteryStrategyState,
  upsertDynamicPriceSnapshot,
  upsertManagedDeviceTelemetry,
  upsertWeatherForecast,
} from "./database";
import {
  describeStrategyPlanItem,
  formatDaemonLogTimestamp,
  getDaemonTimeZoneLabel,
  getTodayTriggerAt,
  isItemAlreadyTriggeredToday,
  needsCompletionTracking,
  shouldCompleteScheduledItem,
  shouldSkipDelayedSocItemBecauseLaterItemIsDue,
  shouldSkipScheduledItem,
} from "./strategy-scheduler";

const lockPath = getDaemonLockPath();
const POLL_INTERVAL_MS = 5_000;
const FORECAST_REFRESH_INTERVAL_MS = 10 * 60 * 1_000;
const DYNAMIC_PRICE_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;
const FORECAST_HOURS = 48;
const FORECAST_PERIOD_MINUTES = 15;

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

  logInfo(`${EMSD_NAME} daemon started.`);
  logInfo(`SQLite database: ${getDatabasePath()}`);
  logInfo(`Connected batteries: ${batteries.length}`);
  logInfo(`Connected meters: ${meters.length}`);
  logInfo(`Daemon local time zone: ${getDaemonTimeZoneLabel()}`);
  logInfo(`Polling managed devices every ${POLL_INTERVAL_MS / 1000} seconds.`);
  logInfo(
    `Refreshing solar forecasts at most every ${FORECAST_REFRESH_INTERVAL_MS / 60_000} minutes.`,
  );
  logInfo(
    `Refreshing dynamic prices at most every ${DYNAMIC_PRICE_REFRESH_INTERVAL_MS / 60_000} minutes.`,
  );

  let pollInFlight = false;
  let refreshInFlight = false;

  async function refreshSiteData(forceRefresh = false): Promise<void> {
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;

    try {
      const sites = readSites(db);
      const dynamicPriceSources = readDynamicPriceSources(db);
      const weatherSources = readWeatherForecastSources(db);

      await refreshWeatherForecasts(
        db,
        sites,
        weatherSources,
        options.verbose,
        forceRefresh,
      );
      await refreshDynamicPrices(
        db,
        sites,
        dynamicPriceSources,
        options.verbose,
        forceRefresh,
      );
    } finally {
      refreshInFlight = false;
    }
  }

  async function pollTelemetry(): Promise<void> {
    if (pollInFlight) {
      return;
    }

    pollInFlight = true;

    try {
      const polledBatteries = readBatteries(db);
      const polledMeters = readMeters(db);

      await refreshSiteData();

      await Promise.all([
        ...polledBatteries.map(async (battery) => {
          const sample = await createBatteryPlugin(battery)
            .getNormalizedInfo()
            .catch((error: unknown) => {
              logError(
                `battery telemetry poll failed for ${battery.id} at ${battery.ipAddress}: ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            });

          if (!sample) {
            return;
          }

          if (shouldMarkManualModeStarted(battery, sample)) {
            updateBatteryManualModeStarted(db, {
              batteryId: battery.id,
              siteId: battery.siteId,
              manualModeStarted: true,
            });
          }

          if (shouldRestoreDefaultStrategy(battery, sample)) {
            const fallbackStrategy = resolveBatteryStrategyFromPlanItem({
              item: battery.strategyPlan[0],
              minimumDischargePercent: battery.minimumDischargePercent,
            });

            logVerbose(
              options.verbose,
              `restoring default strategy for ${battery.id} after manual mode completed: ${describeStrategyPlanItem(battery.strategyPlan[0])}`,
            );

            await createBatteryPlugin(battery)
              .setStrategy(fallbackStrategy)
              .then(() => {
                updateBatteryStrategyState(db, {
                  batteryId: battery.id,
                  siteId: battery.siteId,
                  manualModeActive: false,
                  manualModeStarted: false,
                  strategy: fallbackStrategy,
                });
                updateBatteryStrategyRuntime(db, {
                  batteryId: battery.id,
                  siteId: battery.siteId,
                  strategyRuntime: clearActiveBatteryStrategyRuntime(
                    battery.strategyRuntime,
                  ),
                });
              })
              .catch((error: unknown) => {
                logError(
                  `failed to restore default strategy for ${battery.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
              });
          }

          if (!battery.manualModeActive) {
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
              `skipping scheduled strategy for ${battery.id} because manual mode is active`,
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
              logError(
                `meter telemetry poll failed for ${meter.id} at ${meter.ipAddress}: ${error instanceof Error ? error.message : String(error)}`,
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
      logError(
        `telemetry poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      pollInFlight = false;
    }
  }

  // Initial refresh of forecast and price info on daemon start
  logInfo("Polling solar forecasts at startup...");
  void refreshSiteData(true);
  logInfo("Polling dynamic prices at startup...");

  void pollTelemetry();

  // const heartbeat = setInterval(() => {
  //   console.log(`[${new Date().toISOString()}] daemon heartbeat`);
  // }, 60_000);
  const poller = setInterval(() => {
    void pollTelemetry();
  }, POLL_INTERVAL_MS);
  const forecastPoller = setInterval(() => {
    void refreshSiteData();
  }, FORECAST_REFRESH_INTERVAL_MS);
  const pricePoller = setInterval(() => {
    void refreshSiteData();
  }, DYNAMIC_PRICE_REFRESH_INTERVAL_MS);

  process.on("SIGUSR1", () => {
    logInfo("received on-demand refresh request");
    void refreshSiteData(true);
  });

  function shutdown(signal: string): void {
    // clearInterval(heartbeat);
    clearInterval(poller);
    clearInterval(forecastPoller);
    clearInterval(pricePoller);
    db.close();
    rmSync(lockPath, { force: true });
    logInfo(`${EMSD_NAME} daemon stopped after ${signal}.`);
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function refreshWeatherForecasts(
  db: ReturnType<typeof openDaemonDatabase>,
  sites: SiteRecord[],
  weatherSources: WeatherForecastSourceRecord[],
  verbose: boolean,
  forceRefresh = false,
): Promise<void> {
  for (const site of sites) {
    const cachedForecast = readWeatherForecast(db, site.id);

    if (
      !forceRefresh &&
      !shouldRefreshWeatherForecast(cachedForecast, new Date())
    ) {
      continue;
    }

    const source =
      weatherSources.find((entry) => entry.siteId === site.id) ?? null;

    try {
      const forecast = await getWeatherForecast({
        hours: FORECAST_HOURS,
        periodMinutes: FORECAST_PERIOD_MINUTES,
        site,
        source,
      });

      upsertWeatherForecast(db, site.id, forecast);
      logInfo(`refreshed solar forecast for ${site.id}`);
    } catch (error) {
      logError(
        `solar forecast refresh failed for ${site.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function refreshDynamicPrices(
  db: ReturnType<typeof openDaemonDatabase>,
  sites: SiteRecord[],
  sources: DynamicPriceSourceRecord[],
  verbose: boolean,
  forceRefresh = false,
): Promise<void> {
  for (const site of sites) {
    const source = sources.find((entry) => entry.siteId === site.id) ?? null;

    if (!source) {
      continue;
    }

    const cachedSnapshot = readDynamicPriceSnapshot(db, site.id);

    if (
      !forceRefresh &&
      !shouldRefreshDynamicPrice(cachedSnapshot, new Date())
    ) {
      continue;
    }

    try {
      const snapshot = await getDynamicPriceSnapshot({ site, source });
      upsertDynamicPriceSnapshot(db, site.id, snapshot);
      logInfo(`refreshed dynamic price snapshot for ${site.id}`);
    } catch (error) {
      logError(
        `dynamic price refresh failed for ${site.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function shouldRefreshWeatherForecast(
  forecast: WeatherForecastRecord | null,
  now: Date,
): boolean {
  if (forecast === null) {
    return true;
  }

  const generatedAt = new Date(forecast.generatedAt).getTime();

  if (Number.isNaN(generatedAt)) {
    return true;
  }

  return now.getTime() - generatedAt >= FORECAST_REFRESH_INTERVAL_MS;
}

function shouldRefreshDynamicPrice(
  snapshot: DynamicPriceSnapshotRecord | null,
  now: Date,
): boolean {
  if (snapshot === null) {
    return true;
  }

  const generatedAt = new Date(snapshot.generatedAt).getTime();

  if (Number.isNaN(generatedAt)) {
    return true;
  }

  return now.getTime() - generatedAt >= DYNAMIC_PRICE_REFRESH_INTERVAL_MS;
}

function shouldMarkManualModeStarted(
  battery: BatteryRecord,
  sample: NormalizedBatteryInfo,
): boolean {
  return (
    battery.manualModeActive &&
    !battery.manualModeStarted &&
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
    !battery.manualModeActive ||
    !battery.manualModeStarted ||
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

  for (const [index, item] of dueItems.entries()) {
    const triggerAt = getTodayTriggerAt(item, now);

    if (!triggerAt) {
      logVerbose(
        verbose,
        `ignoring non-executable strategy item for ${battery.id}: ${describeStrategyPlanItem(item)}`,
      );
      continue;
    }

    if (now.getTime() < triggerAt.getTime()) {
      logVerbose(
        verbose,
        `strategy item not due yet for ${battery.id}: ${describeStrategyPlanItem(item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
      );
      continue;
    }

    if (
      isItemAlreadyTriggeredToday({
        runtime,
        itemId: item.id,
        triggerAt,
      })
    ) {
      logVerbose(
        verbose,
        `strategy item already triggered today for ${battery.id}: ${describeStrategyPlanItem(item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)}`,
      );
      continue;
    }

    if (
      shouldSkipDelayedSocItemBecauseLaterItemIsDue({
        items: dueItems,
        currentIndex: index,
        currentTriggerAt: triggerAt,
        now,
        runtime,
      })
    ) {
      logVerbose(
        verbose,
        `skipping delayed strategy item for ${battery.id} because a later item is already due: ${describeStrategyPlanItem(item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
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

    if (shouldSkipScheduledItem(item, triggerAt, now)) {
      logVerbose(
        verbose,
        `skipping expired strategy item for ${battery.id}: ${describeStrategyPlanItem(item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
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
      manualModeActive: false,
      manualModeStarted: false,
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
    manualModeActive: false,
    manualModeStarted: false,
    strategy: fallbackStrategy,
  });
  updateBatteryStrategyRuntime(db, {
    batteryId: battery.id,
    siteId: battery.siteId,
    strategyRuntime: {
      ...clearActiveBatteryStrategyRuntime(battery.strategyRuntime),
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

  console.log(`[${formatDaemonLogTimestamp()}] ${message}`);
}

function logInfo(message: string): void {
  console.log(`[${formatDaemonLogTimestamp()}] ${message}`);
}

function logError(message: string): void {
  console.error(`[${formatDaemonLogTimestamp()}] ${message}`);
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
