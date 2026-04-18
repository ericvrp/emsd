import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authOptions } from "../../../../auth";
import {
  getDynamicPriceSnapshot,
  getHistoryArchive,
  getLiveStatus,
} from "../../../../lib/ems-bridge";
import { buildPriceMarkerPeriodStarts } from "../../../../lib/price-selection";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = request.nextUrl.searchParams.get("siteId");

  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  const [archive, snapshot] = await Promise.all([
    getHistoryArchive({ siteId }),
    getLiveStatus(),
  ]);
  const site = snapshot.sites.find((entry) => entry.id === siteId) ?? null;
  let dynamicPriceSnapshot = null;
  let dynamicPriceSnapshotError: string | null = null;

  if (site?.dynamicPriceSources[0]) {
    try {
      dynamicPriceSnapshot = await getDynamicPriceSnapshot({ siteId });
    } catch (error) {
      dynamicPriceSnapshotError =
        error instanceof Error ? error.message : String(error);
    }
  }

  const { highestMarkerPeriodStarts, lowestMarkerPeriodStarts } =
    buildPriceMarkerPeriodStarts(archive);

  return NextResponse.json({
    archive,
    dynamicPriceSnapshot,
    dynamicPriceSnapshotError,
    highestMarkerPeriodStarts,
    lowestMarkerPeriodStarts,
  });
}
