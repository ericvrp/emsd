import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../auth";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { SiteSetupPanel } from "../../components/settings-panel";
import { SolarEnergyPage } from "../../components/solar-energy-page";
import { getHistoryArchive, getLiveStatus } from "../../lib/ems-bridge";
import { getSearchParamValue } from "../../lib/search-params";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SolarRoute({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const snapshot = await getLiveStatus();

  if (!snapshot.daemon.running) {
    return <DaemonOfflineState />;
  }

  const currentSite = snapshot.sites[0] ?? null;
  const params = (await searchParams) ?? {};
  const requestedDay = getSearchParamValue(params.day);
  const historyArchive = currentSite
    ? await getHistoryArchive({ siteId: currentSite.id })
    : null;

  return (
    <DashboardPageFrame
      currentSite={currentSite}
      generatedAt={snapshot.generatedAt}
    >
      {currentSite && historyArchive ? (
        <SolarEnergyPage
          archive={historyArchive}
          currentSite={currentSite}
          requestedDay={requestedDay}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}
