# SolarEdge Local API

## Purpose

Use the local SolarEdge inverter web interface when EMSD should read solar production and optimizer data directly from the inverter on the LAN.

The local API is available on newer SolarEdge inverters with SetApp commissioning (no physical display). It provides real-time production data, optimizer-level telemetry, and some inverter status information.

This local interface is useful for:

- current solar production power
- daily, monthly, yearly, and lifetime energy totals
- grid voltage and frequency
- DC voltage and inverter temperature
- optimizer online count and per‑optimizer voltage, current, temperature, and power (averaged)
- import/export meter data when CTs are configured

## Hardware Models And SetApp

The local API is present on inverters that use SetApp for commissioning. These models have a communication board without a physical display and are identified by a CPU number starting with `04`.

Relevant families include:

- **Single‑phase HD‑Wave inverters with SetApp** (e.g., SE3000H‑HD‑Wave, SE3500H, SE5000H, SE6000H, SE7600H, SE10000H)
- **Three‑phase European inverters with SetApp** (e.g., SE3K‑E10K, SE12.5K–SE27.6K, SE33.3K)
- **Australian single‑phase inverters with SetApp** (SE2500H–SE10000H)

The fastest way to verify local API support is to browse to the inverter’s IP address. If a SolarEdge commissioning page appears, the local API is available.

**Important warning:** recent firmware versions (reportedly from late 2023 onward) have disabled local access on many units. Always check that you can reach the inverter’s web interface before planning an integration.

## Device Specifics

### SolarEdge SE3000H HD‑Wave

The SE3000H is a single‑phase HD‑Wave inverter with SetApp. It falls into the “Single‑phase HD‑Wave inverters with SetApp” family listed above and supports the local API when running compatible firmware.

Key characteristics for EMSD integration:

- Rated power: 3000 W AC
- HD‑Wave technology (high‑frequency switching)
- Built‑in Wi‑Fi access point for SetApp commissioning
- Local web interface at `http://<inverter‑ip>`
- Exposes production, energy totals, grid measurements, and optimizer data via the local API

### SolarEdge S500B Power Optimizer

The S500B is a DC‑side power optimizer that pairs with SolarEdge inverters. Each optimizer performs maximum power point tracking (MPPT) for a single PV module and communicates with the inverter over power‑line communication.

Key characteristics for EMSD integration:

- Maximum output power: 500 W
- Input voltage range: 6–60 V DC
- Output voltage range: up to 60 V DC
- Integrated safety features (SafeDC™)
- Data reported **aggregated** by the inverter; the local API does not expose per‑optimizer time series
- Optimizer health (online status, voltage, current, temperature) is available as averages via the `maintenance` endpoint

## API Protocol

The SolarEdge local API uses Protocol Buffers (protobuf) over HTTP GET requests. All endpoints under `/web/v1/` return binary protobuf payloads. There is no authentication required.

### Status Endpoint Structure

The main endpoint for production data is `GET /web/v1/status`. The response is a protobuf message with this structure (simplified):

```protobuf
message Status {
  float powerWatt = 3;           // current production power (W)
  float voltage = 4;             // grid voltage (V)
  float frequencyHz = 5;         // grid frequency (Hz)
  message EnergyStatistics {
    float today = 1;             // energy today (Wh)
    float thisMonth = 2;         // energy this month (Wh)
    float thisYear = 3;          // energy this year (Wh)
    float total = 4;             // lifetime energy (Wh)
  }
  EnergyStatistics energy = 15;
  // ... other fields omitted
}
```

## API Endpoints

All endpoints are GET requests that return Protocol Buffer (protobuf) payloads. There is no authentication.

The most useful endpoints for EMSD are:

- `GET /web/v1/status` – real‑time production data, energy counters, grid measurements, optimizer online count
- `GET /web/v1/maintenance` – optimizer‑level voltage, current, temperature, and power (averaged)
- `GET /web/v1/information` – software versions, error log
- `GET /web/v1/power_control` – power‑control settings (grid control, energy manager, etc.)

A more complete list of endpoints (from the `solaredge‑local` repository):

* AppConfigs: `web/v1/app_configs`
* Region: `web/v1/region`
* Region_Country: `web/v1/region/country`
* Region_Language: `web/v1/region/language`
* Pairing: `web/v1/pairing`
* Pairing_Request: `web/v1/pairing/request`
* Communication: `web/v1/communication`
* Communication_Server: `web/v1/communication/server`
* Communication_Lan: `web/v1/communication/lan`
* Communication_Rs485_SlaveDetect: `web/v1/communication/rs485/<id>/slave_detect`
* Communication_Rs485_Protocol: `web/v1/communication/rs485/<id>/protocol`
* Communication_Rs485_DeviceId: `web/v1/communication/rs485/<id>/deviceid`
* Communication_Rs485_Modbus: `web/v1/communication/rs485/<id>/modbus`
* Communication_Rs485_Modbus_AddDevice: `web/v1/communication/rs485/<id>/modbus/add_device`
* Communication_Rs485_Modbus_RemoveDevice: `web/v1/communication/rs485/<id>/modbus/remove_device`
* Communication_Wifi: `web/v1/communication/wifi`
* Communication_Wifi_Wps: `web/v1/communication/wifi/wps`
* Communication_Wifi_Connect: `web/v1/communication/wifi/connect`
* Communication_Cellular: `web/v1/communication/cellular`
* Communication_Zigbee_Defaults: `web/v1/communication/zigbee/defaults`
* Communication_Zigbee_ModuleConfigs: `web/v1/communication/zigbee/module_configs`
* Communication_Zigbee_OpMode: `web/v1/communication/zigbee/op_mode`
* Communication_Gpio_Pri: `web/v1/communication/gpio/pri`
* Communication_ModbusTcp: `web/v1/communication/modbus_tcp`
* PowerControl: `web/v1/power_control`
* PowerControl_GridControl: `web/v1/power_control/grid_control`
* PowerControl_EnergyManager_LimitControl: `web/v1/power_control/energy_manager/limit_control`
* PowerControl_EnergyManager_EnergyControl: `web/v1/power_control/energy_manager/energy_control`
* PowerControl_EnergyManager_StorageControl: `web/v1/power_control/energy_manager/storage_control`
* PowerControl_ReactivePower: `web/v1/power_control/reactive_power`
* PowerControl_ActivePower: `web/v1/power_control/active_power`
* PowerControl_Wakeup: `web/v1/power_control/wakeup`
* PowerControl_Advanced: `web/v1/power_control/advanced`
* PowerControl_Reset: `web/v1/power_control/reset`
* PowerControl_Rrcr: `web/v1/power_control/rrcr`
* Maintenance: `web/v1/maintenance`
* Maintenance_DateTime: `web/v1/maintenance/date_and_time`
* Maintenance_ResetCounters: `web/v1/maintenance/reset_counters`
* Maintenance_ResetFactory: `web/v1/maintenance/reset_factory`
* Maintenance_Afci: `web/v1/maintenance/afci`
* Maintenance_AfciTest: `web/v1/maintenance/afci/test`
* Maintenance_Inverters_SelfTest: `web/v1/maintenance/inverters/<position>/self_test`
* Maintenance_Standby: `web/v1/maintenance/standby`
* Maintenance_GridProtectionLogin: `web/v1/maintenance/grid_protection/login`
* Maintenance_GridProtection: `web/v1/maintenance/grid_protection`
* Maintenance_UpgradeUsb: `web/v1/maintenance/fw_upgrade/usb`
* Information: `web/v1/information`
* Status: `web/v1/status`
* Status_ServerCommTest: `web/v1/status/server_comm_test`

## Data Shapes (From `solaredge‑local` Python Wrapper)

The following fields are exposed by the `solaredge‑local` library and are used in the Home Assistant integration. Exact field names may differ in the raw protobuf responses.

### `status` object (from `get_status()`)

- `status.energy.total` – lifetime energy (Wh)
- `status.energy.thisYear` – year‑to‑date energy (Wh)
- `status.energy.thisMonth` – month‑to‑date energy (Wh)
- `status.energy.today` – today’s energy (Wh)
- `status.powerWatt` – current production power (W)
- `status.inverters.primary.temperature.value` – inverter temperature (°C or °F)
- `status.inverters.primary.voltage` – DC voltage (V)
- `status.frequencyHz` – grid frequency (Hz)
- `status.voltage` – grid voltage (V)
- `status.optimizersStatus.online` – number of online optimizers
- `status.optimizersStatus.total` – total optimizers
- `status.status` – inverter operating mode (integer index into `INVERTER_MODES` list)
- `status.metersList` – list of meter objects (if CTs installed)
  - `meter.currentPower` – current power (W) for that meter
  - `meter.totalEnergy` – total energy (Wh) for that meter

Common inverter modes (mapping from `INVERTER_MODES` list):

- `SHUTTING_DOWN`
- `ERROR`
- `STANDBY`
- `PAIRING`
- `POWER_PRODUCTION`
- `AC_CHARGING`
- `NOT_PAIRED`
- `NIGHT_MODE`
- `GRID_MONITORING`
- `IDLE`

### `maintenance` object (from `get_maintenance()`)

- `maintenance.diagnostics.inverters.primary.optimizer` – list of optimizer objects
  - `optimizer.online` – boolean
  - `optimizer.temperature.value` – optimizer temperature
  - `optimizer.inputV` – optimizer input voltage (V)
  - `optimizer.inputC` – optimizer input current (A)
- `maintenance.system.name` – system name (string)

The Home Assistant integration averages the online optimizer values to produce:

- average optimizer temperature
- average optimizer voltage
- average optimizer current
- average optimizer power (voltage × current)

### `information` object (from `get_information()`)

- software versions
- error log entries

### `power_control` object (from `get_power_control()`)

- grid‑control settings
- energy‑manager limits
- storage‑control parameters
- reactive‑power settings

## Meter Data (CTs)

When CTs are installed and configured, the `status.metersList` array contains meter objects. Index 0 is commonly the export meter, index 1 the import meter (this may vary by configuration). Each meter provides `currentPower` and `totalEnergy`.

## Example Raw Response

You can inspect the raw protobuf response using `curl` and the Protocol Buffers compiler:

```bash
curl -s http://<inverter‑ip>/web/v1/status | protoc --decode_raw
```

Many numeric values are 32‑bit floating‑point numbers.

Parsed `.proto` definitions are available in the `solaredge‑local` repository under `message_types/`. To decode with a specific proto file:

```bash
curl -s http://<inverter‑ip>/web/v1/status | protoc --decode Status message_types/status.proto
```

## SolarEdge Power Optimizers (S500B)

SolarEdge power optimizers (e.g., model S500B) are DC‑side optimizers that communicate with the inverter over power‑line communication. The inverter aggregates optimizer data and exposes it via the `maintenance` endpoint.

Each optimizer reports:

- online status
- input voltage
- input current
- temperature

The inverter calculates average values across all online optimizers; individual optimizer data is not exposed through the local API.

## Integration Notes For EMSD

1. **Verify local access** – browse to the inverter’s IP address before coding.
2. **Firmware warning** – recent firmware may disable the local API. If the web interface is inaccessible, the API will not work.
3. **Use the TypeScript implementation** – EMSD includes a pure TypeScript Protocol Buffer decoder that extracts power and energy data without Python dependencies.
4. **Polling interval** – the inverter may throttle frequent requests. The Home Assistant integration uses a 10‑second throttle.
5. **Meter interpretation** – confirm which meter index corresponds to import vs. export by comparing with the inverter’s web interface or known power flow.
6. **Optimizer data** – optimizer‑level details are only available as averages; per‑optimizer monitoring requires the SolarEdge cloud API.
7. **No authentication** – the local API is unprotected; ensure the inverter is on a secure network segment.

## Recommended EMSD Integration Order

Start with the smallest stable read‑only surface:

1. `GET /web/v1/status` – production power, energy totals, grid measurements
2. `GET /web/v1/maintenance` – optimizer average values
3. `GET /web/v1/information` – software version and error log

If CTs are installed, add meter data from `status.metersList`.

## Risks And Quirks

- Firmware updates can remove local API access entirely.
- No authentication means any device on the LAN can query the inverter.
- Protobuf payloads may change across firmware versions; the Python wrapper may need updates.
- The local API does not provide historical data (only real‑time and cumulative counters).
- Optimizer data is aggregated; individual optimizer failures may be hidden in averages.

## Relationship To SolarEdge Cloud API

SolarEdge offers a well‑documented cloud‑based Monitoring API that provides richer data, historical series, and per‑optimizer details. Use the cloud API when you need:

- official, versioned REST API
- remote access outside the LAN
- per‑optimizer time‑series
- detailed fault and event logs

Use the local API when you need:

- on‑LAN telemetry with minimal latency
- independence from cloud connectivity (after firmware verification)
- simple real‑time production and optimizer health.

## Example Local URLs

Assuming the inverter is reachable at `http://192.168.1.100`:

```
http://192.168.1.100/web/v1/status
http://192.168.1.100/web/v1/maintenance
http://192.168.1.100/web/v1/information
http://192.168.1.100/web/v1/power_control
```

## EMSD Plugin Implementation

The EMSD SolarEdge plugin uses a pure TypeScript implementation that directly queries the inverter's local API and decodes the Protocol Buffer responses without Python dependencies.

### Requirements

- No external dependencies beyond Bun/Node.js
- The inverter must have local API enabled (see firmware warning above)

### How It Works

1. The plugin sends an HTTP GET request to `http://<inverter‑ip>/web/v1/status`
2. The binary protobuf response is decoded using a custom Protocol Buffer decoder implemented in TypeScript
3. The plugin extracts the `powerWatt` field (field 3) and returns it as the current production power
4. If the request or decoding fails, the provider is marked as `offline`

### Discovery

The discovery plugin sends an HTTP GET request to the inverter's root path (`/`) and looks for "SolarEdge" or "SetApp" in the response. If found, a supplemental request is sent to `/web/v1/status` to parse the current power from the protobuf response. The device is reported as a SolarEdge inverter with its current power output.

### Telemetry Polling

The daemon periodically calls `getSolarEnergyProviderNormalizedInfo`, which fetches the status endpoint and decodes the protobuf response. If the request fails or the response cannot be decoded, the provider is marked as `offline` and `currentPowerW` is `null`.

### Configuration

No additional environment variables are required. The plugin uses the inverter's IP address stored in the managed device record.

### Protocol Buffer Decoding

The plugin includes a minimal Protocol Buffer decoder that understands the SolarEdge status message structure:
- Field 3: `powerWatt` (float)
- Field 4: `voltage` (float)
- Field 5: `frequencyHz` (float)
- Field 15: nested `EnergyStatistics` message containing `today`, `thisMonth`, `thisYear`, `total` (float)

The decoder skips unknown fields and wire types, ensuring forward compatibility with future firmware updates.

## Practical Recommendation

For EMSD, the best first SolarEdge integration target is:

- read‑only
- SetApp‑based inverter (CPU number starting with `04`)
- `status` endpoint for production and grid data
- `maintenance` endpoint for optimizer health
- meter data if CTs are installed

Do not rely on local API availability for new installations; always have a fallback to the cloud API if possible.

## Sources

- SolarEdge SetApp information: `https://www.solaredge.com/us/products/installer‑tools/setapp`
- `solaredge‑local` Python library repository: `https://github.com/drobtravels/solaredge‑local`
- Home Assistant SolarEdge Local integration: `https://www.home‑assistant.io/integrations/solaredge_local/`
- Community discussion on firmware changes: `https://github.com/jbuehl/solaredge/issues/124`