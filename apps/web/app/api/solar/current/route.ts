import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authOptions } from "../../../../auth";
import { getLiveStatus } from "../../../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getLiveStatus();
  const siteId = request.nextUrl.searchParams.get("siteId");
  const site = siteId
    ? (snapshot.sites.find((entry) => entry.id === siteId) ?? null)
    : (snapshot.sites[0] ?? null);

  const currentGeneratedPower =
    site?.devices
      .filter((device) => device.kind === "solar-energy-provider")
      .reduce<number | null>((total, device) => {
        const powerW = device.telemetry?.powerW;

        if (typeof powerW !== "number") {
          return total;
        }

        return total === null ? powerW : total + powerW;
      }, null) ?? null;

  return NextResponse.json({ currentGeneratedPower });
}
