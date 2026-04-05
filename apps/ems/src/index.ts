import { EMSD_NAME } from "@emsd/core";
import { formatBatteryHelpText, runBatteryCommand } from "./battery";
import {
  formatHelpText as formatDiscoverHelpText,
  runDiscoverCommand,
} from "./discover";
import { formatMeterHelpText, runMeterCommand } from "./meter";

export function formatHelpText(): string {
  return [
    `${EMSD_NAME} EMS`,
    "",
    "Usage:",
    "  help                  Show this help output",
    "  battery <subcommand>  Manage batteries in the active site",
    "  meter <subcommand>    Manage meters in the active site",
    "  discover [--verbose] [--host <ipv4>]  Scan for supported devices",
    "",
    "Tip:",
    "  battery --help        Show battery management help",
    "  meter --help          Show meter management help",
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

  if (args[0] === "battery") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatBatteryHelpText());
      return 0;
    }

    return runBatteryCommand(args.slice(1));
  }

  if (args[0] === "discover") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatDiscoverHelpText());
      return 0;
    }

    return runDiscoverCommand(args.slice(1));
  }

  if (args[0] === "meter") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatMeterHelpText());
      return 0;
    }

    return runMeterCommand(args.slice(1));
  }

  console.log(formatHelpText());
  return 1;
}

if (import.meta.main) {
  const exitCode = await runEms();
  process.exit(exitCode);
}
