# Meter Plugins

## Goal

Add or expand support for a meter integration, starting from the HomeWizard P1 direction in the main product plan, while keeping meter support explicit and site-scoped.

## Current Touchpoints

- `packages/core/src/index.ts`: `MeterRecord` and telemetry-related shared types
- `apps/ems/src/plugins/meter/`: meter-specific discovery parsing and telemetry sampling
- `apps/ems/src/meter.ts`: meter add, list, enable, disable, and remove commands
- `apps/ems/src/managed-site-store.ts`: meter CRUD in SQLite
- `apps/daemon/src/database.ts`: `meters` and `device_telemetry` tables

## Implementation Steps

1. Lock down the exact target.
   Decide whether this plan is for the first HomeWizard P1 implementation, an expansion of that implementation, or another meter that should map into a distinct plugin model.

2. Define the normalized meter data needed by EMSD.
   At minimum, preserve import or export power, connection state, and any gas reading already supported by `device_telemetry`. If more meter data becomes necessary, add it deliberately and only where the rest of the system can consume it.

3. Implement or refine discovery.
   Add or update a meter plugin under `apps/ems/src/plugins/meter/` so `discover` can identify the meter and produce a stable `discoveryId`, model, name, and details string.

4. Implement telemetry fetches.
   Extend `fetchMeterTelemetry()` through plugin-specific parsing so meter reads produce normalized `powerW`, `gasM3`, and connection state.

5. Keep persisted meter records simple.
   Reuse `MeterRecord` and the `meters` table when possible. Only add columns if the meter integration truly needs durable provider-specific configuration that cannot be reconstructed elsewhere.

6. Ensure EMS meter flows are complete.
   Confirm `meter add`, `meter list`, `meter enable`, `meter disable`, and `meter remove` work cleanly for the plugin record shape.

7. Decide daemon polling ownership.
   If the meter should feed long-running telemetry, the daemon should own repeated polling and storage in `device_telemetry`. Keep EMS commands focused on management and explicit reads.

8. Add tests.
   Cover discovery parsing, telemetry parsing, and meter management commands.

9. Validate on a live host or captured payloads.
   Use realistic API responses to verify import or export sign handling, offline behavior, and any gas field parsing.

## Implementation Notes

- Keep meter support under `meter` commands instead of collapsing it into a generic equipment layer.
- Prefer clear naming in `details` so discovery output is useful before a device is added.
- If the device exposes cumulative counters as well as instantaneous power, decide whether those belong in the current normalized model or should wait for a broader telemetry expansion.

## Suggested Test Scope

- `apps/ems/src/discover.test.ts`: discovery and meter telemetry parsing
- `apps/ems/src/meter.test.ts`: add, list, enable, disable, and remove flows
- `apps/daemon/src/database.test.ts`: only if new schema or daemon telemetry behavior is added

## Definition Of Done

- `discover` can identify the meter when reachable.
- `meter add` persists a valid managed record.
- Meter telemetry can be parsed into the normalized shape.
- EMS meter commands behave correctly.
- Tests cover the new or expanded integration.
