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
  daemon: {
    running: boolean;
    pid: number | null;
  };
  site: {
    id: string;
    name: string;
    location: string;
  } | null;
  summary: LocalApiSummary;
  pricing: LocalApiPricing;
  solarForecast: LocalApiSolarForecast;
  devices: LocalApiDevices;
}

export interface LocalApiSummary {
  currentImportPrice: number | null;
  currentImportPriceCurrency: string | null;
  currentImportPriceStartsAt: string | null;
  currentImportPriceIsNegative: boolean;
  nextImportPrice: number | null;
  currentForecastSolarPowerW: number | null;
  nextForecastSolarPowerW: number | null;
  totalBatterySocPercent: number | null;
  totalBatteryPowerW: number | null;
  totalSolarPowerW: number | null;
  totalMeterPowerW: number | null;
  batteryCount: number;
  meterCount: number;
  solarEnergyProviderCount: number;
}

export interface LocalApiPricing {
  current: {
    startsAt: string;
    importPrice: number;
    currency: string;
  } | null;
  next: {
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
  next: {
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
    return { current: null, next: null, upcoming: [] };
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

  let next: {
    startsAt: string;
    importPrice: number;
    currency: string;
  } | null = null;

  if (currentIndex + 1 < sortedPoints.length) {
    const point = sortedPoints[currentIndex + 1];
    if (point) {
      next = {
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

  return { current, next, upcoming };
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
      next: null,
      upcoming: [],
    };
  }

  const sortedPoints = [...forecast.points].sort(
    (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime(),
  );

  const currentIndex = selectCurrentForecastPoint(sortedPoints, now);

  let currentPoint: {
    period: string;
    periodEnd: string;
    value: number;
  } | null = null;

  if (currentIndex >= 0 && currentIndex < sortedPoints.length) {
    const point = sortedPoints[currentIndex];
    if (point && point.value !== null && point.value !== undefined) {
      currentPoint = {
        period: point.period,
        periodEnd: point.periodEnd,
        value: point.value,
      };
    }
  }

  let nextPoint: {
    period: string;
    periodEnd: string;
    value: number;
  } | null = null;

  for (let i = currentIndex + 1; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];
    if (point && point.value !== null && point.value !== undefined) {
      nextPoint = {
        period: point.period,
        periodEnd: point.periodEnd,
        value: point.value,
      };
      break;
    }
  }

  const upcoming = sortedPoints.slice(currentIndex + 1).map((point) => ({
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
    next: nextPoint,
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

export async function buildLocalApiCurrent(): Promise<LocalApiCurrentResponse> {
  const now = new Date();
  const snapshot = await getLiveStatus();
  const site = snapshot.sites[0] ?? null;

  let dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null = null;
  let forecast: WeatherForecastRecord | null = null;

  if (site) {
    if (site.dynamicPriceSources.length > 0) {
      try {
        dynamicPriceSnapshot = await getDynamicPriceSnapshot({
          siteId: site.id,
        });
      } catch {
        dynamicPriceSnapshot = null;
      }
    }

    if (site.weatherSources.length > 0) {
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

  const pricing = computePricing(dynamicPriceSnapshot, now);
  const solarForecast = computeSolarForecast(forecast, now);

  let currentImportPriceIsNegative = false;

  if (pricing.current && pricing.current.importPrice < 0) {
    currentImportPriceIsNegative = true;
  }

  return {
    schema: "ems.local.current.v1",
    generatedAt: snapshot.generatedAt,
    daemon: {
      running: snapshot.daemon.running,
      pid: snapshot.daemon.pid,
    },
    site: site
      ? {
          id: site.id,
          name: site.name,
          location: site.location,
        }
      : null,
    summary: {
      currentImportPrice: pricing.current?.importPrice ?? null,
      currentImportPriceCurrency: pricing.current?.currency ?? null,
      currentImportPriceStartsAt: pricing.current?.startsAt ?? null,
      currentImportPriceIsNegative,
      nextImportPrice: pricing.next?.importPrice ?? null,
      currentForecastSolarPowerW: solarForecast.current?.value ?? null,
      nextForecastSolarPowerW: solarForecast.next?.value ?? null,
      totalBatterySocPercent: computeAggregateSocPercent(batteries),
      totalBatteryPowerW: computeAggregatePowerW(batteries),
      totalSolarPowerW: computeAggregatePowerW(solarProviders),
      totalMeterPowerW: computeAggregatePowerW(meters),
      batteryCount: batteries.length,
      meterCount: meters.length,
      solarEnergyProviderCount: solarProviders.length,
    },
    pricing,
    solarForecast,
    devices: {
      batteries: batteries.map(mapBatteryDevice),
      meters: meters.map(mapMeterDevice),
      solarEnergyProviders: solarProviders.map(mapSolarDevice),
    },
  };
}
