import { DaemonOfflineState } from "../../components/daemon-offline-state";
import {
  type SearchParams,
  loadDashboardPageData,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { PricingSection } from "../../components/pricing-page";
import { SiteSetupPanel } from "../../components/settings-panel";
import { getHistoryArchive } from "../../lib/ems-bridge";
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

  const {
    currentSite,
    dynamicPriceSnapshot,
    dynamicPriceSnapshotError,
    generatedAt,
  } = dashboardData;
  const requestedDay = getSearchParamValue(
    dashboardData.resolvedSearchParams.day,
  );
  const historyArchive = currentSite
    ? await getHistoryArchive({ siteId: currentSite.id })
    : null;

  return (
    <DashboardPageFrame currentSite={currentSite} generatedAt={generatedAt}>
      {currentSite && historyArchive ? (
        <PricingSection
          archive={historyArchive}
          error={dynamicPriceSnapshotError}
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
