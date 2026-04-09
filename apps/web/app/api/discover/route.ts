import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../auth";
import { signDiscoveredDevice } from "../../../lib/discovery-proof";
import { discoverDevices } from "../../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const host = url.searchParams.get("host");

  return NextResponse.json(
    (await discoverDevices(host)).map((device) => signDiscoveredDevice(device)),
  );
}
