# HomeWizard Plug-In Battery Reference

Potentially relevant references for discovery and a future `homewizard-battery` plugin.

## Key integration notes

- The HomeWizard Plug-In Battery is discoverable on LAN via mDNS service `_homewizard._tcp`.
- HomeWizard API v2 uses HTTPS on port `443`.
- API access requires a bearer token created through `POST /api/user` after the user presses the device button.
- The battery control API is unusual: `GET/PUT /api/batteries` is exposed on the HomeWizard P1 Meter and kWh Meter, not directly on the Plug-In Battery itself.
- HomeWizard documents the Plug-In Battery as supported for `/api`, `/api/user`, and discovery, but marks it as not supported for the `/api/batteries` endpoint because that endpoint lives on the controller device.

## Discovery

- Docs: https://api-documentation.homewizard.com/docs/discovery
- Discovery protocol: mDNS / Zeroconf / Bonjour
- API v2 service: `_homewizard._tcp`
- Relevant TXT records:
  - `api_version`
  - `id`
  - `serial`
  - `product_name`
  - `product_type`
- HomeWizard notes Plug-In Battery support on `_homewizard._tcp`.

## Authentication

- Docs: https://api-documentation.homewizard.com/docs/v2/authorization
- Token flow:
  - send `POST /api/user`
  - device returns `403` until the user presses the hardware button
  - retry within the 30 second window after button press
  - store returned bearer token
- Header requirements:
  - `Authorization: Bearer <TOKEN>`
  - `X-Api-Version: 2`
- HTTPS certificate notes:
  - HomeWizard provides a CA certificate for validation
  - Plug-In Battery certificate hostname product type is documented as `battery`

## Device info

- Docs: https://api-documentation.homewizard.com/docs/v2/device_information
- Endpoint: `GET /api`
- Reported fields:
  - `product_name`
  - `product_type`
  - `serial`
  - `firmware_version`
  - `api_version`

## Battery control

- Docs: https://api-documentation.homewizard.com/docs/v2/batteries
- Endpoint: `GET /api/batteries`, `PUT /api/batteries`
- Important architecture note: this endpoint is available on the P1 Meter and kWh Meter, which manage one or more connected Plug-In Batteries.
- Exposed fields:
  - `mode`
  - `permissions`
  - `battery_count`
  - `power_w`
  - `target_power_w`
  - `max_consumption_w`
  - `max_production_w`
- Documented modes:
  - `zero`
  - `to_full`
  - `standby`
- Documented permissions:
  - `charge_allowed`
  - `discharge_allowed`

## Product references

- Product page: https://www.homewizard.com/nl/plug-in-battery/
- API docs home: https://api-documentation.homewizard.com/
- FAQ on API availability from product page: HomeWizard explicitly states that the Plug-In Battery has a local API and links to the battery API documentation above.

## Discovery implications for EMSD

- We likely need to discover HomeWizard devices by `_homewizard._tcp` rather than by probing battery-specific HTTP endpoints.
- We should expect either:
  - direct discovery of a Plug-In Battery device, or
  - discovery of the P1 Meter / kWh Meter that acts as the battery controller.
- Before implementing the plugin, confirm which discovered `product_type` values actually expose usable battery telemetry and control in a real installation.
