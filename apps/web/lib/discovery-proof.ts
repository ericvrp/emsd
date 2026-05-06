import { createHmac, timingSafeEqual } from "node:crypto";

export interface DiscoveredDevice {
  category: "battery" | "meter" | "solar-energy-provider";
  details: string;
  discoveryId: string;
  ipAddress: string;
  model: string;
  name: string;
  port: number | null;
  powerW: number | null;
  socPercent: number | null;
  state: "idle" | "charging" | "discharging" | "connected" | "offline" | null;
}

export interface SignedDiscoveredDevice extends DiscoveredDevice {
  discoveryExpiresAt: string;
  discoveryIssuedAt: string;
  discoveryProof: string;
}

const DISCOVERY_PROOF_VERSION = "v1";
const DISCOVERY_PROOF_TTL_MS = 15 * 60 * 1_000;

export function signDiscoveredDevice(
  device: DiscoveredDevice,
  now = new Date(),
): SignedDiscoveredDevice {
  const discoveryIssuedAt = now.toISOString();
  const discoveryExpiresAt = new Date(
    now.getTime() + DISCOVERY_PROOF_TTL_MS,
  ).toISOString();

  return {
    ...device,
    discoveryExpiresAt,
    discoveryIssuedAt,
    discoveryProof: createDiscoveryProof({
      device,
      discoveryExpiresAt,
      discoveryIssuedAt,
    }),
  };
}

export function verifySignedDiscoveredDevice(
  value: unknown,
  now = new Date(),
): DiscoveredDevice {
  if (!isSignedDiscoveredDevice(value)) {
    throw new Error("Invalid discovered device payload.");
  }

  const signedDevice = value;
  const expiresAt = new Date(signedDevice.discoveryExpiresAt).getTime();

  if (Number.isNaN(expiresAt)) {
    throw new Error("Discovery result expiry is invalid.");
  }

  if (expiresAt < now.getTime()) {
    throw new Error("Discovery result expired. Run discovery again.");
  }

  const expectedProof = createDiscoveryProof({
    device: toUnsignedDiscoveredDevice(signedDevice),
    discoveryExpiresAt: signedDevice.discoveryExpiresAt,
    discoveryIssuedAt: signedDevice.discoveryIssuedAt,
  });

  const actualBuffer = Buffer.from(signedDevice.discoveryProof, "hex");
  const expectedBuffer = Buffer.from(expectedProof, "hex");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Discovery result proof is invalid. Run discovery again.");
  }

  return toUnsignedDiscoveredDevice(signedDevice);
}

export function isSignedDiscoveredDevice(
  value: unknown,
): value is SignedDiscoveredDevice {
  if (!isDiscoveredDevice(value)) {
    return false;
  }

  const candidate = value as unknown as Record<string, unknown>;

  return (
    typeof candidate.discoveryExpiresAt === "string" &&
    typeof candidate.discoveryIssuedAt === "string" &&
    typeof candidate.discoveryProof === "string"
  );
}

export function isDiscoveredDevice(value: unknown): value is DiscoveredDevice {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.category === "battery" ||
      candidate.category === "meter" ||
      candidate.category === "solar-energy-provider") &&
    typeof candidate.details === "string" &&
    typeof candidate.discoveryId === "string" &&
    typeof candidate.ipAddress === "string" &&
    typeof candidate.model === "string" &&
    typeof candidate.name === "string" &&
    (typeof candidate.port === "number" || candidate.port === null) &&
    (typeof candidate.powerW === "number" || candidate.powerW === null) &&
    (typeof candidate.socPercent === "number" ||
      candidate.socPercent === null) &&
    (candidate.state === "idle" ||
      candidate.state === "charging" ||
      candidate.state === "discharging" ||
      candidate.state === "connected" ||
      candidate.state === "offline" ||
      candidate.state === null)
  );
}

function createDiscoveryProof(input: {
  device: DiscoveredDevice;
  discoveryExpiresAt: string;
  discoveryIssuedAt: string;
}): string {
  return createHmac("sha256", getDiscoveryProofSecret())
    .update(
      JSON.stringify({
        version: DISCOVERY_PROOF_VERSION,
        discoveryExpiresAt: input.discoveryExpiresAt,
        discoveryIssuedAt: input.discoveryIssuedAt,
        device: serializeDiscoveredDevice(input.device),
      }),
    )
    .digest("hex");
}

function getDiscoveryProofSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("Missing required environment variable: NEXTAUTH_SECRET");
  }

  return `${secret}:discovery-proof`;
}

function serializeDiscoveredDevice(device: DiscoveredDevice) {
  return {
    category: device.category,
    details: device.details,
    discoveryId: device.discoveryId,
    ipAddress: device.ipAddress,
    model: device.model,
    name: device.name,
    port: device.port,
    powerW: device.powerW,
    socPercent: device.socPercent,
    state: device.state,
  };
}

function toUnsignedDiscoveredDevice(
  device: SignedDiscoveredDevice,
): DiscoveredDevice {
  return serializeDiscoveredDevice(device);
}
