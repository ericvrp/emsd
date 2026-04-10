import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../auth";
import { DaemonOfflineState } from "../../components/daemon-offline-state";
import { DashboardPageFrame } from "../../components/dashboard-page-frame";
import { HistoryPage } from "../../components/history-page";
import { SiteSetupPanel } from "../../components/settings-panel";
import { getHistoryArchive, getLiveStatus } from "../../lib/ems-bridge";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HistoryRoute({
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
  const rawTab = getSearchParamValue(params.tab);
  const selectedTab =
    rawTab === "price" ||
    rawTab === "solar" ||
    rawTab === "solar-energy" ||
    rawTab === "grid" ||
    rawTab === "battery"
      ? rawTab
      : "battery";
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
        <HistoryPage
          archive={historyArchive}
          requestedDay={requestedDay}
          selectedTab={selectedTab}
        />
      ) : (
        <SiteSetupPanel />
      )}
    </DashboardPageFrame>
  );
}

function getSearchParamValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === "string" && value[0].length > 0
      ? value[0]
      : null;
  }

  return null;
}
