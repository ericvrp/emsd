import type { WeatherForecastPointRecord, WeatherProvider } from "@emsd/core";
import type { WeatherForecastRequest, WeatherPlugin } from "./index";
import {
  createWeatherForecastRecord,
  normalizeWeatherForecastPoints,
  parseNullableNumber,
  parseSiteCoordinates,
} from "./index";

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_PROVIDER: WeatherProvider = "open-meteo";

interface OpenMeteoResponse {
  hourly?: {
    cloud_cover?: Array<number | null>;
    global_tilted_irradiance?: Array<number | null>;
    shortwave_radiation?: Array<number | null>;
    temperature_2m?: Array<number | null>;
    time?: string[];
  };
  minutely_15?: {
    cloud_cover?: Array<number | null>;
    global_tilted_irradiance?: Array<number | null>;
    shortwave_radiation?: Array<number | null>;
    temperature_2m?: Array<number | null>;
    time?: string[];
  };
}

export const openMeteoWeatherPlugin: WeatherPlugin = {
  id: OPEN_METEO_PROVIDER,
  name: "Open-Meteo",
  async fetchForecast(input: WeatherForecastRequest) {
    const { latitude, longitude } = parseSiteCoordinates(input.site);
    const use15Minute = input.periodMinutes <= 15;
    const response = await fetch(
      buildOpenMeteoUrl({
        hours: input.hours,
        latitude,
        longitude,
        use15Minute,
      }),
      { headers: { accept: "application/json" } },
    );

    if (!response.ok) {
      throw new Error(
        `Open-Meteo forecast request failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }

    const payload = (await response.json()) as OpenMeteoResponse;
    const points = normalizeWeatherForecastPoints(
      mapOpenMeteoPoints(payload, use15Minute),
    );

    return createWeatherForecastRecord(input, {
      metricLabel: "Ground sunlight",
      periodMinutes: use15Minute ? 15 : 60,
      points,
      provider: OPEN_METEO_PROVIDER,
      providerLabel: this.name,
      sourceName: input.source?.name ?? this.name,
      unitLabel: "W/m²",
    });
  },
};

function buildOpenMeteoUrl(input: {
  hours: number;
  latitude: number;
  longitude: number;
  use15Minute: boolean;
}): string {
  const params = new URLSearchParams({
    latitude: input.latitude.toFixed(6),
    longitude: input.longitude.toFixed(6),
    timezone: "GMT",
  });

  if (input.use15Minute) {
    params.set(
      "minutely_15",
      "shortwave_radiation,temperature_2m,cloud_cover",
    );
    params.set(
      "forecast_minutely_15",
      String(Math.max(1, Math.min(16 * 24 * 4, input.hours * 4))),
    );
  } else {
    params.set(
      "hourly",
      "shortwave_radiation,temperature_2m,cloud_cover",
    );
    params.set(
      "forecast_hours",
      String(Math.max(1, Math.min(16 * 24, input.hours))),
    );
  }

  return `${OPEN_METEO_BASE_URL}?${params.toString()}`;
}

function mapOpenMeteoPoints(
  payload: OpenMeteoResponse,
  use15Minute: boolean,
): WeatherForecastPointRecord[] {
  const bucket = use15Minute ? payload.minutely_15 : payload.hourly;
  const times = bucket?.time ?? [];

  return times.map((periodEnd, index) => {
    const temperature = parseNullableNumber(bucket?.temperature_2m?.[index]);
    const cloudOpacity = parseNullableNumber(bucket?.cloud_cover?.[index]);
    const ghi = parseNullableNumber(bucket?.shortwave_radiation?.[index]);

    return {
      airTempC: temperature,
      cloudOpacityPercent: cloudOpacity,
      ghiWm2: ghi,
      period: use15Minute ? "PT15M" : "PT60M",
      periodEnd: `${periodEnd}:00Z`.replace("+00:00:00Z", "+00:00"),
      value: ghi,
    };
  });
}
