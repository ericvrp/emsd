export interface DaemonOptions {
  verbose: boolean;
}

export function formatDaemonHelpText(command = "daemon"): string {
  return [
    "Usage:",
    `  ${command} [--verbose]`,
    "",
    "Options:",
    "  --verbose, -v        Emit strategy decision logs during polling",
    "  --help, -h           Show daemon option help",
  ].join("\n");
}

export function parseDaemonOptions(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): DaemonOptions | null {
  const options: DaemonOptions = {
    verbose: isVerboseEnvironmentEnabled(env.EMSD_VERBOSE),
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h" || arg === "help") {
      return null;
    }

    if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
      continue;
    }

    throw new Error(`Unknown daemon option: ${arg}`);
  }

  return options;
}

function isVerboseEnvironmentEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
