import type { SiteRecord } from "@emsd/core";
import { logEmsError } from "./logging";
import {
  createSite,
  deleteSite,
  listSites,
  updateSite,
} from "./managed-site-store";

export function formatSiteHelpText(): string {
  return [
    "Usage:",
    "  site list",
    "  site ls",
    "  site add <site-id> <name>",
    "  site create <site-id> <name>",
    "  site update <site-id> <name>",
    "  site edit <site-id> <name>",
    "  site remove <site-id>",
    "  site delete <site-id>",
    "  site rm <site-id>",
  ].join("\n");
}

export function formatSiteList(sites: SiteRecord[]): string {
  if (sites.length === 0) {
    return "No sites configured.";
  }

  const header = ["SITE ID", "NAME", "UPDATED AT"].join(" | ");
  const separator = "-".repeat(header.length);
  const rows = sites.map((site) =>
    [site.id, site.name, site.updatedAt].join(" | "),
  );

  return [header, separator, ...rows].join("\n");
}

export async function runSiteCommand(args: string[] = []): Promise<number> {
  try {
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args[0] === "--help" ||
      args[0] === "-h"
    ) {
      console.log(formatSiteHelpText());
      return 0;
    }

    if (args[0] === "list" || args[0] === "ls") {
      console.log(formatSiteList(listSites()));
      return 0;
    }

    if (args[0] === "add" || args[0] === "create") {
      const siteId = args[1];
      const name = args.slice(2).join(" ").trim();

      if (!siteId) {
        throw new Error("Missing site id for add");
      }

      if (!name) {
        throw new Error("Missing site name for add");
      }

      console.log(JSON.stringify(createSite({ id: siteId, name }), null, 2));
      return 0;
    }

    if (args[0] === "update" || args[0] === "edit") {
      const siteId = args[1];
      const name = args.slice(2).join(" ").trim();

      if (!siteId) {
        throw new Error("Missing site id for update");
      }

      if (!name) {
        throw new Error("Missing site name for update");
      }

      const site = updateSite(siteId, { name });

      if (!site) {
        throw new Error(`Managed site not found: ${siteId}`);
      }

      console.log(JSON.stringify(site, null, 2));
      return 0;
    }

    if (args[0] === "remove" || args[0] === "delete" || args[0] === "rm") {
      const siteId = args[1];

      if (!siteId) {
        throw new Error("Missing site id for remove");
      }

      const site = deleteSite(siteId);

      if (!site) {
        throw new Error(`Managed site not found: ${siteId}`);
      }

      console.log(JSON.stringify(site, null, 2));
      return 0;
    }

    throw new Error(`Unknown site command: ${args[0]}`);
  } catch (error) {
    logEmsError(error instanceof Error ? error.message : String(error));
    console.log(formatSiteHelpText());
    return 1;
  }
}
