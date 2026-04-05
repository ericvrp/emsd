import type { BatteryRecord } from "@emsd/core";
import {
  type DiscoveredDevice,
  discoverDevices,
  discoverHostDevices,
  getPreferredDiscoveryTarget,
} from "./discover";
import {
  createBattery,
  deleteBattery,
  listBatteries,
  setBatteryEnabled,
} from "./managed-site-store";

interface BatteryAddOptions {
  host: string | null;
}

export function formatBatteryHelpText(): string {
  return [
    "Usage:",
    "  battery list",
    "  battery add <discovery-id> [--host <ipv4>]",
    "  battery remove <battery-id>",
    "  battery enable <battery-id>",
    "  battery disable <battery-id>",
  ].join("\n");
}

export function formatBatteryList(batteries: BatteryRecord[]): string {
  if (batteries.length === 0) {
    return "No batteries configured for the active site.";
  }

  const header = [
    "NAME",
    "STATUS",
    "ENABLED",
    "CONNECTED",
    "MODEL",
    "IP ADDRESS",
    "UPDATED AT",
  ].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = batteries.map((battery) =>
    [
      battery.name,
      battery.status,
      battery.enabled ? "yes" : "no",
      battery.connected ? "yes" : "no",
      battery.model,
      battery.ipAddress,
      battery.updatedAt,
    ].join(" | "),
  );

  return [header, separator, ...rows].join("\n");
}

export async function runBatteryCommand(args: string[] = []): Promise<number> {
  try {
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args[0] === "--help" ||
      args[0] === "-h"
    ) {
      console.log(formatBatteryHelpText());
      return 0;
    }

    if (args[0] === "list") {
      console.log(formatBatteryList(listBatteries()));
      return 0;
    }

    if (args[0] === "add") {
      const discoveryId = args[1];

      if (!discoveryId) {
        throw new Error("Missing discovery id for battery add");
      }

      const options = parseBatteryAddOptions(args.slice(2));
      const discovered = await resolveDiscoveredDevice(
        discoveryId,
        "battery",
        options,
      );

      if (!discovered) {
        throw new Error(
          `Discovered battery not available right now: ${discoveryId}`,
        );
      }

      console.log(
        JSON.stringify(
          createBattery({
            name: discovered.name,
            adapter: discovered.model,
            model: discovered.model,
            ipAddress: discovered.ipAddress,
            connected: true,
            enabled: true,
            status: inferBatteryStatus(discovered.details),
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
        throw new Error(`Missing battery id for ${args[0]}`);
      }

      const battery = setBatteryEnabled(id, args[0] === "enable");

      if (!battery) {
        throw new Error(`Managed battery not found: ${id}`);
      }

      console.log(JSON.stringify(battery, null, 2));
      return 0;
    }

    if (args[0] === "remove") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing battery id for remove");
      }

      const battery = deleteBattery(id);

      if (!battery) {
        throw new Error(`Managed battery not found: ${id}`);
      }

      console.log(JSON.stringify(battery, null, 2));
      return 0;
    }

    throw new Error(`Unknown battery command: ${args[0]}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(formatBatteryHelpText());
    return 1;
  }
}

function parseBatteryAddOptions(args: string[]): BatteryAddOptions {
  const options: BatteryAddOptions = {
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

    throw new Error(`Unknown battery option: ${arg}`);
  }

  return options;
}

async function resolveDiscoveredDevice(
  discoveryId: string,
  category: DiscoveredDevice["category"],
  options: BatteryAddOptions,
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

function inferBatteryStatus(details: string): BatteryRecord["status"] {
  const matchedState = details.match(/state\s+([^,]+)/i)?.[1]?.trim();

  if (
    matchedState === "idle" ||
    matchedState === "charging" ||
    matchedState === "discharging"
  ) {
    return matchedState;
  }

  return "idle";
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
