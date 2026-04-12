import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../auth";
import { getLiveStatus } from "../../../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getLiveStatus();
  const currentSite = snapshot.sites[0] ?? null;
  const batteryCount =
    currentSite?.devices.filter((device) => device.kind === "battery").length ??
    0;

  return NextResponse.json({
    batteryCount,
    currentSiteId: currentSite?.id ?? null,
    daemonRunning: snapshot.daemon.running,
  });
}
