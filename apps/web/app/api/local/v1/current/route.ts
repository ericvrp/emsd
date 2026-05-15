import { NextResponse } from "next/server";
import { validateLocalApiToken } from "../../../../../lib/local-api-auth";
import { buildLocalApiEntityFilter } from "../../../../../lib/local-api-filters";
import {
  type LocalApiTimingBreakdown,
  buildLocalApiCurrent,
} from "../../../../../lib/local-current";

const LOCAL_API_CACHE_SECONDS = 10;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const timings: LocalApiTimingBreakdown = {};
  let status = 200;

  try {
    const authStartedAt = Date.now();
    const authorization = request.headers.get("authorization");

    if (!authorization || !authorization.startsWith("Bearer ")) {
      status = 401;
      timings.authMs = Date.now() - authStartedAt;
      return NextResponse.json(
        { error: "Missing or invalid authorization header" },
        { status: 401 },
      );
    }

    const token = authorization.slice(7).trim();

    if (!token || !validateLocalApiToken(token)) {
      status = 401;
      timings.authMs = Date.now() - authStartedAt;
      return NextResponse.json(
        { error: "Invalid bearer token" },
        { status: 401 },
      );
    }
    timings.authMs = Date.now() - authStartedAt;

    const filterStartedAt = Date.now();
    const exclude = buildLocalApiEntityFilter(url.searchParams);
    timings.filterMs = Date.now() - filterStartedAt;

    const body = await buildLocalApiCurrent(exclude, timings);
    const responseJsonStartedAt = Date.now();

    const response = NextResponse.json(body, {
      headers: {
        "Cache-Control": `private, max-age=${LOCAL_API_CACHE_SECONDS}`,
        Vary: "Authorization",
      },
    });
    timings.responseJsonMs = Date.now() - responseJsonStartedAt;
    return response;
  } catch (error) {
    status = 500;
    throw error;
  } finally {
    // console.log(
    //   `[local-api] GET ${url.pathname} status=${status} durationMs=${Date.now() - startedAt} ${formatTimingBreakdown(timings)} include=${url.searchParams.get("include") ?? ""} exclude=${url.searchParams.get("exclude") ?? ""}`,
    // );
  }
}

function formatTimingBreakdown(timings: LocalApiTimingBreakdown): string {
  return [
    ["authMs", timings.authMs],
    ["filterMs", timings.filterMs],
    ["liveStatusMs", timings.liveStatusMs],
    ["dynamicPriceSnapshotMs", timings.dynamicPriceSnapshotMs],
    ["weatherForecastMs", timings.weatherForecastMs],
    ["deviceGroupingAndComputeMs", timings.deviceGroupingAndComputeMs],
    ["historyArchiveMs", timings.historyArchiveMs],
    ["responseBuildMs", timings.responseBuildMs],
    ["derivedMarkersMs", timings.derivedMarkersMs],
    ["responseJsonMs", timings.responseJsonMs],
  ]
    .map(
      ([label, value]) => `${label}=${typeof value === "number" ? value : 0}`,
    )
    .join(" ");
}
