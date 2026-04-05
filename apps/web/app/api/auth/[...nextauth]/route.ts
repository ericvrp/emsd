import NextAuth from "next-auth";
import { authOptions } from "../../../../auth";

function buildHandler(request: Request) {
  process.env.AUTH_TRUST_HOST = "true";
  process.env.NEXTAUTH_URL = new URL(request.url).origin;
  return NextAuth(authOptions);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  return buildHandler(request)(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  return buildHandler(request)(request, context);
}
