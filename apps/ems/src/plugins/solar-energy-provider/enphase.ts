import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderProductionControlStatus,
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
const ENPHASE_PRODUCTION_CONTROL_PATH = "/ivp/ss/dpel";
const ENLIGHTEN_AUTH_URL =
  "https://enlighten.enphaseenergy.com/login/login.json";
const ENLIGHTEN_TOKEN_URL = "https://entrez.enphaseenergy.com/tokens";

class EnphaseTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnphaseTerminalError";
  }
}

class EnphaseProductionControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnphaseProductionControlError";
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

type EnphaseProductionControlPayload = Record<string, unknown>;

type EnphaseRequestOptions = {
  allowAuthentication?: boolean;
  allowErrorStatus?: boolean;
  body?: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  serialHint?: string | null;
};

const enphaseSessionByHost = new Map<string, EnphaseLocalSession>();

export class EnphaseSolarEnergyProviderPlugin {
  constructor(private readonly provider: SolarEnergyProviderRecord) {}

  async getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo> {
    const production = await fetchProductionInfo(this.provider);
    const productionControlStatus: SolarEnergyProviderProductionControlStatus =
      await readProductionControlStatus(this.provider).catch(
        () => "unavailable",
      );

    return {
      currentPowerW: production.currentPowerW,
      productionControlStatus,
      status: production.currentPowerW === null ? "offline" : "connected",
    };
  }

  async setProductionEnabled(
    enabled: boolean,
  ): Promise<NormalizedSolarEnergyProviderInfo> {
    await setEnphaseProductionEnabled(this.provider, enabled);
    return this.getNormalizedInfo();
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
      port: 80,
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
    {
      serialHint,
    },
  );
  return parseApiV1ProductionPayload(parseJsonObject(fallbackText));
}

async function fetchEnphaseText(
  host: string,
  path: string,
  options: EnphaseRequestOptions = {},
): Promise<string> {
  const response = await fetchEnphaseResponse(host, path, options);
  return response.text();
}

async function fetchEnphaseResponse(
  host: string,
  path: string,
  options: EnphaseRequestOptions = {},
): Promise<Response> {
  const schemes: Array<"https" | "http"> = ["https", "http"];
  let lastError: unknown = null;

  for (const scheme of schemes) {
    try {
      return await fetchEnphaseResponseForScheme(host, path, scheme, options);
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

async function fetchEnphaseResponseForScheme(
  host: string,
  path: string,
  scheme: "https" | "http",
  options: EnphaseRequestOptions,
): Promise<Response> {
  const url = buildEnphaseLocalUrl(host, path, scheme);
  const method = options.method ?? "GET";
  const initialResponse = await fetchWithAction(
    url,
    {
      body: options.body,
      headers: buildEnphaseRequestHeaders(options.headers),
      method,
      ...buildEnphaseTlsOptions(scheme),
    },
    "Enphase local request",
  );

  if (
    initialResponse.ok ||
    (options.allowErrorStatus && initialResponse.status !== 401)
  ) {
    return initialResponse;
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
      body: options.body,
      headers: buildAuthenticatedLocalHeaders(session, options.headers),
      method,
      ...buildEnphaseTlsOptions(scheme),
    },
    "Enphase local request",
  );

  if (!authenticatedResponse.ok && !options.allowErrorStatus) {
    if (authenticatedResponse.status === 401) {
      enphaseSessionByHost.delete(host);
    }

    throw new EnphaseTerminalError(
      `Authenticated Enphase request failed with HTTP ${authenticatedResponse.status} for ${url}`,
    );
  }

  return authenticatedResponse;
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
  headers?: Record<string, string>,
): Record<string, string> {
  return {
    ...buildEnphaseRequestHeaders(headers),
    Authorization: `Bearer ${session.token}`,
    ...(session.cookieHeader ? { Cookie: session.cookieHeader } : {}),
  };
}

function buildEnphaseRequestHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  return {
    accept: "application/json, text/xml;q=0.9, */*;q=0.8",
    ...(headers ?? {}),
  };
}

async function readProductionControlStatus(
  provider: SolarEnergyProviderRecord,
): Promise<SolarEnergyProviderProductionControlStatus> {
  const payload = await readEnphaseProductionControlPayload(provider);
  return parseProductionControlStatus(payload, provider);
}

async function readEnphaseProductionControlPayload(
  provider: SolarEnergyProviderRecord,
): Promise<EnphaseProductionControlPayload> {
  if (isVerboseEnphaseProductionControlLoggingEnabled()) {
    console.log(
      `Polling Enphase production control via GET https://${provider.ipAddress}${ENPHASE_PRODUCTION_CONTROL_PATH} for provider ${provider.id}`,
    );
  }
  const response = await fetchEnphaseResponse(
    provider.ipAddress,
    ENPHASE_PRODUCTION_CONTROL_PATH,
    {
      allowErrorStatus: true,
      serialHint: provider.serialNumber,
    },
  ).catch((error: unknown) => {
    throw normalizeProductionControlSetupError(error, provider);
  });

  if (response.status === 404) {
    throw new EnphaseProductionControlError(
      `Enphase gateway at ${provider.ipAddress} does not expose the production control endpoint.`,
    );
  }

  if (response.status === 401) {
    throw new EnphaseProductionControlError(
      buildProductionControlAccessErrorMessage(provider, "read"),
    );
  }

  if (response.status === 403) {
    throw new EnphaseProductionControlError(
      `The current Enphase account does not have permission to read production control for provider ${provider.id}.`,
    );
  }

  if (!response.ok) {
    throw new EnphaseProductionControlError(
      `Enphase gateway rejected the production control status read with HTTP ${response.status} for provider ${provider.id}.`,
    );
  }

  const responseText = await response.text();
  if (isVerboseEnphaseProductionControlLoggingEnabled()) {
    console.log(
      `Enphase production control payload for provider ${provider.id} at ${provider.ipAddress}: ${responseText}`,
    );
  }
  const payload = parseJsonObject(responseText);

  if (!payload) {
    throw new EnphaseProductionControlError(
      `Enphase gateway returned an unreadable production control payload for provider ${provider.id}. EMSD can still read production telemetry, but this gateway's production-control response format is not yet supported.`,
    );
  }

  return payload;
}

function parseProductionControlStatus(
  payload: EnphaseProductionControlPayload,
  provider: SolarEnergyProviderRecord,
): SolarEnergyProviderProductionControlStatus {
  const booleanState = findControlBoolean(payload);

  if (booleanState !== null) {
    return booleanState ? "enabled" : "disabled";
  }

  const stringState = findControlString(payload);

  if (stringState !== null) {
    return stringState;
  }

  throw new EnphaseProductionControlError(
    `Enphase gateway did not report a recognized production control state for provider ${provider.id}. EMSD can still read production telemetry, but this gateway's production-control payload shape is not yet supported.`,
  );
}

async function setEnphaseProductionEnabled(
  provider: SolarEnergyProviderRecord,
  enabled: boolean,
): Promise<void> {
  const payload = await readEnphaseProductionControlPayload(provider);
  const nextPayload = buildProductionControlUpdatePayload(
    payload,
    enabled,
    provider,
  );
  console.log(
    `Posting Enphase production control via POST https://${provider.ipAddress}${ENPHASE_PRODUCTION_CONTROL_PATH} for provider ${provider.id}: targetState=${formatProductionControlState(enabled)} payload=${JSON.stringify(nextPayload)}`,
  );
  const response = await fetchEnphaseResponse(
    provider.ipAddress,
    ENPHASE_PRODUCTION_CONTROL_PATH,
    {
      allowErrorStatus: true,
      body: JSON.stringify(nextPayload),
      headers: { "content-type": "application/json" },
      method: "POST",
      serialHint: provider.serialNumber,
    },
  ).catch((error: unknown) => {
    throw normalizeProductionControlSetupError(error, provider);
  });

  if (response.status === 404) {
    throw new EnphaseProductionControlError(
      `Enphase gateway at ${provider.ipAddress} does not expose the production control endpoint.`,
    );
  }

  if (response.status === 401) {
    throw new EnphaseProductionControlError(
      buildProductionControlAccessErrorMessage(provider, "change"),
    );
  }

  if (response.status === 403) {
    throw new EnphaseProductionControlError(
      `The current Enphase account does not have permission to change production control for provider ${provider.id}.`,
    );
  }

  if (!response.ok) {
    const responseText = (await response.text()).trim();
    throw new EnphaseProductionControlError(
      `Enphase gateway rejected the production control update with HTTP ${response.status} for provider ${provider.id}${responseText ? `: ${responseText}` : "."}`,
    );
  }
}

function buildProductionControlUpdatePayload(
  payload: EnphaseProductionControlPayload,
  enabled: boolean,
  provider: SolarEnergyProviderRecord,
): EnphaseProductionControlPayload {
  const cloned = JSON.parse(
    JSON.stringify(payload),
  ) as EnphaseProductionControlPayload;

  if (applyControlBooleanUpdate(cloned, enabled)) {
    return cloned;
  }

  if (applyControlStringUpdate(cloned, enabled)) {
    return cloned;
  }

  throw new EnphaseProductionControlError(
    `Enphase gateway did not report a recognized top-level production control field for provider ${provider.id}. EMSD will not guess how to write this payload shape.`,
  );
}

function findControlBoolean(value: unknown): boolean | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (isEnabledKey(normalizedKey) && typeof entry === "boolean") {
      return entry;
    }

    if (isDisabledKey(normalizedKey) && typeof entry === "boolean") {
      return !entry;
    }
  }

  return null;
}

function findControlString(
  value: unknown,
): SolarEnergyProviderProductionControlStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (
      isEnabledKey(normalizedKey) ||
      isDisabledKey(normalizedKey) ||
      normalizedKey === "status" ||
      normalizedKey === "state"
    ) {
      const normalizedValue = normalizeControlStateString(entry);

      if (normalizedValue !== null) {
        return normalizedValue;
      }
    }
  }

  return null;
}

function applyControlBooleanUpdate(value: unknown, enabled: boolean): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  let changed = false;

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (isEnabledKey(normalizedKey) && typeof entry === "boolean") {
      (value as Record<string, unknown>)[key] = enabled;
      changed = true;
      continue;
    }

    if (isDisabledKey(normalizedKey) && typeof entry === "boolean") {
      (value as Record<string, unknown>)[key] = !enabled;
      changed = true;
    }
  }

  return changed;
}

function applyControlStringUpdate(value: unknown, enabled: boolean): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  let changed = false;

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (
      (isEnabledKey(normalizedKey) ||
        isDisabledKey(normalizedKey) ||
        normalizedKey === "status" ||
        normalizedKey === "state") &&
      typeof entry === "string" &&
      normalizeControlStateString(entry) !== null
    ) {
      (value as Record<string, unknown>)[key] = enabled
        ? "enabled"
        : "disabled";
      changed = true;
    }
  }

  return changed;
}

function normalizeControlStateString(
  value: unknown,
): SolarEnergyProviderProductionControlStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (["enabled", "enable", "on", "true"].includes(normalizedValue)) {
    return "enabled";
  }

  if (["disabled", "disable", "off", "false"].includes(normalizedValue)) {
    return "disabled";
  }

  return null;
}

function formatProductionControlState(
  enabled: boolean,
): "enabled" | "disabled" {
  return enabled ? "enabled" : "disabled";
}

function isVerboseEnphaseProductionControlLoggingEnabled(): boolean {
  return process.env.EMSD_VERBOSE === "1";
}

function isEnabledKey(key: string): boolean {
  return [
    "enabled",
    "enable",
    "productionenabled",
    "production_enabled",
    "enableproduction",
    "enable_production",
  ].includes(key);
}

function isDisabledKey(key: string): boolean {
  return [
    "disabled",
    "disable",
    "productiondisabled",
    "production_disabled",
    "disableproduction",
    "disable_production",
  ].includes(key);
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

function hasEnphaseOwnerCredentials(): boolean {
  return (
    (process.env.ENPHASE_ENLIGHTEN_USERNAME?.trim().length ?? 0) > 0 &&
    (process.env.ENPHASE_ENLIGHTEN_PASSWORD?.trim().length ?? 0) > 0
  );
}

function buildProductionControlAccessErrorMessage(
  provider: SolarEnergyProviderRecord,
  action: "read" | "change",
): string {
  const actionLabel = action === "read" ? "read" : "change";

  if (!hasEnphaseOwnerCredentials()) {
    return "Set ENPHASE_ENLIGHTEN_USERNAME and ENPHASE_ENLIGHTEN_PASSWORD to authenticate with the Enphase local gateway before using production control.";
  }

  return `Enphase production telemetry is reachable for provider ${provider.id}, but the gateway rejected the authenticated request to ${actionLabel} production control. This usually means production control is unsupported on this hardware or firmware, or your Enphase account lacks the extra privileges required for control even though telemetry works.`;
}

function normalizeProductionControlSetupError(
  error: unknown,
  provider: SolarEnergyProviderRecord,
): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  if (
    error.message.includes("ENPHASE_ENLIGHTEN_USERNAME") &&
    error.message.includes("ENPHASE_ENLIGHTEN_PASSWORD")
  ) {
    return new EnphaseProductionControlError(
      `Enphase production telemetry can still work from the daemon for provider ${provider.id}, but this production-control action runs through the EMS bridge process and that process does not currently have ENPHASE_ENLIGHTEN_USERNAME and ENPHASE_ENLIGHTEN_PASSWORD available. Ensure those variables are present for the web/EMS bridge process too, not only for the daemon shell or startup environment.`,
    );
  }

  return error;
}
