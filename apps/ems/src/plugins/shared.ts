export function matchesPatterns(
  patterns: string[],
  responseText: string,
): boolean {
  return patterns.every((pattern) => new RegExp(pattern).test(responseText));
}

export async function fetchWithAction(
  url: string,
  init: RequestInit,
  action: string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(formatFetchError(url, error, action));
  }
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
