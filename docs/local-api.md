# Local API

A Next.js-owned local HTTP API that Home Assistant can consume with its built-in REST support, without requiring a custom integration, plugin, or extension.

## Quick Start

1. Open the EMSD web app, navigate to the **Local API** section in Settings.
2. Generate a bearer token. Copy it immediately — it will not be shown again.
3. Add the token to your Home Assistant `secrets.yaml` (in the Home Assistant config directory):

   ```yaml
   ems_local_api_token: "Bearer <token>"
   ```

4. Copy the generated YAML from the EMSD UI and save it to your Home Assistant config directory. The recommended location is `packages/ems.yaml`. If you haven't enabled packages yet, add this to `configuration.yaml`:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

5. Restart Home Assistant. The entities will appear under Developer Tools.

## Route

```
GET /api/local/v1/current
```

The route is versioned (`v1`) so future breaking changes can land in `v2` without ambiguity.

### Authentication

Every request must include a bearer token:

```
Authorization: Bearer <token>
```

Two auth mechanisms are supported, in priority order:

1. **`EMSD_LOCAL_API_TOKEN` environment variable** — plain-text comparison. Suitable for deploy-time configuration.
2. **Hash file at `var/local-api-token.hash`** — used for UI-generated tokens. Only a SHA-256 hash of the token is stored on disk. The plaintext token is displayed once in the UI and then discarded.

Invalid or missing tokens return `401 JSON`.

### Query Parameters: `include` and `exclude`

The route accepts optional `?include=` and `?exclude=` query parameters with comma-separated entity IDs. The generated Home Assistant YAML does not use these filters and exports every current entity by default, but they remain available for direct API consumers.

```
GET /api/local/v1/current?include=ems_price_now,ems_derived_markers
GET /api/local/v1/current?exclude=ems_solar_forecast,ems_meter_power
```

When `include` is present, only the listed entity groups are returned. When `exclude` is present, the listed entity groups are omitted. If both are present, `exclude` wins. Filtered fields and sections are simply absent from the JSON response.

### Cache Header

Successful responses include:

```http
Cache-Control: private, max-age=10
Vary: Authorization
```

The generated Home Assistant YAML still uses `scan_interval: 30`.

## Response Schema

```json
{
  "schema": "ems.local.current.v1",
  "generatedAt": "2026-04-27T10:15:00.000Z",
  "daemonRunning": true,
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
  "derivedMarkers": {
    "todayLowPriceMarkerStartsAt": "2026-04-27T12:00:00.000Z",
    "todayLowPriceMarkerImportPrice": -0.12,
    "todayLowPriceMarkers": [
      {
        "startsAt": "2026-04-27T12:00:00.000Z",
        "importPrice": -0.12
      }
    ],
    "todayHighPriceMarkerStartsAt": "2026-04-27T19:00:00.000Z",
    "todayHighPriceMarkerImportPrice": 0.31,
    "todayHighPriceMarkers": [
      {
        "startsAt": "2026-04-27T19:00:00.000Z",
        "importPrice": 0.31
      }
    ],
    "solarSurplusStartAt": "2026-04-27T10:45:00.000Z",
    "solarSurplusEndAt": "2026-04-27T16:30:00.000Z"
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
    "upcoming": []
  },
  "devices": {
    "batteries": [],
    "meters": [],
    "solarEnergyProviders": []
  }
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `schema` | string | Schema version identifier (`"ems.local.current.v1"`) |
| `generatedAt` | string | ISO 8601 timestamp of data generation |
| `daemonRunning` | boolean | Whether the EMC D daemon is currently running |
| `site` | object \| null | Current site metadata (id, name, location) |
| `summary` | object | Aggregated scalar values for easy automation templates |
| `pricing` | object | Current, next, and upcoming dynamic price points. Omitted when both import price entities are excluded |
| `derivedMarkers` | object | Today's derived low/high price marker times and solar surplus start/end times. Omitted when Derived Markers is excluded |
| `solarForecast` | object | Current and upcoming solar forecast points. Omitted when the solar forecast entity is excluded |
| `devices` | object | Grouped managed device records (batteries, meters, solar providers). Omitted when Basic info is excluded |

All top-level fields except `schema`, `generatedAt`, and `summary` may be absent depending on the `?exclude=` parameter and data availability.

### Summary Fields

| Field | Type | Description |
|-------|------|-------------|
| `currentImportPrice` | number \| null | Current electricity import price |
| `currentImportPriceCurrency` | string \| null | Currency of the current price |
| `currentImportPriceStartsAt` | string \| null | When the current price period started |
| `currentImportPriceIsNegative` | boolean | Whether the current import price is below zero |
| `nextImportPrice` | number \| null | Next upcoming import price |
| `currentForecastSolarPowerW` | number \| null | Solar forecast for the current period (falls back to first upcoming when no current period matches) |
| `totalBatterySocPercent` | number \| null | Average state-of-charge across all batteries |
| `totalBatteryPowerW` | number \| null | Total power across all batteries (positive = charging, negative = discharging) |
| `totalSolarPowerW` | number \| null | Total measured solar production |
| `totalMeterPowerW` | number \| null | Net grid power at the meter (positive = import, negative = export) |
| `batteryCount` | number | Number of managed battery devices |
| `meterCount` | number | Number of managed meter devices |
| `solarEnergyProviderCount` | number | Number of solar energy providers |

### Pricing Section

| Field | Type | Description |
|-------|------|-------------|
| `current` | object \| null | Current price point (startsAt, importPrice, currency) |
| `next` | object \| null | Next upcoming price point |
| `upcoming` | array | All future price points beyond the next one |

### Solar Forecast Section

| Field | Type | Description |
|-------|------|-------------|
| `generatedAt` | string \| null | When the forecast was generated |
| `periodMinutes` | number \| null | Duration of each forecast period |
| `provider` | string \| null | Forecast provider identifier |
| `providerLabel` | string \| null | Human-readable provider name |
| `current` | object \| null | Current forecast period (period, periodEnd, value). Falls back to the first upcoming value when no period contains the current time |
| `upcoming` | array | Periods whose end time is in the future |

### Derived Markers Section

| Field | Type | Description |
|-------|------|-------------|
| `todayLowPriceMarkerStartsAt` | string \| null | First low-price marker for the current local day |
| `todayLowPriceMarkerImportPrice` | number \| null | Import price at the first low-price marker |
| `todayLowPriceMarkers` | array | All centered 4-hour moving-average low-price markers for the current local day |
| `todayHighPriceMarkerStartsAt` | string \| null | First high-price marker for the current local day |
| `todayHighPriceMarkerImportPrice` | number \| null | Import price at the first high-price marker |
| `todayHighPriceMarkers` | array | All high-price markers for the current local day |
| `solarSurplusStartAt` | string \| null | First predicted solar surplus start for the current local day |
| `solarSurplusEndAt` | string \| null | Final predicted solar surplus end for the current local day |

### Devices Section

Each device kind (batteries, meters, solarEnergyProviders) is an array of records.

**Battery device:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Device identifier |
| `name` | string | Human-readable name |
| `model` | string | Device model |
| `address` | string | Network address |
| `enabled` | boolean | Whether the device is enabled |
| `connected` | boolean | Whether the device is currently reachable |
| `state` | string | Current operational state (charging, discharging, idle, etc.) |
| `powerW` | number \| null | Current power |
| `socPercent` | number \| null | State of charge percentage |
| `capacityWh` | number \| null | Rated capacity |
| `strategyMode` | string \| null | Active strategy mode (e.g. self-consumption, manual) |
| `strategySummary` | string \| null | Human-readable strategy summary |
| `manualModeActive` | boolean | Whether manual override is active |
| `minimumDischargePercent` | number \| null | Configured minimum discharge SoC |
| `maximumChargePowerW` | number \| null | Configured max charge power |
| `maximumDischargePowerW` | number \| null | Configured max discharge power |

**Meter device:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Device identifier |
| `name` | string | Human-readable name |
| `model` | string | Device model |
| `address` | string | Network address |
| `enabled` | boolean | Whether the device is enabled |
| `connected` | boolean | Whether the device is currently reachable |
| `state` | string | Current operational state |
| `powerW` | number \| null | Current power |

**Solar device:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Device identifier |
| `name` | string | Human-readable name |
| `model` | string | Device model |
| `address` | string | Network address |
| `enabled` | boolean | Whether the provider is enabled |
| `connected` | boolean | Whether the provider is currently reachable |
| `state` | string | Current operational state |
| `powerW` | number \| null | Current measured production |
| `productionControlStatus` | string \| null | Production control status (`enabled`, `disabled`, or `unavailable`) |

## Behavior Under Degraded Conditions

The route returns `200` in non-ideal states rather than failing the entire request:

| Condition | Behavior |
|-----------|----------|
| Daemon offline | `daemonRunning: false`, remaining data returned as available |
| No site configured | `site: null`, empty device arrays, null summary values |
| No dynamic price source | `pricing` section omitted, price-related summary fields null |
| No solar forecast source | `solarForecast` section omitted, forecast summary fields null |
| Missing telemetry | Individual power/SOC fields are null, counts remain accurate |

## Entity Filtering

The generated Home Assistant YAML does not filter entities. Direct API callers can still use `?include=` or `?exclude=` to control which data the API fetches and returns. Each entity ID maps to specific response fields:

| Entity ID | Controls |
|-----------|----------|
| `ems_basic` | `daemonRunning`, `site`, `devices` |
| `ems_price_now` | `currentImportPrice`, `currentImportPriceCurrency`, `currentImportPriceStartsAt`, `nextImportPrice`, `pricing` section |
| `ems_negative_price_now` | `currentImportPriceIsNegative` |
| `ems_battery_info` | `totalBatterySocPercent`, `totalBatteryPowerW` |
| `ems_solar_forecast` | `currentForecastSolarPowerW`, `solarForecast` section |
| `ems_solar_power` | `totalSolarPowerW` |
| `ems_meter_power` | `totalMeterPowerW` |
| `ems_derived_markers` | `derivedMarkers` section |

When an entity is filtered out, its associated fields are omitted from the response and the backend skips unnecessary computation (e.g. skipping the dynamic price fetch when both pricing entities are excluded).

## Home Assistant YAML Setup

The EMSD UI generates ready-to-paste Home Assistant YAML for every current entity. The generated YAML uses one `rest:` block pointing at the versioned API route and maps JSON fields to individual Home Assistant entities.

### Generated Entities

The generated YAML includes these entity groups:

| UI Label | Description | Generated Sensors |
|----------|-------------|-------------------|
| Basic info | (daemon, site, devices) | No sensors — controls data inclusion only |
| Import Price | Current electricity import price | `sensor.ems_price_now` |
| Import Price Is Negative | Binary flag when import price is below zero | `binary_sensor.ems_negative_price_now` |
| Battery Info | (soc, power, state) | `sensor.ems_battery_soc`, `sensor.ems_battery_power`, `sensor.ems_battery_state` |
| Solar Forecast | Current solar forecast value | `sensor.ems_solar_forecast` |
| Solar Power | Current measured solar production | `sensor.ems_solar_power` |
| Grid Power | Net grid meter power | `sensor.ems_grid_power` |
| Derived Markers | Today low/high price marker counts with full marker arrays as attributes, plus solar surplus start/end | `sensor.ems_today_low_price_markers`, `sensor.ems_today_high_price_markers`, `sensor.ems_solar_surplus_start`, `sensor.ems_solar_surplus_end` |

The API response preview auto-refreshes every 30 seconds while visible.

### Example Home Assistant Automation

Once the entities are available, an automation can react to negative pricing:

```yaml
automation:
  - alias: "Notify on negative price"
    trigger:
      - platform: state
        entity_id: binary_sensor.ems_negative_price_now
        to: "on"
    action:
      - service: notify.mobile_app
        data:
          message: >
            Import price is now {{ states('sensor.ems_price_now') }} EUR/kWh
```

## Architecture

The route is fully Next.js-owned but delegates data access through the existing EMS bridge:

- **Daemon** owns persistence, polling, scheduling, and long-running orchestration.
- **EMS** owns CLI and API data access.
- **Web** owns HTTP presentation and this local API export contract.
- The web app must not open SQLite directly — it uses the EMS bridge for all data reads.
- Solar forecast and dynamic price providers run server-side only; they are never called from client-side code.

## Security

- Bearer tokens have 256 bits of entropy.
- UI-generated tokens: only a SHA-256 hash is stored on disk; the plaintext token is displayed once.
- Token revocation writes an empty string to the hash file.
- The `var/` directory is gitignored and is not served by the web app.
- Timing-safe comparison is used for all token validation paths.

## Out of Scope

- Historical graph data.
- A write API for controlling devices.
- Full long-horizon forecast archives.
- Home Assistant auto-discovery (MQTT discovery, custom integration).
- Multi-site support.
