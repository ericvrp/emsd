import { EMSD_NAME } from "@emsd/core";
import { runApiCommand } from "./api";
import { formatBatteryHelpText, runBatteryCommand } from "./battery";
import {
  formatHelpText as formatDiscoverHelpText,
  runDiscoverCommand,
} from "./discover";
import { formatMeterHelpText, runMeterCommand } from "./meter";
import { formatPriceHelpText, runPriceCommand } from "./price";
import { formatSiteHelpText, runSiteCommand } from "./site";
import { formatWeatherHelpText, runWeatherCommand } from "./weather";

export function formatHelpText(): string {
  return [
    `${EMSD_NAME} EMS`,
    "",
    "Usage:",
    "  help                  Show this help output",
    "  site <subcommand>     Manage sites",
    "  battery <subcommand>  Manage batteries for a site",
    "  meter <subcommand>    Manage meters for a site",
    "  weather <subcommand>  Manage solar forecast sources",
    "  price <subcommand>    Manage dynamic price sources",
    "  discover [--verbose] [--host <ipv4>]  Scan for supported devices",
    "",
    "Tip:",
    "  site --help           Show site management help",
    "  battery --help        Show battery management help",
    "  meter --help          Show meter management help",
    "  weather --help        Show solar forecast source help",
    "  price --help          Show dynamic price source help",
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

  if (args[0] === "site") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatSiteHelpText());
      return 0;
    }

    return runSiteCommand(args.slice(1));
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

  if (args[0] === "weather") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatWeatherHelpText());
      return 0;
    }

    return runWeatherCommand(args.slice(1));
  }

  if (args[0] === "price") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      console.log(formatPriceHelpText());
      return 0;
    }

    return runPriceCommand(args.slice(1));
  }

  if (args[0] === "api") {
    return runApiCommand(args.slice(1));
  }

  console.log(formatHelpText());
  return 1;
}

if (import.meta.main) {
  const exitCode = await runEms();
  process.exit(exitCode);
}
