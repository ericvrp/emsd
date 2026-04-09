# Plugin Documentation

This section collects the implementation guides for EMSD plugin categories.

## Current Plugin Areas

- `battery`
- `meter`
- `solar-energy-provider`
- `solar-forecast`
- `price`

## Terminology Note

The current codebase still uses some `weather` naming for solar forecast management:

- plugin implementations live in `apps/ems/src/plugins/solar-forecast/`
- EMS management commands live in `apps/ems/src/weather.ts`
- shared forecast records use `Weather*` type names in `packages/core`

Treat those as the current forecast-provider surface rather than as a separate product area.

## EMS-First Rule

Every new plugin should be implemented in this order:

1. Extend shared types only where the plugin needs a stable normalized contract.
2. Extend daemon-owned persistence when new managed fields or runtime data must be stored.
3. Extend EMS command or management flows so the plugin can be added, listed, updated, removed, or inspected.
4. Add focused tests for the new behavior.
5. Only after EMS support exists, consider exposing the capability elsewhere.

## Plugin Guides

- `battery/README.md`
- `meter/README.md`
- `solar-energy-provider/README.md`
- `solar-forecast/README.md`
- `price/README.md`

## Cross-Cutting Checklist

Use this checklist regardless of plugin type:

1. Define the provider or plugin identifier and keep it stable.
2. Decide whether the plugin is discovered transiently, configured manually, or both.
3. Identify the normalized data the rest of EMSD needs from the plugin.
4. Add or extend shared types in `packages/core` only when reused across app boundaries.
5. Update daemon schema in `apps/daemon/src/database.ts` if new persisted fields or runtime tables are required.
6. Update EMS persistence code in `apps/ems/src/managed-site-store.ts` to match the daemon schema.
7. Add or extend the EMS management surface in the relevant domain command or bridge path.
8. Keep errors actionable and include the relevant site ID, resource ID, host, or provider name.
9. Add the narrowest relevant tests first.
10. Validate from the EMS or daemon-owned server path before considering any broader UI follow-up.

## Acceptance Standard

A plugin integration is complete when:

- it can be represented cleanly in shared types,
- it can be persisted by the daemon-owned database model when needed,
- it is manageable through the current EMS or server-owned control surface,
- it has targeted test coverage,
- and it does not introduce web-only behavior.
