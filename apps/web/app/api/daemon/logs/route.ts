import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../auth";
import { getDaemonLogs } from "../../../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const day = searchParams.get("day");
  const limit = Number.parseInt(searchParams.get("limit") ?? "200", 10);

  return NextResponse.json(
    await getDaemonLogs({
      day,
      limit: Number.isFinite(limit) ? limit : 200,
    }),
  );
}
