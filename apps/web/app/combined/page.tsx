import {
  CombinedGraphPage,
  CombinedGraphTypeTabs,
} from "../../components/combined-graph-page";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import {
  type SearchParams,
  loadDashboardPageData,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { SiteSetupPanel } from "../../components/settings-panel";
import { resolveRelativeDayParam } from "../../lib/day-utils";
import { getHistoryArchive } from "../../lib/ems-bridge";
import { buildPriceMarkerPeriodStarts } from "../../lib/price-selection";
import { getSearchParamValue } from "../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function CombinedPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const dashboardData = await loadDashboardPageData(searchParams);

  if (dashboardData.offline) {
    return <DaemonOfflineState />;
  }

  const { currentSite, dynamicPriceSnapshot, weatherForecast } = dashboardData;
  const requestedDay = resolveRelativeDayParam(
    getSearchParamValue(dashboardData.resolvedSearchParams.day),
  );
  const historyArchive = currentSite
    ? await getHistoryArchive({ day: requestedDay, siteId: currentSite.id })
    : null;
  const priceMarkers = historyArchive
    ? buildPriceMarkerPeriodStarts(historyArchive)
    : null;

  return (
    <DashboardPageFrame
      currentSite={currentSite}
      nav={<CombinedGraphTypeTabs />}
    >
      {currentSite && historyArchive && priceMarkers ? (
        <CombinedGraphPage
          archive={historyArchive}
          dynamicPriceSnapshot={dynamicPriceSnapshot}
          highestMarkerPeriodStarts={priceMarkers.highestMarkerPeriodStarts}
          lowestMarkerPeriodStarts={priceMarkers.lowestMarkerPeriodStarts}
          requestedDay={requestedDay}
          site={currentSite}
          weatherForecast={weatherForecast}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
