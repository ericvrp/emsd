# Plugin Documentation

This section collects the implementation guides for EMSD plugin types.

The codebase now uses the same top-level plugin categories in `apps/ems/src/plugins/`:

- `battery`
- `meter`
- `weather`
- `price`

## EMS-First Rule

Every new plugin should be implemented in this order:

1. Extend shared types only where the plugin needs a stable normalized contract.
2. Extend daemon-owned persistence when new managed fields or runtime data must be stored.
3. Extend EMS command flows so the plugin can be added, listed, updated, removed, and inspected from the CLI.
4. Add focused tests for the new behavior.
5. Only after EMS support exists, consider exposing the capability elsewhere.

## Plugin Guides

- `battery/README.md`
- `meter/README.md`
- `weather/README.md`
- `price/README.md`

## Cross-Cutting Checklist

Use this checklist regardless of plugin type:

1. Define the provider or adapter identifier and keep it stable.
2. Decide whether the plugin is discovered transiently, configured manually, or both.
3. Identify the normalized data the rest of EMSD needs from the plugin.
4. Add or extend shared types in `packages/core` only when reused across app boundaries.
5. Update daemon schema in `apps/daemon/src/database.ts` if new persisted fields are required.
6. Update EMS persistence code in `apps/ems/src/managed-site-store.ts` to match the daemon schema.
7. Add or extend the EMS command surface in the domain command file.
8. Keep errors actionable and include the relevant site ID, resource ID, host, or provider name.
9. Add the narrowest relevant tests first.
10. Validate from the EMS command app before considering any web follow-up.

## Acceptance Standard

A plugin integration is complete when:

- it can be represented cleanly in shared types,
- it can be persisted by the daemon-owned database model when needed,
- it is fully manageable through EMS commands,
- it has targeted test coverage,
- and it does not introduce web-only behavior.
