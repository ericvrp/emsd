import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../auth";

export const dynamic = "force-dynamic";

interface NominatimResult {
  lat: string;
  lon: string;
}

function formatGpsCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      { error: "Missing geocode query." },
      { status: 400 },
    );
  }

  const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
  searchUrl.searchParams.set("format", "jsonv2");
  searchUrl.searchParams.set("limit", "1");
  searchUrl.searchParams.set("q", query);

  const response = await fetch(searchUrl, {
    headers: {
      "Accept-Language": "en",
      "User-Agent": "EMSD/0.1 (site geocoder)",
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Geocoding request failed with status ${response.status}.` },
      { status: 502 },
    );
  }

  const results = (await response.json()) as NominatimResult[];
  const match = results[0];

  if (!match) {
    return NextResponse.json(
      { error: `No GPS location found for '${query}'.` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    location: formatGpsCoordinate(Number(match.lat), Number(match.lon)),
  });
}
