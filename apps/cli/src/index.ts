import { EMSD_NAME } from "@emsd/core";
import { runBatteryListCommand } from "./battery-list";

function printHelp(): void {
  console.log(`${EMSD_NAME} CLI`);
  console.log("");
  console.log("Usage:");
  console.log(
    "  battery list    List connected batteries and their current status",
  );
}

export function runCli(args = process.argv.slice(2)): number {
  if (args[0] === "battery" && args[1] === "list") {
    return runBatteryListCommand();
  }

  printHelp();
  return args.length === 0 ? 0 : 1;
}

process.exit(runCli());
