import {
  fetchWithAction,
  getStringValue,
  parseJsonObject,
  parseNullableNumber,
} from "./shared";

const SHELLY_LOCAL_REQUEST_TIMEOUT_MS = 2_000;

interface ShellyLocalRequestOptions {
  requestTimeoutMs?: number;
}

export interface ShellyLocalSnapshot {
  app: string | null;
  capabilities: string[];
  firmwareVersion: string | null;
  generation: number | null;
  id: string | null;
  model: string | null;
  name: string | null;
  outputEnabled: boolean | null;
  powerW: number | null;
}

export async function fetchShellyLocalSnapshot(
  host: string,
  options: ShellyLocalRequestOptions = {},
): Promise<ShellyLocalSnapshot> {
  const rpcDevice = await fetchShellyJson(
    host,
    "/rpc/Shelly.GetDeviceInfo",
    "Shelly device info request",
    options,
  ).catch(() => null);

  if (rpcDevice) {
    const rpcStatus = await fetchShellyJson(
      host,
      "/rpc/Switch.GetStatus?id=0",
      "Shelly switch status request",
      options,
    ).catch(() => null);

    return buildShellyRpcSnapshot(rpcDevice, rpcStatus);
  }

  const gen1Device = await fetchShellyJson(
    host,
    "/shelly",
    "Shelly device info request",
    options,
  );
  const gen1Status = await fetchShellyJson(
    host,
    "/status",
    "Shelly status request",
    options,
  ).catch(() => null);

  return buildShellyGen1Snapshot(gen1Device, gen1Status);
}

export function formatShellyDetails(snapshot: ShellyLocalSnapshot): string {
  const details: string[] = [];

  if (snapshot.model) {
    details.push(`model ${snapshot.model}`);
  }

  if (snapshot.powerW !== null) {
    details.push(`power ${Math.round(snapshot.powerW)} W`);
  }

  if (snapshot.outputEnabled !== null) {
    details.push(`switch ${snapshot.outputEnabled ? "on" : "off"}`);
  }

  if (snapshot.capabilities.length > 0) {
    details.push(`capabilities ${snapshot.capabilities.join("/")}`);
  }

  if (snapshot.firmwareVersion) {
    details.push(`firmware ${snapshot.firmwareVersion}`);
  }

  if (snapshot.id) {
    details.push(`id ${snapshot.id}`);
  }

  return details.length > 0 ? details.join(", ") : "Shelly local API";
}

export function isShellyPlug(snapshot: ShellyLocalSnapshot): boolean {
  const app = snapshot.app?.toLowerCase() ?? "";
  const model = snapshot.model?.toLowerCase() ?? "";
  const name = snapshot.name?.toLowerCase() ?? "";
  const identifiers = [app, model, name].join(" ");

  return (
    identifiers.includes("plug") ||
    identifiers.includes("shplg") ||
    identifiers.includes("snpl") ||
    identifiers.includes("s3pl") ||
    identifiers.includes("splug") ||
    identifiers.includes("plusplugs") ||
    identifiers.includes("mini1pm") ||
    identifiers.includes("pmmini") ||
    (snapshot.capabilities.includes("power") &&
      snapshot.capabilities.includes("switch"))
  );
}

async function fetchShellyJson(
  host: string,
  path: string,
  action: string,
  options: ShellyLocalRequestOptions,
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
        options.requestTimeoutMs ?? SHELLY_LOCAL_REQUEST_TIMEOUT_MS,
      ),
    },
    action,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return parseJsonObject(await response.text());
}

function buildShellyRpcSnapshot(
  device: Record<string, unknown>,
  status: Record<string, unknown> | null,
): ShellyLocalSnapshot {
  const output = status?.output;

  return {
    app: getStringValue(device.app),
    capabilities: parseShellyCapabilities(status),
    firmwareVersion: getStringValue(device.fw_id) ?? getStringValue(device.ver),
    generation: parseShellyGeneration(device.gen),
    id: getStringValue(device.id),
    model: getStringValue(device.model),
    name: getStringValue(device.name),
    outputEnabled: typeof output === "boolean" ? output : null,
    powerW: parseNullableNumber(status?.apower),
  };
}

function buildShellyGen1Snapshot(
  device: Record<string, unknown> | null,
  status: Record<string, unknown> | null,
): ShellyLocalSnapshot {
  const relay = Array.isArray(status?.relays) ? status.relays[0] : null;
  const meter = Array.isArray(status?.meters) ? status.meters[0] : null;
  const output =
    relay && typeof relay === "object" && "ison" in relay
      ? (relay as { ison?: unknown }).ison
      : null;

  return {
    app: getStringValue(device?.type),
    capabilities: parseShellyCapabilities(status),
    firmwareVersion: getStringValue(device?.fw) ?? getStringValue(status?.mac),
    generation: 1,
    id: getStringValue(device?.mac) ?? getStringValue(status?.mac),
    model: getStringValue(device?.type),
    name: getStringValue(device?.name),
    outputEnabled: typeof output === "boolean" ? output : null,
    powerW:
      meter && typeof meter === "object"
        ? parseNullableNumber((meter as { power?: unknown }).power)
        : null,
  };
}

function parseShellyCapabilities(
  status: Record<string, unknown> | null,
): string[] {
  const capabilities = new Set<string>();

  if (!status) {
    return [];
  }

  if (parseNullableNumber(status.apower) !== null) {
    capabilities.add("power");
  }

  if (
    parseNullableNumber(status.aenergy) !== null ||
    (status.aenergy !== null && typeof status.aenergy === "object")
  ) {
    capabilities.add("energy");
  }

  if (typeof status.output === "boolean") {
    capabilities.add("switch");
  }

  if (Array.isArray(status.meters)) {
    capabilities.add("power");
    capabilities.add("energy");
  }

  if (Array.isArray(status.relays)) {
    capabilities.add("switch");
  }

  return [...capabilities].sort();
}

function parseShellyGeneration(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
