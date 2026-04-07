# Battery Plugins

## Goal

Add support for another battery brand without breaking the existing normalized battery contract or the EMS-first control flow.

## Current Touchpoints

- `packages/core/src/index.ts`: shared battery types such as `BatteryRecord`, `BatteryStrategyRecord`, and `NormalizedBatteryInfo`
- `apps/ems/src/plugins/battery/`: battery-specific discovery parsing and telemetry sampling
- `apps/ems/src/battery-adapters.ts`: battery adapter factory and brand-specific read/write logic
- `apps/ems/src/battery.ts`: battery add, get, list, enable, disable, and strategy commands
- `apps/daemon/src/database.ts`: battery table schema
- `apps/ems/src/managed-site-store.ts`: battery CRUD and strategy persistence

## Implementation Steps

1. Confirm the vendor capability surface.
   Document how the battery exposes discovery, telemetry reads, and control writes. Decide whether it supports only read-only status, `self-consumption`, or full `manual` control.

2. Choose a stable adapter ID.
   Add a clear adapter identifier, similar to `indevolt-battery`, and use it consistently in discovery, persisted records, and the adapter factory.

3. Normalize the vendor data model.
   Map vendor-specific fields into `NormalizedBatteryInfo` and existing strategy fields before touching the CLI. If the vendor requires new shared fields, add them in `packages/core/src/index.ts` only if they are genuinely reusable.

4. Extend discovery if the battery is discoverable.
   Add a battery plugin under `apps/ems/src/plugins/battery/` with its request definitions, regex matches, parsing logic, and stable discovery behavior.

5. Implement the adapter.
   Add a new `BatteryAdapter` subclass in `apps/ems/src/battery-adapters.ts`. Implement `getNormalizedInfo()` and `setStrategy()` with explicit validation and actionable error messages.

6. Extend adapter selection.
   Update `createBatteryAdapter()` so persisted battery records with the new adapter ID resolve to the new adapter implementation.

7. Wire battery add flow.
   Update `apps/ems/src/battery.ts` so `battery add` persists the right `adapter`, `model`, default status, and default strategy values for the new battery.

8. Keep persistence minimal.
   Reuse the existing `batteries` table unless the new battery needs durable fields that are required across process boundaries. Only then add schema changes in `apps/daemon/src/database.ts` and matching store updates in `apps/ems/src/managed-site-store.ts`.

9. Add tests.
   Cover the adapter factory, telemetry normalization, strategy validation, and any discovery-specific parsing. Prefer focused EMS tests over broad end-to-end coverage first.

10. Verify manually through EMS.
    Validate `battery add`, `battery list`, `battery get`, and `battery strategy set` against the new adapter.

## Questions To Resolve Per Vendor

- Can the battery be discovered automatically on LAN, or is it manual-config only?
- Does the vendor expose current power, state of charge, and a reliable state value?
- How does the vendor encode `idle`, `charging`, and `discharging`?
- Does the vendor support a `self-consumption` mode separate from manual control?
- What are the safe limits for charge and discharge power?
- Does control require authentication or session management?

## Suggested Test Scope

- `apps/ems/src/battery.test.ts`: CLI behavior and persistence defaults
- `apps/ems/src/discover.test.ts`: discovery plugin and parsed device output when relevant
- battery adapter unit coverage in `apps/ems/src/battery.test.ts` or a dedicated test file if it becomes large

## Definition Of Done

- The new battery can be added through EMS.
- `battery get` returns normalized information.
- Supported strategy changes succeed and unsupported ones fail clearly.
- Discovery works if the vendor is discoverable.
- Tests cover the new adapter behavior.
