import type {
  SiteRecord,
  WeatherForecastPointRecord,
  WeatherForecastRecord,
  WeatherForecastSourceRecord,
  WeatherProvider,
} from "@emsd/core";
import { parseGpsCoordinate } from "@emsd/core";
import { openMeteoWeatherPlugin } from "./open-meteo";

export interface WeatherForecastRequest {
  hours: number;
  periodMinutes: number;
  site: SiteRecord;
  source: WeatherForecastSourceRecord | null;
}

export interface WeatherPlugin {
  fetchForecast(input: WeatherForecastRequest): Promise<WeatherForecastRecord>;
  id: WeatherProvider;
  name: string;
}

export const weatherPlugins: WeatherPlugin[] = [openMeteoWeatherPlugin];

export const DEFAULT_WEATHER_PROVIDER: WeatherProvider = "open-meteo";

export function createWeatherPlugin(
  provider: WeatherProvider = DEFAULT_WEATHER_PROVIDER,
): WeatherPlugin {
  const plugin = weatherPlugins.find((entry) => entry.id === provider);

  if (!plugin) {
    throw new Error(`Unsupported solar forecast provider: ${provider}`);
  }

  return plugin;
}

export async function getWeatherForecast(
  input: WeatherForecastRequest,
): Promise<WeatherForecastRecord> {
  const provider = input.source?.provider ?? DEFAULT_WEATHER_PROVIDER;
  return createWeatherPlugin(provider).fetchForecast(input);
}

export function parseSiteCoordinates(site: SiteRecord): {
  latitude: number;
  longitude: number;
} {
  const coordinates = parseGpsCoordinate(site.location);

  if (!coordinates) {
    throw new Error(
      `Site ${site.id} is missing a valid GPS location in 'latitude, longitude' format.`,
    );
  }

  return coordinates;
}

export function normalizeWeatherForecastPoints(
  points: WeatherForecastPointRecord[],
): WeatherForecastPointRecord[] {
  return points
    .filter(
      (point) =>
        typeof point.periodEnd === "string" && point.periodEnd.length > 0,
    )
    .sort(
      (left, right) =>
        new Date(left.periodEnd).getTime() -
        new Date(right.periodEnd).getTime(),
    );
}

export function createWeatherForecastRecord(
  input: WeatherForecastRequest,
  options: {
    metricLabel: string;
    periodMinutes: number;
    points: WeatherForecastPointRecord[];
    provider: WeatherProvider;
    providerLabel: string;
    sourceName: string;
    unitLabel: string;
  },
): WeatherForecastRecord {
  return {
    generatedAt: new Date().toISOString(),
    hours: input.hours,
    location: input.site.location,
    metricLabel: options.metricLabel,
    periodMinutes: options.periodMinutes,
    points: options.points,
    provider: options.provider,
    providerLabel: options.providerLabel,
    sourceId: input.source?.id ?? null,
    sourceName: options.sourceName,
    unitLabel: options.unitLabel,
  };
}

export function parseNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
