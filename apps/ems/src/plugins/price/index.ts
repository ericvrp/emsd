import type {
  DynamicPricePointRecord,
  DynamicPriceSnapshotRecord,
  DynamicPriceSourceRecord,
  SiteRecord,
} from "@emsd/core";
import { tibberPricePlugin } from "./tibber";

export interface DynamicPriceRequest {
  site: SiteRecord;
  source: DynamicPriceSourceRecord;
}

export interface DynamicPricePlugin {
  fetchPrices(input: DynamicPriceRequest): Promise<DynamicPriceSnapshotRecord>;
  id: DynamicPriceSourceRecord["provider"];
  name: string;
}

export const pricePlugins: DynamicPricePlugin[] = [tibberPricePlugin];

export function createPricePlugin(
  provider: DynamicPriceSourceRecord["provider"] = "tibber",
): DynamicPricePlugin {
  const plugin = pricePlugins.find((entry) => entry.id === provider);

  if (!plugin) {
    throw new Error(`Unsupported dynamic price provider: ${provider}`);
  }

  return plugin;
}

export async function getDynamicPriceSnapshot(
  input: DynamicPriceRequest,
): Promise<DynamicPriceSnapshotRecord> {
  return createPricePlugin(input.source.provider).fetchPrices(input);
}

export function createDynamicPriceSnapshot(
  input: DynamicPriceRequest,
  options: {
    currency: string;
    points: DynamicPricePointRecord[];
    providerLabel: string;
  },
): DynamicPriceSnapshotRecord {
  return {
    currency: options.currency,
    generatedAt: new Date().toISOString(),
    points: options.points,
    provider: input.source.provider,
    providerLabel: options.providerLabel,
    siteId: input.site.id,
    sourceId: input.source.id,
    sourceName: input.source.name,
  };
}
