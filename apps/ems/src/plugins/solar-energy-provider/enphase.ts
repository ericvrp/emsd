import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import {
  fetchWithAction,
  getStringValue,
  parseJsonObject,
  parseNullableNumber,
} from "../shared";
import type { DiscoveryPlugin } from "../types";

const ENPHASE_DISCOVERY_MODEL = "enphase-local";
const ENPHASE_DISCOVERY_NAME = "Enphase IQ Gateway";
const ENLIGHTEN_AUTH_URL =
  "https://enlighten.enphaseenergy.com/login/login.json";
const ENLIGHTEN_TOKEN_URL = "https://entrez.enphaseenergy.com/tokens";

class EnphaseTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnphaseTerminalError";
  }
}

function isEnphaseTerminalError(error: unknown): boolean {
  return (
    error instanceof EnphaseTerminalError ||
    (error instanceof Error && error.name === "EnphaseTerminalError")
  );
}

type EnphaseLocalSession = {
  cookieHeader: string | null;
  token: string;
};

type EnphaseGatewayInfo = {
  firmwareVersion: string | null;
  model: string | null;
  serialNumber: string | null;
};

type EnphaseProductionInfo = {
  currentPowerW: number | null;
};

const enphaseSessionByHost = new Map<string, EnphaseLocalSession>();

export class EnphaseSolarEnergyProviderPlugin {
  constructor(private readonly provider: SolarEnergyProviderRecord) {}

  async getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo> {
    const production = await fetchProductionInfo(this.provider);

    return {
      currentPowerW: production.currentPowerW,
      status: production.currentPowerW === null ? "offline" : "connected",
    };
  }
}

export const enphaseSolarEnergyProviderDiscoveryPlugin: DiscoveryPlugin = {
  pluginType: "solar-energy-provider",
  category: "solar-energy-provider",
  model: ENPHASE_DISCOVERY_MODEL,
  name: ENPHASE_DISCOVERY_NAME,
  port: 80,
  schemes: ["http"],
  request: {
    path: "/info.xml",
    method: "GET",
  },
  supplementalRequest: {
    path: "/api/v1/production",
    method: "GET",
    headers: {
      accept: "application/json",
    },
  },
  response: {
    match: ["<sn>\\d+</sn>", "<(software|pn)>"],
  },
  buildDiscoveredDevice({ ipAddress, responseText, supplementalResponseText }) {
    const gatewayInfo = parseInfoXml(responseText);
    const productionPayload = parseJsonObject(supplementalResponseText ?? "");
    const production = parseApiV1ProductionPayload(productionPayload);
    const details: string[] = [];

    if (gatewayInfo.serialNumber) {
      details.push(`serial ${gatewayInfo.serialNumber}`);
    }

    if (gatewayInfo.firmwareVersion) {
      details.push(`firmware ${gatewayInfo.firmwareVersion}`);
    }

    if (production.currentPowerW !== null) {
      details.push(`power ${Math.round(production.currentPowerW)} W`);
    }

    return {
      category: "solar-energy-provider",
      details: details.join(", "),
      ipAddress,
      model: ENPHASE_DISCOVERY_MODEL,
      name: ENPHASE_DISCOVERY_NAME,
      powerW: production.currentPowerW,
      socPercent: null,
      state: production.currentPowerW === null ? null : "connected",
    };
  },
};

async function fetchGatewayInfo(host: string): Promise<EnphaseGatewayInfo> {
  const responseText = await fetchEnphaseText(host, "/info.xml", {
    allowAuthentication: false,
  }).catch(() => null);

  return responseText ? parseInfoXml(responseText) : emptyGatewayInfo();
}

async function fetchProductionInfo(
  provider: SolarEnergyProviderRecord,
): Promise<EnphaseProductionInfo> {
  const serialHint = provider.serialNumber;
  const detailedText = await fetchEnphaseText(
    provider.ipAddress,
    "/production.json?details=1",
    { serialHint },
  ).catch((error: unknown) => {
    if (isEnphaseTerminalError(error)) {
      throw error;
    }

    return null;
  });

  if (detailedText) {
    const payload = parseJsonObject(detailedText);
    const parsed = parseDetailedProductionPayload(payload);

    if (parsed.currentPowerW !== null) {
      return parsed;
    }
  }

  const fallbackText = await fetchEnphaseText(
    provider.ipAddress,
    "/api/v1/production",
    { serialHint },
  );
  return parseApiV1ProductionPayload(parseJsonObject(fallbackText));
}

async function fetchEnphaseText(
  host: string,
  path: string,
  options: { allowAuthentication?: boolean; serialHint?: string | null } = {},
): Promise<string> {
  const schemes: Array<"https" | "http"> = ["https", "http"];
  let lastError: unknown = null;

  for (const scheme of schemes) {
    try {
      return await fetchEnphaseTextForScheme(host, path, scheme, options);
    } catch (error) {
      if (isEnphaseTerminalError(error)) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Enphase request failed for ${host}${path}`);
}

async function fetchEnphaseTextForScheme(
  host: string,
  path: string,
  scheme: "https" | "http",
  options: { allowAuthentication?: boolean; serialHint?: string | null },
): Promise<string> {
  const url = buildEnphaseLocalUrl(host, path, scheme);
  const initialResponse = await fetchWithAction(
    url,
    {
      headers: { accept: "application/json, text/xml;q=0.9, */*;q=0.8" },
      method: "GET",
      ...buildEnphaseTlsOptions(scheme),
    },
    "Enphase local request",
  );

  if (initialResponse.ok) {
    return initialResponse.text();
  }

  if (initialResponse.status !== 401 || options.allowAuthentication === false) {
    throw new Error(
      `Enphase request failed with HTTP ${initialResponse.status} for ${url}`,
    );
  }

  if (scheme !== "https") {
    throw new Error(
      `Enphase local authentication requires HTTPS for ${host}${path}`,
    );
  }

  const session = await getAuthenticatedEnphaseSession(
    host,
    options.serialHint,
  ).catch((error: unknown) => {
    throw new EnphaseTerminalError(
      error instanceof Error ? error.message : String(error),
    );
  });
  const authenticatedResponse = await fetchWithAction(
    url,
    {
      headers: buildAuthenticatedLocalHeaders(session),
      method: "GET",
      ...buildEnphaseTlsOptions(scheme),
    },
    "Enphase local request",
  );

  if (!authenticatedResponse.ok) {
    if (authenticatedResponse.status === 401) {
      enphaseSessionByHost.delete(host);
    }

    throw new EnphaseTerminalError(
      `Authenticated Enphase request failed with HTTP ${authenticatedResponse.status} for ${url}`,
    );
  }

  return authenticatedResponse.text();
}

async function getAuthenticatedEnphaseSession(
  host: string,
  serialHint: string | null | undefined,
): Promise<EnphaseLocalSession> {
  const cached = enphaseSessionByHost.get(host);

  if (cached) {
    return cached;
  }

  const gatewayInfo = await fetchGatewayInfo(host);
  const serialNumber = gatewayInfo.serialNumber ?? serialHint ?? null;

  if (!serialNumber) {
    throw new Error(
      `Enphase gateway at ${host} requires authentication, but its serial number could not be read from /info.xml.`,
    );
  }

  const username = getRequiredEnv(
    "ENPHASE_ENLIGHTEN_USERNAME",
    "Set ENPHASE_ENLIGHTEN_USERNAME and ENPHASE_ENLIGHTEN_PASSWORD to authenticate with the Enphase local gateway.",
  );
  const password = getRequiredEnv(
    "ENPHASE_ENLIGHTEN_PASSWORD",
    "Set ENPHASE_ENLIGHTEN_USERNAME and ENPHASE_ENLIGHTEN_PASSWORD to authenticate with the Enphase local gateway.",
  );

  const token = await fetchEnphaseOwnerToken({
    password,
    serialNumber,
    username,
  });
  const session = await createLocalEnphaseSession(host, token);
  enphaseSessionByHost.set(host, session);
  return session;
}

async function fetchEnphaseOwnerToken(input: {
  password: string;
  serialNumber: string;
  username: string;
}): Promise<string> {
  const loginResponse = await fetchWithAction(
    ENLIGHTEN_AUTH_URL,
    {
      body: new URLSearchParams({
        "user[email]": input.username,
        "user[password]": input.password,
      }).toString(),
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    "Enphase Enlighten login request",
  );

  if (!loginResponse.ok) {
    throw new Error(
      `Enphase Enlighten login failed with HTTP ${loginResponse.status}.`,
    );
  }

  const loginPayload = (await loginResponse.json()) as {
    session_id?: string | null;
  };
  const sessionId = getStringValue(loginPayload.session_id);

  if (!sessionId) {
    throw new Error("Enphase Enlighten login did not return a session_id.");
  }

  const tokenResponse = await fetchWithAction(
    ENLIGHTEN_TOKEN_URL,
    {
      body: JSON.stringify({
        serial_num: input.serialNumber,
        session_id: sessionId,
        username: input.username,
      }),
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "content-type": "application/json",
      },
      method: "POST",
    },
    "Enphase owner token request",
  );

  if (!tokenResponse.ok) {
    throw new Error(
      `Enphase owner token request failed with HTTP ${tokenResponse.status}.`,
    );
  }

  const token = (await tokenResponse.text()).trim();

  if (!token) {
    throw new Error("Enphase owner token response was empty.");
  }

  return token;
}

async function createLocalEnphaseSession(
  host: string,
  token: string,
): Promise<EnphaseLocalSession> {
  const url = buildEnphaseLocalUrl(host, "/auth/check_jwt", "https");
  const response = await fetchWithAction(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: "GET",
      ...buildEnphaseTlsOptions("https"),
    },
    "Enphase local token exchange",
  );

  if (!response.ok) {
    throw new Error(
      `Enphase local token exchange failed with HTTP ${response.status} for ${url}.`,
    );
  }

  return {
    cookieHeader: normalizeSetCookieHeader(response.headers.get("set-cookie")),
    token,
  };
}

function buildAuthenticatedLocalHeaders(
  session: EnphaseLocalSession,
): Record<string, string> {
  return {
    accept: "application/json, text/xml;q=0.9, */*;q=0.8",
    Authorization: `Bearer ${session.token}`,
    ...(session.cookieHeader ? { Cookie: session.cookieHeader } : {}),
  };
}

function buildEnphaseLocalUrl(
  host: string,
  path: string,
  scheme: "https" | "http",
): string {
  return `${scheme}://${host}${path}`;
}

function buildEnphaseTlsOptions(scheme: "https" | "http"): RequestInit {
  return scheme === "https"
    ? ({ tls: { rejectUnauthorized: false } } as RequestInit)
    : {};
}

function parseInfoXml(responseText: string): EnphaseGatewayInfo {
  return {
    firmwareVersion: matchXmlTag(responseText, "software"),
    model: matchXmlTag(responseText, "pn"),
    serialNumber: matchXmlTag(responseText, "sn"),
  };
}

function parseDetailedProductionPayload(
  payload: Record<string, unknown> | null,
): EnphaseProductionInfo {
  const production = Array.isArray(payload?.production)
    ? (payload.production as unknown[])
    : [];
  const productionEntries = production
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null,
    )
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const meteredEntry =
    productionEntries.find(
      (entry) => getStringValue(entry.measurementType) === "production",
    ) ??
    productionEntries[1] ??
    productionEntries[0] ??
    null;

  return {
    currentPowerW: parseNullableNumber(meteredEntry?.wNow),
  };
}

function parseApiV1ProductionPayload(
  payload: Record<string, unknown> | null,
): EnphaseProductionInfo {
  return {
    currentPowerW: parseNullableNumber(payload?.wattsNow),
  };
}

function matchXmlTag(responseText: string, tagName: string): string | null {
  const matched = responseText.match(
    new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "i"),
  );
  return matched?.[1]?.trim() || null;
}

function normalizeSetCookieHeader(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const cookieParts = header
    .split(/,\s*(?=[^;,]+=)/)
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter((part) => part.length > 0);

  return cookieParts.length > 0 ? cookieParts.join("; ") : null;
}

function emptyGatewayInfo(): EnphaseGatewayInfo {
  return {
    firmwareVersion: null,
    model: null,
    serialNumber: null,
  };
}

function getRequiredEnv(name: string, message: string): string {
  const value = process.env[name]?.trim() ?? "";

  if (!value) {
    throw new Error(message);
  }

  return value;
}
