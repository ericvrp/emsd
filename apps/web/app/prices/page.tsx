import { DaemonOfflineState } from "../../components/daemon-offline-state";
import {
  type SearchParams,
  loadDashboardPageData,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { PricingSection } from "../../components/pricing-page";
import { SiteSetupPanel } from "../../components/settings-panel";
import { getHistoryArchive } from "../../lib/ems-bridge";
import { buildPriceMarkerPeriodStarts } from "../../lib/price-selection";
import { getSearchParamValue } from "../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function PricesPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const dashboardData = await loadDashboardPageData(searchParams);

  if (dashboardData.offline) {
    return <DaemonOfflineState />;
  }

  const { currentSite, dynamicPriceSnapshot, dynamicPriceSnapshotError } =
    dashboardData;
  const requestedDay = getSearchParamValue(
    dashboardData.resolvedSearchParams.day,
  );
  const historyArchive = currentSite
    ? await getHistoryArchive({ siteId: currentSite.id })
    : null;
  const priceMarkers = historyArchive
    ? buildPriceMarkerPeriodStarts(historyArchive)
    : null;

  return (
    <DashboardPageFrame currentSite={currentSite}>
      {currentSite && historyArchive && priceMarkers ? (
        <PricingSection
          archive={historyArchive}
          error={dynamicPriceSnapshotError}
          highestMarkerPeriodStarts={priceMarkers.highestMarkerPeriodStarts}
          lowestMarkerPeriodStarts={priceMarkers.lowestMarkerPeriodStarts}
          requestedDay={requestedDay}
          site={currentSite}
          snapshot={dynamicPriceSnapshot}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
