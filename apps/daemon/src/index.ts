import type { Database } from "bun:sqlite";
import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  type BatteryRecord,
  type BatteryStrategyPlanItem,
  BatteryStrategyTriggerKind,
  type DynamicPriceSnapshotRecord,
  type DynamicPriceSourceRecord,
  EMSD_NAME,
  type ManagedDeviceTelemetryRecord,
  type NormalizedBatteryInfo,
  type SiteRecord,
  type WeatherForecastRecord,
  type WeatherForecastSourceRecord,
  acknowledgePendingBatteryStrategyPlan,
  clearActiveBatteryStrategyRuntime,
  ensureParentDirectory,
  formatBatteryStrategyDisplayState,
  formatBatteryStrategyTriggerKindLabel,
  getBatteryStrategyDisplayLabel,
  getBatteryStrategyDisplayState,
  getBatteryStrategyItemLabel,
  getDaemonLockPath,
  getDatabasePath,
  isBatteryStrategyPriceTrigger,
  isBatteryStrategyTriggerNeedingPriceSamples,
  isDelayedChargingAutoDischargeItem,
  resolveBatteryStrategyFromPlanItem,
  resolveEstimatedManualState,
} from "@emsd/core";
import { createBatteryPlugin } from "../../ems/src/battery-plugins";
import { fetchMeterTelemetry } from "../../ems/src/discover";
import { getDynamicPriceSnapshot } from "../../ems/src/plugins/price";
import {
  getSolarEnergyProviderNormalizedInfo,
  setSolarEnergyProviderProductionEnabled,
} from "../../ems/src/plugins/solar-energy-provider";
import { getWeatherForecast } from "../../ems/src/plugins/solar-forecast";
import { formatDaemonHelpText, parseDaemonOptions } from "./daemon-options";
import {
  type DaemonLogLevel,
  completeSolarEnergyProviderControlRequest,
  insertDaemonLog,
  markSolarEnergyProviderControlRequestRunning,
  openDaemonDatabase,
  queueSolarEnergyProviderControlRequest,
  readBatteries,
  readBatteryById,
  readBatteryPowerSamples,
  readDynamicPriceSamples,
  readDynamicPriceSnapshot,
  readDynamicPriceSources,
  readLatestSolarEnergyProviderControlRequests,
  readManagedDeviceTelemetry,
  readMeters,
  readP1MeterSamples,
  readPendingSolarEnergyProviderControlRequests,
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
  estimateDynamicPriceTarget,
  estimateImportShortageDynamicTarget,
  formatImportShortageDynamicTargetForLog,
} from "./dynamic-price-target";
import { resolveEffectiveSolarProductionControlStatus } from "./solar-production-control";
import {
  formatAutomaticStrategyAppliedSummary,
  formatFallbackStrategyRestoreSummary,
  formatManualStrategyAppliedSummary,
  formatScheduledStrategyCompletionSummary,
  formatScheduledStrategyStartedSummary,
  formatStrategyPlanAppliedSummary,
} from "./strategy-log";
import {
  describeStrategyPlanItem,
  formatDaemonLogTimestamp,
  formatScheduledItemCompletion,
  getDaemonTimeZoneLabel,
  getDelayedChargePrepSkipReason,
  getNextStrategyTriggerAt,
  getSameDayLowerPriorityBuiltInSuppressions,
  getScheduledItemCompletion,
  getSolarProductionControlDecision,
  getStrategyRuntimeTriggerAt,
  getStrategyTriggerAt,
  isDelayedChargePrepItem,
  isItemAlreadyTriggeredToday,
  needsCompletionTracking,
  shouldMarkScheduledItemObserved,
  shouldSkipScheduledItem,
  shouldWaitForObservedStart,
} from "./strategy-scheduler";
import {
  getCurrentSiteSolarPowerW,
  getScheduledStartSkipReason,
} from "./strategy-start-guard";

const lockPath = getDaemonLockPath();
const POLL_INTERVAL_MS = 5_000;
const FORECAST_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;
const DYNAMIC_PRICE_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;
const FORECAST_HOURS = 48;
const FORECAST_PERIOD_MINUTES = 15;

let daemonLogDb: Database | null = null;

class DaemonStartupError extends Error {}

interface BatteryControlSnapshot {
  manualModeActive: boolean;
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
  process.env.EMSD_VERBOSE = options.verbose ? "1" : "0";

  acquireDaemonLock();

  const db = openDaemonDatabase();
  daemonLogDb = db;
  const batteries = readBatteries(db);
  const meters = readMeters(db);
  const solarEnergyProviders = readSolarEnergyProviders(db);

  logInfo(`========== ${EMSD_NAME} daemon is starting ==========`);
  // logInfo(`SQLite database: ${getDatabasePath()}`);
  // logInfo(`Connected batteries: ${batteries.length}`);
  // logInfo(`Connected meters: ${meters.length}`);
  // logInfo(`Connected solar energy providers: ${solarEnergyProviders.length}`);
  // logInfo(`Daemon local time zone: ${getDaemonTimeZoneLabel()}`);
  // logInfo(`Polling managed devices every ${POLL_INTERVAL_MS / 1000} seconds.`);
  // logInfo(
  //   `Refreshing solar forecasts at most every ${FORECAST_REFRESH_INTERVAL_MS / 60_000} minutes.`,
  // );
  // logInfo(
  //   `Refreshing dynamic prices at most every ${DYNAMIC_PRICE_REFRESH_INTERVAL_MS / 60_000} minutes.`,
  // );

  let pollInFlight = false;
  let refreshInFlight = false;
  const observedBatteryControls = new Map(
    batteries.map((battery) => [
      battery.id,
      createBatteryControlSnapshot(battery),
    ]),
  );

  function observeBatteryControlChanges(
    currentBatteries: BatteryRecord[],
    now: Date,
    verbose = options.verbose,
  ): void {
    for (const battery of currentBatteries) {
      logAppliedBatteryControlChanges(
        db,
        observedBatteryControls.get(battery.id),
        battery,
        now,
        verbose,
      );
      observedBatteryControls.set(
        battery.id,
        createBatteryControlSnapshot(battery),
      );
    }

    for (const batteryId of observedBatteryControls.keys()) {
      if (!currentBatteries.some((battery) => battery.id === batteryId)) {
        observedBatteryControls.delete(batteryId);
      }
    }
  }

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
      await processPendingSolarEnergyProviderControlRequests(
        db,
        options.verbose,
      );

      const polledBatteries = readBatteries(db);
      const polledMeters = readMeters(db);
      const pollStartedAt = new Date();
      const polledSolarEnergyProviders = readSolarEnergyProviders(db);

      observeBatteryControlChanges(polledBatteries, pollStartedAt);

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
                const nextRuntime = acknowledgePendingBatteryStrategyPlan(
                  clearActiveBatteryStrategyRuntime(battery.strategyRuntime),
                  pollStartedAt,
                );

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
                  strategyRuntime: nextRuntime,
                });
              })
              .catch((error: unknown) => {
                logError(
                  `failed to restore default strategy for ${battery.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
              });
          }

          const scheduledBattery =
            readBatteryById(db, battery.siteId, battery.id) ?? battery;
          const scheduledSample =
            sample.capacityWh === null
              ? {
                  ...sample,
                  capacityWh:
                    readManagedDeviceTelemetry(db).find(
                      (telemetry) =>
                        telemetry.kind === "battery" &&
                        telemetry.deviceId === battery.id,
                    )?.capacityWh ?? null,
                }
              : sample;

          if (!scheduledBattery.manualModeActive) {
            await runIndependentSolarProductionControlStrategy(
              db,
              scheduledBattery,
              new Date(),
              options.verbose,
            );
          } else {
            logVerbose(
              options.verbose,
              `skipping independent solar production control for ${scheduledBattery.id} because manual mode is active`,
            );
          }

          if (!scheduledBattery.manualModeActive) {
            await runScheduledStrategy(
              db,
              scheduledBattery,
              scheduledSample,
              new Date(),
              options.verbose,
            );
          } else {
            logVerbose(
              options.verbose,
              `skipping scheduled strategy for ${scheduledBattery.id} because manual mode is active`,
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
            productionControlStatus: null,
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
            productionControlStatus: null,
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
            productionControlStatus: sample.productionControlStatus,
            socPercent: null,
            state: sample.status,
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
  // logInfo("Polling solar forecasts at startup...");
  void refreshSiteData(true);
  // logInfo("Polling dynamic prices at startup...");

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

async function processPendingSolarEnergyProviderControlRequests(
  db: ReturnType<typeof openDaemonDatabase>,
  verbose: boolean,
): Promise<void> {
  const pendingRequests = readPendingSolarEnergyProviderControlRequests(db);

  if (pendingRequests.length === 0) {
    return;
  }

  const providers = readSolarEnergyProviders(db);

  for (const request of pendingRequests) {
    const provider = providers.find(
      (entry) =>
        entry.id === request.providerId && entry.siteId === request.siteId,
    );
    const updatedAt = new Date().toISOString();

    if (!provider) {
      completeSolarEnergyProviderControlRequest(db, {
        message: `Managed solar energy provider not found: ${request.providerId}`,
        requestId: request.id,
        status: "failed",
        updatedAt,
      });
      continue;
    }

    markSolarEnergyProviderControlRequestRunning(db, request.id, updatedAt);
    const targetState = request.requestedEnabled ? "enabled" : "disabled";
    logInfoWithVerboseDetails(
      verbose,
      `processing solar production control request for ${provider.id}: targetState=${targetState}`,
      `processing solar production control request for ${provider.id} at ${provider.ipAddress}: targetState=${targetState}`,
    );

    await setSolarEnergyProviderProductionEnabled(
      provider,
      request.requestedEnabled,
    )
      .then(() => {
        completeSolarEnergyProviderControlRequest(db, {
          message: null,
          requestId: request.id,
          status: "completed",
          updatedAt: new Date().toISOString(),
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        logError(
          `solar production control request failed for ${provider.id}: ${message}`,
        );
        completeSolarEnergyProviderControlRequest(db, {
          message,
          requestId: request.id,
          status: "failed",
          updatedAt: new Date().toISOString(),
        });
      });
  }
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
      !shouldRefreshDynamicPrice(cachedSnapshot, source, new Date())
    ) {
      continue;
    }

    try {
      const snapshot = await getDynamicPriceSnapshot({ site, source });
      upsertDynamicPriceSnapshot(db, site.id, snapshot);
      logVerbose(verbose, `refreshed price snapshot for ${site.id}`);
    } catch (error) {
      logError(
        `price refresh failed for ${site.id}: ${error instanceof Error ? error.message : String(error)}`,
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
  source: DynamicPriceSourceRecord,
  now: Date,
): boolean {
  if (snapshot === null) {
    return true;
  }

  const generatedAt = new Date(snapshot.generatedAt).getTime();

  if (Number.isNaN(generatedAt)) {
    return true;
  }

  if (snapshot.provider !== source.provider) {
    return true;
  }

  if (snapshot.sourceUpdatedAt !== source.updatedAt) {
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
    itemLabel: getBatteryStrategyItemLabel(battery),
    manualState: battery.manualState,
    observedAt,
    siteId: battery.siteId,
    source: battery.manualModeActive ? "manual" : "automatic",
    startedAt: observedAt,
    strategyMode: battery.strategyMode,
  };
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
  const dueItems = battery.strategyPlan
    .slice(1)
    .filter(
      (item) =>
        item.enabled &&
        item.triggerKind !== BatteryStrategyTriggerKind.SolarProductionControl,
    );
  const dynamicPriceSamples = dueItems.some((item) =>
    isBatteryStrategyTriggerNeedingPriceSamples(item.triggerKind),
  )
    ? readDynamicPriceSamples(db, battery.siteId)
    : [];
  const dynamicPriceSources =
    dynamicPriceSamples.length > 0 ? readDynamicPriceSources(db) : [];
  const managedDeviceTelemetry = readManagedDeviceTelemetry(db);
  let runtime = battery.strategyRuntime;
  let batteryPowerSamples: ReturnType<typeof readBatteryPowerSamples> | null =
    null;
  let p1MeterSamples: ReturnType<typeof readP1MeterSamples> | null = null;
  let solarEnergyProviderSamples: ReturnType<
    typeof readSolarEnergyProviderSamples
  > | null = null;
  let solarForecastSamples: ReturnType<typeof readSolarForecastSamples> | null =
    null;
  const dynamicPriceTargetEstimates = new Map<
    string,
    ReturnType<typeof estimateDynamicPriceTarget>
  >();
  const warnedDynamicPriceItems = new Set<string>();

  const getBatteryPowerSamples = () => {
    if (batteryPowerSamples === null) {
      batteryPowerSamples = readBatteryPowerSamples(db, battery.siteId);
    }

    return batteryPowerSamples;
  };
  const getP1MeterSamples = () => {
    if (p1MeterSamples === null) {
      p1MeterSamples = readP1MeterSamples(db, battery.siteId);
    }

    return p1MeterSamples;
  };
  const getSolarEnergyProviderSamples = () => {
    if (solarEnergyProviderSamples === null) {
      solarEnergyProviderSamples = readSolarEnergyProviderSamples(
        db,
        battery.siteId,
      );
    }

    return solarEnergyProviderSamples;
  };
  const getSolarForecastSamples = () => {
    if (solarForecastSamples === null) {
      solarForecastSamples = readSolarForecastSamples(db, battery.siteId);
    }

    return solarForecastSamples;
  };
  const getDynamicPriceTargetEstimate = (item: BatteryStrategyPlanItem) => {
    if (item.targetMethod !== "auto" || isDelayedChargePrepItem(item)) {
      return null;
    }

    const cachedEstimate = dynamicPriceTargetEstimates.get(item.id);

    if (cachedEstimate) {
      return cachedEstimate;
    }

    const estimate = estimateDynamicPriceTarget({
      battery,
      batteryPowerSamples: getBatteryPowerSamples(),
      dynamicPriceSamples,
      item,
      items: battery.strategyPlan,
      now,
      normalizedImportExportSpread: resolveNormalizedImportExportSpread(
        dynamicPriceSources,
        battery.siteId,
      ),
      p1MeterSamples: getP1MeterSamples(),
      sample,
      solarEnergyProviderSamples: getSolarEnergyProviderSamples(),
      solarForecastSamples: getSolarForecastSamples(),
    });

    dynamicPriceTargetEstimates.set(item.id, estimate);

    if (estimate.warning && !warnedDynamicPriceItems.has(item.id)) {
      warnedDynamicPriceItems.add(item.id);
      logWarn(estimate.warning);
    }

    return estimate;
  };
  const getDelayedChargePrepActivationSkipReason = (
    item: BatteryStrategyPlanItem,
    index: number,
  ): string | null => {
    const delayedChargingItem = battery.strategyPlan
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.enabled && isDelayedChargingAutoDischargeItem(candidate),
      );

    if (!delayedChargingItem) {
      return `skipped: no paired delayed charging item resolved for delayed-charge prep item ${item.id}`;
    }

    const delayedChargingEstimate =
      getDynamicPriceTargetEstimate(delayedChargingItem);

    return getDelayedChargePrepSkipReason({
      delayedChargingItemId: delayedChargingItem.id,
      delayedChargingMarkerTime: delayedChargingEstimate?.targetTime ?? null,
      delayedChargingSkipReason: delayedChargingEstimate?.skipReason ?? null,
      delayedChargingStartTime: delayedChargingEstimate?.startTime ?? null,
      currentSocPercent: sample.socPercent,
      now,
      prepItemId: item.id,
      runtime,
    });
  };

  const resolveScheduledActivationCandidate = (
    minimumPlanIndex: number,
    bypassExportSurplusGuard?: boolean,
  ): {
    dynamicPriceTargetEstimate: ReturnType<
      typeof estimateDynamicPriceTarget
    > | null;
    item: BatteryStrategyPlanItem;
    resolvedManualState: BatteryStrategyPlanItem["manualState"];
    runtimeTriggerAt: Date;
    triggerAt: Date;
  } | null => {
    for (
      let index = battery.strategyPlan.length - 1;
      index >= minimumPlanIndex;
      index -= 1
    ) {
      const item = battery.strategyPlan[index];

      if (!item || !item.enabled) {
        continue;
      }

      if (
        isDelayedChargePrepItem(item) &&
        !bypassExportSurplusGuard &&
        activeItem?.triggerKind === BatteryStrategyTriggerKind.ExportSurplus
      ) {
        logVerbose(
          verbose,
          `delayed-charge prep waiting for export surplus to complete for ${battery.id}: ${describeStrategyPlanItem(item)}`,
        );
        continue;
      }

      let triggerAt = getStrategyTriggerAt({
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

      let dynamicPriceTargetEstimate =
        item.targetMethod === "auto" && isDelayedChargingAutoDischargeItem(item)
          ? getDynamicPriceTargetEstimate(item)
          : null;

      if (item.triggerKind === BatteryStrategyTriggerKind.ImportShortage) {
        dynamicPriceTargetEstimate = estimateImportShortageDynamicTarget({
          battery,
          batteryPowerSamples: getBatteryPowerSamples(),
          lowPriceMarkerTime: triggerAt,
          now,
          p1MeterSamples: getP1MeterSamples(),
          sample,
          solarEnergyProviderSamples: getSolarEnergyProviderSamples(),
          solarForecastSamples: getSolarForecastSamples(),
        });
      }

      if (dynamicPriceTargetEstimate?.startTime) {
        const delayedChargingStartTime = new Date(
          dynamicPriceTargetEstimate.startTime,
        );

        if (!Number.isNaN(delayedChargingStartTime.getTime())) {
          triggerAt = delayedChargingStartTime;
        }
      }

      const runtimeTriggerAt = getStrategyRuntimeTriggerAt({
        item,
        targetTime: dynamicPriceTargetEstimate?.targetTime ?? null,
        triggerAt,
      });

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
          triggerAt: runtimeTriggerAt,
        })
      ) {
        logVerbose(
          verbose,
          `strategy item already triggered today for ${battery.id}: ${describeStrategyPlanItem(item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)}`,
        );
        continue;
      }

      const importShortageTargetAt =
        item.triggerKind === BatteryStrategyTriggerKind.ImportShortage &&
        dynamicPriceTargetEstimate?.targetTime
          ? new Date(dynamicPriceTargetEstimate.targetTime)
          : null;
      const scheduledItemExpired =
        importShortageTargetAt !== null &&
        !Number.isNaN(importShortageTargetAt.getTime())
          ? shouldSkipScheduledItem(item, importShortageTargetAt, now)
          : shouldSkipScheduledItem(item, runtimeTriggerAt, now);

      if (scheduledItemExpired) {
        logVerbose(
          verbose,
          `skipping expired strategy item for ${battery.id}: ${describeStrategyPlanItem(item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
        );
        runtime = {
          ...runtime,
          lastTriggeredAtByItemId: {
            ...runtime.lastTriggeredAtByItemId,
            [item.id]: runtimeTriggerAt.toISOString(),
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
            [item.id]: runtimeTriggerAt.toISOString(),
          },
        };
        updateBatteryStrategyRuntime(db, {
          batteryId: battery.id,
          siteId: battery.siteId,
          strategyRuntime: runtime,
        });
        continue;
      }

      if (isDelayedChargePrepItem(item)) {
        const skipReason = getDelayedChargePrepActivationSkipReason(
          item,
          index,
        );

        if (skipReason !== null) {
          logInfoWithVerboseDetails(
            verbose,
            skipReason,
            `skipping strategy item for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
          );
          runtime = {
            ...runtime,
            lastTriggeredAtByItemId: {
              ...runtime.lastTriggeredAtByItemId,
              [item.id]: runtimeTriggerAt.toISOString(),
            },
          };
          updateBatteryStrategyRuntime(db, {
            batteryId: battery.id,
            siteId: battery.siteId,
            strategyRuntime: runtime,
          });
          continue;
        }
      }

      dynamicPriceTargetEstimate ??= getDynamicPriceTargetEstimate(item);

      if (dynamicPriceTargetEstimate?.skipReason) {
        if (
          !dynamicPriceTargetEstimate.skipReason.startsWith(
            "skipped: no net solar charge expected",
          )
        ) {
          logInfoWithVerboseDetails(
            verbose,
            dynamicPriceTargetEstimate.skipReason,
            `skipping strategy item for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, item)} triggerAt=${formatDaemonLogTimestamp(triggerAt)} now=${formatDaemonLogTimestamp(now)}`,
          );
        }
        runtime = {
          ...runtime,
          lastTriggeredAtByItemId: {
            ...runtime.lastTriggeredAtByItemId,
            [item.id]: runtimeTriggerAt.toISOString(),
          },
        };
        updateBatteryStrategyRuntime(db, {
          batteryId: battery.id,
          siteId: battery.siteId,
          strategyRuntime: runtime,
        });
        continue;
      }

      return {
        dynamicPriceTargetEstimate,
        item,
        resolvedManualState: resolveEstimatedManualState({
          fallbackManualState: item.manualState,
          resolvedManualState: dynamicPriceTargetEstimate?.resolvedManualState,
          targetMethod: item.targetMethod,
        }),
        runtimeTriggerAt,
        triggerAt,
      };
    }

    return null;
  };

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

  const activeItemIndex = activeItem
    ? battery.strategyPlan.findIndex((item) => item.id === activeItem.id)
    : -1;
  // While a non-default item is active, lower-priority items are blocked.
  // Only higher-index items may preempt the current active item.
  const higherPriorityCandidate =
    activeItemIndex >= 1
      ? resolveScheduledActivationCandidate(activeItemIndex + 1)
      : null;

  if (activeItem && higherPriorityCandidate === null) {
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
                details: runtime.activeEstimateDetails ?? null,
                resolvedManualState: runtime.activeResolvedManualState ?? null,
                targetSocPercent: runtime.activeTargetSocPercent,
                reserveSocPercent: runtime.activeReserveSocPercent ?? 0,
                recoveryTime: runtime.activeRecoveryTime ?? null,
                targetTime: runtime.activeTargetTime ?? null,
              }
            : null,
        ),
        `strategy item started for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, activeItem)}${observedDelay}`,
      );
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

    if (activeItem.triggerKind === BatteryStrategyTriggerKind.ExportSurplus) {
      const prepCandidate = resolveScheduledActivationCandidate(
        activeItemIndex + 1,
        true,
      );

      if (
        prepCandidate !== null &&
        isDelayedChargePrepItem(prepCandidate.item)
      ) {
        logInfoWithVerboseDetails(
          verbose,
          `export surplus completed for ${battery.id}, activating delayed-charge prep`,
          `export surplus completed for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, activeItem)}, activating ${describeStrategyPlanItemWithIndex(battery, prepCandidate.item)}`,
        );
        const prepStrategy = applyEstimatedTargetToStrategy(
          resolveBatteryStrategyFromPlanItem({
            item: prepCandidate.item,
            minimumDischargePercent: battery.minimumDischargePercent,
            maximumChargePowerW: battery.maximumChargePowerW,
            maximumDischargePowerW: battery.maximumDischargePowerW,
          }),
          prepCandidate.item,
          prepCandidate.resolvedManualState,
          prepCandidate.dynamicPriceTargetEstimate?.estimatedTargetPercent ??
            null,
          battery.minimumDischargePercent,
          battery.maximumChargePowerW,
          battery.maximumDischargePowerW,
        );

        await createBatteryPlugin(battery).setStrategy(prepStrategy);

        const appliedAt = new Date();
        const prepRuntime = acknowledgePendingBatteryStrategyPlan(
          {
            activeItemId: needsCompletionTracking(prepCandidate.item)
              ? prepCandidate.item.id
              : null,
            activeResolvedManualState:
              needsCompletionTracking(prepCandidate.item) &&
              prepCandidate.item.targetMethod === "auto"
                ? prepCandidate.resolvedManualState
                : null,
            activeTargetSocPercent:
              needsCompletionTracking(prepCandidate.item) &&
              prepCandidate.item.targetMethod === "auto"
                ? (prepCandidate.dynamicPriceTargetEstimate
                    ?.estimatedTargetPercent ?? null)
                : null,
            activeReserveSocPercent:
              needsCompletionTracking(prepCandidate.item) &&
              prepCandidate.item.targetMethod === "auto"
                ? (prepCandidate.dynamicPriceTargetEstimate
                    ?.estimatedReservePercentAtTargetTime ?? null)
                : null,
            activeTargetTime:
              needsCompletionTracking(prepCandidate.item) &&
              prepCandidate.item.targetMethod === "auto"
                ? (prepCandidate.dynamicPriceTargetEstimate?.targetTime ?? null)
                : null,
            activeEstimateDetails:
              needsCompletionTracking(prepCandidate.item) &&
              prepCandidate.item.targetMethod === "auto" &&
              prepCandidate.dynamicPriceTargetEstimate
                ? formatImportShortageDynamicTargetForLog(
                    prepCandidate.dynamicPriceTargetEstimate,
                  )
                : null,
            activeStartedAt: needsCompletionTracking(prepCandidate.item)
              ? appliedAt.toISOString()
              : null,
            activeObservedAt: null,
            activeStartSocPercent: needsCompletionTracking(prepCandidate.item)
              ? sample.socPercent
              : null,
            lastTriggeredAtByItemId: {
              ...runtime.lastTriggeredAtByItemId,
              [prepCandidate.item.id]: prepCandidate.triggerAt.toISOString(),
            },
          },
          appliedAt,
        );

        updateBatteryStrategyState(db, {
          batteryId: battery.id,
          siteId: battery.siteId,
          manualModeActive: false,
          manualModeStarted: false,
          strategy: prepStrategy,
        });
        updateBatteryStrategyRuntime(db, {
          batteryId: battery.id,
          siteId: battery.siteId,
          strategyRuntime: prepRuntime,
        });

        logInfoWithVerboseDetails(
          verbose,
          `delayed-charge prep active for ${battery.id}`,
          `delayed-charge prep started for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, prepCandidate.item)}`,
        );
        return;
      }
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
  const activationCandidate =
    higherPriorityCandidate ?? resolveScheduledActivationCandidate(1);

  if (activationCandidate === null) {
    if (runtime.pendingPlanSavedAt !== null) {
      const fallbackItem = getFallbackStrategyPlanItem(battery);
      const fallbackStrategy = resolveBatteryStrategyFromPlanItem({
        item: fallbackItem,
        minimumDischargePercent: battery.minimumDischargePercent,
        maximumChargePowerW: battery.maximumChargePowerW,
        maximumDischargePowerW: battery.maximumDischargePowerW,
      });
      const nextRuntime = acknowledgePendingBatteryStrategyPlan(
        clearActiveBatteryStrategyRuntime(runtime),
        now,
      );

      logVerbose(
        verbose,
        `applying pending fallback strategy for ${battery.id}: ${describeStrategyPlanItem(fallbackItem)}`,
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
        strategyRuntime: nextRuntime,
      });
    }

    return;
  }

  const {
    dynamicPriceTargetEstimate,
    item,
    resolvedManualState,
    runtimeTriggerAt,
    triggerAt,
  } = activationCandidate;

  if (activeItem) {
    logInfoWithVerboseDetails(
      verbose,
      `preempting ${describeStrategyPlanItemWithIndex(battery, activeItem)} with ${describeStrategyPlanItemWithIndex(battery, item)}`,
      `canceling active strategy item for ${battery.id}: ${describeStrategyPlanItemWithIndex(battery, activeItem)} because higher-index item wants to activate ${describeStrategyPlanItemWithIndex(battery, item)}`,
    );
  }

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

  const nextRuntime = acknowledgePendingBatteryStrategyPlan(
    {
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
      activeRecoveryTime:
        needsCompletionTracking(item) && item.targetMethod === "auto"
          ? dynamicPriceTargetEstimate?.delayedChargingDetails
            ? new Date(
                new Date(
                  dynamicPriceTargetEstimate.delayedChargingDetails
                    .lowPriceMarkerTime,
                ).getTime() +
                  dynamicPriceTargetEstimate.delayedChargingDetails
                    .timeToFullMinutes *
                    60_000,
              ).toISOString()
            : null
          : null,
      activeEstimateDetails:
        needsCompletionTracking(item) &&
        item.targetMethod === "auto" &&
        dynamicPriceTargetEstimate
          ? formatImportShortageDynamicTargetForLog(dynamicPriceTargetEstimate)
          : null,
      activeStartedAt: needsCompletionTracking(item) ? now.toISOString() : null,
      activeObservedAt: null,
      activeStartSocPercent: needsCompletionTracking(item)
        ? sample.socPercent
        : null,
      lastTriggeredAtByItemId: {
        ...runtime.lastTriggeredAtByItemId,
        ...getSameDayLowerPriorityBuiltInSuppressions({
          battery,
          item,
          now,
        }),
        [item.id]: runtimeTriggerAt.toISOString(),
      },
    },
    now,
  );

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
              details:
                formatImportShortageDynamicTargetForLog(
                  dynamicPriceTargetEstimate,
                ) ?? null,
              resolvedManualState:
                dynamicPriceTargetEstimate.resolvedManualState ?? null,
              recoveryTime: dynamicPriceTargetEstimate.delayedChargingDetails
                ? new Date(
                    new Date(
                      dynamicPriceTargetEstimate.delayedChargingDetails
                        .lowPriceMarkerTime,
                    ).getTime() +
                      dynamicPriceTargetEstimate.delayedChargingDetails
                        .timeToFullMinutes *
                        60_000,
                  ).toISOString()
                : null,
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

async function runIndependentSolarProductionControlStrategy(
  db: ReturnType<typeof openDaemonDatabase>,
  battery: BatteryRecord,
  now: Date,
  verbose: boolean,
): Promise<void> {
  const item =
    battery.strategyPlan.find(
      (entry) =>
        entry.enabled &&
        entry.triggerKind === BatteryStrategyTriggerKind.SolarProductionControl,
    ) ?? null;

  if (item === null) {
    return;
  }

  const dynamicPriceSamples = readDynamicPriceSamples(db, battery.siteId);
  const normalizedImportExportSpread = resolveNormalizedImportExportSpread(
    readDynamicPriceSources(db),
    battery.siteId,
  );
  const decision = getSolarProductionControlDecision({
    item,
    now,
    dynamicPriceSamples,
    normalizedImportExportSpread,
  });

  if (decision === null) {
    logVerbose(
      verbose,
      `solar production control has no active price decision for ${battery.id}`,
    );
    return;
  }

  if (
    isItemAlreadyTriggeredToday({
      runtime: battery.strategyRuntime,
      itemId: item.id,
      triggerAt: decision.triggerAt,
    })
  ) {
    return;
  }

  const providers = readSolarEnergyProviders(db).filter(
    (provider) => provider.siteId === battery.siteId && provider.enabled,
  );

  if (providers.length === 0) {
    logVerbose(
      verbose,
      `solar production control has no enabled providers for ${battery.id}`,
    );
    return;
  }

  const telemetry = readManagedDeviceTelemetry(db);
  const latestControlRequestsByProvider = new Map(
    readLatestSolarEnergyProviderControlRequests(db).map((request) => [
      `${request.siteId}:${request.providerId}`,
      request,
    ]),
  );
  let processedProviderCount = 0;

  for (const provider of providers) {
    const providerTelemetry =
      telemetry.find(
        (entry) =>
          entry.kind === "solar-energy-provider" &&
          entry.deviceId === provider.id,
      ) ?? null;
    const latestControlRequest =
      latestControlRequestsByProvider.get(
        `${provider.siteId}:${provider.id}`,
      ) ?? null;
    const currentStatus = resolveEffectiveSolarProductionControlStatus(
      providerTelemetry,
      latestControlRequest,
    );

    processedProviderCount += 1;
    const currentlyEnabled = currentStatus === "enabled";

    if (currentlyEnabled === decision.desiredEnabled) {
      continue;
    }

    queueSolarEnergyProviderControlRequest(db, {
      providerId: provider.id,
      requestedAt: now.toISOString(),
      requestedEnabled: decision.desiredEnabled,
      siteId: provider.siteId,
    });

    logInfoWithVerboseDetails(
      verbose,
      `queued solar production ${decision.desiredEnabled ? "enable" : "disable"} for ${provider.id} because export price is ${decision.exportPrice.toFixed(3)}`,
      `queued independent solar production control for ${provider.id}: importPrice=${decision.importPrice.toFixed(3)} exportPrice=${decision.exportPrice.toFixed(3)} triggerAt=${decision.triggerAt.toISOString()}`,
    );
  }

  if (processedProviderCount === 0) {
    return;
  }

  updateBatteryStrategyRuntime(db, {
    batteryId: battery.id,
    siteId: battery.siteId,
    strategyRuntime: {
      ...battery.strategyRuntime,
      lastTriggeredAtByItemId: {
        ...battery.strategyRuntime.lastTriggeredAtByItemId,
        [item.id]: decision.triggerAt.toISOString(),
      },
    },
  });
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

  if (
    isDelayedChargingAutoDischargeItem(item) &&
    resolvedManualState === null
  ) {
    return {
      strategyMode: "self-consumption",
      manualState: null,
      manualPowerW: null,
      manualTargetSoc: 100,
      manualChargeTargetSoc: 100,
      manualDischargeTargetSoc: minimumDischargePercent,
    };
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

  const appliedAt = new Date();
  const completedItem = battery.strategyPlan.find(
    (item) => item.id === completedItemId,
  );
  const completedRuntimeTriggeredAt =
    completedItem &&
    isDelayedChargingAutoDischargeItem(completedItem) &&
    battery.strategyRuntime.activeTargetTime &&
    !Number.isNaN(new Date(battery.strategyRuntime.activeTargetTime).getTime())
      ? battery.strategyRuntime.activeTargetTime
      : (battery.strategyRuntime.lastTriggeredAtByItemId[completedItemId] ??
        appliedAt.toISOString());
  const nextRuntime = acknowledgePendingBatteryStrategyPlan(
    {
      ...clearActiveBatteryStrategyRuntime(battery.strategyRuntime),
      lastTriggeredAtByItemId: {
        ...battery.strategyRuntime.lastTriggeredAtByItemId,
        [completedItemId]: completedRuntimeTriggeredAt,
      },
    },
    appliedAt,
  );

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
    strategyRuntime: nextRuntime,
  });
}

function createBatteryControlSnapshot(
  battery: BatteryRecord,
): BatteryControlSnapshot {
  return {
    manualModeActive: battery.manualModeActive,
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
  db: ReturnType<typeof openDaemonDatabase>,
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
      isBatteryStrategyTriggerNeedingPriceSamples(item.triggerKind),
    )
  ) {
    dynamicPriceSamples = readDynamicPriceSamples(db, battery.siteId);
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

  if (manualChanged && !battery.manualModeActive && previous.manualModeActive) {
    logInfoWithVerboseDetails(
      verbose,
      formatAutomaticStrategyAppliedSummary(battery),
      `scheduled automation applied for ${battery.id}: ${describeCurrentBatteryStrategy(battery)}`,
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

function resolveNormalizedImportExportSpread(
  sources: DynamicPriceSourceRecord[],
  siteId: string,
): number | null {
  const source = sources.find((entry) => entry.siteId === siteId) ?? null;

  return source?.exportDeduction ?? null;
}

function logVerbose(enabled: boolean, message: string): void {
  if (!enabled) {
    return;
  }

  writeDaemonLog("verbose", message);
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
  writeDaemonLog("info", message);
}

function logWarn(message: string): void {
  writeDaemonLog("warn", message);
}

function logError(message: string): void {
  writeDaemonLog("error", message);
}

function writeDaemonLog(level: DaemonLogLevel, message: string): void {
  const loggedAt = new Date();
  const timestamp = formatDaemonLogTimestamp(loggedAt);

  if (level === "warn") {
    console.warn(`[daemon] [${timestamp}] WARNING: ${message}`);
  } else if (level === "error") {
    console.error(`[daemon] [${timestamp}] ${message}`);
  } else {
    console.log(`[daemon] [${timestamp}] ${message}`);
  }

  if (daemonLogDb === null) {
    return;
  }

  try {
    insertDaemonLog(daemonLogDb, {
      level,
      message,
      loggedAt: loggedAt.toISOString(),
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(
      `[daemon] [${timestamp}] Failed to store daemon log: ${details}`,
    );
  }
}

try {
  main();
} catch (error) {
  if (error instanceof DaemonStartupError) {
    console.error(`[daemon] ${error.message}`);
    process.exit(1);
  }

  throw error;
}
