import type {
  DynamicPricePointRecord,
  DynamicPriceSnapshotRecord,
  LiveStatusSnapshot,
  ManagedDeviceStatusRecord,
  ManagedDeviceTelemetryRecord,
  WeatherForecastPointRecord,
  WeatherForecastRecord,
} from "@emsd/core";
import {
  getDynamicPriceSnapshot,
  getLiveStatus,
  getWeatherForecast,
} from "./ems-bridge";

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
  pricing?: LocalApiPricing;
  solarForecast?: LocalApiSolarForecast;
  devices?: LocalApiDevices;
}

export interface LocalApiSummary {
  currentImportPrice: number | null;
  currentImportPriceCurrency: string | null;
  currentImportPriceStartsAt: string | null;
  currentImportPriceIsNegative: boolean;
  currentForecastSolarPowerW: number | null;
  totalBatterySocPercent: number | null;
  totalBatteryPowerW: number | null;
  batteryStrategySummary: string | null;
  totalSolarPowerW: number | null;
  totalMeterPowerW: number | null;
}

export interface LocalApiPricing {
  current: {
    startsAt: string;
    importPrice: number;
    currency: string;
  } | null;
  upcoming: Array<{
    startsAt: string;
    importPrice: number;
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

function computePricing(
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

  let current: {
    startsAt: string;
    importPrice: number;
    currency: string;
  } | null = null;

  if (currentIndex >= 0 && currentIndex < sortedPoints.length) {
    const point = sortedPoints[currentIndex];
    if (point) {
      current = {
        startsAt: point.startsAt,
        importPrice: point.importPrice,
        currency: point.currency,
      };
    }
  }

  const upcoming = sortedPoints.slice(currentIndex + 1).map((point) => ({
    startsAt: point.startsAt,
    importPrice: point.importPrice,
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
): Promise<Partial<LocalApiCurrentResponse>> {
  const now = new Date();
  const snapshot = await getLiveStatus();
  const site = snapshot.sites[0] ?? null;

  const needPricing =
    !exclude ||
    !(exclude.has("ems_price_now") && exclude.has("ems_negative_price_now"));
  const needForecast = !exclude || !exclude.has("ems_solar_forecast");

  let dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null = null;
  let forecast: WeatherForecastRecord | null = null;

  if (site) {
    if (needPricing && site.dynamicPriceSources.length > 0) {
      try {
        dynamicPriceSnapshot = await getDynamicPriceSnapshot({
          siteId: site.id,
        });
      } catch {
        dynamicPriceSnapshot = null;
      }
    }

    if (needForecast && site.weatherSources.length > 0) {
      try {
        forecast = await getWeatherForecast({
          hours: 24,
          periodMinutes: 15,
          siteId: site.id,
        });
      } catch {
        forecast = null;
      }
    }
  }

  const batteries = site
    ? site.devices.filter((d) => d.kind === "battery")
    : [];
  const meters = site ? site.devices.filter((d) => d.kind === "meter") : [];
  const solarProviders = site
    ? site.devices.filter((d) => d.kind === "solar-energy-provider")
    : [];

  const pricing: LocalApiPricing | null = needPricing
    ? computePricing(dynamicPriceSnapshot, now)
    : null;
  const solarForecast: LocalApiSolarForecast | null = needForecast
    ? computeSolarForecast(forecast, now)
    : null;

  let currentImportPriceIsNegative = false;

  if (pricing?.current && pricing.current.importPrice < 0) {
    currentImportPriceIsNegative = true;
  }

  const needBasic = !exclude || !exclude.has("ems_basic");
  const needBatteryInfo = !exclude || !exclude.has("ems_battery_info");
  const needSolarPower = !exclude || !exclude.has("ems_solar_power");
  const needMeterPower = !exclude || !exclude.has("ems_meter_power");

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
    summary.currentImportPriceCurrency = pricing?.current?.currency ?? null;
    summary.currentImportPriceStartsAt = pricing?.current?.startsAt ?? null;
  }

  if (!exclude || !exclude.has("ems_negative_price_now")) {
    summary.currentImportPriceIsNegative = currentImportPriceIsNegative;
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

  if (!exclude || !exclude.has("ems_price_now")) {
    response.pricing = pricing;
  }

  return response as unknown as Partial<LocalApiCurrentResponse>;
}
