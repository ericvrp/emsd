import type { WeatherForecastSourceRecord } from "@emsd/core";
import {
  createWeatherForecastSource,
  deleteWeatherForecastSource,
  listWeatherForecastSources,
  updateWeatherForecastSource,
} from "./managed-site-store";

export function formatWeatherHelpText(): string {
  return [
    "Usage:",
    "  weather list --site-id <site-id>",
    "  weather ls --site-id <site-id>",
    "  weather add <source-id> <name> --site-id <site-id>",
    "  weather create <source-id> <name> --site-id <site-id>",
    "  weather update <source-id> <name> --site-id <site-id>",
    "  weather edit <source-id> <name> --site-id <site-id>",
    "  weather remove <source-id> --site-id <site-id>",
    "  weather delete <source-id> --site-id <site-id>",
    "  weather rm <source-id> --site-id <site-id>",
  ].join("\n");
}

export function formatWeatherList(
  sources: WeatherForecastSourceRecord[],
): string {
  if (sources.length === 0) {
    return "No weather forecast sources configured for the selected site.";
  }

  const header = ["SOURCE ID", "NAME", "UPDATED AT"].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = sources.map((source) =>
    [source.id, source.name, source.updatedAt].join(" | "),
  );

  return [header, separator, ...rows].join("\n");
}

export async function runWeatherCommand(args: string[] = []): Promise<number> {
  try {
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args[0] === "--help" ||
      args[0] === "-h"
    ) {
      console.log(formatWeatherHelpText());
      return 0;
    }

    if (args[0] === "list" || args[0] === "ls") {
      const options = parseSiteOptions(args.slice(1));
      console.log(
        formatWeatherList(listWeatherForecastSources(options.siteId)),
      );
      return 0;
    }

    if (args[0] === "add" || args[0] === "create") {
      const sourceId = args[1];
      const options = parseNamedSourceOptions(args.slice(2), "add");

      if (!sourceId) {
        throw new Error("Missing weather source id for add");
      }

      console.log(
        JSON.stringify(
          createWeatherForecastSource(
            { id: sourceId, name: options.name },
            options.siteId,
          ),
          null,
          2,
        ),
      );
      return 0;
    }

    if (args[0] === "update" || args[0] === "edit") {
      const sourceId = args[1];
      const options = parseNamedSourceOptions(args.slice(2), "update");

      if (!sourceId) {
        throw new Error("Missing weather source id for update");
      }

      const source = updateWeatherForecastSource(
        sourceId,
        { name: options.name },
        options.siteId,
      );

      if (!source) {
        throw new Error(`Managed weather source not found: ${sourceId}`);
      }

      console.log(JSON.stringify(source, null, 2));
      return 0;
    }

    if (args[0] === "remove" || args[0] === "delete" || args[0] === "rm") {
      const sourceId = args[1];
      const options = parseSiteOptions(args.slice(2));

      if (!sourceId) {
        throw new Error("Missing weather source id for remove");
      }

      const source = deleteWeatherForecastSource(sourceId, options.siteId);

      if (!source) {
        throw new Error(`Managed weather source not found: ${sourceId}`);
      }

      console.log(JSON.stringify(source, null, 2));
      return 0;
    }

    throw new Error(`Unknown weather command: ${args[0]}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(formatWeatherHelpText());
    return 1;
  }
}

function parseNamedSourceOptions(
  args: string[],
  action: string,
): {
  siteId: string;
  name: string;
} {
  const siteOptionIndex = args.indexOf("--site-id");

  if (siteOptionIndex === -1) {
    throw new Error("Missing required option: --site-id <site-id>");
  }

  const name = args.slice(0, siteOptionIndex).join(" ").trim();

  if (!name) {
    throw new Error(`Missing weather source name for ${action}`);
  }

  return {
    name,
    siteId: parseSiteOptions(args.slice(siteOptionIndex)).siteId,
  };
}

function parseSiteOptions(args: string[]): { siteId: string } {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--site-id") {
      continue;
    }

    const siteId = args[index + 1];

    if (!siteId) {
      throw new Error("Missing value for --site-id");
    }

    return { siteId };
  }

  throw new Error("Missing required option: --site-id <site-id>");
}
