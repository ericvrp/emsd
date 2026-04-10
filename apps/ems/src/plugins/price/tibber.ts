import type {
  DynamicPricePointRecord,
  DynamicPriceSourceRecord,
} from "@emsd/core";
import type { DynamicPricePlugin, DynamicPriceRequest } from "./index";
import { createDynamicPriceSnapshot } from "./index";

const TIBBER_API_URL = "https://api.tibber.com/v1-beta/gql";

interface TibberHomePriceInfo {
  currentSubscription?: {
    priceInfo?: {
      current?: TibberPricePoint | null;
      today?: TibberPricePoint[] | null;
      tomorrow?: TibberPricePoint[] | null;
    } | null;
  } | null;
  id: string;
}

interface TibberPricePoint {
  currency?: string | null;
  startsAt?: string | null;
  total?: number | null;
}

interface TibberResponse {
  data?: {
    viewer?: {
      homes?: TibberHomePriceInfo[] | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

const TIBBER_QUERY = `
  query GetPriceInfo {
    viewer {
      homes {
        id
        currentSubscription {
          priceInfo(resolution: QUARTER_HOURLY) {
            current {
              currency
              startsAt
              total
            }
            today {
              currency
              startsAt
              total
            }
            tomorrow {
              currency
              startsAt
              total
            }
          }
        }
      }
    }
  }
`;

export const tibberPricePlugin: DynamicPricePlugin = {
  id: "tibber",
  name: "Tibber",
  async fetchPrices(input: DynamicPriceRequest) {
    const token = getTibberAccessToken();
    const response = await fetch(TIBBER_API_URL, {
      body: JSON.stringify({ query: TIBBER_QUERY }),
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(
        `Tibber price request failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }

    const payload = (await response.json()) as TibberResponse;

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    const homes = payload.data?.viewer?.homes ?? [];
    const home = selectTibberHome(homes, input.source);
    const priceInfo = home.currentSubscription?.priceInfo;

    if (!priceInfo) {
      throw new Error(
        `Tibber home ${home.id} has no active subscription price info.`,
      );
    }

    const rawPoints = [
      ...(priceInfo.today ?? []),
      ...(priceInfo.tomorrow ?? []),
      ...(priceInfo.current ? [priceInfo.current] : []),
    ];
    const points = dedupeAndSortPoints(rawPoints.map(mapTibberPoint));
    const currency =
      points[0]?.currency ??
      priceInfo.current?.currency ??
      priceInfo.today?.[0]?.currency ??
      "EUR";

    return createDynamicPriceSnapshot(input, {
      currency,
      points,
      providerLabel: this.name,
    });
  },
};

function getTibberAccessToken(): string {
  const token = process.env.TIBBER_ACCESS_TOKEN ?? null;

  if (!token || token.trim().length === 0) {
    throw new Error("Missing Tibber access token. Set TIBBER_ACCESS_TOKEN.");
  }

  return token.trim();
}

function getConfiguredTibberHomeId(): string | null {
  const homeId = process.env.TIBBER_HOME_ID ?? null;

  if (!homeId || homeId.trim().length === 0) {
    return null;
  }

  return homeId.trim();
}

function selectTibberHome(
  homes: TibberHomePriceInfo[],
  source: DynamicPriceSourceRecord,
): TibberHomePriceInfo {
  if (homes.length === 0) {
    throw new Error("Tibber returned no homes for the current account.");
  }

  const configuredHomeId = getConfiguredTibberHomeId();

  if (configuredHomeId) {
    const matched = homes.find((home) => home.id === configuredHomeId);

    if (!matched) {
      throw new Error(
        `Tibber home not found for configured homeId ${configuredHomeId}.`,
      );
    }

    return matched;
  }

  return homes[0] as TibberHomePriceInfo;
}

function mapTibberPoint(point: TibberPricePoint): DynamicPricePointRecord {
  if (typeof point.startsAt !== "string" || typeof point.total !== "number") {
    throw new Error("Tibber returned a malformed price point.");
  }

  return {
    currency: typeof point.currency === "string" ? point.currency : "EUR",
    importPrice: point.total,
    startsAt: point.startsAt,
  };
}

function dedupeAndSortPoints(
  points: DynamicPricePointRecord[],
): DynamicPricePointRecord[] {
  const byStart = new Map<string, DynamicPricePointRecord>();

  for (const point of points) {
    byStart.set(point.startsAt, point);
  }

  return [...byStart.values()].sort(
    (left, right) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  );
}
