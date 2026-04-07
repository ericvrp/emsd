import { afterEach, expect, test } from "bun:test";
import type { SiteRecord, WeatherForecastSourceRecord } from "@emsd/core";
import { getWeatherForecast } from "./plugins/solar-forecast";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Open-Meteo weather plugin fetches ground sunlight forecast", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    expect(url).toContain("https://api.open-meteo.com/v1/forecast?");
    expect(url).toContain("minutely_15=");
    expect(url).toContain("shortwave_radiation");

    return new Response(
      JSON.stringify({
        minutely_15: {
          time: ["2026-04-07T06:15", "2026-04-07T06:30"],
          temperature_2m: [12.4, 13.1],
          cloud_cover: [38, 18],
          shortwave_radiation: [0, 380],
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const forecast = await getWeatherForecast({
    hours: 48,
    periodMinutes: 15,
    site: buildSite(),
    source: buildOpenMeteoSource(),
  });

  expect(forecast.provider).toBe("open-meteo");
  expect(forecast.metricLabel).toBe("Ground sunlight");
  expect(forecast.unitLabel).toBe("W/m²");
  expect(forecast.points).toEqual([
    {
      airTempC: 12.4,
      cloudOpacityPercent: 38,
      ghiWm2: 0,
      period: "PT15M",
      periodEnd: "2026-04-07T06:15:00Z",
      value: 0,
    },
    {
      airTempC: 13.1,
      cloudOpacityPercent: 18,
      ghiWm2: 380,
      period: "PT15M",
      periodEnd: "2026-04-07T06:30:00Z",
      value: 380,
    },
  ]);
});

function buildSite(): SiteRecord {
  return {
    id: "home",
    location: "52.367600, 4.904100",
    name: "Home",
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
  };
}

function buildOpenMeteoSource(): WeatherForecastSourceRecord {
  return {
    id: "open-meteo-primary",
    siteId: "home",
    name: "Open-Meteo main roof",
    provider: "open-meteo",
    surface: "open-meteo-shortwave-radiation",
    updatedAt: "2026-04-07T00:00:00.000Z",
  };
}
