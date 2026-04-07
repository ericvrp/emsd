# Open-Meteo Solar Forecast Plugin

The Open-Meteo solar forecast plugin provides solar irradiance forecasts using the [Open-Meteo](https://open-meteo.com/) weather API. This plugin is designed for estimating solar power generation based on ground sunlight measurements.

## Overview

This plugin fetches weather forecast data from Open-Meteo and converts it into a standardized solar forecast format. It provides:

- **Global Horizontal Irradiance (GHI)** - Solar radiation received per unit area (W/m²)
- **Air temperature** - 2-meter above ground temperature (°C)
- **Cloud opacity** - Cloud coverage percentage (%)

The plugin supports both hourly and 15-minute forecast intervals depending on the requested period.

## Installation

This plugin is included in the EMSD solar forecast package. No additional installation is required beyond the standard EMSD setup.

## Configuration

The Open-Meteo plugin requires no special configuration. It uses the site coordinates from your EMSD configuration to fetch location-specific forecasts.

### Site Coordinates

Ensure your site configuration includes valid latitude and longitude values:

```json
{
  "site": {
    "latitude": 52.37,
    "longitude": 4.90
  }
}
```

## Usage

The plugin is automatically selected when you configure a solar forecast source with the provider set to "open-meteo":

```yaml
solarForecast:
  provider: open-meteo
  # Other configuration options...
```

## Data Provided

The plugin returns forecast data points containing:

| Field | Unit | Description |
|-------|------|-------------|
| `ghiWm2` | W/m² | Global Horizontal Irradiance - the primary metric for solar energy estimation |
| `airTempC` | °C | Air temperature at 2 meters above ground |
| `cloudOpacityPercent` | % | Cloud coverage percentage (0-100) |
| `period` | ISO 8601 duration | Forecast period duration (PT15M or PT60M) |
| `periodEnd` | ISO 8601 timestamp | End time of the forecast period in UTC |

## API Details

### Endpoint

The plugin accesses the Open-Meteo API endpoint:
```
https://api.open-meteo.com/v1/forecast
```

### Parameters

Based on the requested forecast duration and interval, the plugin requests:
- `shortwave_radiation` - Converted to GHI in W/m²
- `temperature_2m` - Air temperature in °C
- `cloud_cover` - Cloud coverage percentage
- `timezone: "GMT"` - All times returned in UTC

### Forecast Resolution

- For periods ≤ 15 minutes: Uses 15-minute interval data (`minutely_15`)
- For periods > 15 minutes: Uses hourly interval data (`hourly`)

The plugin automatically adjusts the forecast duration requested from the API based on your needs, with maximum limits:
- 15-minute data: Up to 16 days (384 intervals)
- Hourly data: Up to 16 days (384 intervals)

## Limitations

1. **Dependent on Open-Meteo service**: Forecast accuracy and availability depend on the Open-Meteo API
2. **Geographic coverage**: Open-Meteo provides global coverage, but forecast quality may vary by location
3. **Data freshness**: Forecast data is updated according to Open-Meteo's update schedule
4. **GHI only**: This plugin provides Global Horizontal Irradiance. For PV-specific calculations, additional factors like panel orientation, tilt, and efficiency must be applied

## Example Response

A typical forecast data point looks like:
```json
{
  "ghiWm2": 850.5,
  "airTempC": 22.3,
  "cloudOpacityPercent": 25,
  "period": "PT60M",
  "periodEnd": "2026-04-07T15:00:00Z",
  "value": 850.5
}
```

## Related Plugins

- Other solar forecast plugins can be found in the `solar-forecast` directory
- Weather plugins follow a common interface defined in `@emsd/core`

## References

- [Open-Meteo API Documentation](https://open-meteo.com/en/docs)
- [Global Horizontal Irradiance (GHI) explained](https://www.energyeducation.ca/encyclopedia/Global_horizontal_irradiance)