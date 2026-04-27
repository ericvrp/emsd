import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoRoot } from "@emsd/core";

function getTokenHashPath(): string {
  return join(getRepoRoot(), "var", "local-api-token.hash");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function validateLocalApiToken(token: string): boolean {
  if (!token || token.length === 0) {
    return false;
  }

  const envToken = process.env.EMSD_LOCAL_API_TOKEN?.trim();

  if (envToken) {
    const actual = Buffer.from(token, "utf8");
    const expected = Buffer.from(envToken, "utf8");

    if (actual.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(actual, expected);
  }

  const hashPath = getTokenHashPath();

  if (!existsSync(hashPath)) {
    return false;
  }

  const storedHash = readFileSync(hashPath, "utf8").trim();

  if (!storedHash) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(hashToken(token), "utf8"),
    Buffer.from(storedHash, "utf8"),
  );
}

export function generateLocalApiToken(): string {
  const token = randomBytes(32).toString("hex");
  const hash = hashToken(token);
  const hashPath = getTokenHashPath();

  mkdirSync(join(hashPath, ".."), { recursive: true });
  writeFileSync(hashPath, `${hash}\n`, "utf8");

  return token;
}

export function isEnvConfiguredToken(): boolean {
  return Boolean(process.env.EMSD_LOCAL_API_TOKEN?.trim());
}

export function hasConfiguredToken(): boolean {
  if (process.env.EMSD_LOCAL_API_TOKEN?.trim()) {
    return true;
  }

  const hashPath = getTokenHashPath();

  return (
    existsSync(hashPath) && readFileSync(hashPath, "utf8").trim().length > 0
  );
}

export function revokeLocalApiToken(): void {
  const hashPath = getTokenHashPath();

  if (existsSync(hashPath)) {
    writeFileSync(hashPath, "", "utf8");
  }
}
