import {
  fetchWithAction,
  getStringOrNumber,
  getStringValue,
  parseJsonObject,
  parseNullableNumber,
} from "./shared";

const HOMEWIZARD_LOCAL_REQUEST_TIMEOUT_MS = 2_000;

interface HomeWizardLocalRequestOptions {
  requestTimeoutMs?: number;
}

export interface HomeWizardLocalSnapshot {
  apiVersion: string | null;
  capabilities: string[];
  data: Record<string, unknown> | null;
  firmwareVersion: string | null;
  powerW: number | null;
  productName: string | null;
  productType: string | null;
  serial: string | null;
}

export async function fetchHomeWizardLocalSnapshot(
  host: string,
  options: HomeWizardLocalRequestOptions = {},
): Promise<HomeWizardLocalSnapshot> {
  const device = await fetchHomeWizardJson(
    host,
    "/api",
    "HomeWizard API request",
    options,
  );
  const data = await fetchHomeWizardJson(
    host,
    "/api/v1/data",
    "HomeWizard data request",
    options,
  ).catch(() => null);

  return buildHomeWizardLocalSnapshot(device, data);
}

export function buildHomeWizardLocalSnapshot(
  device: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
): HomeWizardLocalSnapshot {
  return {
    apiVersion: getStringValue(device?.api_version),
    capabilities: parseCapabilities(device, data),
    data,
    firmwareVersion: getStringValue(device?.firmware_version),
    powerW: parseHomeWizardPowerW(data),
    productName: getStringValue(device?.product_name),
    productType: getStringValue(device?.product_type),
    serial: getStringValue(device?.serial),
  };
}

export function formatHomeWizardDetails(
  snapshot: HomeWizardLocalSnapshot,
): string {
  const details: string[] = [];

  if (snapshot.productType) {
    details.push(`type ${snapshot.productType}`);
  }

  if (snapshot.powerW !== null) {
    details.push(`power ${Math.round(snapshot.powerW)} W`);
  }

  if (snapshot.capabilities.length > 0) {
    details.push(`capabilities ${snapshot.capabilities.join("/")}`);
  }

  if (snapshot.firmwareVersion) {
    details.push(`firmware ${snapshot.firmwareVersion}`);
  }

  if (snapshot.serial) {
    details.push(`serial ${snapshot.serial}`);
  }

  return details.length > 0 ? details.join(", ") : "HomeWizard local API";
}

export function isHomeWizardSmartPlug(
  snapshot: HomeWizardLocalSnapshot,
): boolean {
  return matchesHomeWizardDevice(
    snapshot,
    ["smart plug", "socket", "plug"],
    ["HWE-SKT", "HWE-SOCKET", "HWE-PLUG"],
  );
}

export function isHomeWizardCt(snapshot: HomeWizardLocalSnapshot): boolean {
  return matchesHomeWizardDevice(
    snapshot,
    ["ct", "kwh meter", "energy meter"],
    ["HWE-CT", "HWE-KWH", "HWE-KWH1", "HWE-KWH3"],
  );
}

async function fetchHomeWizardJson(
  host: string,
  path: string,
  action: string,
  options: HomeWizardLocalRequestOptions,
): Promise<Record<string, unknown> | null> {
  const url = `http://${host}:80${path}`;
  const response = await fetchWithAction(
    url,
    {
      headers: {
        accept: "application/json",
      },
      method: "GET",
      signal: AbortSignal.timeout(
        options.requestTimeoutMs ?? HOMEWIZARD_LOCAL_REQUEST_TIMEOUT_MS,
      ),
    },
    action,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return parseJsonObject(await response.text());
}

function parseHomeWizardPowerW(
  data: Record<string, unknown> | null,
): number | null {
  return (
    parseNullableNumber(data?.active_power_w) ??
    parseNullableNumber(data?.active_power_l1_w) ??
    parseNullableNumber(data?.active_power_l2_w) ??
    parseNullableNumber(data?.active_power_l3_w)
  );
}

function parseCapabilities(
  device: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
): string[] {
  const capabilities = new Set<string>();
  const rawCapabilities = device?.capabilities;

  if (Array.isArray(rawCapabilities)) {
    for (const capability of rawCapabilities) {
      const value = getStringOrNumber(capability);
      if (value) {
        capabilities.add(value);
      }
    }
  }

  if (data) {
    for (const key of Object.keys(data)) {
      if (key.includes("power")) {
        capabilities.add("power");
      }
      if (key.includes("energy") || key.startsWith("total_")) {
        capabilities.add("energy");
      }
      if (key === "switch_state" || key === "relay_state") {
        capabilities.add("switch");
      }
    }
  }

  return [...capabilities].sort();
}

function matchesHomeWizardDevice(
  snapshot: HomeWizardLocalSnapshot,
  productNameParts: string[],
  productTypes: string[],
): boolean {
  const productName = snapshot.productName?.toLowerCase() ?? "";
  const productType = snapshot.productType?.toUpperCase() ?? "";

  return (
    productNameParts.some((part) => productName.includes(part)) ||
    productTypes.some(
      (type) => productType === type || productType.startsWith(`${type}-`),
    )
  );
}
