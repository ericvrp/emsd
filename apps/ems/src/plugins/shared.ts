export function matchesPatterns(patterns: string[], responseText: string): boolean {
  return patterns.every((pattern) => new RegExp(pattern).test(responseText));
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
