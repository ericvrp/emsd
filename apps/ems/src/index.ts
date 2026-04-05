import { EMSD_NAME } from "@emsd/core";
import { runBatteryListCommand } from "./battery-list";
import { formatDeviceHelpText, runDeviceCommand } from "./device";
import {
  formatHelpText as formatDiscoverHelpText,
  runDiscoverCommand,
} from "./discover";

export function formatHelpText(): string {
  return [
    `${EMSD_NAME} EMS`,
    "",
    "Usage:",
    "  help                  Show this help output",
    "  battery list          List connected batteries and their current status",
    "  device <subcommand>   Manage discovered devices",
    "  discover [--all] [--verbose] [--host <ipv4>]  Scan for supported devices",
    "",
    "Tip:",
    "  device --help         Show discovered-device CRUD help",
    "  discover --help       Show discovery-specific help",
  ].join("\n");
}

export async function runEms(args = process.argv.slice(2)): Promise<number> {
  if (
    args.length === 0 ||
    args[0] === "help" ||
    args[0] === "--help" ||
    args[0] === "-h"
  ) {
    console.log(formatHelpText());
    return 0;
  }

  if (args[0] === "battery" && args[1] === "list") {
    return runBatteryListCommand();
  }

  if (args[0] === "discover") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatDiscoverHelpText());
      return 0;
    }

    return runDiscoverCommand(args.slice(1));
  }

  if (args[0] === "device") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatDeviceHelpText());
      return 0;
    }

    return runDeviceCommand(args.slice(1));
  }

  console.log(formatHelpText());
  return 1;
}

if (import.meta.main) {
  const exitCode = await runEms();
  process.exit(exitCode);
}
