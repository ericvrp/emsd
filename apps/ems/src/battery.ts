import { readFileSync } from "node:fs";
import {
  normalizeBatteryStrategyPlan,
  type BatteryStrategyPlanRecord,
} from "@emsd/core";
import type {
  BatteryManualState,
  BatteryRecord,
  BatteryStrategyMode,
} from "@emsd/core";
import { createBatteryPlugin } from "./battery-plugins";
import {
  type DiscoveredDevice,
  discoverDevices,
  discoverHostDevices,
  getPreferredDiscoveryTarget,
} from "./discover";
import {
  createBattery,
  deleteBattery,
  getBattery,
  listBatteries,
  setBatteryEnabled,
  setHouseStrategyPlan,
} from "./managed-site-store";

interface BatteryAddOptions {
  host: string | null;
  siteId: string;
}

interface BatteryCommandOptions {
  siteId: string;
}

interface BatteryStrategyPlanSetOptions extends BatteryCommandOptions {
  filePath: string;
}

interface ResolvedDiscoveredDevice {
  device: DiscoveredDevice | null;
  errorMessage: string | null;
}

export function formatBatteryHelpText(): string {
  return [
    "Usage:",
    "  battery list --site-id <site-id>",
    "  battery ls --site-id <site-id>",
    "  battery get <battery-id> --site-id <site-id>",
    "  battery add <discovery-id> --site-id <site-id> [--host <ipv4>]",
    "  battery create <discovery-id> --site-id <site-id> [--host <ipv4>]",
    "  battery remove <battery-id> --site-id <site-id>",
    "  battery delete <battery-id> --site-id <site-id>",
    "  battery rm <battery-id> --site-id <site-id>",
    "  battery enable <battery-id> --site-id <site-id>",
    "  battery disable <battery-id> --site-id <site-id>",
    "  battery strategy-plan get --site-id <site-id>",
    "  battery strategy-plan set --site-id <site-id> --file <path>",
  ].join("\n");
}

export function formatBatteryList(batteries: BatteryRecord[]): string {
  if (batteries.length === 0) {
    return "No batteries configured for the selected site.";
  }

  const header = [
    "BATTERY ID",
    "NAME",
    "STATUS",
    "STRATEGY",
    "MANUAL STATE",
    "MANUAL W",
    "ENABLED",
    "CONNECTED",
    "MODEL",
    "IP ADDRESS",
    "UPDATED AT",
  ].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = batteries.map((battery) =>
    [
      battery.id,
      battery.name,
      battery.status,
      battery.strategyMode,
      battery.manualState ?? "-",
      battery.manualPowerW !== null
        ? String(Math.round(battery.manualPowerW))
        : "-",
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

    if (args[0] === "list" || args[0] === "ls") {
      const options = parseBatteryCommandOptions(args.slice(1));
      console.log(formatBatteryList(listBatteries(options.siteId)));
      return 0;
    }

    if (args[0] === "get") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing battery id for get");
      }

      const options = parseBatteryCommandOptions(args.slice(2));
      const battery = getBattery(id, options.siteId);

      if (!battery) {
        throw new Error(`Managed battery not found: ${id}`);
      }

      const plugin = createBatteryPlugin(battery);
      const info = await plugin.getNormalizedInfo();
      console.log(
        JSON.stringify(
          {
            ...battery,
            capacityWh: info.capacityWh,
            currentW: info.currentW,
            socPercent: info.socPercent,
            strategyMode: info.strategyMode,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    if (args[0] === "add" || args[0] === "create") {
      const discoveryId = args[1];

      if (!discoveryId) {
        throw new Error("Missing discovery id for battery add");
      }

      const options = parseBatteryAddOptions(args.slice(2));
      const resolved = await resolveDiscoveredDevice(
        discoveryId,
        "battery",
        options,
      );

      if (!resolved.device) {
        throw new Error(
          resolved.errorMessage ??
            `Discovered battery not found or not reachable right now: ${discoveryId}`,
        );
      }

      const discovered = resolved.device;

      console.log(
        JSON.stringify(
          createBattery(
            {
              id: discoveryId,
              name: discovered.name,
              plugin: discovered.model,
              model: discovered.model,
              ipAddress: discovered.ipAddress,
              minimumDischargePercent: 10,
              manualChargeTargetSoc: 100,
              manualDischargeTargetSoc: 10,
              connected: true,
              enabled: true,
              status: inferBatteryStatus(discovered.details),
              strategyMode: inferBatteryStrategyMode(discovered.details),
              manualState: inferBatteryManualState(discovered.details),
              manualPowerW: inferBatteryPowerW(discovered.details),
              manualTargetSoc: 100,
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
        throw new Error(`Missing battery id for ${args[0]}`);
      }

      const options = parseBatteryCommandOptions(args.slice(2));
      const battery = setBatteryEnabled(
        id,
        args[0] === "enable",
        options.siteId,
      );

      if (!battery) {
        throw new Error(`Managed battery not found: ${id}`);
      }

      console.log(JSON.stringify(battery, null, 2));
      return 0;
    }

    if (args[0] === "remove" || args[0] === "delete" || args[0] === "rm") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing battery id for remove");
      }

      const options = parseBatteryCommandOptions(args.slice(2));
      const battery = deleteBattery(id, options.siteId);

      if (!battery) {
        throw new Error(`Managed battery not found: ${id}`);
      }

      console.log(JSON.stringify(battery, null, 2));
      return 0;
    }

    if (args[0] === "strategy-plan") {
      if (
        args.length === 1 ||
        args[1] === "help" ||
        args[1] === "--help" ||
        args[1] === "-h"
      ) {
        console.log(formatBatteryHelpText());
        return 0;
      }

      if (args[1] === "get") {
        if (args[2] === "--help" || args[2] === "-h" || args[2] === "help") {
          console.log(formatBatteryHelpText());
          return 0;
        }

        const options = parseBatteryCommandOptions(args.slice(2));
        console.log(
          JSON.stringify(getHouseStrategyPlan(options.siteId), null, 2),
        );
        return 0;
      }

      if (args[1] === "set") {
        if (args[2] === "--help" || args[2] === "-h" || args[2] === "help") {
          console.log(formatBatteryHelpText());
          return 0;
        }

        const options = parseBatteryStrategyPlanSetOptions(args.slice(2));
        console.log(
          JSON.stringify(
            setHouseStrategyPlan(
              { strategyPlan: readStrategyPlanFromFile(options) },
              options.siteId,
            ),
            null,
            2,
          ),
        );
        return 0;
      }

      throw new Error(`Unknown battery strategy-plan command: ${args[1] ?? "<missing>"}`);
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

    throw new Error(`Unknown battery option: ${arg}`);
  }

  return options;
}

function parseBatteryCommandOptions(args: string[]): BatteryCommandOptions {
  return {
    siteId: parseRequiredSiteId(args),
  };
}

function parseBatteryStrategyPlanSetOptions(
  args: string[],
): BatteryStrategyPlanSetOptions {
  const options: BatteryStrategyPlanSetOptions = {
    filePath: "",
    siteId: parseRequiredSiteId(args),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--site-id") {
      index += 1;
      continue;
    }

    if (arg === "--file") {
      const filePath = args[index + 1];

      if (!filePath) {
        throw new Error("Missing value for --file");
      }

      options.filePath = filePath;
      index += 1;
      continue;
    }

    throw new Error(`Unknown battery strategy-plan option: ${arg}`);
  }

  if (!options.filePath) {
    throw new Error("Missing required option: --file <path>");
  }

  return options;
}

function getHouseStrategyPlan(siteId: string): BatteryStrategyPlanRecord {
  const battery = listBatteries(siteId)[0] ?? null;

  if (!battery) {
    throw new Error(`No batteries found for site ${siteId}`);
  }

  return battery.strategyPlan;
}

function readStrategyPlanFromFile(
  options: BatteryStrategyPlanSetOptions,
): BatteryStrategyPlanRecord {
  const battery = listBatteries(options.siteId)[0] ?? null;

  if (!battery) {
    throw new Error(`No batteries found for site ${options.siteId}`);
  }

  return normalizeBatteryStrategyPlan({
    minimumDischargePercent: battery.minimumDischargePercent,
    strategy: {
      strategyMode: battery.strategyMode,
      manualState: battery.manualState,
      manualPowerW: battery.manualPowerW,
      manualChargeTargetSoc: battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
      manualTargetSoc: battery.manualTargetSoc,
    },
    value: JSON.parse(readFileSync(options.filePath, "utf8")),
  });
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
  options: BatteryAddOptions,
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

function inferBatteryManualState(details: string): BatteryManualState {
  const status = inferBatteryStatus(details);
  return status === "offline" ? "idle" : status;
}

function inferBatteryStrategyMode(details: string): BatteryStrategyMode {
  const matchedMode = details.match(/mode\s+([^,]+)/i)?.[1]?.trim();

  if (matchedMode === "self-consumption") {
    return "self-consumption";
  }

  if (matchedMode === "real-time control" || matchedMode === "manual") {
    return "manual";
  }

  return "auto";
}

function inferBatteryPowerW(details: string): number | null {
  const matchedPower = details.match(/power\s+(-?\d+)\s*W/i)?.[1];

  if (!matchedPower) {
    return null;
  }

  const parsed = Number(matchedPower);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function parseIntegerOption(value: string | undefined, label: string): number {
  if (!value) {
    throw new Error(`Missing value for ${label}`);
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer value for ${label}: ${value}`);
  }

  return parsed;
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
