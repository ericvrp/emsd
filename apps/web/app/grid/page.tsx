import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../auth";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import { GridPage } from "../../components/grid-page";
import { SiteSetupPanel } from "../../components/settings-panel";
import { getHistoryArchive, getLiveStatus } from "../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export default async function GridRoute() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const snapshot = await getLiveStatus();

  if (!snapshot.daemon.running) {
    return <DaemonOfflineState />;
  }

  const currentSite = snapshot.sites[0] ?? null;
  const historyArchive = currentSite
    ? await getHistoryArchive({ siteId: currentSite.id })
    : null;

  return (
    <DashboardPageFrame
      currentSite={currentSite}
      generatedAt={snapshot.generatedAt}
    >
      {currentSite && historyArchive ? (
        <GridPage archive={historyArchive} siteName={currentSite.name} />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
