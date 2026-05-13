import { DaemonOfflineState } from "../../components/daemon-offline-state";
import {
  type SearchParams,
  loadDashboardPageData,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { WeatherForecastSection } from "../../components/forecast-page";
import { SiteSetupPanel } from "../../components/settings-panel";
import { resolveRelativeDayParam } from "../../lib/day-utils";
import { getHistoryArchive } from "../../lib/ems-bridge";
import { getSearchParamValue } from "../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function SolarPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const dashboardData = await loadDashboardPageData(searchParams);

  if (dashboardData.offline) {
    return <DaemonOfflineState />;
  }

  const { currentSite, weatherForecast, weatherForecastError } = dashboardData;
  const requestedDay = getSearchParamValue(
    dashboardData.resolvedSearchParams.day,
  );
  const resolvedRequestedDay = resolveRelativeDayParam(requestedDay);
  const historyArchive = currentSite
    ? await getHistoryArchive({
        day: resolvedRequestedDay,
        siteId: currentSite.id,
      })
    : null;

  return (
    <DashboardPageFrame currentSite={currentSite}>
      {currentSite && historyArchive ? (
        <WeatherForecastSection
          archive={historyArchive}
          error={weatherForecastError}
          forecast={weatherForecast}
          requestedDay={resolvedRequestedDay}
          site={currentSite}
          source={currentSite.weatherSources[0] ?? null}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
