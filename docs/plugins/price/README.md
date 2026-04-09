# Dynamic Price Plugins

## Goal

Add or extend a dynamic electricity price provider in a way that is manageable through EMS first and ready for daemon-owned refresh and strategy use.

## Current Supported Provider

- `tibber`

## Current Touchpoints

- `packages/core/src/index.ts`: `DynamicPriceSourceRecord`, `DynamicPriceSnapshotRecord`, and `DynamicPricePointRecord`
- `apps/ems/src/plugins/price/`: provider-specific price fetch and normalization logic
- `apps/ems/src/price.ts`: source list, add, update, and remove commands
- `apps/ems/src/managed-site-store.ts`: dynamic price source CRUD
- `apps/daemon/src/database.ts`: `dynamic_price_sources`, `dynamic_price_snapshots`, and `dynamic_price_samples`
- `apps/daemon/src/index.ts`: daemon refresh loop for price snapshots and samples

## Tibber Notes

- Authentication currently uses `TIBBER_ACCESS_TOKEN`.
- `TIBBER_HOME_ID` is optional and selects a specific Tibber home when an account has more than one.
- The current query reads quarter-hourly `current`, `today`, and `tomorrow` price points from Tibber's GraphQL API.
- EMSD normalizes those responses into timestamped import price points with `currency`, `startsAt`, and `importPrice`.

For provider-specific details, see `docs/reference/price/tibber.md`.

## Implementation Steps

1. Define the provider contract.
   Be explicit about authentication, regional selection, refresh cadence, and whether the provider exposes import prices, export prices, or both.

2. Normalize only the downstream pricing data EMSD needs.
   Keep provider payload shapes local to the plugin and return a stable normalized snapshot record.

3. Keep managed source records configuration-only.
   Store provider identity and durable configuration in `dynamic_price_sources`. Refreshed price data belongs in daemon-owned snapshot and sample tables.

4. Extend shared types only when they are reused across boundaries.
   Avoid adding provider-specific fields to shared records unless the daemon, EMS, or web server all need them.

5. Keep runtime refresh daemon-owned.
   Scheduled sync, retries, deduplication, and retention should stay in daemon code.

6. Fail clearly on provider auth and account selection issues.
   Errors should name missing environment variables, missing homes, or malformed provider responses.

7. Add targeted tests.
   Cover source CRUD, provider normalization, deduping, and auth or response validation behavior.

8. Validate the first consumer.
   Confirm the normalized output is usable for dashboard display and future strategy logic before expanding the provider surface.

## Suggested Test Scope

- `apps/ems/src/price.test.ts`: CLI parsing and source CRUD
- `apps/ems/src/price-plugin.test.ts`: provider normalization, auth handling, and malformed payloads
- `apps/daemon/src/database.test.ts`: only if schema or snapshot persistence changes
- `packages/core/src/index.test.ts`: only if shared price types change

## Definition Of Done

- A dynamic price source can be added, listed, updated, and removed through EMS.
- The provider returns normalized price points.
- The daemon can refresh and persist price snapshots.
- Auth and provider errors are actionable.
- Tests cover the provider-specific behavior.
