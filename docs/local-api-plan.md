# Local API Plan

## Implementation Status: Implemented

The v1 route, auth helper, payload serializer, and UI are implemented.

## Goal

Add a Next.js-owned local API that Home Assistant can consume with its built-in REST support, without requiring a custom Home Assistant integration, plugin, or extension.

The first version should expose a single read-only route that returns JSON for the current household situation in a machine-friendly format. The immediate use case is Home Assistant automation around dynamic prices, including reacting when the current import price is negative.

## Implementation Summary

### Files created

| File | Purpose |
|------|---------|
| `apps/web/lib/local-api-auth.ts` | Bearer token validation, generation, and revocation |
| `apps/web/lib/local-current.ts` | Payload serializer (types + builder function) |
| `apps/web/app/api/local/v1/current/route.ts` | Versioned GET route |
| `apps/web/components/local-api-panel.tsx` | UI for token management and YAML generation |

### Files modified

| File | Change |
|------|--------|
| `apps/web/app/actions.ts` | Added `createLocalApiTokenAction`, `revokeLocalApiTokenAction`, `getLocalApiTokenStatusAction` server actions |
| `apps/web/components/settings-panel.tsx` | Added `"local-api"` tab with `LocalApiPanel` component |
| `apps/web/.env.example` | Added `EMSD_LOCAL_API_TOKEN` env var |

### Token storage and security

The local API supports two auth mechanisms in priority order:

1. **`EMSD_LOCAL_API_TOKEN` environment variable** — plain-text comparison. When set, every incoming bearer token is compared directly against this env var value using timing-safe comparison. Simple and works well when the token is set once at deploy time.

2. **Hash file at `var/local-api-token.hash`** — used for UI-generated tokens. When no `EMSD_LOCAL_API_TOKEN` env var is set, the system falls back to the hash file.

How the hash-file path works:

- `crypto.randomBytes(32).toString("hex")` generates a 64-character hex token (256 bits of entropy)
- `SHA-256(token)` produces the hash
- Only the hash is written to `var/local-api-token.hash` — the plaintext token is never stored on disk
- The token is displayed once in the UI and then the plaintext is discarded
- On each API request, the incoming token is hashed (`SHA-256(token)`) and compared to the stored hash using timing-safe comparison
- Token revocation simply writes an empty string to the hash file

Why this is safe if the hash file is stolen:

- SHA-256 is one-way. An attacker cannot reverse the hash to recover the original token.
- The generated tokens have 256 bits of entropy (64 hex characters from `crypto.randomBytes(32)`). Brute-forcing 2^256 possibilities is computationally infeasible even with dedicated hardware.
- The `var/` directory is already listed in `.gitignore` and is not served by the web app.
- The file stores only the hash — even full filesystem read access does not reveal usable credentials.

Comparing the two approaches:

| Mechanism | Plaintext stored? | Revocable? | Best for |
|-----------|-------------------|------------|----------|
| `EMSD_LOCAL_API_TOKEN` env var | Yes (in env/proc) | Requires restart | Quick deploy, Docker, env-based config |
| Hash file | No (only SHA-256 hash) | Yes (UI button) | Interactive setup, zero-knowledge storage |

## Current Codebase Baseline

- The web app already owns local HTTP routes under `apps/web/app/api/`.
- Those routes currently use the human UI auth flow via `next-auth` and the shared admin password in `apps/web/auth.ts`.
- The web app already reads EMS data through the EMS CLI bridge in `apps/web/lib/ems-bridge.ts`.
- The web app must keep using the EMS bridge and must not open SQLite directly.
- `getLiveStatus()` already gives the web app the daemon state, site list, managed devices, and latest device telemetry.
- `getDynamicPriceSnapshot()` already gives the web app current and upcoming dynamic price points for a site.
- `getWeatherForecast()` already gives the web app the configured solar forecast data for a site.
- Existing API routes currently return UI-oriented data and are protected by a browser-session auth check, which is not a good fit for Home Assistant polling.

## Home Assistant Constraints

Home Assistant's built-in REST support is a good fit for this feature.

- Home Assistant can poll a local HTTP `GET` endpoint on a schedule.
- It is comfortable consuming JSON objects and extracting many values from one response.
- It supports multiple sensors from one endpoint, which matches the goal of one route returning the whole current situation.
- It supports HTTP Basic auth and custom headers, including `Authorization: Bearer ...`.

This means JSON is the correct first format.

## Product Recommendation

Create one dedicated local API route instead of reusing the existing UI routes.

Recommended first route:

```text
GET /api/local/v1/current
```

Reasons:

- It keeps the contract separate from UI-facing JSON.
- It allows a stable machine-oriented payload without being constrained by frontend component needs.
- It avoids coupling Home Assistant to browser-session behavior.
- It matches the current route naming style that already uses `current` endpoints.
- It versions the HTTP contract from the start so later breaking changes can land in `v2` without ambiguity.

This route should stay read-only in the first version.

### Site cardinality

Keep the top-level payload on a single `site` object for v1, not a `sites` array.

Reasons:

- The repo currently assumes one household per install.
- The user-facing product today is centered on the current household, not a fleet view.
- A single-site payload is easier for Home Assistant templates and simpler to document.
- The existing local automation use case does not need multi-site support.

If multi-site becomes a real product requirement later, add a versioned `sites` array contract then, instead of complicating the first API shape now.

## Authentication Decision

Use a dedicated bearer token for the local API.

Recommended direction:

- Home Assistant sends `Authorization: Bearer <token>`.
- EMSD validates that token only for the local API route family.
- The token is independent from the normal UI login session.

Why this is the best first choice:

- Home Assistant already supports bearer tokens through request headers.
- It is simpler for Home Assistant than trying to reproduce the UI's login and cookie flow.
- It is safer than no auth.
- It is more revocable and auditable than IP allowlisting alone.
- It keeps human auth and machine auth separate.

Why not the other options:

- No auth:
  - Too risky even on a local network.
  - Easy to forget about later if the service is ever proxied or exposed beyond the LAN.
- UI password auth:
  - The current UI auth is session-based, not a simple HTTP Basic endpoint.
  - Reusing the human admin password for automation clients is poor separation of concerns.
  - It increases Home Assistant setup complexity.
- IP allowlist only:
  - No secret means no real client identity.
  - It becomes fragile with reverse proxies, DHCP changes, and multi-host setups.
  - It is hard to rotate or revoke cleanly.

Recommended follow-up security stance:

- Bearer token is required for v1.
- Optional IP allowlisting can be added later as defense in depth, not as the only auth layer.

### Token lifecycle recommendation

Preferred long-term behavior:

- Generate and revoke the local API token from the UI settings area.
- Show the full token only once when created.
- Store only a hashed or otherwise non-recoverable server-side representation.
- Start with support for one token if that keeps the first implementation smaller.

### Recommended UI-assisted setup flow

The UI should help the user complete the Home Assistant setup, not just hand over a token.

Recommended behavior:

- Create the bearer token in the UI.
- Display the token one time immediately after creation.
- In the same UI flow, generate a ready-to-paste Home Assistant YAML package snippet.
- Let the YAML generator use simple user preferences so the user does not need to hand-edit much or any YAML.

Recommended user preferences for the generated YAML:

- base URL or host name for the EMS web app (auto-detected from `window.location.host`)
- whether to use `configuration.yaml` directly or a package file such as `packages/ems.yaml`
- scan interval
- which recommended entities to include
- optional entity name prefix if the user wants multiple instances later

This should be treated as part of the intended onboarding experience for the local API, not just a future convenience.

If scope needs to be reduced further during implementation, a single environment-configured token is an acceptable temporary stepping stone, but the target design should remain a dedicated bearer token managed for this API.

## Response Design

The response should be optimized for two consumers at the same time:

- Home Assistant templates that want a few easy scalar values.
- Power users who want a full current-state snapshot for richer automations.

Recommended shape:

1. Include a small `summary` object with stable scalar values.
2. Include a fuller `site` and `devices` section derived from the existing EMS data.
3. Include current and upcoming dynamic price information because that is the main automation trigger for this feature.
4. Include solar forecast because it is already available server-side and is directly useful for automation.
5. Keep the route focused on current state and near-future planning data, not history archives.

Recommended top-level shape:

```json
{
  "schema": "ems.local.current.v1",
  "generatedAt": "2026-04-27T10:15:00.000Z",
  "daemon": {
    "running": true,
    "pid": 12345
  },
  "site": {
    "id": "home",
    "name": "Home",
    "location": "..."
  },
  "summary": {
    "currentImportPrice": -0.12,
    "currentImportPriceCurrency": "EUR",
    "currentImportPriceStartsAt": "2026-04-27T10:00:00.000Z",
    "currentImportPriceIsNegative": true,
    "nextImportPrice": 0.03,
    "currentForecastSolarPowerW": 1800,
    "nextForecastSolarPowerW": 2200,
    "totalBatterySocPercent": 58.4,
    "totalBatteryPowerW": -900,
    "totalSolarPowerW": 2100,
    "totalMeterPowerW": 3400,
    "batteryCount": 2,
    "meterCount": 1,
    "solarEnergyProviderCount": 1
  },
  "pricing": {
    "current": {
      "startsAt": "2026-04-27T10:00:00.000Z",
      "importPrice": -0.12,
      "currency": "EUR"
    },
    "next": {
      "startsAt": "2026-04-27T11:00:00.000Z",
      "importPrice": 0.03,
      "currency": "EUR"
    },
    "upcoming": []
  },
  "solarForecast": {
    "generatedAt": "2026-04-27T09:58:00.000Z",
    "periodMinutes": 15,
    "provider": "open-meteo",
    "providerLabel": "Open-Meteo",
    "current": {
      "period": "2026-04-27T10:00:00.000Z",
      "periodEnd": "2026-04-27T10:15:00.000Z",
      "value": 1800
    },
    "next": {
      "period": "2026-04-27T10:15:00.000Z",
      "periodEnd": "2026-04-27T10:30:00.000Z",
      "value": 2200
    },
    "upcoming": []
  },
  "devices": {
    "batteries": [],
    "meters": [],
    "solarEnergyProviders": []
  }
}
```

Notes:

- The payload should use JSON `null` where data is unavailable.
- The payload should keep internal field meanings explicit rather than compressing them into display strings.
- The payload should be stable and versioned with a schema string.
- The payload should stay single-site in v1 to match the current product assumption.
- The payload should not include large history arrays in v1.

## Recommended Included Data

### Summary fields for easy automation

These are the most valuable fields for Home Assistant templates and automations:

- `currentImportPrice`
- `currentImportPriceCurrency`
- `currentImportPriceStartsAt`
- `currentImportPriceIsNegative`
- `nextImportPrice`
- `currentForecastSolarPowerW`
- `nextForecastSolarPowerW`
- `totalBatterySocPercent`
- `totalBatteryPowerW`
- `totalSolarPowerW`
- `totalMeterPowerW`
- `batteryCount`
- `meterCount`
- `solarEnergyProviderCount`
- `daemon.running`

### Detailed current-state fields

These should be included so Home Assistant users can build richer automations without needing more API routes:

- Current site metadata.
- Managed battery records with current telemetry.
- Managed meter records with current telemetry.
- Managed solar energy provider records with current telemetry.
- Battery strategy-related fields that already exist in managed device records.
- Solar production control status for solar providers when available.
- Current and upcoming price points from the dynamic price snapshot.
- Current and upcoming solar forecast points from the weather or solar forecast source.

### Explicitly out of scope for v1

- Historical graph data.
- A write API for controlling devices.
- Full long-horizon forecast archives beyond what is practical for local automation polling.
- Home Assistant auto-discovery or a custom Home Assistant integration.

## Behavior Recommendation

The route should prefer a useful JSON response over turning every non-ideal state into an HTTP error.

Recommended behavior:

- Invalid or missing token: return `401` JSON, never redirect to `/login`.
- Daemon offline: return `200` JSON with `daemon.running: false` and as much remaining context as is safely available.
- No site configured yet: return `200` JSON with `site: null`, empty device arrays, and null summary values where needed.
- Missing dynamic price source: return `200` JSON with `pricing.current: null`, `pricing.next: null`, and an empty `upcoming` array.
- Missing solar forecast source: return `200` JSON with `solarForecast.current: null`, `solarForecast.next: null`, and an empty `upcoming` array, or `solarForecast: null` if that keeps the contract cleaner.

This is more Home Assistant friendly than failing the whole request whenever one subsystem is unavailable.

## Architecture Recommendation

Keep this route fully Next.js-owned, but keep data ownership unchanged.

1. The Next.js route authenticates the request.
2. The route reads current data through the existing EMS bridge.
3. The route reshapes the result into a local-automation-oriented JSON payload.
4. The route does not query SQLite directly.
5. The route does not introduce new business rules that only exist for Home Assistant.

This keeps the existing repo architecture intact:

- daemon owns persistence and polling
- EMS owns CLI/API data access
- web owns HTTP presentation and this local API export contract

## Planned Code Areas

### 1. New local API route (implemented)

Files:

- `apps/web/app/api/local/v1/current/route.ts`

Plan:

- Add a dedicated `GET` route.
- Mark it dynamic like the other current-state routes.
- Return JSON only.
- Use dedicated local API auth instead of the UI session check.

### 2. Local API auth helper (implemented)

Files:

- `apps/web/lib/local-api-auth.ts`

Plan:

- Add bearer-token validation that is separate from `next-auth` session handling.
- Keep the validation path narrow so it only applies to the local API route family.
- Avoid mixing bearer-token logic into the human login flow more than necessary.

### 3. Payload shaping helper (implemented)

Files:

- `apps/web/lib/local-current.ts`

Plan:

- Reuse `getLiveStatus()`.
- Reuse `getDynamicPriceSnapshot()` when the current site has a dynamic price source.
- Reuse `getWeatherForecast()` when the current site has a solar forecast source.
- Add a small serializer that converts those results into the stable Home Assistant JSON contract.
- Keep this serializer intentionally separate from the UI page loaders so UI component needs do not leak into the external API shape.

### 4. UI-assisted token and YAML setup (implemented)

Files:

- `apps/web/components/local-api-panel.tsx`
- `apps/web/app/actions.ts` (token actions)
- `apps/web/components/settings-panel.tsx` (tab integration)

Plan:

- Add token creation and revocation from the UI.
- After token creation, show the full token once and provide copy actions.
- Generate a ready-to-paste Home Assistant YAML snippet in the same UI.
- Let the generated YAML reflect simple user preferences such as scan interval, included entities, and package-file vs direct-configuration style.
- Keep the generated YAML aligned with the stable `v1` route contract so documentation and generated output stay in sync.

## Home Assistant Setup Plan

### What Home Assistant can and cannot do directly

Home Assistant can point at this endpoint directly, but built-in REST support does not auto-discover arbitrary JSON into the right Home Assistant entities on its own.

What that means in practice:

- Home Assistant can poll `GET /api/local/v1/current` directly.
- Home Assistant can read JSON fields from the response.
- Home Assistant cannot infer by itself that one field should become a power sensor, another should become a battery sensor, and another should become a binary sensor, purely from the JSON payload.
- Home Assistant therefore still needs a small configuration mapping that says which JSON field becomes which entity.

So for v1, yes, some Home Assistant YAML is still needed.

The good news is that this can stay very small:

- one `rest:` block
- one endpoint URL
- one bearer token secret
- a short list of sensors and binary sensors mapped from stable JSON fields

This is the minimum-friction path available without building a dedicated Home Assistant integration or switching to another discovery protocol such as MQTT discovery.

### Minimal setup target

The local API should be designed so a user only needs to do these steps in Home Assistant:

1. Copy one bearer token from EMSD.
2. Copy one YAML block generated by EMSD.
3. Restart Home Assistant or reload YAML-backed helpers where supported.

That should be the usability bar for this feature.

### Recommended Home Assistant entity strategy

Use one REST endpoint and create multiple Home Assistant entities from that single response.

Recommended mapping style:

- numeric values become `sensor` entities
- boolean values become `binary_sensor` entities when they represent true or false state
- avoid exposing the whole payload as one opaque blob unless it is only for debugging

This gives better automations, dashboards, history, and device-class behavior than relying on one text sensor with many JSON attributes.

### Recommended v1 setup steps for the user

Assuming Home Assistant is already running and can reach the EMSD web app over the local network:

1. Create the local API bearer token from EMSD.
2. Open the Home Assistant configuration directory.
3. Add the token to `secrets.yaml`.
4. Paste the YAML generated by EMSD into `configuration.yaml`, or better, into a dedicated package file such as `packages/ems.yaml`.
5. Restart Home Assistant.
6. Confirm the new entities appear under Developer Tools and can be used in automations.

### Recommended `secrets.yaml` entry

```yaml
ems_local_api_token: "Bearer YOUR_TOKEN_HERE"
```

### Recommended package-based setup

To keep Home Assistant changes minimal and isolated, prefer one dedicated package file.

Example `configuration.yaml` addition if packages are not already enabled:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

Then create `packages/ems.yaml` with the EMSD configuration.

This keeps the Home Assistant side to one small file instead of scattering settings across multiple YAML files.

### Recommended `packages/ems.yaml` example

```yaml
rest:
  - resource: http://localhost:3300/api/local/v1/current
    scan_interval: 30
    timeout: 10
    headers:
      Authorization: !secret ems_local_api_token
    sensor:
      - name: "EMS Price Now"
        unique_id: ems_price_now
        value_template: "{{ value_json.summary.currentImportPrice }}"
        unit_of_measurement: "EUR/kWh"
      - name: "EMS Battery SOC"
        unique_id: ems_battery_soc
        value_template: "{{ value_json.summary.totalBatterySocPercent }}"
        device_class: battery
        unit_of_measurement: "%"
      - name: "EMS Solar Forecast Now"
        unique_id: ems_solar_forecast_now
        value_template: "{{ value_json.summary.currentForecastSolarPowerW }}"
        device_class: power
        state_class: measurement
        unit_of_measurement: "W"
      - name: "EMS Solar Power Now"
        unique_id: ems_solar_power_now
        value_template: "{{ value_json.summary.totalSolarPowerW }}"
        device_class: power
        state_class: measurement
        unit_of_measurement: "W"
    binary_sensor:
      - name: "EMS Negative Price Now"
        unique_id: ems_negative_price_now
        value_template: "{{ value_json.summary.currentImportPriceIsNegative }}"
```

This is the kind of configuration the UI YAML generator produces.

### Resulting Home Assistant entities

With a setup like the example above, the user should end up with normal Home Assistant entities such as:

- `sensor.ems_price_now`
- `sensor.ems_battery_soc`
- `sensor.ems_solar_forecast_now`
- `sensor.ems_solar_power_now`
- `binary_sensor.ems_negative_price_now`

Those entities can then be used directly in:

- automations
- dashboards
- helpers
- energy-adjacent logic
- scripts

### Example automation use case

Once the entities exist, a Home Assistant automation can react to `binary_sensor.ems_negative_price_now` turning on, then decide whether to start selected household loads.

That is exactly the class of workflow this API should unlock first.

### Why we should not try to make the JSON self-describing for Home Assistant in v1

Even if the JSON included extra metadata like labels, units, device classes, and suggested entity IDs, built-in Home Assistant REST consumption would still not automatically create the corresponding entities from arbitrary JSON.

So adding Home Assistant-specific discovery metadata into the response does not remove the need for configuration when using the built-in REST integration.

For v1, the better strategy is:

- keep the API payload clean and stable
- document a minimal Home Assistant package file
- have EMSD generate that YAML snippet for copy-paste

### Future options if we want even less Home Assistant setup

If the goal later becomes near-zero Home Assistant manual setup, the realistic options are:

1. Support Home Assistant MQTT discovery.
2. Push states into Home Assistant's own API using a Home Assistant token.

Of those, the least disruptive next step is likely `1`, but it is a larger product and integration step than UI-generated YAML and should stay out of the first milestone.

## Home Assistant Consumption Example

This is the kind of setup the route should make possible with built-in Home Assistant REST support:

```yaml
rest:
  - resource: http://localhost:3300/api/local/v1/current
    scan_interval: 30
    headers:
      Authorization: !secret ems_local_api_token
    sensor:
      - name: "EMS Price Now"
        value_template: "{{ value_json.summary.currentImportPrice }}"
      - name: "EMS Battery SOC"
        value_template: "{{ value_json.summary.totalBatterySocPercent }}"
      - name: "EMS Solar Forecast Now"
        value_template: "{{ value_json.summary.currentForecastSolarPowerW }}"
    binary_sensor:
      - name: "EMS Negative Price Now"
        value_template: "{{ value_json.summary.currentImportPriceIsNegative }}"
```

This is the target ease-of-use standard for the API.

## Validation Plan

### Route tests

Plan:

- Verify `401` for missing or invalid bearer token.
- Verify `200` with expected JSON when data is available.
- Verify `200` with a degraded but valid payload when the daemon is offline.
- Verify `200` with null/empty sections when no site exists.
- Verify the current and next price points are derived correctly from the dynamic price snapshot.
- Verify the current and next solar forecast points are derived correctly from the forecast response.

### Serializer tests

Plan:

- Verify summary aggregation from one battery, multiple batteries, and missing telemetry.
- Verify null handling when price data is absent.
- Verify null handling when forecast data is absent.
- Verify `currentImportPriceIsNegative` only reflects the current price point.
- Verify device grouping into batteries, meters, and solar energy providers.

### UI-generated YAML tests

Plan:

- Verify the UI-generated Home Assistant YAML uses the versioned route path.
- Verify the generated YAML includes the chosen scan interval and selected entities.
- Verify the generated YAML stays valid when optional fields are omitted.
- Verify the token is displayed only at creation time and is not later recoverable in plain text.

### Home Assistant setup docs

Plan:

- Document the smallest supported Home Assistant YAML example.
- Document `secrets.yaml` usage for the bearer token.
- Document package-based setup as the preferred installation path.
- Explain clearly that built-in REST requires field-to-entity mapping and does not auto-discover arbitrary JSON into entities.
- Include one example automation that reacts to negative pricing.
- Document the UI flow that creates the token and generates the YAML snippet.

## Documentation Plan

After implementation later, add focused docs for setup and usage.

Files to update later:

- `docs/README.md`
- a new Home Assistant usage document or this file promoted into reference documentation

Documentation should include:

- route URL
- versioning policy for the route, starting with `v1`
- auth setup
- example Home Assistant YAML
- package-based Home Assistant setup steps
- UI-generated YAML setup flow
- explanation of what Home Assistant can and cannot auto-discover from arbitrary JSON
- explanation of the most important JSON fields
- expected behavior when the daemon or price source is offline

## Final Recommendation

Build a single Next.js route at `GET /api/local/v1/current` that returns JSON, powered by the existing EMS bridge, with dedicated bearer-token auth, and include both dynamic price and solar forecast data.

Pair that route with UI-based token creation and UI-generated Home Assistant YAML so the Home Assistant side stays as close as possible to copy-paste setup.
