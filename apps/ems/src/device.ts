import type { DiscoveryCategory } from "@emsd/core";
import {
  createDiscoveredDevice,
  deleteDiscoveredDevice,
  getDiscoveredDevice,
  listDiscoveredDevices,
  updateDiscoveredDevice,
} from "./discovered-device-store";

interface DeviceWriteOptions {
  category?: DiscoveryCategory;
  model?: string;
  name?: string;
  ipAddress?: string;
  details?: string;
}

export function formatDeviceHelpText(): string {
  return [
    "Usage:",
    "  device list",
    "  device get <id>",
    "  device create --category <battery|meter> --model <model> --name <name> --ip-address <ipv4> [--details <text>]",
    "  device update <id> [--category <battery|meter>] [--model <model>] [--name <name>] [--ip-address <ipv4>] [--details <text>]",
    "  device delete <id>",
  ].join("\n");
}

export function runDeviceCommand(args: string[] = []): number {
  try {
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args[0] === "--help" ||
      args[0] === "-h"
    ) {
      console.log(formatDeviceHelpText());
      return 0;
    }

    if (args[0] === "list") {
      console.log(JSON.stringify(listDiscoveredDevices(), null, 2));
      return 0;
    }

    if (args[0] === "get") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing device id for get");
      }

      const device = getDiscoveredDevice(id);

      if (!device) {
        throw new Error(`Discovered device not found: ${id}`);
      }

      console.log(JSON.stringify(device, null, 2));
      return 0;
    }

    if (args[0] === "create") {
      const options = parseDeviceWriteOptions(args.slice(1));
      assertCreateOptions(options);
      console.log(JSON.stringify(createDiscoveredDevice(options), null, 2));
      return 0;
    }

    if (args[0] === "update") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing device id for update");
      }

      const options = parseDeviceWriteOptions(args.slice(2));

      if (Object.keys(options).length === 0) {
        throw new Error("No fields provided for update");
      }

      const device = updateDiscoveredDevice(id, options);

      if (!device) {
        throw new Error(`Discovered device not found: ${id}`);
      }

      console.log(JSON.stringify(device, null, 2));
      return 0;
    }

    if (args[0] === "delete") {
      const id = args[1];

      if (!id) {
        throw new Error("Missing device id for delete");
      }

      const device = deleteDiscoveredDevice(id);

      if (!device) {
        throw new Error(`Discovered device not found: ${id}`);
      }

      console.log(JSON.stringify(device, null, 2));
      return 0;
    }

    throw new Error(`Unknown device command: ${args[0]}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(formatDeviceHelpText());
    return 1;
  }
}

function parseDeviceWriteOptions(args: string[]): DeviceWriteOptions {
  const options: DeviceWriteOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (!value) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--category") {
      if (value !== "battery" && value !== "meter") {
        throw new Error(`Invalid category: ${value}`);
      }

      options.category = value;
      index += 1;
      continue;
    }

    if (arg === "--model") {
      options.model = value;
      index += 1;
      continue;
    }

    if (arg === "--name") {
      options.name = value;
      index += 1;
      continue;
    }

    if (arg === "--ip-address") {
      if (!isIpv4Address(value)) {
        throw new Error(`Invalid IPv4 address for --ip-address: ${value}`);
      }

      options.ipAddress = value;
      index += 1;
      continue;
    }

    if (arg === "--details") {
      options.details = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown device option: ${arg}`);
  }

  return options;
}

function assertCreateOptions(options: DeviceWriteOptions): asserts options is {
  category: DiscoveryCategory;
  model: string;
  name: string;
  ipAddress: string;
  details: string;
} {
  if (!options.category) {
    throw new Error("Missing required option: --category");
  }

  if (!options.model) {
    throw new Error("Missing required option: --model");
  }

  if (!options.name) {
    throw new Error("Missing required option: --name");
  }

  if (!options.ipAddress) {
    throw new Error("Missing required option: --ip-address");
  }

  if (!options.details) {
    options.details = "";
  }
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
