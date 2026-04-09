# Enphase Local API

## Purpose

Use the local Enphase gateway interface when EMSD should read data directly from the site LAN instead of querying the Enphase cloud portal.

For residential systems, the local device is usually the `IQ Gateway`, often embedded inside an `IQ Combiner`. Older integrations and community docs still commonly call it `Envoy` or `Envoy-S`.

This local interface is useful for:

- current solar production
- household consumption when CTs are installed
- grid import and export when CTs are installed in the right mode
- battery state and battery power on supported systems
- inverter and battery inventory

## Naming And Hardware

Current Enphase branding uses `IQ Gateway`. In practice you may still encounter:

- `Envoy-R`, `Envoy-C`, `Envoy LCD`: older models
- `Envoy-S`: newer pre-IQ-Gateway naming
- `IQ Gateway`: current gateway name
- `IQ Combiner`: enclosure that often contains an embedded IQ Gateway

Important practical differences:

- older units before firmware `3.9` may not expose a usable REST API
- non-metered systems mostly expose production only
- metered systems with CTs can expose consumption, grid, and storage metering
- battery and Enpower or IQ System Controller data depends on installed hardware

## Documentation Quality

This is the main caveat with Enphase local access:

- some endpoints appear official or semi-official, especially older production endpoints
- many useful local endpoints are not cleanly documented by Enphase in the same way as the cloud API
- current practical knowledge mostly comes from community integrations, especially Home Assistant

For EMSD, treat the local API as usable but not fully vendor-stable. Firmware updates can change auth behavior and payloads.

## Authentication

Authentication depends heavily on firmware generation.

### Firmware before 7.x

Community integrations commonly report these patterns:

- username `installer` with blank password
- username `envoy` with blank password on some devices
- username `envoy` with the last 6 digits of the serial number as password on some devices
- some older installer-password flows are community-reverse-engineered rather than clearly documented by Enphase

This part of the ecosystem is inconsistent across models and firmware.

### Firmware 7.x and later

Community integrations consistently report that newer local access requires Enphase owner credentials to obtain a token.

Practical flow:

1. Use Enlighten account credentials.
2. Obtain a token associated with the gateway serial number.
3. Present that token to the local gateway.
4. Use the resulting local session for API requests.

Important caveats from the Home Assistant integration:

- firmware `7+` requires Enlighten username and password
- the obtained token is described as valid for about 1 year
- multi-factor authentication is not supported by that flow
- initial bootstrap is therefore not fully local on newer firmware

For EMSD, set these daemon environment variables when local auth is required:

- `ENPHASE_ENLIGHTEN_USERNAME`
- `ENPHASE_ENLIGHTEN_PASSWORD`

## Main Local Endpoints

The endpoints below are the most useful local surfaces for EMSD. Stability varies.

### Lowest-risk telemetry endpoints

- `GET /info` or `GET /info.xml`
  - gateway serial, model, and basic identity
- `GET /api/v1/production`
  - older official-looking production endpoint
  - useful on simpler and older systems
- `GET /api/v1/production/inverters`
  - per-inverter production list

### Common aggregate endpoints on newer systems

- `GET /production.json?details=1`
  - current production
  - daily, 7-day, and lifetime production values
  - on metered systems often also exposes consumption and some storage-related values
  - heavily used in community integrations
  - not all of this payload appears to be officially documented

- `GET /home.json`
  - summary-style gateway state used by community integrations

### Meter and CT endpoints

These are especially relevant for a real EMS because CT-based data is more useful than some of the calculated summary fields.

- `GET /ivp/meters`
  - meter and CT configuration discovery
- `GET /ivp/meters/reports`
  - aggregate and per-phase production and consumption data
- `GET /ivp/meters/readings`
  - instantaneous and cumulative readings for configured meters

For household EMS use, these are often the most important local endpoints on a metered gateway.

### Battery and Ensemble endpoints

- `GET /ivp/ensemble/inventory`
  - battery and Ensemble inventory on supported systems
  - commonly used for IQ Battery details
- `GET /production.json?details=1`
  - may also expose battery summary fields on some systems

### Other community-used endpoints

- `GET /home`
  - gateway status page

## Typical Payload Shapes

These are implementation-oriented examples based on common community observations. They are not guaranteed vendor contracts. Exact fields can vary by firmware, hardware, and CT configuration.

### `GET /info.xml`

Typical shape:

```xml
<envoy_info>
  <device>
    <software>D8.2.4222</software>
    <pn>800-00670-r06</pn>
    <sn>123456789012</sn>
    <imeter>1</imeter>
  </device>
</envoy_info>
```

Useful fields:

- `software`: firmware version
- `pn`: part number or hardware variant
- `sn`: gateway serial number
- `imeter`: whether the unit is metered or CT-capable

Notes:

- older devices may return HTML-like content instead of clean XML
- this is mainly for identity and capability detection, not live telemetry

### `GET /api/v1/production`

Typical shape:

```json
{
  "wattsNow": 1842,
  "wattHoursToday": 11234,
  "wattHoursSevenDays": 84321,
  "wattHoursLifetime": 9123456
}
```

Useful fields:

- `wattsNow`: current production power in W
- `wattHoursToday`: today's production energy in Wh
- `wattHoursSevenDays`: rolling or prior-7-day production counter in Wh
- `wattHoursLifetime`: lifetime production in Wh

Notes:

- this is the simplest production-only endpoint
- it does not describe house consumption or grid import or export

### `GET /api/v1/production/inverters`

Typical shape:

```json
[
  {
    "serialNumber": "121234000001",
    "lastReportWatts": 221,
    "lastReportDate": 1712661000
  }
]
```

Common extra fields on some firmware include AC and DC voltage, current, temperature, frequency, and daily or lifetime energy.

Useful fields:

- `serialNumber`: inverter identifier
- `lastReportWatts`: last reported inverter power in W
- `lastReportDate`: Unix timestamp for that report

Notes:

- this is last reported inverter data, not guaranteed real-time data
- richer per-inverter payloads are more firmware-dependent than the basic fields

### `GET /production.json?details=1`

Typical shape:

```json
{
  "production": [
    {
      "type": "inverters",
      "activeCount": 18,
      "wNow": 1911,
      "whLifetime": 9123456,
      "readingTime": 1712661000
    },
    {
      "type": "eim",
      "measurementType": "production",
      "activeCount": 1,
      "wNow": 1888,
      "whToday": 11234,
      "whLastSevenDays": 84321,
      "whLifetime": 9123010,
      "lines": [
        { "wNow": 1888, "whToday": 11234, "whLifetime": 9123010 }
      ]
    }
  ],
  "consumption": [
    {
      "measurementType": "total-consumption",
      "wNow": 1420,
      "whToday": 15432,
      "whLastSevenDays": 104321,
      "whLifetime": 10234567,
      "lines": [
        { "wNow": 1420, "whToday": 15432, "whLifetime": 10234567 }
      ]
    }
  ],
  "storage": [
    {
      "percentFull": 64
    }
  ]
}
```

Useful fields:

- `production[*].wNow`
- `production[*].whToday`
- `production[*].whLastSevenDays`
- `production[*].whLifetime`
- `consumption[*].wNow`
- `consumption[*].whToday`
- `consumption[*].whLastSevenDays`
- `consumption[*].whLifetime`
- `storage[*].percentFull`
- `lines[]` for phase-level values

Important interpretation notes:

- `production[0]` is commonly inverter-derived aggregate data
- `production[1]` is commonly CT-backed production data when a production CT exists
- `consumption[0]` is commonly house consumption, not necessarily grid interchange
- this endpoint is widely used, but parts of it are community-derived rather than cleanly vendor-documented
- for metered systems, CT-based endpoints below are often safer than relying on the summary math here

### `GET /ivp/meters`

Typical shape:

```json
[
  {
    "eid": 704643328,
    "state": "enabled",
    "measurementType": "production",
    "phaseCount": 1
  },
  {
    "eid": 704643584,
    "state": "enabled",
    "measurementType": "net-consumption",
    "phaseCount": 1
  }
]
```

Useful fields:

- `state`: whether the meter role is enabled
- `measurementType`: what the CT role means
- `phaseCount`: number of active phases

Important interpretation notes:

- `production` means solar production metering
- `net-consumption` means grid interchange style metering
- `total-consumption` means house or load consumption metering
- use this endpoint first to discover what the rest of the meter payloads actually mean

### `GET /ivp/meters/reports`

Typical shape:

```json
[
  {
    "cumulative": {
      "currW": 1888,
      "whDlvdCum": 9123010,
      "whRcvdCum": 0,
      "rmsVoltage": 231.2,
      "freqHz": 49.98,
      "rmsCurrent": 8.2,
      "pwrFactor": 0.99
    },
    "lines": [
      {
        "currW": 1888,
        "whDlvdCum": 9123010,
        "rmsVoltage": 231.2,
        "rmsCurrent": 8.2
      }
    ]
  }
]
```

Useful fields:

- `cumulative.currW`: current power
- `cumulative.whDlvdCum`: lifetime energy delivered
- `cumulative.whRcvdCum`: lifetime energy received
- `cumulative.rmsVoltage`
- `cumulative.freqHz`
- `cumulative.rmsCurrent`
- `cumulative.pwrFactor`
- `lines[]`: phase-level equivalents

Important interpretation notes:

- `Dlvd` means delivered to the switchboard
- `Rcvd` means received from the switchboard
- the meaning changes with CT role:
  - production CT: delivered is usually solar production
  - total-consumption CT: delivered is usually house load consumption
  - storage CT: delivered is usually battery discharge, received is usually battery charge
- do not reuse one interpretation across all meter roles

### `GET /ivp/meters/readings`

Typical shape:

```json
[
  {
    "instantaneousDemand": 620,
    "actEnergyDlvd": 4567890,
    "actEnergyRcvd": 1234567,
    "channels": [
      {
        "instantaneousDemand": 620,
        "actEnergyDlvd": 4567890,
        "actEnergyRcvd": 1234567
      }
    ]
  }
]
```

Useful fields:

- `instantaneousDemand`: commonly used as net grid power when the CT role is `net-consumption`
- `actEnergyDlvd`: cumulative delivered energy
- `actEnergyRcvd`: cumulative received energy
- `channels[]`: phase-level equivalents

Important interpretation notes:

- on `net-consumption` setups, positive `instantaneousDemand` is commonly interpreted as importing from the grid
- negative `instantaneousDemand` is commonly interpreted as exporting to the grid
- community integrations commonly interpret:
  - `actEnergyDlvd` as lifetime imported energy
  - `actEnergyRcvd` as lifetime exported energy
- that interpretation depends on the CT being a net-consumption meter

### `GET /ivp/ensemble/inventory`

Typical observed shape:

```json
[
  {
    "devices": [
      {
        "serial_num": "122233344455",
        "percentFull": 64,
        "encharge_capacity": 10240,
        "last_rpt_date": 1712661000
      }
    ]
  }
]
```

Useful fields vary by device family, but common fields seen in practice include:

- device serial number
- state of charge
- battery power
- apparent power
- temperature
- communication status
- last report time

Important interpretation notes:

- this endpoint is highly variable across battery generations and related Ensemble devices
- use fixtures from a real system before hard-coding a narrow parser
- when `production.json` does not expose a usable battery summary, community integrations often fall back to this endpoint

### `GET /home.json`

Typical shape:

```json
{
  "enpower": {
    "grid_status": "closed"
  }
}
```

Useful fields:

- `enpower.grid_status`

Important interpretation notes:

- useful on battery-backed systems with Enpower or IQ System Controller hardware
- not a replacement for meter-based import and export telemetry
- semantics can vary across hardware and firmware

## What Data You Can Usually Get

### Non-metered systems

Usually safe to expect:

- current production
- today production
- 7-day production
- lifetime production
- per-inverter power on many systems

Usually not safe to expect:

- real household consumption
- real grid import and export
- battery energy flow from CT data

### Metered systems with CTs

Usually possible:

- current production
- current household consumption
- lifetime import and export counters depending on CT mode
- phase-level measurements on multi-phase setups
- production, consumption, and storage CT readings

CT installation mode matters a lot:

- `Load with Solar` is the mode typically associated with net consumption and import or export style values
- `Load only` is associated with total consumption and may not give direct import or export values

### Battery systems

Depending on installed hardware and firmware, local data may include:

- aggregate battery state of charge
- available battery energy
- individual IQ Battery state of charge
- battery power
- storage CT power and lifetime charged or discharged energy when a storage CT exists

## Local Control Capabilities

Read access is the safer use case.

There appears to be some local control surface on systems with Enpower or IQ System Controller, and Home Assistant exposes community-proven controls such as:

- reserve battery level
- storage mode
- charge from grid
- grid enable
- load-shedding relay control

However:

- this is not presented by Enphase as a stable public local EMS control API
- behavior appears to depend on hardware, firmware, and regional configuration
- this should be treated as experimental until validated on the exact target system

For EMSD, local telemetry is a much safer first target than local control.

## Recommended EMSD Integration Order

Start with the smallest stable read-only surface:

1. `GET /info.xml`
2. `GET /api/v1/production`
3. `GET /api/v1/production/inverters`

If the system is metered, then add:

1. `GET /ivp/meters`
2. `GET /ivp/meters/reports`
3. `GET /ivp/meters/readings`

If the site has batteries, then add:

1. `GET /ivp/ensemble/inventory`
2. battery-related fields from `GET /production.json?details=1`

Prefer CT-based meter readings over calculated summary fields when both are available.

## Risks And Quirks

- firmware updates can silently change auth requirements or payload structure
- firmware `7+` local access is not fully offline because token bootstrap uses Enlighten credentials
- non-metered systems expose much less useful EMS data
- some metered values available through `production.json` are specifically noted by the Home Assistant docs as not coming from officially documented local endpoints
- inverter detail availability can vary by firmware and system size
- some community integrations report that older or slower gateways can become unstable with aggressive polling

## Relationship To Enphase Cloud API

Enphase also has a well-documented cloud API v4. That API is separate from the local gateway interface.

Use the cloud API when you need:

- officially documented OAuth-based access
- remote access outside the LAN
- historical or account-scoped access managed through the Enphase portal

Use the local API when you need:

- on-LAN telemetry
- lower latency
- reduced cloud dependency after auth bootstrap

For newer firmware, the line is blurred because local auth still depends on a cloud-issued token flow.

## Example Local URLs

Assuming the gateway is reachable at `https://envoy.local` or `https://192.168.1.50`:

```text
https://envoy.local/info.xml
https://envoy.local/api/v1/production
https://envoy.local/api/v1/production/inverters
https://envoy.local/production.json?details=1
https://envoy.local/ivp/meters
https://envoy.local/ivp/meters/reports
https://envoy.local/ivp/meters/readings
https://envoy.local/ivp/ensemble/inventory
```

## Practical Recommendation

For EMSD, the best first local Enphase integration target is:

- read-only
- metered IQ Gateway if available
- CT-driven production and consumption data
- optional battery inventory and state of charge

Do not assume local battery dispatch control is portable or stable across Enphase systems unless tested on the exact hardware and firmware.

## Sources

- Enphase communication hardware overview: `https://enphase.com/installers/communication`
- Home Assistant Enphase Envoy integration: `https://www.home-assistant.io/integrations/enphase_envoy/`
- Community custom integration README: `https://github.com/briancmpbll/home_assistant_custom_envoy`
- Community implementation reference: `https://raw.githubusercontent.com/briancmpbll/home_assistant_custom_envoy/main/custom_components/enphase_envoy_custom/envoy_reader.py`
