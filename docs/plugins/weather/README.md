# Weather Plugins

## Goal

Add a weather resource that can be managed per site and later consumed by daemon-side planning, without introducing web-only configuration or logic.

## Current Touchpoints

- `packages/core/src/index.ts`: `WeatherForecastSourceRecord`
- `apps/ems/src/weather.ts`: weather source list, add, update, and remove commands
- `apps/ems/src/managed-site-store.ts`: weather source CRUD
- `apps/daemon/src/database.ts`: `weather_sources` table

## Implementation Steps

1. Decide the provider shape.
   Define the provider ID, the minimum configuration required, and whether the source is fully manual, API-backed, or derived from location settings.

2. Clarify the normalized weather output.
   Decide what the daemon will eventually need from the provider, such as hourly cloud cover, irradiation proxy data, temperature, or forecast windows. Keep the first persisted managed record minimal; forecast payload storage can remain a later daemon concern.

3. Expand shared types only if needed.
   The current `WeatherForecastSourceRecord` is intentionally small. If the provider needs more durable fields than `id`, `siteId`, `name`, and `updatedAt`, add them in `packages/core/src/index.ts` and keep them generic enough to be worth sharing.

4. Update daemon schema when configuration fields must persist.
   Add columns to `weather_sources` in `apps/daemon/src/database.ts` only for durable configuration, not transient forecast results.

5. Update EMS store code.
   Mirror schema changes in `apps/ems/src/managed-site-store.ts` so list, create, update, and delete flows stay aligned with daemon-owned persistence.

6. Extend EMS commands.
   Update `apps/ems/src/weather.ts` to accept the configuration the provider actually needs. Keep the command surface explicit and readable.

7. Define future daemon runtime ownership.
   If forecasts should be cached or refreshed on a schedule, that belongs in the daemon rather than in the CLI path.

8. Add tests.
   Cover argument parsing, CRUD behavior, and any validation for provider-specific fields.

## Good First Scope

- Keep the provider registry small and explicit.
- Allow `weather add` to create a managed source record with the provider ID and human-readable name.
- Defer forecast fetching and cache tables until a strategy or simulation feature requires them.

## Suggested Test Scope

- `apps/ems/src/weather.test.ts`: CLI parsing, CRUD, and validation
- `apps/daemon/src/database.test.ts`: only if `weather_sources` schema changes
- `packages/core/src/index.test.ts`: only if shared weather types or helpers are added

## Definition Of Done

- A weather source can be added, listed, updated, and removed through EMS.
- Any required configuration persists correctly.
- The record shape is ready for future daemon-owned forecast fetching.
- Tests cover the new command and persistence behavior.
