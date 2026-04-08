import {
  loadDashboardPageData,
  type SearchParams,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import {
  SiteSetupPanel,
  WeatherForecastSection,
} from "../../components/settings-panel";

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

  const {
    currentSite,
    generatedAt,
    weatherForecast,
    weatherForecastError,
  } = dashboardData;

  return (
    <DashboardPageFrame
      currentSite={currentSite}
      generatedAt={generatedAt}
    >
      {currentSite ? (
        <WeatherForecastSection
          error={weatherForecastError}
          forecast={weatherForecast}
          site={currentSite}
          source={currentSite.weatherSources[0] ?? null}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
