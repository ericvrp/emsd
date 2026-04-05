import type { DynamicPriceSourceRecord } from "@emsd/core";
import {
  createDynamicPriceSource,
  deleteDynamicPriceSource,
  listDynamicPriceSources,
  updateDynamicPriceSource,
} from "./managed-site-store";

export function formatPriceHelpText(): string {
  return [
    "Usage:",
    "  price list --site-id <site-id>",
    "  price ls --site-id <site-id>",
    "  price add <source-id> <name> --site-id <site-id>",
    "  price create <source-id> <name> --site-id <site-id>",
    "  price update <source-id> <name> --site-id <site-id>",
    "  price edit <source-id> <name> --site-id <site-id>",
    "  price remove <source-id> --site-id <site-id>",
    "  price delete <source-id> --site-id <site-id>",
    "  price rm <source-id> --site-id <site-id>",
  ].join("\n");
}

export function formatPriceList(sources: DynamicPriceSourceRecord[]): string {
  if (sources.length === 0) {
    return "No dynamic price sources configured for the selected site.";
  }

  const header = ["SOURCE ID", "NAME", "UPDATED AT"].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = sources.map((source) =>
    [source.id, source.name, source.updatedAt].join(" | "),
  );

  return [header, separator, ...rows].join("\n");
}

export async function runPriceCommand(args: string[] = []): Promise<number> {
  try {
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args[0] === "--help" ||
      args[0] === "-h"
    ) {
      console.log(formatPriceHelpText());
      return 0;
    }

    if (args[0] === "list" || args[0] === "ls") {
      const options = parseSiteOptions(args.slice(1));
      console.log(formatPriceList(listDynamicPriceSources(options.siteId)));
      return 0;
    }

    if (args[0] === "add" || args[0] === "create") {
      const sourceId = args[1];
      const options = parseNamedSourceOptions(args.slice(2), "add");

      if (!sourceId) {
        throw new Error("Missing dynamic price source id for add");
      }

      console.log(
        JSON.stringify(
          createDynamicPriceSource(
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
        throw new Error("Missing dynamic price source id for update");
      }

      const source = updateDynamicPriceSource(
        sourceId,
        { name: options.name },
        options.siteId,
      );

      if (!source) {
        throw new Error(`Managed dynamic price source not found: ${sourceId}`);
      }

      console.log(JSON.stringify(source, null, 2));
      return 0;
    }

    if (args[0] === "remove" || args[0] === "delete" || args[0] === "rm") {
      const sourceId = args[1];
      const options = parseSiteOptions(args.slice(2));

      if (!sourceId) {
        throw new Error("Missing dynamic price source id for remove");
      }

      const source = deleteDynamicPriceSource(sourceId, options.siteId);

      if (!source) {
        throw new Error(`Managed dynamic price source not found: ${sourceId}`);
      }

      console.log(JSON.stringify(source, null, 2));
      return 0;
    }

    throw new Error(`Unknown price command: ${args[0]}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(formatPriceHelpText());
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
    throw new Error(`Missing dynamic price source name for ${action}`);
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
