# Dynamic Price Plugins

## Goal

Add a dynamic price information resource, such as Nordpool or Tibber, in a way that is manageable through EMS first and ready for later daemon-side strategy use.

## Current Touchpoints

- `packages/core/src/index.ts`: `DynamicPriceSourceRecord`
- `apps/ems/src/price.ts`: price source list, add, update, and remove commands
- `apps/ems/src/managed-site-store.ts`: dynamic price source CRUD
- `apps/daemon/src/database.ts`: `dynamic_price_sources` table

## Implementation Steps

1. Pick the provider contract.
   Define the provider ID, required credentials or region settings, refresh cadence, and whether the provider offers import prices, export prices, or both.

2. Decide the normalized pricing model.
   Define the minimum downstream shape the daemon and strategy engine will need, such as timestamped import and export price points. Keep that normalized contract separate from provider-specific response payloads.

3. Keep the managed record focused on configuration.
   The `dynamic_price_sources` table should store provider identity and durable configuration. Time-series price data itself should be a daemon concern and should not be stuffed into the managed record.

4. Extend shared types if configuration needs to grow.
   Add shared fields in `packages/core/src/index.ts` only when those fields are needed across daemon and EMS boundaries.

5. Update daemon schema when needed.
   Add the necessary columns to `dynamic_price_sources` in `apps/daemon/src/database.ts`. Prefer small explicit columns over opaque blobs when the fields are stable.

6. Update EMS store and commands.
   Mirror schema changes in `apps/ems/src/managed-site-store.ts` and `apps/ems/src/price.ts`. Keep the CLI readable and explicit about any credentials, market region, or tariff parameters.

7. Reserve runtime syncing for the daemon.
   Scheduled sync, retries, provider rate limiting, and durable price history belong in daemon code, not in ad hoc EMS management commands.

8. Add tests.
   Cover price source CRUD, validation, and any shared type additions.

9. Plan the first consumer.
   Make sure the chosen normalized price output will fit future `price sync`, simulation, and dynamic-pricing strategy work from `plans/EMSD-plan.md`.

## Good First Scope

- Support creating a managed source record for one provider.
- Persist only the configuration required to authenticate and identify the relevant market.
- Defer scheduled syncing and price history tables until daemon strategy work needs them.

## Suggested Test Scope

- `apps/ems/src/price.test.ts`: CLI parsing, CRUD, and validation
- `apps/daemon/src/database.test.ts`: only if `dynamic_price_sources` schema changes
- `packages/core/src/index.test.ts`: only if shared price types or helpers are added

## Definition Of Done

- A dynamic price source can be added, listed, updated, and removed through EMS.
- Durable provider configuration persists correctly.
- The integration is ready for future daemon-owned price syncing.
- Tests cover the new command and persistence behavior.
