import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "Forecast preview is not available." },
    { status: 410 },
  );
}
