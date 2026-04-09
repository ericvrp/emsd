# Solar Forecast Plugins

## Goal

Add or extend a forecast provider that gives EMSD a normalized forward-looking solar signal for scheduling, simulation, and dashboard use.

In the current codebase, these sources are managed through `weather` commands and shared `Weather*` types, even though the product-facing purpose is solar forecasting.

## Current Supported Provider

- `open-meteo`

## Current Touchpoints

- `packages/core/src/index.ts`: `WeatherForecastSourceRecord`, `WeatherForecastRecord`, and `WeatherForecastPointRecord`
- `apps/ems/src/plugins/solar-forecast/`: provider-specific forecast fetching and normalization
- `apps/ems/src/weather.ts`: source list, add, update, and remove commands
- `apps/ems/src/managed-site-store.ts`: weather source CRUD
- `apps/daemon/src/database.ts`: `weather_sources`, `weather_forecasts`, and `solar_forecast_samples`
- `apps/daemon/src/index.ts`: daemon refresh loop for forecast snapshots and samples

## Open-Meteo Notes

- The current provider is `open-meteo`.
- It uses site GPS coordinates from `SiteRecord.location`.
- It returns normalized points with `ghiWm2`, `airTempC`, `cloudOpacityPercent`, `period`, and `periodEnd`.
- EMSD currently requests `shortwave_radiation`, `temperature_2m`, and `cloud_cover`.
- The implementation uses 15-minute data for requests at `15` minutes or below and hourly data otherwise.

For provider-specific details, see `docs/reference/solar-forecast/open-meteo.md`.

## Implementation Steps

1. Lock down the forecast contract.
   Decide what downstream code actually needs from the provider, such as irradiance, forecast interval, and timestamp boundaries.

2. Keep the managed source record small.
   Persist source identity and durable provider settings in `weather_sources`. Forecast snapshots and derived samples remain daemon-owned runtime data.

3. Reuse the normalized point shape first.
   Map provider output into `WeatherForecastPointRecord` before adding new shared fields. Add new shared fields only when they are required across process boundaries.

4. Validate site coordinates early.
   Forecast plugins should fail clearly when a site does not have a usable `latitude, longitude` location string.

5. Keep provider-specific payload handling inside the plugin module.
   Parse raw API responses in `apps/ems/src/plugins/solar-forecast/` and return normalized forecast records to the rest of the system.

6. Keep refresh and retention daemon-owned.
   Periodic sync, retries, snapshot writes, and time-series storage belong in the daemon.

7. Add targeted tests.
   Cover coordinate parsing, response normalization, malformed payload handling, and provider-specific interval logic.

8. Verify the forecast is usable by downstream consumers.
   Confirm the stored output works for daemon refresh, history views, and future strategy work.

## Suggested Test Scope

- `apps/ems/src/weather.test.ts`: CLI parsing and weather source CRUD
- plugin tests under `apps/ems/src/plugins/solar-forecast/` or nearby EMS tests for normalization and provider errors
- `apps/daemon/src/database.test.ts`: only if forecast persistence changes
- `packages/core/src/index.test.ts`: only if shared weather types or helpers change

## Definition Of Done

- A forecast source can be added, listed, updated, and removed through EMS.
- The provider returns normalized forecast points for a valid site.
- The daemon can refresh and persist forecast output.
- Provider failures are actionable.
- Tests cover the new or changed provider behavior.
