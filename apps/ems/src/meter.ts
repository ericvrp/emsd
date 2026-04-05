import type { MeterRecord } from "@emsd/core";
import {
  type DiscoveredDevice,
  discoverDevices,
  discoverHostDevices,
  getPreferredDiscoveryTarget,
} from "./discover";
import {
  createMeter,
  deleteMeter,
  listMeters,
  setMeterEnabled,
} from "./managed-site-store";

interface MeterAddOptions {
  host: string | null;
}

export function formatMeterHelpText(): string {
  return [
    "Usage:",
    "  meter list",
    "  meter add <discovery-id> [--host <ipv4>]",
    "  meter remove <meter-id>",
    "  meter enable <meter-id>",
    "  meter disable <meter-id>",
  ].join("\n");
}

export function formatMeterList(meters: MeterRecord[]): string {
  if (meters.length === 0) {
    return "No meters configured for the active site.";
  }

  const header = [
    "NAME",
    "ENABLED",
    "CONNECTED",
    "MODEL",
    "IP ADDRESS",
    "DETAILS",
    "UPDATED AT",
  ].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = meters.map((meter) =>
    [
      meter.name,
      meter.enabled ? "yes" : "no",
      meter.connected ? "yes" : "no",
      meter.model,
      meter.ipAddress,
      meter.details,
      meter.updatedAt,
    ].join(" | "),
  );

  return [header, separator, ...rows].join("\n");
}

export async function runMeterCommand(args: string[] = []): Promise<number> {
  try {
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args[0] === "--help" ||
      args[0] === "-h"
    ) {
      console.log(formatMeterHelpText());
      return 0;
    }

    if (args[0] === "list") {
      console.log(formatMeterList(listMeters()));
      return 0;
    }

    if (args[0] === "add") {
      const discoveryId = args[1];

      if (!discoveryId) {
        throw new Error("Missing discovery id for meter add");
      }

      const options = parseMeterAddOptions(args.slice(2));
      const discovered = await resolveDiscoveredDevice(
        discoveryId,
        "meter",
        options,
      );

      if (!discovered) {
        throw new Error(
          `Discovered meter not available right now: ${discoveryId}`,
        );
      }

      console.log(
        JSON.stringify(
          createMeter({
            name: discovered.name,
            model: discovered.model,
            ipAddress: discovered.ipAddress,
            connected: true,
            enabled: true,
            details: discovered.details,
          }),
          null,
          2,
        ),
      );
      return 0;
    }

    if (args[0] === "enable" || args[0] === "disable") {
      const id = args[1];

      if (!id) {
        throw new Error(`Missing meter id for ${args[0]}`);
      }

      const meter = setMeterEnabled(id, args[0] === "enable");

      if (!meter) {
        throw new Error(`Managed meter not found: ${id}`);
      }

      console.log(JSON.stringify(meter, null, 2));
      return 0;
    }

    if (args[0] === "remove") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing meter id for remove");
      }

      const meter = deleteMeter(id);

      if (!meter) {
        throw new Error(`Managed meter not found: ${id}`);
      }

      console.log(JSON.stringify(meter, null, 2));
      return 0;
    }

    throw new Error(`Unknown meter command: ${args[0]}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(formatMeterHelpText());
    return 1;
  }
}

function parseMeterAddOptions(args: string[]): MeterAddOptions {
  const options: MeterAddOptions = {
    host: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--host") {
      const host = args[index + 1];

      if (!host) {
        throw new Error("Missing value for --host");
      }

      if (!isIpv4Address(host)) {
        throw new Error(`Invalid IPv4 address for --host: ${host}`);
      }

      options.host = host;
      index += 1;
      continue;
    }

    throw new Error(`Unknown meter option: ${arg}`);
  }

  return options;
}

async function resolveDiscoveredDevice(
  discoveryId: string,
  category: DiscoveredDevice["category"],
  options: MeterAddOptions,
): Promise<DiscoveredDevice | null> {
  const devices = options.host
    ? await discoverHostDevices(options.host, {
        verbose: false,
        host: options.host,
      })
    : await discoverCurrentSubnet();

  return (
    devices.find(
      (device) =>
        device.discoveryId === discoveryId && device.category === category,
    ) ?? null
  );
}

async function discoverCurrentSubnet(): Promise<DiscoveredDevice[]> {
  const target = getPreferredDiscoveryTarget();

  if (!target) {
    return [];
  }

  return discoverDevices([target.subnet], { verbose: false, host: null });
}

function isIpv4Address(value: string): boolean {
  const octets = value.split(".");

  if (octets.length !== 4) {
    return false;
  }

  return octets.every((octet) => {
    if (!/^\d+$/.test(octet)) {
      return false;
    }

    const parsed = Number(octet);
    return parsed >= 0 && parsed <= 255;
  });
}
