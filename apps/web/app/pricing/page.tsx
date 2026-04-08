import {
  loadDashboardPageData,
  type SearchParams,
} from "../../components/dashboard-page-data";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import { PricingSection, SiteSetupPanel } from "../../components/settings-panel";

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

  return (
    <DashboardPageFrame
      currentSite={currentSite}
      generatedAt={generatedAt}
    >
      {currentSite ? (
        <PricingSection
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
