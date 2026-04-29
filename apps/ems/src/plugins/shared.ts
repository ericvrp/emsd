import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;
type FetchHeadersInit = FetchInit["headers"];
type FetchBodyInit = FetchInit["body"];

export function matchesPatterns(
  patterns: string[],
  responseText: string,
): boolean {
  return patterns.every((pattern) => new RegExp(pattern).test(responseText));
}

export async function fetchWithLanFallback(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (!shouldUseCurlFallback(url, error)) {
      throw error;
    }

    return fetchViaCurl(url, init, error);
  }
}

export async function fetchWithAction(
  url: string,
  init: RequestInit,
  action: string,
): Promise<Response> {
  try {
    return await fetchWithLanFallback(url, init);
  } catch (error) {
    throw new Error(formatFetchError(url, error, action));
  }
}

async function fetchViaCurl(
  url: string,
  init: RequestInit,
  originalError: unknown,
): Promise<Response> {
  const marker = "__EMSD_CURL_HTTP_STATUS__:";
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    formatCurlTimeoutSeconds(init.signal),
    "--request",
    init.method ?? "GET",
    ...formatCurlHeaders(init.headers),
  ];

  if (shouldUseInsecureTls(init)) {
    args.push("--insecure");
  }

  const body = normalizeRequestBody(init.body);

  if (body !== null) {
    args.push("--data-binary", body);
  }

  args.push("--output", "-");
  args.push("--write-out", `${marker}%{http_code}`);
  args.push(url);

  try {
    const { stdout } = await execFileAsync("curl", args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    const markerIndex = stdout.lastIndexOf(marker);

    if (markerIndex === -1) {
      throw new Error("curl fallback returned no HTTP status marker.");
    }

    const responseBody = stdout.slice(0, markerIndex);
    const statusText = stdout.slice(markerIndex + marker.length).trim();
    const status = Number.parseInt(statusText, 10);

    if (!Number.isInteger(status) || status < 100) {
      throw new Error(`curl fallback returned invalid HTTP status: ${statusText}`);
    }

    return new Response(responseBody, { status });
  } catch (curlError) {
    throw new Error(
      `${getErrorMessage(originalError)}; curl fallback failed: ${getErrorMessage(curlError)}`,
    );
  }
}

function shouldUseCurlFallback(url: string, error: unknown): boolean {
  if (!isLanIpv4Url(url)) {
    return false;
  }

  const normalized = getErrorMessage(error).toLowerCase();

  return (
    normalized.includes("failedtoopensocket") ||
    normalized.includes("was there a typo in the url or port?") ||
    normalized.includes("unable to connect") ||
    normalized.includes("failed to connect") ||
    normalized.includes("couldn't connect") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("no route to host") ||
    normalized.includes("ehostunreach") ||
    normalized.includes("enetunreach")
  );
}

function isLanIpv4Url(url: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const { hostname } = parsed;

  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return false;
  }

  const octets = hostname.split(".").map(Number);
  const first = octets[0];
  const second = octets[1];

  if (first === undefined || second === undefined) {
    return false;
  }

  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function formatCurlTimeoutSeconds(signal: AbortSignal | null | undefined): string {
  if (!signal) {
    return "2";
  }

  if (typeof signal.throwIfAborted === "function") {
    try {
      signal.throwIfAborted();
    } catch {
      return "1";
    }
  }

  return "2";
}

function formatCurlHeaders(headers: FetchHeadersInit | undefined): string[] {
  if (!headers) {
    return [];
  }

  const normalized = new Headers(headers);
  const args: string[] = [];

  for (const [key, value] of normalized.entries()) {
    args.push("--header", `${key}: ${value}`);
  }

  return args;
}

function shouldUseInsecureTls(init: RequestInit): boolean {
  const candidate = init as RequestInit & {
    tls?: { rejectUnauthorized?: boolean };
  };

  return candidate.tls?.rejectUnauthorized === false;
}

function normalizeRequestBody(body: FetchBodyInit | null | undefined): string | null {
  if (body === null || body === undefined) {
    return null;
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  return null;
}

export function formatFetchError(
  url: string,
  error: unknown,
  action: string,
): string {
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();

  if (isAbortError(error) || /timed? out/.test(normalized)) {
    return `${action} timed out for ${url}. Check that the device is online and responding.`;
  }

  if (
    normalized.includes("was there a typo in the url or port?") ||
    normalized.includes(
      "unable to connect. is the computer able to access the url?",
    ) ||
    normalized.includes("failed to connect") ||
    normalized.includes("couldn't connect") ||
    normalized.includes("connection refused") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("no route to host") ||
    normalized.includes("econnrefused") ||
    normalized.includes("ehostunreach") ||
    normalized.includes("enetunreach") ||
    normalized.includes("enotfound")
  ) {
    return `${action} could not connect to ${url}. Check that the device is reachable on the LAN and that the protocol and port are correct.`;
  }

  if (
    normalized.includes("certificate") ||
    normalized.includes("tls") ||
    normalized.includes("ssl") ||
    normalized.includes("handshake")
  ) {
    return `${action} failed TLS negotiation for ${url}: ${message}`;
  }

  return `${action} failed for ${url}: ${message}`;
}

export function parseJsonObject(
  responseText: string,
): Record<string, unknown> | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

export function getStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getStringOrNumber(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

export function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (!error.message) {
      return error.name;
    }

    return error.name !== "Error"
      ? `${error.name}: ${error.message}`
      : error.message;
  }

  return String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
