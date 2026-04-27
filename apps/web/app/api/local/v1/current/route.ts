import { NextResponse } from "next/server";
import { validateLocalApiToken } from "../../../../../lib/local-api-auth";
import { buildLocalApiCurrent } from "../../../../../lib/local-current";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid authorization header" },
      { status: 401 },
    );
  }

  const token = authorization.slice(7).trim();

  if (!token || !validateLocalApiToken(token)) {
    return NextResponse.json(
      { error: "Invalid bearer token" },
      { status: 401 },
    );
  }

  return NextResponse.json(await buildLocalApiCurrent());
}
