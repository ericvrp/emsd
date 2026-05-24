import type {
  PricePointRecord,
  PriceSnapshotRecord,
  PriceSourceRecord,
  SiteRecord,
} from "@emsd/core";
import { fixedImportPricePlugin } from "./fixed-import-price";
import { tibberPricePlugin } from "./tibber";

export interface PriceRequest {
  site: SiteRecord;
  source: PriceSourceRecord;
}

export interface PricePlugin {
  fetchPrices(input: PriceRequest): Promise<PriceSnapshotRecord>;
  id: PriceSourceRecord["provider"];
  name: string;
}

export type DynamicPriceRequest = PriceRequest;
export type DynamicPricePlugin = PricePlugin;

export const pricePlugins: PricePlugin[] = [
  tibberPricePlugin,
  fixedImportPricePlugin,
];

export function createPricePlugin(
  provider: PriceSourceRecord["provider"] = "tibber",
): PricePlugin {
  const plugin = pricePlugins.find((entry) => entry.id === provider);

  if (!plugin) {
    throw new Error(`Unsupported price provider: ${provider}`);
  }

  return plugin;
}

export async function getDynamicPriceSnapshot(
  input: DynamicPriceRequest,
): Promise<PriceSnapshotRecord> {
  return createPricePlugin(input.source.provider).fetchPrices(input);
}

export function createDynamicPriceSnapshot(
  input: DynamicPriceRequest,
  options: {
    currency: string;
    points: PricePointRecord[];
    providerLabel: string;
  },
): PriceSnapshotRecord {
  return {
    currency: options.currency,
    exportDeduction: input.source.exportDeduction,
    generatedAt: new Date().toISOString(),
    points: options.points,
    provider: input.source.provider,
    providerLabel: options.providerLabel,
    siteId: input.site.id,
    sourceId: input.source.id,
    sourceName: input.source.name,
    sourceUpdatedAt: input.source.updatedAt,
  };
}
