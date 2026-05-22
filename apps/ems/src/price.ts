import type { DynamicPriceSourceRecord, PriceProvider } from "@emsd/core";
import { logEmsError } from "./logging";
import {
  createDynamicPriceSource,
  deleteDynamicPriceSource,
  listDynamicPriceSources,
  updateDynamicPriceSource,
} from "./managed-site-store";
import { createFixedImportPriceConfig } from "./plugins/price/fixed-import-price";

export function formatPriceHelpText(): string {
  return [
    "Usage:",
    "  price list --site-id <site-id>",
    "  price ls --site-id <site-id>",
    "  price add <source-id> <name> --site-id <site-id> [--provider tibber|fixed-import-price] [--fixed-import-price <price>] [--export-deduction <price>]",
    "  price create <source-id> <name> --site-id <site-id> [--provider tibber|fixed-import-price] [--fixed-import-price <price>] [--export-deduction <price>]",
    "  price update <source-id> <name> --site-id <site-id> [--provider tibber|fixed-import-price] [--fixed-import-price <price>] [--export-deduction <price>]",
    "  price edit <source-id> <name> --site-id <site-id> [--provider tibber|fixed-import-price] [--fixed-import-price <price>] [--export-deduction <price>]",
    "  price remove <source-id> --site-id <site-id>",
    "  price delete <source-id> --site-id <site-id>",
    "  price rm <source-id> --site-id <site-id>",
    "",
    "Supported providers:",
    "  tibber (default)",
    "  fixed-import-price",
  ].join("\n");
}

export function formatPriceList(sources: DynamicPriceSourceRecord[]): string {
  if (sources.length === 0) {
    return "No dynamic price sources configured for the selected site.";
  }

  const header = ["SOURCE ID", "NAME", "PROVIDER", "EXPORT DEDUCTION", "FIXED IMPORT", "UPDATED AT"].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = sources.map((source) =>
    [
      source.id,
      source.name,
      source.provider,
      source.exportDeduction.toFixed(3),
      formatFixedImportPrice(source),
      source.updatedAt,
    ].join(" | "),
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
            {
              id: sourceId,
              name: options.name,
              provider: options.provider,
              exportDeduction: options.exportDeduction,
              config: options.config,
            },
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
        {
          name: options.name,
          provider: options.provider,
          exportDeduction: options.exportDeduction,
          config: options.config,
        },
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
    logEmsError(error instanceof Error ? error.message : String(error));
    console.log(formatPriceHelpText());
    return 1;
  }
}

function parseNamedSourceOptions(
  args: string[],
  action: string,
): {
  provider: PriceProvider;
  siteId: string;
  name: string;
  exportDeduction?: number;
  config?: ReturnType<typeof createFixedImportPriceConfig>;
} {
  const siteOptionIndex = args.indexOf("--site-id");

  if (siteOptionIndex === -1) {
    throw new Error("Missing required option: --site-id <site-id>");
  }

  const name = args.slice(0, siteOptionIndex).join(" ").trim();

  if (!name) {
    throw new Error(`Missing dynamic price source name for ${action}`);
  }

  const provider = parseProviderOption(args.slice(siteOptionIndex + 2));
  const fixedImportPrice = parseNumberOption(args, "--fixed-import-price");

  if (provider === "fixed-import-price" && fixedImportPrice === undefined) {
    throw new Error("Missing required option for fixed price source: --fixed-import-price <price>");
  }

  const parsed = {
    name,
    provider,
    siteId: parseSiteOptions(args.slice(siteOptionIndex)).siteId,
  };
  const withConfig =
    provider === "fixed-import-price"
      ? {
          ...parsed,
          config: createFixedImportPriceConfig(fixedImportPrice as number),
        }
      : parsed;
  const exportDeduction = parseNumberOption(args, "--export-deduction");

  return exportDeduction === undefined
    ? withConfig
    : { ...withConfig, exportDeduction };
}

function parseProviderOption(args: string[]): PriceProvider {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--provider") {
      continue;
    }

    const provider = args[index + 1];

    if (!provider) {
      throw new Error("Missing value for --provider");
    }

    if (provider !== "tibber" && provider !== "fixed-import-price") {
      throw new Error(`Unsupported price provider: ${provider}`);
    }

    return provider;
  }

  return "tibber";
}

function parseNumberOption(args: string[], optionName: string): number | undefined {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  const rawValue = args[optionIndex + 1];

  if (!rawValue) {
    throw new Error(`Missing value for ${optionName}`);
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${optionName}: ${rawValue}`);
  }

  return value;
}

function formatFixedImportPrice(source: DynamicPriceSourceRecord): string {
  if (source.provider !== "fixed-import-price" || !source.config) {
    return "-";
  }

  return source.config.slots[0]?.importPrice.toFixed(3) ?? "-";
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
