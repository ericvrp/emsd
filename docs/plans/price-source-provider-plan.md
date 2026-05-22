# Price Source Provider Plan

## Goal

Generalize pricing from Tibber-only dynamic price sources to generic price sources, add a fixed import price provider, and preserve existing historic price data while making provider switching visible in the EMS CLI, daemon persistence, and web UI.

## Current Status

- [ ] Not started
- [x] Implementation in progress
- [x] Tests in progress
- [x] Ready for review
- [ ] Shipped

## Product Requirements

- [ ] Support at least two price providers: Tibber and fixed import price.
- [ ] Make the active price provider user selectable.
- [ ] Keep export price computation shared across providers: `exportPrice = importPrice - exportDeduction`.
- [ ] Generate and persist prices for today and tomorrow for the fixed import price provider.
- [ ] When switching providers, overwrite today's and tomorrow's persisted prices with the newly selected provider's prices.
- [ ] Preserve existing historic price samples and snapshots during table renames.
- [ ] Keep price provider execution server-side only.
- [ ] Do not add client-side plugin execution.

## Naming Direction

Use generic price source names where data is no longer necessarily dynamic.

- [ ] Rename `DynamicPriceSourceRecord` to `PriceSourceRecord`.
- [ ] Rename `DynamicPriceSnapshotRecord` to `PriceSnapshotRecord`.
- [ ] Rename `DynamicPricePointRecord` to `PricePointRecord`.
- [ ] Rename `DynamicPriceSampleRecord` to `PriceSampleRecord`.
- [ ] Rename code paths such as `dynamicPriceSources` to `priceSources` where they represent configured sources.
- [ ] Keep names like `dynamic-price-target` where they refer to the battery strategy algorithm, not the provider/source model.
- [ ] Update user-facing text from `dynamic price source` to `price source` where appropriate.

## Database Plan

Rename tables while preserving existing rows.

- [ ] Rename `dynamic_price_sources` to `price_sources`.
- [ ] Rename `dynamic_price_snapshots` to `price_snapshots`.
- [ ] Rename `dynamic_price_samples` to `price_samples`.
- [ ] Add migration logic in `apps/daemon/src/database.ts`.
- [ ] Add migration logic in `apps/ems/src/managed-site-store.ts`.
- [ ] If old table exists and new table does not, use `ALTER TABLE old RENAME TO new`.
- [ ] If both old and new tables exist, do not overwrite either table automatically; fail with an actionable error or explicitly merge only after a deliberate implementation decision.
- [ ] Recreate or rename indexes for `price_samples`.
- [ ] Preserve historic sample rows in `price_samples`.
- [ ] Preserve snapshot JSON in `price_snapshots`.
- [ ] Add `config_json TEXT` to `price_sources`.
- [ ] Keep `provider`, `export_deduction`, `home_id`, and existing source metadata during migration.
- [ ] Normalize existing provider values to supported values without losing rows.
- [ ] Ensure schema creation works for fresh installs.
- [ ] Ensure schema migration works for databases created before `export_deduction` existed.

## Core Types

- [ ] Add `PriceProvider = "tibber" | "fixed-import-price"` in `packages/core`.
- [ ] Add fixed provider config types in `packages/core`.
- [ ] Add a generic price source config union if shared by EMS, daemon, and web.
- [ ] Export new price record types from `packages/core/src/index.ts`.
- [ ] Keep compatibility aliases temporarily only if they reduce one large mechanical rename risk.
- [ ] Remove compatibility aliases before finishing unless they are required by external consumers.

## Fixed Import Price Config

Store fixed pricing as slots from the beginning so future UI can support time-of-day and day-of-week prices.

```ts
type FixedImportPriceConfig = {
  currency: "EUR";
  slots: Array<{
    importPrice: number;
    startTime: string | null;
    endTime: string | null;
    isoWeekdays: number[] | null;
  }>;
};
```

- [ ] Treat `startTime: null` and `endTime: null` as an all-day slot.
- [ ] Treat `isoWeekdays: null` as every day of week.
- [ ] Use ISO weekdays: Monday `1` through Sunday `7`.
- [ ] Validate `importPrice` is finite and non-negative.
- [ ] Validate time strings as `HH:mm` when present.
- [ ] Validate `isoWeekdays` values are integers from `1` through `7` when present.
- [ ] Reject overlapping fixed slots only when multiple slots are exposed or accepted by CLI/API.
- [ ] For the first implementation, create one all-day/all-week slot from a single fixed import price field.

Initial default fixed config shape:

```json
{
  "currency": "EUR",
  "slots": [
    {
      "importPrice": 0.300,
      "startTime": null,
      "endTime": null,
      "isoWeekdays": null
    }
  ]
}
```

## Price Plugin Work

- [ ] Rename plugin request/registry types from dynamic-price naming to price-source naming.
- [ ] Keep Tibber plugin behavior unchanged except for renamed types/functions.
- [ ] Add `apps/ems/src/plugins/price/fixed-import-price.ts`.
- [ ] Register fixed import price plugin in `apps/ems/src/plugins/price/index.ts`.
- [ ] Generate 15-minute price points for local today and tomorrow.
- [ ] Apply fixed slots to each generated period.
- [ ] Use the configured fixed currency, initially `EUR`.
- [ ] Return provider label `Fixed import price`.
- [ ] Include source id/name in snapshots.
- [ ] Keep persisted point shape compatible with graphing and strategy logic.

## Refresh Behavior

- [ ] Add source metadata to price snapshots, likely `sourceUpdatedAt`.
- [ ] Refresh when no snapshot exists.
- [ ] Refresh when the snapshot is older than the normal price refresh interval.
- [ ] Refresh when source provider differs from the snapshot provider.
- [ ] Refresh when source `updatedAt` differs from snapshot `sourceUpdatedAt`.
- [ ] Refresh when source config changes.
- [ ] On web/API provider changes, request an immediate refresh.
- [ ] Confirm fixed provider overwrites today/tomorrow `price_samples` rows.
- [ ] Confirm switching back to Tibber overwrites today/tomorrow `price_samples` rows.
- [ ] Keep older historic sample rows outside today/tomorrow functional for history views.

## EMS CLI Work

- [ ] Update help text from dynamic price source to price source.
- [ ] Support `price create <source-id> <name> --site-id <site-id> --provider tibber`.
- [ ] Support `price create <source-id> <name> --site-id <site-id> --provider fixed-import-price --fixed-import-price <price>`.
- [ ] Support `price update` provider switching.
- [ ] Support `--export-deduction <price>` where useful.
- [ ] Show provider, export deduction, and fixed import price summary in `price list`.
- [ ] Fail with actionable messages for missing fixed import price config.
- [ ] Preserve existing default provider behavior as Tibber if no provider is supplied.

## EMS API Work

- [ ] Stop hard-coding `provider: "tibber"` in `price-create`.
- [ ] Stop hard-coding `provider: "tibber"` in `price-update`.
- [ ] Accept and validate `provider` in price source API actions.
- [ ] Accept and validate fixed provider config or fixed import price scalar.
- [ ] Accept and validate export deduction.
- [ ] Rename internal API response fields from `dynamicPriceSources` to `priceSources` if feasible in the same change.
- [ ] Keep API bridge compatibility only if needed to avoid breaking the web in the same commit.
- [ ] Update errors to reference price source/provider instead of Tibber-specific configuration.

## Daemon Work

- [ ] Rename daemon database helpers from dynamic-price naming to price naming.
- [ ] Update refresh orchestration to use generic price sources.
- [ ] Update log messages to say price snapshot/source where appropriate.
- [ ] Keep strategy code compatible with renamed price samples.
- [ ] Keep dynamic price target algorithm names where they refer to the strategy target method.
- [ ] Ensure server-side plugin code remains outside browser bundles.

## Web Work

- [ ] Update bridge functions and types from dynamic price source names to price source names.
- [ ] Update settings panel copy from dynamic price source to price source.
- [ ] Add provider selector with Tibber and fixed import price.
- [ ] Show fixed import price field when fixed import price provider is selected.
- [ ] Keep export deduction visible for both providers.
- [ ] Save provider, export deduction, and fixed import price config from settings.
- [ ] Request immediate price refresh after save.
- [ ] Ensure graph and tooltip export price logic still uses source export deduction.
- [ ] Ensure UI reflects provider switching after refresh.

## Documentation Work

- [ ] Update `docs/plugins/price/README.md` for generic price providers.
- [ ] Add or update fixed import price provider docs.
- [ ] Update `README.md` references to dynamic price sources.
- [ ] Update `docs/local-api.md` where dynamic price wording now means price source.
- [ ] Keep `docs/scripts/dynamic-price-target.md` wording when it refers to the strategy algorithm.
- [ ] Update `AGENTS.md` if verified commands, architecture, or current behavior changes.

## Tests

- [ ] Add daemon database migration test from `dynamic_price_*` to `price_*` preserving rows.
- [ ] Add EMS store migration test from `dynamic_price_sources` to `price_sources` preserving rows.
- [ ] Add fixed import price plugin test for today and tomorrow point generation.
- [ ] Add fixed slot selection tests if slot matching logic is shared or non-trivial.
- [ ] Update Tibber plugin tests for renamed types/functions.
- [ ] Update EMS CLI price command tests for provider selection.
- [ ] Add EMS CLI fixed provider create/update test.
- [ ] Update EMS API tests for provider passthrough and validation.
- [ ] Update web tests if existing coverage touches settings or bridge naming.

## Validation Commands

Run the narrowest relevant tests first.

- [ ] `bun test apps/ems/src/price-plugin.test.ts`
- [ ] `bun test apps/ems/src/price.test.ts`
- [ ] `bun test apps/ems/src/api.test.ts`
- [ ] `bun test apps/daemon/src/database.test.ts`
- [ ] `bun test apps/daemon/src/strategy-scheduler.test.ts`
- [ ] `bun run --cwd packages/core typecheck`
- [ ] `bun run --cwd apps/ems typecheck`
- [ ] `bun run --cwd apps/daemon typecheck`
- [ ] Run targeted web validation only if web code changed in a risky way.
- [ ] Run `bun run test` after targeted tests pass if the change touches cross-package behavior broadly.

## Suggested Implementation Phases

### Phase 1: Schema And Types

- [ ] Add generic core price types.
- [ ] Add table rename migration helpers.
- [ ] Update daemon database helpers to read/write `price_*` tables.
- [ ] Update EMS store helpers to read/write `price_sources`.
- [ ] Add migration preservation tests.

### Phase 2: Provider Registry And Fixed Plugin

- [ ] Rename plugin interfaces to generic price names.
- [ ] Add fixed import price config parsing.
- [ ] Add fixed import price plugin.
- [ ] Add fixed plugin tests.
- [ ] Keep Tibber behavior passing.

### Phase 3: EMS CLI And API

- [ ] Update CLI parser and help text.
- [ ] Update API input handling.
- [ ] Add provider switching tests.
- [ ] Ensure refresh endpoints use generic source logic.

### Phase 4: Daemon Refresh And Strategy Integration

- [ ] Update daemon source refresh references.
- [ ] Add source-change refresh detection.
- [ ] Verify price samples continue feeding strategy scheduler and graph data.
- [ ] Run daemon targeted tests.

### Phase 5: Web Settings And Copy

- [ ] Update bridge type/function names.
- [ ] Add provider selector and fixed price field.
- [ ] Update settings copy and labels.
- [ ] Ensure immediate refresh after save.
- [ ] Verify UI shows switched provider and updated prices.

### Phase 6: Documentation And Cleanup

- [ ] Update plugin docs.
- [ ] Update user-facing docs.
- [ ] Remove obsolete dynamic-source aliases if not needed.
- [ ] Run final targeted validation.

## Open Decisions

- [ ] Decide whether to expose multi-slot fixed config through EMS CLI now or only store it internally for later UI.
- [ ] Decide exact bridge response compatibility strategy for `dynamicPriceSources` vs `priceSources` during the web rename.
- [ ] Decide whether fixed provider currency should be hard-coded to `EUR` initially or configurable through CLI/API.
- [ ] Decide how to handle databases where both old `dynamic_price_*` and new `price_*` tables already exist.

## Completion Criteria

- [ ] Existing databases migrate without losing historic samples.
- [ ] Fresh databases use `price_*` table names.
- [ ] Tibber still refreshes today/tomorrow prices.
- [ ] Fixed import price provider writes today/tomorrow prices.
- [ ] Switching provider in settings refreshes persisted prices immediately.
- [ ] Export price deduction works for both providers.
- [ ] EMS CLI can create, list, update, and remove price sources for both providers.
- [ ] Web UI can switch between Tibber and fixed import price.
- [ ] Targeted tests and typechecks pass.
