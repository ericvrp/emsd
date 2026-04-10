import {
  loadDashboardPageData,
  type SearchParams,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import {
  PricingSection,
  SiteSetupPanel,
} from "../../components/settings-panel";
import { getHistoryArchive } from "../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export default async function PricingPage({
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
  const historyArchive = currentSite
    ? await getHistoryArchive({ siteId: currentSite.id })
    : null;

  return (
    <DashboardPageFrame currentSite={currentSite} generatedAt={generatedAt}>
      {currentSite && historyArchive ? (
        <PricingSection
          archive={historyArchive}
          error={dynamicPriceSnapshotError}
          site={currentSite}
          snapshot={dynamicPriceSnapshot}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
