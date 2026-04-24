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
  isBatteryStrategyPriceTrigger,
  resolveActiveManualState,
  resolveBatteryStrategyFromPlanItem,
} from "@emsd/core";
import { createBatteryPlugin } from "../../ems/src/battery-plugins";
import { fetchMeterTelemetry } from "../../ems/src/discover";
import { getDynamicPriceSnapshot } from "../../ems/src/plugins/price";
import { getSolarEnergyProviderNormalizedInfo } from "../../ems/src/plugins/solar-energy-provider";
import { getWeatherForecast } from "../../ems/src/plugins/solar-forecast";
import { formatDaemonHelpText, parseDaemonOptions } from "./daemon-options";
import {
  openDaemonDatabase,
  readBatteryById,
  readBatteries,
  readBatteryPowerSamples,
  readDynamicPriceSamples,
  readManagedDeviceTelemetry,
  readDynamicPriceSnapshot,
  readDynamicPriceSources,
  readMeters,
  readP1MeterSamples,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarEnergyProviders,
  readSolarForecastSamples,
  readWeatherForecast,
  readWeatherForecastSources,
  updateBatteryManualModeStarted,
  updateBatteryStrategyRuntime,
  updateBatteryStrategyState,
  upsertBatteryStrategyHistoryState,
  upsertDynamicPriceSnapshot,
  upsertManagedDeviceTelemetry,
  upsertWeatherForecast,
} from "./database";
import {
  formatFallbackStrategyRestoreSummary,
  formatManualStrategyAppliedSummary,
  formatScheduledStrategyCompletionSummary,
  formatScheduledStrategyStartedSummary,
  formatStrategyPlanAppliedSummary,
} from "./strategy-log";
import { estimateDynamicPriceTarget } from "./dynamic-price-target";
import {
  getCurrentSiteSolarPowerW,
  getScheduledStartSkipReason,
} from "./strategy-start-guard";
import {
  describeStrategyPlanItem,
  formatDaemonLogTimestamp,
  formatScheduledItemCompletion,
  getDaemonTimeZoneLabel,
  getNextStrategyTriggerAt,
  getScheduledItemCompletion,
  getStrategyTriggerAt,
  isItemAlreadyTriggeredToday,
  needsCompletionTracking,
  shouldMarkScheduledItemObserved,
  shouldTransitionDelayedChargingToIdle,
  shouldSkipScheduledItem,
  shouldWaitForObservedStart,
} from "./strategy-scheduler";

const lockPath = getDaemonLockPath();
const POLL_INTERVAL_MS = 5_000;
const FORECAST_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;
const DYNAMIC_PRICE_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;
const FORECAST_HOURS = 48;
const FORECAST_PERIOD_MINUTES = 15;

class DaemonStartupError extends Error {}

interface BatteryControlSnapshot {
  manualSignature: string;
  strategyPlanSignature: string;
}

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
  const solarEnergyProviders = readSolarEnergyProviders(db);

  logInfo(`${EMSD_NAME} daemon started.`);
  logInfo(`SQLite database: ${getDatabasePath()}`);
  logInfo(`Connected batteries: ${batteries.length}`);
  logInfo(`Connected meters: ${meters.length}`);
  logInfo(`Connected solar energy providers: ${solarEnergyProviders.length}`);
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
  const observedBatteryControls = new Map(
    batteries.map((battery) => [
      battery.id,
      createBatteryControlSnapshot(battery),
    ]),
  );

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
      const pollStartedAt = new Date();
      const polledSolarEnergyProviders = readSolarEnergyProviders(db);

      for (const battery of polledBatteries) {
        logAppliedBatteryControlChanges(
          observedBatteryControls.get(battery.id),
          battery,
          pollStartedAt,
          options.verbose,
        );
        observedBatteryControls.set(
          battery.id,
          createBatteryControlSnapshot(battery),
        );
      }

      for (const batteryId of observedBatteryControls.keys()) {
        if (!polledBatteries.some((battery) => battery.id === batteryId)) {
          observedBatteryControls.delete(batteryId);
        }
      }

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

          if (shouldRestoreDefaultStrategy(battery, sample, pollStartedAt)) {
            const fallbackItem = getFallbackStrategyPlanItem(battery);
            const fallbackStrategy = resolveBatteryStrategyFromPlanItem({
              item: fallbackItem,
              minimumDischargePercent: battery.minimumDischargePercent,
              maximumChargePowerW: battery.maximumChargePowerW,
              maximumDischargePowerW: battery.maximumDischargePowerW,
            });

            logInfoWithVerboseDetails(
              options.verbose,
              formatFallbackStrategyRestoreSummary(battery.id, fallbackItem),
              `restoring default strategy for ${battery.id} after manual mode completed: ${describeStrategyPlanItem(fallbackItem)}`,
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

          const effectiveBattery =
            readBatteryById(db, battery.siteId, battery.id) ?? battery;
          const observedAt = new Date().toISOString();

          upsertBatteryStrategyHistoryState(
            db,
            buildBatteryStrategyHistoryRecord(effectiveBattery, observedAt),
          );

          upsertManagedDeviceTelemetry(db, {
            deviceId: battery.id,
            siteId: battery.siteId,
            kind: "battery",
            capacityWh: sample.capacityWh,
            powerW: sample.currentW,
            socPercent: sample.socPercent,
            state: null,
            observedAt,
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
            capacityWh: null,
            powerW: sample.powerW,
            socPercent: null,
            state: null,
            observedAt: new Date().toISOString(),
          } satisfies ManagedDeviceTelemetryRecord);
        }),
        ...polledSolarEnergyProviders.map(async (provider) => {
          const sample = await getSolarEnergyProviderNormalizedInfo(
            provider,
          ).catch((error: unknown) => {
            logError(
              `solar energy provider telemetry poll failed for ${provider.id} at ${provider.ipAddress}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          });

          if (!sample) {
            return;
          }

          upsertManagedDeviceTelemetry(db, {
            deviceId: provider.id,
            siteId: provider.siteId,
            kind: "solar-energy-provider",
            capacityWh: null,
            powerW: sample.currentPowerW,
            socPercent: null,
            state: null,
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
      logVerbose(verbose, `refreshed solar forecast for ${site.id}`);
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
      logVerbose(verbose, `refreshed dynamic price snapshot for ${site.id}`);
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

function buildBatteryStrategyHistoryRecord(
  battery: BatteryRecord,
  observedAt: string,
): import("@emsd/core").BatteryStrategyHistoryRecord {
  return {
    activeItemId: battery.strategyRuntime.activeItemId,
    batteryId: battery.id,
    displayLabel: getBatteryStrategyDisplayLabel(battery),
    displayState: getBatteryStrategyDisplayState(battery),
    endedAt: null,
    manualState: battery.manualState,
    observedAt,
    siteId: battery.siteId,
    source: battery.manualModeActive ? "manual" : "automatic",
    startedAt: observedAt,
    strategyMode: battery.strategyMode,
  };
}

function getBatteryStrategyDisplayState(
  battery: Pick<BatteryRecord, "strategyMode" | "manualState">,
): import("@emsd/core").BatteryStrategyHistoryDisplayState {
  if (battery.strategyMode === "self-consumption") {
    return "self-consumption";
  }

  if (battery.manualState === "charging") {
    return "charge";
  }

  if (battery.manualState === "discharging") {
    return "discharge";
  }

  return "idle";
}

function getBatteryStrategyDisplayLabel(
  battery: Pick<BatteryRecord, "strategyMode" | "manualState">,
): string {
  const displayState = getBatteryStrategyDisplayState(battery);

  switch (displayState) {
    case "self-consumption":
      return "Self-consumption";
    case "charge":
      return "Charge";
    case "discharge":
      return "Discharge";
    case "idle":
      return "Idle";
  }
}

function shouldRestoreDefaultStrategy(
  battery: BatteryRecord,
  sample: NormalizedBatteryInfo,
  now: Date,
): boolean {
  if (!battery.manualModeActive || !battery.manualModeStarted) {
    return false;
  }

  if (hasManualDurationExpired(battery, now)) {
    return true;
  }

  if (hasManualEndTimeElapsed(battery, now)) {
    return true;
  }

  if (battery.strategyMode === "self-consumption") {
    const targetSoc =
      battery.strategyRuntime.manualTargetMethod === "auto"
        ? (battery.strategyRuntime.activeTargetSocPercent ?? null)
        : battery.manualTargetSoc;

    if (targetSoc === null || sample.socPercent === null) {
      return false;
    }

    const startSoc = battery.strategyRuntime.activeStartSocPercent;

    return startSoc !== null
      ? startSoc <= targetSoc
        ? sample.socPercent >= targetSoc
        : sample.socPercent <= targetSoc
      : sample.socPercent === targetSoc;
  }

  if (battery.strategyMode !== "manual") {
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

  if (battery.manualState === "idle") {
    const targetSoc =
      battery.strategyRuntime.manualTargetMethod === "auto"
        ? (battery.strategyRuntime.activeTargetSocPercent ?? null)
        : battery.manualTargetSoc;

    return (
      sample.socPercent !== null &&
      targetSoc !== null &&
      sample.socPercent <= targetSoc
    );
  }

  return false;
}

function hasManualDurationExpired(battery: BatteryRecord, now: Date): boolean {
  if (battery.strategyRuntime.manualTargetMethod !== "duration") {
    return false;
  }

  const durationMinutes = battery.strategyRuntime.manualTargetDurationMinutes;
  const startedAt = battery.strategyRuntime.manualTargetStartedAt;

  if (
    durationMinutes === null ||
    durationMinutes === undefined ||
    durationMinutes <= 0 ||
    !startedAt
  ) {
    return false;
  }

  const startedAtMs = new Date(startedAt).getTime();

  if (Number.isNaN(startedAtMs)) {
    return false;
  }

  return now.getTime() >= startedAtMs + durationMinutes * 60_000;
}

function hasManualEndTimeElapsed(battery: BatteryRecord, now: Date): boolean {
  if (battery.strategyRuntime.manualTargetMethod !== "end-time") {
    return false;
  }

  const endTime = battery.strategyRuntime.manualTargetEndTime;
  const startedAt = battery.strategyRuntime.manualTargetStartedAt;

  if (!endTime || !startedAt) {
    return false;
  }

  const [hoursPart, minutesPart] = endTime.split(":");
  const startedAtDate = new Date(startedAt);

  if (Number.isNaN(startedAtDate.getTime())) {
    return false;
  }

  const endAt = new Date(startedAtDate);
  endAt.setHours(Number(hoursPart ?? "0"), Number(minutesPart ?? "0"), 0, 0);

  if (endAt.getTime() <= startedAtDate.getTime()) {
    endAt.setDate(endAt.getDate() + 1);
  }

  return now.getTime() >= endAt.getTime();
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
    let runtime = battery.strategyRuntime;

    if (
      shouldMarkScheduledItemObserved({ item: activeItem, runtime, sample })
    ) {
      runtime = {
        ...runtime,
        activeObservedAt: now.toISOString(),
      };
      updateBatteryStrategyRuntime(db, {
        batteryId: battery.id,
        siteId: battery.siteId,
        strategyRuntime: runtime,
      });
      const observedDelay = formatStrategyObservationDelay(
        battery.strategyRuntime.activeStartedAt,
        now,
      );
      logInfoWithVerboseDetails(
        verbose,
        formatScheduledStrategyStartedSummary(
          battery.id,
          activeItem,
          observedDelay,
          activeItem.targetMethod === "auto" &&
            typeof runtime.activeTargetSocPercent === "number"
            ? {
                reasoning: describeEstimatedRuntimeReasoning(runtime),
                resolvedManualState: runtime.activeResolvedManualState ?? null,
                targetSocPercent: runtime.activeTargetSocPercent,
                reserveSocPercent: runtime.activeReserveSocPercent ?? 0,
                targetTime: runtime.activeTargetTime ?? null,
              }
            : null,
        ),
        `strategy item started for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, activeItem)}${observedDelay}`,
      );
    }

    if (
      shouldTransitionDelayedChargingToIdle({
        item: activeItem,
        now,
        runtime,
        sample,
      })
    ) {
      const idleStrategy = applyEstimatedTargetToStrategy(
        resolveBatteryStrategyFromPlanItem({
          item: activeItem,
          minimumDischargePercent: battery.minimumDischargePercent,
          maximumChargePowerW: battery.maximumChargePowerW,
          maximumDischargePowerW: battery.maximumDischargePowerW,
        }),
        activeItem,
        "idle",
        runtime.activeTargetSocPercent ?? null,
        battery.minimumDischargePercent,
        battery.maximumChargePowerW,
        battery.maximumDischargePowerW,
      );

      await createBatteryPlugin(battery).setStrategy(idleStrategy);

      runtime = {
        ...runtime,
        activeResolvedManualState: "idle",
      };

      updateBatteryStrategyState(db, {
        batteryId: battery.id,
        siteId: battery.siteId,
        manualModeActive: false,
        manualModeStarted: false,
        strategy: idleStrategy,
      });
      updateBatteryStrategyRuntime(db, {
        batteryId: battery.id,
        siteId: battery.siteId,
        strategyRuntime: runtime,
      });

      logVerbose(
        verbose,
        `holding delayed charging target for ${battery.id}: ${describeStrategyPlanItem(activeItem)}`,
      );
      return;
    }

    const completion = getScheduledItemCompletion({
      battery,
      item: activeItem,
      now,
      runtime,
      sample,
    });

    if (completion === null) {
      logVerbose(
        verbose,
        `keeping active strategy item for ${battery.id}: ${describeStrategyPlanItem(activeItem)}`,
      );
      return;
    }

    logInfoWithVerboseDetails(
      verbose,
      formatScheduledStrategyCompletionSummary({
        batteryId: battery.id,
        item: activeItem,
        completion,
        fallbackItem: getFallbackStrategyPlanItem(battery),
      }),
      `deactivating strategy item for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, activeItem)} ${formatScheduledItemCompletion(completion)}`,
    );
    await restoreFallbackStrategy(
      db,
      {
        ...battery,
        strategyRuntime: runtime,
      },
      activeItem.id,
      verbose,
    );
    return;
  }

  const dueItems = battery.strategyPlan.slice(1).filter((item) => item.enabled);
  const dynamicPriceSamples = dueItems.some((item) =>
    isBatteryStrategyPriceTrigger(item.triggerKind),
  )
    ? readDynamicPriceSamples(db, battery.siteId)
    : [];
  const managedDeviceTelemetry = readManagedDeviceTelemetry(db);
  let runtime = battery.strategyRuntime;

  for (let index = dueItems.length - 1; index >= 0; index -= 1) {
    const item = dueItems[index];

    if (!item) {
      continue;
    }

    const triggerAt = getStrategyTriggerAt({
      item,
      now,
      ...(dynamicPriceSamples.length > 0 ? { dynamicPriceSamples } : {}),
    });

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

    const scheduledStartSkipReason = getScheduledStartSkipReason({
      batteryId: battery.id,
      item,
      siteCurrentSolarPowerW: getCurrentSiteSolarPowerW({
        siteId: battery.siteId,
        telemetry: managedDeviceTelemetry,
      }),
    });

    if (scheduledStartSkipReason !== null) {
      logInfoWithVerboseDetails(
        verbose,
        scheduledStartSkipReason,
        `skipping strategy item for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
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

    const dynamicPriceTargetEstimate =
      item.targetMethod === "auto"
        ? estimateDynamicPriceTarget({
            battery,
            batteryPowerSamples: readBatteryPowerSamples(db, battery.siteId),
            dynamicPriceSamples,
            item,
            items: battery.strategyPlan,
            now,
            p1MeterSamples: readP1MeterSamples(db, battery.siteId),
            sample,
            solarEnergyProviderSamples: readSolarEnergyProviderSamples(
              db,
              battery.siteId,
            ),
            solarForecastSamples: readSolarForecastSamples(db, battery.siteId),
          })
        : null;

    if (dynamicPriceTargetEstimate?.warning) {
      logWarn(dynamicPriceTargetEstimate.warning);
    }

    if (dynamicPriceTargetEstimate?.skipReason) {
      logInfoWithVerboseDetails(
        verbose,
        dynamicPriceTargetEstimate.skipReason,
        `skipping strategy item for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
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

    const resolvedManualState = resolveActiveManualState({
      fallbackManualState: item.manualState,
      resolvedManualState: dynamicPriceTargetEstimate?.resolvedManualState,
      targetMethod: item.targetMethod,
    });

    const strategy = applyEstimatedTargetToStrategy(
      resolveBatteryStrategyFromPlanItem({
        item,
        minimumDischargePercent: battery.minimumDischargePercent,
        maximumChargePowerW: battery.maximumChargePowerW,
        maximumDischargePowerW: battery.maximumDischargePowerW,
      }),
      item,
      resolvedManualState,
      dynamicPriceTargetEstimate?.estimatedTargetPercent ?? null,
      battery.minimumDischargePercent,
      battery.maximumChargePowerW,
      battery.maximumDischargePowerW,
    );

    logVerbose(
      verbose,
      `activating strategy item for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, item)}`,
    );

    await createBatteryPlugin(battery).setStrategy(strategy);

    const nextRuntime = {
      activeItemId: needsCompletionTracking(item) ? item.id : null,
      activeResolvedManualState:
        needsCompletionTracking(item) && item.targetMethod === "auto"
          ? resolvedManualState
          : null,
      activeTargetSocPercent:
        needsCompletionTracking(item) && item.targetMethod === "auto"
          ? (dynamicPriceTargetEstimate?.estimatedTargetPercent ?? null)
          : null,
      activeReserveSocPercent:
        needsCompletionTracking(item) && item.targetMethod === "auto"
          ? (dynamicPriceTargetEstimate?.estimatedReservePercentAtTargetTime ??
            null)
          : null,
      activeTargetTime:
        needsCompletionTracking(item) && item.targetMethod === "auto"
          ? (dynamicPriceTargetEstimate?.targetTime ?? null)
          : null,
      activeStartedAt: needsCompletionTracking(item) ? now.toISOString() : null,
      activeObservedAt: null,
      activeStartSocPercent: needsCompletionTracking(item)
        ? sample.socPercent
        : null,
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

    if (!shouldWaitForObservedStart(item, resolvedManualState)) {
      logInfoWithVerboseDetails(
        verbose,
        formatScheduledStrategyStartedSummary(
          battery.id,
          item,
          "",
          dynamicPriceTargetEstimate
            ? {
                reasoning: dynamicPriceTargetEstimate.reasoning,
                resolvedManualState:
                  dynamicPriceTargetEstimate.resolvedManualState ?? null,
                targetSocPercent:
                  dynamicPriceTargetEstimate.estimatedTargetPercent,
                reserveSocPercent:
                  dynamicPriceTargetEstimate.estimatedReservePercentAtTargetTime,
                targetTime: dynamicPriceTargetEstimate.targetTime,
              }
            : null,
        ),
        `strategy item started for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, item)}`,
      );
    }

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

function applyEstimatedTargetToStrategy(
  strategy: ReturnType<typeof resolveBatteryStrategyFromPlanItem>,
  item: BatteryStrategyPlanItem,
  resolvedManualState: BatteryStrategyPlanItem["manualState"],
  estimatedTargetPercent: number | null,
  minimumDischargePercent: number,
  maximumChargePowerW: number,
  maximumDischargePowerW: number,
): ReturnType<typeof resolveBatteryStrategyFromPlanItem> {
  if (item.targetMethod !== "auto" || estimatedTargetPercent === null) {
    return strategy;
  }

  if (item.strategyMode === "self-consumption") {
    return strategy;
  }

  if (resolvedManualState === "charging") {
    return {
      ...strategy,
      manualChargeTargetSoc: estimatedTargetPercent,
      manualDischargeTargetSoc: null,
      manualPowerW: maximumChargePowerW,
      manualState: "charging",
      manualTargetSoc: estimatedTargetPercent,
    };
  }

  if (resolvedManualState === "discharging" || resolvedManualState === "idle") {
    const targetSoc = Math.max(minimumDischargePercent, estimatedTargetPercent);

    return {
      ...strategy,
      manualChargeTargetSoc: null,
      manualDischargeTargetSoc: targetSoc,
      manualPowerW:
        resolvedManualState === "discharging" ? maximumDischargePowerW : null,
      manualState: resolvedManualState,
      manualTargetSoc: targetSoc,
    };
  }

  return strategy;
}

function describeEstimatedRuntimeReasoning(
  runtime: BatteryRecord["strategyRuntime"],
): string {
  return runtime.activeTargetTime
    ? "recent site usage and predicted solar recovery"
    : "recent site usage";
}

function getFallbackStrategyPlanItem(
  battery: Pick<BatteryRecord, "id" | "strategyPlan">,
): BatteryStrategyPlanItem {
  const fallbackItem = battery.strategyPlan[0] ?? null;

  if (fallbackItem === null) {
    throw new Error(
      `battery ${battery.id} is missing a fallback strategy item`,
    );
  }

  return fallbackItem;
}

function describeStrategyPlanItemWithIndex(
  battery: BatteryRecord,
  item: BatteryStrategyPlanItem,
): string {
  const index = battery.strategyPlan.findIndex(
    (candidate) => candidate.id === item.id,
  );

  if (index === -1) {
    return `index=<missing> ${describeStrategyPlanItem(item)}`;
  }

  return `index=${index} ${describeStrategyPlanItem(item)}`;
}

function formatStrategyObservationDelay(
  activeStartedAt: string | null,
  observedAt: Date,
): string {
  if (!activeStartedAt) {
    return "";
  }

  const startedAt = new Date(activeStartedAt).getTime();

  if (Number.isNaN(startedAt)) {
    return "";
  }

  const delaySeconds = Math.max(
    0,
    Math.round((observedAt.getTime() - startedAt) / 1000),
  );

  return ` after ${delaySeconds}s`;
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
    maximumChargePowerW: battery.maximumChargePowerW,
    maximumDischargePowerW: battery.maximumDischargePowerW,
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

function createBatteryControlSnapshot(
  battery: BatteryRecord,
): BatteryControlSnapshot {
  return {
    manualSignature: JSON.stringify({
      strategyMode: battery.strategyMode,
      manualState: battery.manualState,
      manualPowerW: battery.manualPowerW,
      manualChargeTargetSoc: battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
      manualTargetSoc: battery.manualTargetSoc,
      manualModeActive: battery.manualModeActive,
    }),
    strategyPlanSignature: JSON.stringify(battery.strategyPlan),
  };
}

function logAppliedBatteryControlChanges(
  previous: BatteryControlSnapshot | undefined,
  battery: BatteryRecord,
  now: Date,
  verbose: boolean,
): void {
  if (!previous) {
    return;
  }

  const current = createBatteryControlSnapshot(battery);

  const manualChanged = previous.manualSignature !== current.manualSignature;
  const planChanged =
    previous.strategyPlanSignature !== current.strategyPlanSignature;
  let dynamicPriceSamples: ReturnType<typeof readDynamicPriceSamples> = [];

  if (
    battery.strategyPlan.some((item) =>
      isBatteryStrategyPriceTrigger(item.triggerKind),
    )
  ) {
    const db = openDaemonDatabase();

    try {
      dynamicPriceSamples = readDynamicPriceSamples(db, battery.siteId);
    } finally {
      db.close();
    }
  }

  if (planChanged) {
    logInfoWithVerboseDetails(
      verbose,
      formatStrategyPlanAppliedSummary(battery, now, dynamicPriceSamples),
      `strategy plan applied for ${battery.id}: default=${describeStrategyPlanItem(battery.strategyPlan[0])} pastToday=${describeTriggeredStrategyItemsBeforeNow(battery, now, dynamicPriceSamples)} nextToday=${describeNextStrategyItemForToday(battery, now, dynamicPriceSamples)}`,
    );
  }

  if (manualChanged && battery.manualModeActive) {
    logInfoWithVerboseDetails(
      verbose,
      formatManualStrategyAppliedSummary(battery),
      `manual strategy applied for ${battery.id}: ${describeCurrentBatteryStrategy(battery)}`,
    );
  }
}

function describeCurrentBatteryStrategy(battery: BatteryRecord): string {
  const parts = [
    `mode=${battery.strategyMode}`,
    `manualModeActive=${battery.manualModeActive}`,
  ];

  if (battery.manualState) {
    parts.push(`state=${battery.manualState}`);
  }

  if (battery.manualPowerW !== null) {
    parts.push(`powerW=${battery.manualPowerW}`);
  }

  if (battery.manualChargeTargetSoc !== null) {
    parts.push(`chargeSoc=${battery.manualChargeTargetSoc}`);
  }

  if (battery.manualDischargeTargetSoc !== null) {
    parts.push(`dischargeSoc=${battery.manualDischargeTargetSoc}`);
  }

  if (battery.manualTargetSoc !== null) {
    parts.push(`targetSoc=${battery.manualTargetSoc}`);
  }

  return parts.join(" ");
}

function describeTriggeredStrategyItemsBeforeNow(
  battery: BatteryRecord,
  now: Date,
  dynamicPriceSamples: ReturnType<typeof readDynamicPriceSamples> = [],
): string {
  const items = battery.strategyPlan.slice(1).flatMap((item) => {
    if (!item.enabled) {
      return [];
    }

    const triggerAt = getNextStrategyTriggerAt({
      item,
      now,
      dynamicPriceSamples,
    });

    if (
      triggerAt === null ||
      triggerAt.getTime() >= now.getTime() ||
      !isItemAlreadyTriggeredToday({
        runtime: battery.strategyRuntime,
        itemId: item.id,
        triggerAt,
      })
    ) {
      return [];
    }

    return [
      `${describeStrategyPlanItemWithIndex(battery, item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)}`,
    ];
  });

  return items.length > 0 ? items.join(" | ") : "none";
}

function describeNextStrategyItemForToday(
  battery: BatteryRecord,
  now: Date,
  dynamicPriceSamples: ReturnType<typeof readDynamicPriceSamples> = [],
): string {
  for (const item of battery.strategyPlan.slice(1)) {
    if (!item.enabled) {
      continue;
    }

    const triggerAt = getStrategyTriggerAt({ item, now, dynamicPriceSamples });

    if (
      triggerAt === null ||
      triggerAt.getTime() < now.getTime() ||
      isItemAlreadyTriggeredToday({
        runtime: battery.strategyRuntime,
        itemId: item.id,
        triggerAt,
      })
    ) {
      continue;
    }

    return `${describeStrategyPlanItemWithIndex(battery, item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)}`;
  }

  return "none";
}

function logVerbose(enabled: boolean, message: string): void {
  if (!enabled) {
    return;
  }

  console.log(`[${formatDaemonLogTimestamp()}] ${message}`);
}

function logInfoWithVerboseDetails(
  verbose: boolean,
  summary: string,
  details: string,
): void {
  logInfo(summary);
  logVerbose(verbose, details);
}

function logInfo(message: string): void {
  console.log(`[${formatDaemonLogTimestamp()}] ${message}`);
}

function logWarn(message: string): void {
  console.warn(`[${formatDaemonLogTimestamp()}] WARNING: ${message}`);
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
