import { afterEach, expect, test } from "bun:test";
import type { DynamicPriceSourceRecord, SiteRecord } from "@emsd/core";
import { getDynamicPriceSnapshot } from "./plugins/price";

const originalFetch = globalThis.fetch;
const originalToken = process.env.TIBBER_ACCESS_TOKEN;
const originalHomeId = process.env.TIBBER_HOME_ID;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.TIBBER_ACCESS_TOKEN = originalToken;
  process.env.TIBBER_HOME_ID = originalHomeId;
});

test("Tibber price plugin fetches today and tomorrow prices", async () => {
  process.env.TIBBER_ACCESS_TOKEN = "tibber-token";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe("https://api.tibber.com/v1-beta/gql");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer tibber-token",
      "content-type": "application/json",
    });

    return new Response(
      JSON.stringify({
        data: {
          viewer: {
            homes: [
              {
                id: "home-1",
                currentSubscription: {
                  priceInfo: {
                    current: {
                      currency: "EUR",
                      startsAt: "2026-04-07T12:00:00.000Z",
                      total: 0.211,
                    },
                    today: [
                      {
                        currency: "EUR",
                        startsAt: "2026-04-07T11:00:00.000Z",
                        total: 0.201,
                      },
                    ],
                    tomorrow: [
                      {
                        currency: "EUR",
                        startsAt: "2026-04-08T00:00:00.000Z",
                        total: 0.189,
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const snapshot = await getDynamicPriceSnapshot({
    site: buildSite(),
    source: buildSource(),
  });

  expect(snapshot.provider).toBe("tibber");
  expect(snapshot.providerLabel).toBe("Tibber");
  expect(snapshot.points).toEqual([
    {
      currency: "EUR",
      importPrice: 0.201,
      startsAt: "2026-04-07T11:00:00.000Z",
    },
    {
      currency: "EUR",
      importPrice: 0.211,
      startsAt: "2026-04-07T12:00:00.000Z",
    },
    {
      currency: "EUR",
      importPrice: 0.189,
      startsAt: "2026-04-08T00:00:00.000Z",
    },
  ]);
});

test("Tibber price plugin prefers TIBBER_HOME_ID when set", async () => {
  process.env.TIBBER_ACCESS_TOKEN = "tibber-token";
  process.env.TIBBER_HOME_ID = "home-2";
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        data: {
          viewer: {
            homes: [
              {
                id: "home-1",
                currentSubscription: {
                  priceInfo: {
                    today: [
                      {
                        currency: "EUR",
                        startsAt: "2026-04-07T11:00:00.000Z",
                        total: 0.201,
                      },
                    ],
                  },
                },
              },
              {
                id: "home-2",
                currentSubscription: {
                  priceInfo: {
                    today: [
                      {
                        currency: "EUR",
                        startsAt: "2026-04-07T11:00:00.000Z",
                        total: 0.133,
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const snapshot = await getDynamicPriceSnapshot({
    site: buildSite(),
    source: buildSource(),
  });

  expect(snapshot.points).toEqual([
    {
      currency: "EUR",
      importPrice: 0.133,
      startsAt: "2026-04-07T11:00:00.000Z",
    },
  ]);
});

function buildSite(): SiteRecord {
  return {
    id: "home",
    location: "52.367600, 4.904100",
    name: "Home",
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
  };
}

function buildSource(): DynamicPriceSourceRecord {
  return {
    id: "tibber-main",
    siteId: "home",
    name: "Tibber",
    provider: "tibber",
    updatedAt: "2026-04-07T00:00:00.000Z",
  };
}
