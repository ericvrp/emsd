import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../auth";
import {
  getDynamicPriceSnapshot,
  getLiveStatus,
  getWeatherForecast,
} from "../lib/ems-bridge";

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function loadDashboardPageData(searchParams?: SearchParams) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const snapshot = await getLiveStatus();
  const resolvedSearchParams = (await searchParams) ?? {};

  if (!snapshot.daemon.running) {
    return {
      currentSite: null,
      dynamicPriceSnapshot: null,
      dynamicPriceSnapshotError: null,
      generatedAt: snapshot.generatedAt,
      offline: true,
      resolvedSearchParams,
      weatherForecast: null,
      weatherForecastError: null,
    };
  }

  const currentSite = snapshot.sites[0] ?? null;
  let dynamicPriceSnapshot: Awaited<
    ReturnType<typeof getDynamicPriceSnapshot>
  > | null = null;
  let dynamicPriceSnapshotError: string | null = null;
  let weatherForecast: Awaited<ReturnType<typeof getWeatherForecast>> | null =
    null;
  let weatherForecastError: string | null = null;

  if (currentSite) {
    try {
      if (currentSite.dynamicPriceSources[0]) {
        dynamicPriceSnapshot = await getDynamicPriceSnapshot({
          siteId: currentSite.id,
        });
      }
    } catch (error) {
      dynamicPriceSnapshotError =
        error instanceof Error ? error.message : String(error);
    }

    try {
      if (currentSite.weatherSources[0]) {
        weatherForecast = await getWeatherForecast({
          hours: 48,
          periodMinutes: 15,
          siteId: currentSite.id,
        });
      }
    } catch (error) {
      weatherForecastError =
        error instanceof Error ? error.message : String(error);
    }
  }

  return {
    currentSite,
    dynamicPriceSnapshot,
    dynamicPriceSnapshotError,
    generatedAt: snapshot.generatedAt,
    offline: false,
    resolvedSearchParams,
    weatherForecast,
    weatherForecastError,
  };
}
