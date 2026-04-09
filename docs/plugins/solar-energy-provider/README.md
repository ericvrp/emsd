# Solar Energy Provider Plugins

## Goal

Add support for a site-local solar production source that EMSD can discover, persist, poll, and expose as normalized live generation telemetry.

The current real-world target is Enphase residential systems with microinverters, where the LAN-visible device is the `IQ Gateway` or older `Envoy` gateway rather than each inverter individually.

## Current Supported Provider

- `enphase-local`

## Current Touchpoints

- `packages/core/src/index.ts`: `SolarEnergyProviderRecord` and `NormalizedSolarEnergyProviderInfo`
- `apps/ems/src/plugins/solar-energy-provider/`: provider-specific discovery and live telemetry fetch logic
- `apps/ems/src/managed-site-store.ts`: solar energy provider CRUD
- `apps/daemon/src/database.ts`: `solar_energy_providers` and `solar_energy_provider_samples`
- `apps/daemon/src/index.ts`: daemon-owned polling and sample persistence
- `apps/web/server/ems-web-api.ts`: create from discovery, read normalized info, and delete flows

## Enphase Notes

- Discovery currently identifies the gateway from `/info.xml` and supplements it with `/api/v1/production`.
- Runtime reads prefer `/production.json?details=1` and fall back to `/api/v1/production` when needed.
- On newer firmware, local reads may require Enphase owner authentication over HTTPS.
- Set `ENPHASE_ENLIGHTEN_USERNAME` and `ENPHASE_ENLIGHTEN_PASSWORD` in the daemon environment when the gateway returns an auth challenge.
- The normalized output currently focuses on current power, today energy, lifetime energy, serial number, firmware version, and connection status.

For implementation details and endpoint notes, see `docs/reference/solar-energy-provider/enphase.md`.

## Implementation Steps

1. Confirm the physical integration point.
   For Enphase microinverter systems, integrate with the site gateway, not individual microinverters. Treat the gateway as the managed provider record.

2. Choose a stable plugin ID.
   Keep the persisted plugin identifier explicit, similar to `enphase-local`, so discovery, storage, and runtime polling all resolve the same provider implementation.

3. Normalize only the fields EMSD actually consumes.
   Preserve current generation and durable identity fields first. Add new shared fields only when multiple app boundaries need them.

4. Keep discovery focused on durable identity.
   A discovered device should provide a stable name, model, IP address, and useful details such as serial number or firmware version.

5. Keep provider records configuration-oriented.
   Persist the provider identity, host, and any durable details in `solar_energy_providers`. Repeated telemetry samples belong in daemon-owned sample tables, not in the managed record itself.

6. Keep repeated polling in the daemon.
   Scheduled refresh, retry behavior, retention, and time-series sample writes belong in `apps/daemon`, even if the fetch implementation lives in an EMS plugin module.

7. Handle auth failures clearly.
   If the provider needs credentials or a firmware-specific flow, fail with an actionable message that names the host and the required environment variables.

8. Add targeted tests.
   Cover discovery parsing, normalized telemetry mapping, auth error handling, and any gateway-specific fallback behavior.

9. Validate against a live gateway or captured payloads.
   Use realistic responses from the exact Enphase gateway generation you care about, because firmware behavior is not perfectly uniform.

## Suggested Test Scope

- `apps/ems/src/solar-energy-provider-plugin.test.ts`: normalized info fetches, auth handling, and fallback behavior
- `apps/ems/src/discover.test.ts`: discovery parsing when provider discovery changes
- `apps/daemon/src/database.test.ts`: only if schema or sample persistence changes

## Definition Of Done

- The provider can be discovered or otherwise added as a managed solar energy provider.
- The daemon can read normalized live production data from it.
- Samples persist in daemon-owned storage.
- Auth and offline failures are actionable.
- Tests cover the provider-specific behavior.
