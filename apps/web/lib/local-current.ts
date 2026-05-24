import type {
  DynamicPriceSnapshotRecord,
  HistoryArchive,
  ManagedDeviceStatusRecord,
  WeatherForecastRecord,
} from "@emsd/core";
import {
  PRICE_SELECTION_WINDOW_MS,
  findPriceSelections,
  findSolarSurplusBoundsFromSeries,
} from "@emsd/core";
import {
  getDynamicPriceSnapshot,
  getHistoryArchive,
  getLiveStatus,
  getWeatherForecast,
} from "./ems-bridge";
import { computeExportPrice } from "./price-format";

const DYNAMIC_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const WEATHER_FORECAST_CACHE_TTL_MS = 5 * 60 * 1000;
const DERIVED_MARKERS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const dynamicPriceSnapshotCache = new Map<
  string,
  CacheEntry<DynamicPriceSnapshotRecord | null>
>();
const weatherForecastCache = new Map<
  string,
  CacheEntry<WeatherForecastRecord | null>
>();
const derivedMarkersCache = new Map<
  string,
  CacheEntry<LocalApiDerivedMarkers>
>();

export interface LocalApiCurrentResponse {
  schema: "ems.local.current.v1";
  generatedAt: string;
  daemonRunning?: boolean;
  site?: {
    id: string;
    name: string;
    location: string;
  } | null;
  summary: LocalApiSummary;
  derivedMarkers?: LocalApiDerivedMarkers;
  pricing?: LocalApiPricing;
  solarForecast?: LocalApiSolarForecast;
  devices?: LocalApiDevices;
}

export interface LocalApiSummary {
  currentImportPrice: number | null;
  currentExportPrice: number | null;
  currentImportPriceReduction: number | null;
  currentImportPriceCurrency: string | null;
  currentImportPriceStartsAt: string | null;
  currentExportPriceIsNegative: boolean;
  currentForecastSolarPowerW: number | null;
  totalBatterySocPercent: number | null;
  totalBatteryPowerW: number | null;
  batteryStrategySummary: string | null;
  totalSolarPowerW: number | null;
  totalMeterPowerW: number | null;
}

export interface LocalApiDerivedPriceMarker {
  startsAt: string;
  importPrice: number;
}

export interface LocalApiDerivedMarkers {
  todayLowPriceMarkerStartsAt: string | null;
  todayLowPriceMarkerImportPrice: number | null;
  todayLowPriceMarkers: LocalApiDerivedPriceMarker[];
  todayHighPriceMarkerStartsAt: string | null;
  todayHighPriceMarkerImportPrice: number | null;
  todayHighPriceMarkers: LocalApiDerivedPriceMarker[];
  solarSurplusStartAt: string | null;
  solarSurplusEndAt: string | null;
}

export interface LocalApiTimingBreakdown {
  authMs?: number;
  filterMs?: number;
  liveStatusMs?: number;
  dynamicPriceSnapshotMs?: number;
  weatherForecastMs?: number;
  deviceGroupingAndComputeMs?: number;
  historyArchiveMs?: number;
  responseBuildMs?: number;
  derivedMarkersMs?: number;
  responseJsonMs?: number;
}

export interface LocalApiPricing {
  current: {
    startsAt: string;
    importPrice: number;
    exportPrice: number;
    importPriceReduction: number;
    currency: string;
  } | null;
  upcoming: Array<{
    startsAt: string;
    importPrice: number;
    exportPrice: number;
    importPriceReduction: number;
    currency: string;
  }>;
}

export interface LocalApiSolarForecast {
  generatedAt: string | null;
  periodMinutes: number | null;
  provider: string | null;
  providerLabel: string | null;
  current: {
    period: string;
    periodEnd: string;
    value: number;
  } | null;
  upcoming: Array<{
    period: string;
    periodEnd: string;
    value: number | null;
  }>;
}

export interface LocalApiDevices {
  batteries: LocalApiBatteryDevice[];
  meters: LocalApiMeterDevice[];
  solarEnergyProviders: LocalApiSolarDevice[];
}

export interface LocalApiBatteryDevice {
  id: string;
  name: string;
  model: string;
  address: string;
  enabled: boolean;
  connected: boolean;
  state: string;
  powerW: number | null;
  socPercent: number | null;
  capacityWh: number | null;
  strategyMode: string | null;
  strategySummary: string | null;
  manualModeActive: boolean;
  minimumDischargePercent: number | null;
  maximumChargePowerW: number | null;
  maximumDischargePowerW: number | null;
}

export interface LocalApiMeterDevice {
  id: string;
  name: string;
  model: string;
  address: string;
  enabled: boolean;
  connected: boolean;
  state: string;
  powerW: number | null;
}

export interface LocalApiSolarDevice {
  id: string;
  name: string;
  model: string;
  address: string;
  enabled: boolean;
  connected: boolean;
  state: string;
  powerW: number | null;
  productionControlStatus: string | null;
}

function createEmptyDerivedMarkers(): LocalApiDerivedMarkers {
  return {
    todayLowPriceMarkerStartsAt: null,
    todayLowPriceMarkerImportPrice: null,
    todayLowPriceMarkers: [],
    todayHighPriceMarkerStartsAt: null,
    todayHighPriceMarkerImportPrice: null,
    todayHighPriceMarkers: [],
    solarSurplusStartAt: null,
    solarSurplusEndAt: null,
  };
}

function getCachedValue<T>(input: {
  cache: Map<string, CacheEntry<T>>;
  key: string;
  load: () => Promise<T>;
  nowMs: number;
  ttlMs: number;
}): Promise<T> {
  const cached = input.cache.get(input.key);

  if (cached && cached.expiresAt > input.nowMs) {
    return cached.promise;
  }

  const promise = input.load().catch((error) => {
    input.cache.delete(input.key);
    throw error;
  });

  input.cache.set(input.key, {
    expiresAt: input.nowMs + input.ttlMs,
    promise,
  });

  return promise;
}

export function clearLocalApiCurrentCaches(): void {
  dynamicPriceSnapshotCache.clear();
  weatherForecastCache.clear();
  derivedMarkersCache.clear();
}

export function computeDerivedMarkers(input: {
  archive: HistoryArchive;
  now: Date;
}): LocalApiDerivedMarkers {
  const todayKey = getLocalDayKey(input.now);
  const priceSamples = input.archive.dynamicPriceSamples.map((sample) => ({
    periodStart: sample.periodStart,
    value: sample.importPrice,
  }));
  const priceSelections = findPriceSelections(
    priceSamples,
    PRICE_SELECTION_WINDOW_MS,
  );
  const todayLowPriceMarkers = priceSelections.lowest
    .filter((point) => isSameLocalDay(point.periodStart, todayKey))
    .map((point) => ({
      startsAt: point.periodStart,
      importPrice: point.value,
    }));
  const todayHighPriceMarkers = priceSelections.highest
    .filter((point) => isSameLocalDay(point.periodStart, todayKey))
    .map((point) => ({
      startsAt: point.periodStart,
      importPrice: point.value,
    }));
  const todayPredictedSolar = input.archive.solarPredictedGeneration.filter(
    (point) => isSameLocalDay(point.periodStart, todayKey),
  );
  const todayExpectedLoad =
    input.archive.selectedDayExpectedSiteLoadSamples.filter((point) =>
      isSameLocalDay(point.periodStart, todayKey),
    );
  const solarSurplusBounds = findSolarSurplusBoundsFromSeries({
    expectedLoadSeries: todayExpectedLoad,
    fallbackEndTime: todayPredictedSolar.at(-1)?.periodStart ?? null,
    predictedSeries: todayPredictedSolar,
    selectedDayKey: todayKey,
  });
  const firstLowPriceMarker = todayLowPriceMarkers[0] ?? null;
  const firstHighPriceMarker = todayHighPriceMarkers[0] ?? null;

  return {
    todayLowPriceMarkerStartsAt: firstLowPriceMarker?.startsAt ?? null,
    todayLowPriceMarkerImportPrice: firstLowPriceMarker?.importPrice ?? null,
    todayLowPriceMarkers,
    todayHighPriceMarkerStartsAt: firstHighPriceMarker?.startsAt ?? null,
    todayHighPriceMarkerImportPrice: firstHighPriceMarker?.importPrice ?? null,
    todayHighPriceMarkers,
    solarSurplusStartAt: solarSurplusBounds.firstStartTime,
    solarSurplusEndAt: solarSurplusBounds.finalEndTime,
  };
}

async function getCachedDynamicPriceSnapshot(input: {
  nowMs: number;
  siteId: string;
}): Promise<DynamicPriceSnapshotRecord | null> {
  try {
    return await getCachedValue({
      cache: dynamicPriceSnapshotCache,
      key: input.siteId,
      nowMs: input.nowMs,
      ttlMs: DYNAMIC_PRICE_CACHE_TTL_MS,
      load: () => getDynamicPriceSnapshot({ siteId: input.siteId }),
    });
  } catch {
    return null;
  }
}

async function getCachedWeatherForecast(input: {
  nowMs: number;
  siteId: string;
}): Promise<WeatherForecastRecord | null> {
  try {
    return await getCachedValue({
      cache: weatherForecastCache,
      key: input.siteId,
      nowMs: input.nowMs,
      ttlMs: WEATHER_FORECAST_CACHE_TTL_MS,
      load: () =>
        getWeatherForecast({
          hours: 24,
          periodMinutes: 15,
          siteId: input.siteId,
        }),
    });
  } catch {
    return null;
  }
}

async function getCachedDerivedMarkers(input: {
  dayKey: string;
  now: Date;
  nowMs: number;
  siteId: string;
  timings?: LocalApiTimingBreakdown;
}): Promise<LocalApiDerivedMarkers> {
  const cacheKey = `${input.siteId}:${input.dayKey}`;
  const cached = derivedMarkersCache.get(cacheKey);

  if (cached && cached.expiresAt > input.nowMs) {
    if (input.timings) {
      input.timings.historyArchiveMs = input.timings.historyArchiveMs ?? 0;
      input.timings.derivedMarkersMs = input.timings.derivedMarkersMs ?? 0;
    }
    return cached.promise;
  }

  const promise = (async () => {
    const historyArchiveStartedAt = Date.now();
    let historyArchive: HistoryArchive | null = null;

    try {
      historyArchive = await getHistoryArchive({
        day: input.dayKey,
        siteId: input.siteId,
      });
    } catch {
      historyArchive = null;
    } finally {
      if (input.timings) {
        input.timings.historyArchiveMs = Date.now() - historyArchiveStartedAt;
      }
    }

    const derivedMarkersStartedAt = Date.now();

    try {
      return historyArchive
        ? computeDerivedMarkers({ archive: historyArchive, now: input.now })
        : createEmptyDerivedMarkers();
    } finally {
      if (input.timings) {
        input.timings.derivedMarkersMs = Date.now() - derivedMarkersStartedAt;
      }
    }
  })().catch((error) => {
    derivedMarkersCache.delete(cacheKey);
    throw error;
  });

  derivedMarkersCache.set(cacheKey, {
    expiresAt: input.nowMs + DERIVED_MARKERS_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

function isSameLocalDay(timestamp: string, dayKey: string): boolean {
  const date = new Date(timestamp);

  return !Number.isNaN(date.getTime()) && getLocalDayKey(date) === dayKey;
}

function getLocalDayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function selectCurrentPoint(
  points: Array<{ startsAt: string }>,
  now: Date,
): number {
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    if (point && new Date(point.startsAt).getTime() <= now.getTime()) {
      return i;
    }
  }

  return -1;
}

function selectCurrentForecastPoint(
  points: Array<{ period: string; periodEnd: string }>,
  now: Date,
): number {
  const nowTime = now.getTime();

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) {
      continue;
    }

    const start = new Date(point.period).getTime();
    const end = new Date(point.periodEnd).getTime();

    if (nowTime >= start && nowTime < end) {
      return i;
    }
  }

  return -1;
}

export function computePricing(
  snapshot: DynamicPriceSnapshotRecord | null,
  now: Date,
): LocalApiPricing {
  if (!snapshot || snapshot.points.length === 0) {
    return { current: null, upcoming: [] };
  }

  const sortedPoints = [...snapshot.points].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  const currentIndex = selectCurrentPoint(
    sortedPoints.map((p) => ({ startsAt: p.startsAt })),
    now,
  );
  const exportDeduction = snapshot.exportDeduction ?? 0.13;

  let current: {
    startsAt: string;
    importPrice: number;
    exportPrice: number;
    importPriceReduction: number;
    currency: string;
  } | null = null;

  if (currentIndex >= 0 && currentIndex < sortedPoints.length) {
    const point = sortedPoints[currentIndex];
    if (point) {
      current = {
        startsAt: point.startsAt,
        importPrice: point.importPrice,
        exportPrice: computeExportPrice(point.importPrice, exportDeduction),
        importPriceReduction: exportDeduction,
        currency: point.currency,
      };
    }
  }

  const upcoming = sortedPoints.slice(currentIndex + 1).map((point) => ({
    startsAt: point.startsAt,
    importPrice: point.importPrice,
    exportPrice: computeExportPrice(point.importPrice, exportDeduction),
    importPriceReduction: exportDeduction,
    currency: point.currency,
  }));

  return { current, upcoming };
}

interface ForecastPoint {
  period: string;
  periodEnd: string;
  value: number;
}

function findUpcomingIndex(
  sortedPoints: Array<{ periodEnd: string }>,
  now: Date,
): number {
  const nowTime = now.getTime();

  for (let i = 0; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];

    if (!point) {
      continue;
    }

    if (new Date(point.periodEnd).getTime() > nowTime) {
      return i;
    }
  }

  return sortedPoints.length;
}

function computeSolarForecast(
  forecast: WeatherForecastRecord | null,
  now: Date,
): LocalApiSolarForecast {
  if (!forecast || forecast.points.length === 0) {
    return {
      generatedAt: null,
      periodMinutes: null,
      provider: null,
      providerLabel: null,
      current: null,
      upcoming: [],
    };
  }

  const sortedPoints = [...forecast.points].sort(
    (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime(),
  );

  const currentIndex = selectCurrentForecastPoint(sortedPoints, now);

  let currentPoint: ForecastPoint | null = null;

  let resolvedCurrentIndex = -1;

  if (currentIndex >= 0 && currentIndex < sortedPoints.length) {
    const point = sortedPoints[currentIndex];

    if (point) {
      currentPoint = {
        period: point.period,
        periodEnd: point.periodEnd,
        value: point.value ?? 0,
      };
      resolvedCurrentIndex = currentIndex;
    }
  }

  if (!currentPoint) {
    const firstUpcoming = findUpcomingIndex(sortedPoints, now);

    if (firstUpcoming < sortedPoints.length) {
      const point = sortedPoints[firstUpcoming];

      if (point) {
        currentPoint = {
          period: point.period,
          periodEnd: point.periodEnd,
          value: point.value ?? 0,
        };
        resolvedCurrentIndex = firstUpcoming;
      }
    }
  }

  const upcomingStart =
    resolvedCurrentIndex >= 0
      ? resolvedCurrentIndex + 1
      : findUpcomingIndex(sortedPoints, now);
  const upcoming = sortedPoints.slice(upcomingStart).map((point) => ({
    period: point.period,
    periodEnd: point.periodEnd,
    value: point.value,
  }));

  return {
    generatedAt: forecast.generatedAt,
    periodMinutes: forecast.periodMinutes,
    provider: forecast.provider,
    providerLabel: forecast.providerLabel,
    current: currentPoint,
    upcoming,
  };
}

function computeAggregateSocPercent(
  batteries: ManagedDeviceStatusRecord[],
): number | null {
  const withSoc = batteries.filter(
    (b) =>
      b.telemetry?.socPercent !== null && b.telemetry?.socPercent !== undefined,
  );

  if (withSoc.length === 0) {
    return null;
  }

  const totalSoc = withSoc.reduce(
    (sum, b) => sum + (b.telemetry?.socPercent ?? 0),
    0,
  );

  return totalSoc / withSoc.length;
}

function computeAggregatePowerW(
  devices: ManagedDeviceStatusRecord[],
): number | null {
  const withPower = devices.filter(
    (d) => d.telemetry?.powerW !== null && d.telemetry?.powerW !== undefined,
  );

  if (withPower.length === 0) {
    return null;
  }

  return withPower.reduce((sum, d) => sum + (d.telemetry?.powerW ?? 0), 0);
}

function mapBatteryDevice(
  device: ManagedDeviceStatusRecord,
): LocalApiBatteryDevice {
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    address: device.address,
    enabled: device.enabled,
    connected: device.connected,
    state: device.state,
    powerW: device.telemetry?.powerW ?? null,
    socPercent: device.telemetry?.socPercent ?? null,
    capacityWh: device.telemetry?.capacityWh ?? null,
    strategyMode: device.batteryStrategy?.strategyMode ?? null,
    strategySummary: device.batteryStrategySummary ?? null,
    manualModeActive: device.batteryManualModeActive,
    minimumDischargePercent: device.minimumDischargePercent ?? null,
    maximumChargePowerW: device.maximumChargePowerW ?? null,
    maximumDischargePowerW: device.maximumDischargePowerW ?? null,
  };
}

function mapMeterDevice(
  device: ManagedDeviceStatusRecord,
): LocalApiMeterDevice {
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    address: device.address,
    enabled: device.enabled,
    connected: device.connected,
    state: device.state,
    powerW: device.telemetry?.powerW ?? null,
  };
}

function mapSolarDevice(
  device: ManagedDeviceStatusRecord,
): LocalApiSolarDevice {
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    address: device.address,
    enabled: device.enabled,
    connected: device.connected,
    state: device.state,
    powerW: device.telemetry?.powerW ?? null,
    productionControlStatus: device.telemetry?.productionControlStatus ?? null,
  };
}

export async function buildLocalApiCurrent(
  exclude?: Set<string>,
  timings?: LocalApiTimingBreakdown,
): Promise<Partial<LocalApiCurrentResponse>> {
  const now = new Date();
  const nowMs = Date.now();
  const liveStatusStartedAt = Date.now();
  const snapshot = await getLiveStatus();
  if (timings) {
    timings.liveStatusMs = Date.now() - liveStatusStartedAt;
  }
  const site = snapshot.sites[0] ?? null;

  const needPricing =
    !exclude ||
    !(exclude.has("ems_price_now") && exclude.has("ems_negative_price_now"));
  const needForecast = !exclude || !exclude.has("ems_solar_forecast");
  const needDerivedMarkers = !exclude || !exclude.has("ems_derived_markers");

  const dynamicPriceSnapshotPromise =
    site && needPricing && site.dynamicPriceSources.length > 0
      ? (async () => {
          const dynamicPriceSnapshotStartedAt = Date.now();
          try {
            return await getCachedDynamicPriceSnapshot({
              nowMs,
              siteId: site.id,
            });
          } finally {
            if (timings) {
              timings.dynamicPriceSnapshotMs =
                Date.now() - dynamicPriceSnapshotStartedAt;
            }
          }
        })()
      : Promise.resolve(null);
  const forecastPromise =
    site && needForecast && site.weatherSources.length > 0
      ? (async () => {
          const weatherForecastStartedAt = Date.now();
          try {
            return await getCachedWeatherForecast({
              nowMs,
              siteId: site.id,
            });
          } finally {
            if (timings) {
              timings.weatherForecastMs = Date.now() - weatherForecastStartedAt;
            }
          }
        })()
      : Promise.resolve(null);
  const derivedMarkersPromise =
    site && needDerivedMarkers
      ? getCachedDerivedMarkers({
          dayKey: getLocalDayKey(now),
          now,
          nowMs,
          siteId: site.id,
          ...(timings ? { timings } : {}),
        })
      : Promise.resolve<LocalApiDerivedMarkers | null>(null);

  const deviceGroupingAndComputeStartedAt = Date.now();
  const batteries = site
    ? site.devices.filter((d) => d.kind === "battery")
    : [];
  const meters = site ? site.devices.filter((d) => d.kind === "meter") : [];
  const solarProviders = site
    ? site.devices.filter((d) => d.kind === "solar-energy-provider")
    : [];
  if (timings) {
    timings.deviceGroupingAndComputeMs =
      Date.now() - deviceGroupingAndComputeStartedAt;
  }

  const [dynamicPriceSnapshot, forecast, derivedMarkers] = await Promise.all([
    dynamicPriceSnapshotPromise,
    forecastPromise,
    derivedMarkersPromise,
  ]);

  const pricing: LocalApiPricing | null = needPricing
    ? computePricing(dynamicPriceSnapshot, now)
    : null;
  const solarForecast: LocalApiSolarForecast | null = needForecast
    ? computeSolarForecast(forecast, now)
    : null;

  let currentExportPriceIsNegative = false;

  if (pricing?.current && pricing.current.exportPrice < 0) {
    currentExportPriceIsNegative = true;
  }

  const needBasic = !exclude || !exclude.has("ems_basic");
  const needBatteryInfo = !exclude || !exclude.has("ems_battery_info");
  const needSolarPower = !exclude || !exclude.has("ems_solar_power");
  const needMeterPower = !exclude || !exclude.has("ems_meter_power");

  const responseBuildStartedAt = Date.now();
  const response: Record<string, unknown> = {
    schema: "ems.local.current.v1",
    generatedAt: snapshot.generatedAt,
    summary: {},
  };

  if (needBasic) {
    response.daemonRunning = snapshot.daemon.running;
    response.site = site
      ? {
          id: site.id,
          name: site.name,
          location: site.location,
        }
      : null;
    response.devices = {
      batteries: batteries.map(mapBatteryDevice),
      meters: meters.map(mapMeterDevice),
      solarEnergyProviders: solarProviders.map(mapSolarDevice),
    };
  }

  const summary = response.summary as Record<string, unknown>;

  if (!exclude || !exclude.has("ems_price_now")) {
    summary.currentImportPrice = pricing?.current?.importPrice ?? null;
    summary.currentExportPrice = pricing?.current?.exportPrice ?? null;
    summary.currentImportPriceReduction =
      pricing?.current?.importPriceReduction ?? null;
    summary.currentImportPriceCurrency = pricing?.current?.currency ?? null;
    summary.currentImportPriceStartsAt = pricing?.current?.startsAt ?? null;
  }

  if (!exclude || !exclude.has("ems_negative_price_now")) {
    summary.currentExportPriceIsNegative = currentExportPriceIsNegative;
  }

  if (needBatteryInfo) {
    summary.totalBatterySocPercent = computeAggregateSocPercent(batteries);
    summary.totalBatteryPowerW = computeAggregatePowerW(batteries);
    summary.batteryStrategySummary =
      batteries[0]?.batteryStrategySummary ?? null;
  }

  if (needSolarPower) {
    summary.totalSolarPowerW = computeAggregatePowerW(solarProviders);
  }

  if (needMeterPower) {
    summary.totalMeterPowerW = computeAggregatePowerW(meters);
  }

  if (!exclude || !exclude.has("ems_solar_forecast")) {
    summary.currentForecastSolarPowerW = solarForecast?.current?.value ?? null;
    response.solarForecast = solarForecast;
  }

  if (needDerivedMarkers) {
    response.derivedMarkers = derivedMarkers ?? createEmptyDerivedMarkers();
  }

  if (!exclude || !exclude.has("ems_price_now")) {
    response.pricing = pricing;
  }
  if (timings) {
    timings.responseBuildMs = Date.now() - responseBuildStartedAt;
  }

  return response as unknown as Partial<LocalApiCurrentResponse>;
}
