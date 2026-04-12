import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authOptions } from "../../../../auth";
import {
  getHistoryArchive,
  getLiveStatus,
  getWeatherForecast,
} from "../../../../lib/ems-bridge";

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
  let forecast = null;
  let forecastError: string | null = null;

  if (site?.weatherSources[0]) {
    try {
      forecast = await getWeatherForecast({
        hours: 48,
        periodMinutes: 15,
        siteId,
      });
    } catch (error) {
      forecastError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json({
    archive,
    forecast,
    forecastError,
  });
}
