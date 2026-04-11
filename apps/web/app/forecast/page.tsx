import { buildPredictedSolarGenerationSeries } from "@emsd/core";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import {
  type SearchParams,
  loadDashboardPageData,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { WeatherForecastSection } from "../../components/forecast-page";
import { SiteSetupPanel } from "../../components/settings-panel";
import { getHistoryArchive } from "../../lib/ems-bridge";
import { getSearchParamValue } from "../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function ForecastPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const dashboardData = await loadDashboardPageData(searchParams);

  if (dashboardData.offline) {
    return <DaemonOfflineState />;
  }

  const { currentSite, generatedAt, weatherForecast, weatherForecastError } =
    dashboardData;
  const requestedDay = getSearchParamValue(
    dashboardData.resolvedSearchParams.day,
  );
  const historyArchive = currentSite
    ? await getHistoryArchive({ siteId: currentSite.id })
    : null;
  const predictedSolarGeneration = historyArchive
    ? buildPredictedSolarGenerationSeries({
        forecastSamples: historyArchive.solarForecastSamples,
        solarEnergyProviderSamples: historyArchive.solarEnergyProviderSamples,
      })
    : [];

  return (
    <DashboardPageFrame currentSite={currentSite} generatedAt={generatedAt}>
      {currentSite && historyArchive ? (
        <WeatherForecastSection
          archive={historyArchive}
          error={weatherForecastError}
          forecast={weatherForecast}
          predictedSolarGeneration={predictedSolarGeneration}
          requestedDay={requestedDay}
          site={currentSite}
          source={currentSite.weatherSources[0] ?? null}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
