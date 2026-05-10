import type { MeterRecord } from "@emsd/core";
import {
  type DiscoveredDevice,
  discoverDevices,
  discoverHostDevices,
  getPreferredDiscoveryTarget,
} from "./discover";
import { logEmsError } from "./logging";
import {
  createMeter,
  deleteMeter,
  listMeters,
  setMeterEnabled,
} from "./managed-site-store";

interface MeterAddOptions {
  host: string | null;
  siteId: string;
}

interface MeterCommandOptions {
  siteId: string;
}

interface ResolvedDiscoveredDevice {
  device: DiscoveredDevice | null;
  errorMessage: string | null;
}

export function formatMeterHelpText(): string {
  return [
    "Usage:",
    "  meter list --site-id <site-id>",
    "  meter ls --site-id <site-id>",
    "  meter add <discovery-id> --site-id <site-id> [--host <ipv4>]",
    "  meter create <discovery-id> --site-id <site-id> [--host <ipv4>]",
    "  meter remove <discovery-id> --site-id <site-id>",
    "  meter delete <discovery-id> --site-id <site-id>",
    "  meter rm <discovery-id> --site-id <site-id>",
    "  meter enable <discovery-id> --site-id <site-id>",
    "  meter disable <discovery-id> --site-id <site-id>",
  ].join("\n");
}

export function formatMeterList(meters: MeterRecord[]): string {
  if (meters.length === 0) {
    return "No meters configured for the selected site.";
  }

  const header = [
    "DISCOVERY ID",
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
      meter.id,
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

    if (args[0] === "list" || args[0] === "ls") {
      const options = parseMeterCommandOptions(args.slice(1));
      console.log(formatMeterList(listMeters(options.siteId)));
      return 0;
    }

    if (args[0] === "add" || args[0] === "create") {
      const discoveryId = args[1];

      if (!discoveryId) {
        throw new Error("Missing discovery id for meter add");
      }

      const options = parseMeterAddOptions(args.slice(2));
      const resolved = await resolveDiscoveredDevice(
        discoveryId,
        "meter",
        options,
      );

      if (!resolved.device) {
        throw new Error(
          resolved.errorMessage ??
            `Discovered meter not found or not reachable right now: ${discoveryId}`,
        );
      }

      const discovered = resolved.device;

      console.log(
        JSON.stringify(
          createMeter(
            {
              id: discoveryId,
              name: discovered.name,
              model: discovered.model,
              ipAddress: discovered.ipAddress,
              connected: true,
              enabled: true,
              details: discovered.details,
            },
            options.siteId,
          ),
          null,
          2,
        ),
      );
      return 0;
    }

    if (args[0] === "enable" || args[0] === "disable") {
      const id = args[1];

      if (!id) {
        throw new Error(`Missing discovery id for ${args[0]}`);
      }

      const options = parseMeterCommandOptions(args.slice(2));
      const meter = setMeterEnabled(id, args[0] === "enable", options.siteId);

      if (!meter) {
        throw new Error(`Managed meter not found: ${id}`);
      }

      console.log(JSON.stringify(meter, null, 2));
      return 0;
    }

    if (args[0] === "remove" || args[0] === "delete" || args[0] === "rm") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing discovery id for remove");
      }

      const options = parseMeterCommandOptions(args.slice(2));
      const meter = deleteMeter(id, options.siteId);

      if (!meter) {
        throw new Error(`Managed meter not found: ${id}`);
      }

      console.log(JSON.stringify(meter, null, 2));
      return 0;
    }

    throw new Error(`Unknown meter command: ${args[0]}`);
  } catch (error) {
    logEmsError(error instanceof Error ? error.message : String(error));
    console.log(formatMeterHelpText());
    return 1;
  }
}

function parseMeterAddOptions(args: string[]): MeterAddOptions {
  const options: MeterAddOptions = {
    host: null,
    siteId: parseRequiredSiteId(args),
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

    if (arg === "--site-id") {
      index += 1;
      continue;
    }

    throw new Error(`Unknown meter option: ${arg}`);
  }

  return options;
}

function parseMeterCommandOptions(args: string[]): MeterCommandOptions {
  return {
    siteId: parseRequiredSiteId(args),
  };
}

function parseRequiredSiteId(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--site-id") {
      continue;
    }

    const siteId = args[index + 1];

    if (!siteId) {
      throw new Error("Missing value for --site-id");
    }

    return siteId;
  }

  throw new Error("Missing required option: --site-id <site-id>");
}

async function resolveDiscoveredDevice(
  discoveryId: string,
  category: DiscoveredDevice["category"],
  options: MeterAddOptions,
): Promise<ResolvedDiscoveredDevice> {
  const devices = options.host
    ? await discoverHostDevices(options.host, {
        verbose: false,
        host: options.host,
      })
    : await discoverCurrentSubnet();

  const exactMatch = devices.find(
    (device) => device.discoveryId === discoveryId,
  );

  if (!exactMatch) {
    return {
      device: null,
      errorMessage: `Discovered ${category} not found or not reachable right now: ${discoveryId}`,
    };
  }

  if (exactMatch.category !== category) {
    const suggestedCommand = `${exactMatch.category} add ${discoveryId}`;

    return {
      device: null,
      errorMessage: `Discovery id ${discoveryId} is a ${exactMatch.category}, not a ${category}; use '${suggestedCommand}' instead`,
    };
  }

  return {
    device: exactMatch,
    errorMessage: null,
  };
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
