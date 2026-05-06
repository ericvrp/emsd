# Huawei SUN2000 Modbus Control Reference

## Purpose

This note captures what we can reliably extract from the local Huawei source bundle and copied Huawei Modbus manual so EMSD can plan a Huawei solar energy provider plugin.

The useful part of the source bundle is the demonstrated local write path that changes Huawei inverter production over Modbus-TCP. It is not a complete EMS integration guide.

## Primary Sources

- Copied Huawei manual: `huawei-source/modbus_docs.pdf`
- Copied source files: `huawei-source/main.py`, `huawei-source/homewizard_p1.py`, `huawei-source/run.sh`, `huawei-source/requirements.txt`

Important notes about the source bundle:

- there is no `README.md`
- there is no declared license in the GitHub metadata
- the codebase is intentionally small and task-specific

## Source Bundle Inventory

Files copied into `huawei-source/`:

- `main.py`: the actual control loop
- `homewizard_p1.py`: reads HomeWizard P1 local meter data
- `run.sh`: updates the repo, loads `.env`, installs dependencies, runs `main.py`
- `requirements.txt`: `pymodbus` and `requests`
- `modbus_docs.pdf`: Huawei Modbus register manual

## Required Configuration In The Source Bundle

Useful configuration hints from the source bundle:

- `INVERTER_IP`: Huawei inverter IP
- `PORT`: Modbus-TCP port

Observations:

- the source bundle does not explain how Modbus is enabled on the inverter
- the source bundle does not document Huawei account, installer, or commissioning requirements
- the source bundle keeps the Modbus port configurable, but the Huawei manual says `6607` is the LAN/VPN Modbus-TCP port
- other source-bundle environment variables are for that script's own control flow or logging and are not part of the EMSD plan

## Control Approach Used By The Source Bundle

The source bundle does not use Huawei `startup` and `shutdown` commands.

Instead, it writes the active-power limit register:

- `40126`: `Fixed active power derated (W)`

The script writes two 16-bit registers as `[0, value]`.

Examples from `main.py`:

- enable production: write `40126` to `[0, 3000]`
- disable production: write `40126` to `[0, 0]`

This means the source bundle models on/off as a power-limit change, not as a separate inverter power-state command.

## Vendor Modbus Details Extracted From The Bundled PDF

The bundled PDF is specifically for `SUN2000LB` models, not all Huawei inverter families.

### Supported Models In That Manual

The manual lists these models with earliest firmware `V300R024C00`:

- `SUN2000_6K_LB0`
- `SUN2000_5K_LB0`
- `SUN2000_4.6K_LB0`
- `SUN2000_4K_LB0`
- `SUN2000_3.68K_LB0`
- `SUN2000_3K_LB0`
- `SUN5000_6K_LB0`
- `SUN5000_3K_LB0`

EMSD should not assume the same register behavior is already verified on all Huawei solar products.

### Modbus-TCP Transport

The manual states:

- Modbus-TCP port: `6607`
- logical device ID for the directly connected slave: `0`
- standard function codes used: `0x03`, `0x06`, `0x10`
- Huawei-specific exception `0x80`: `No permission`

This is important for EMSD because a Huawei discovery path can probe Modbus directly without relying on HTTP.

### Device Identification Support

The manual documents `0x2B / 0x0E` device identifier reads.

Reported objects include:

- manufacturer name: `HUAWEI`
- product code: `SUN2000`
- main revision version

It also documents a device-list query that can describe connected downstream devices.

This is the strongest discovery lead in the manual.

## High-Value Registers For EMSD

These are the most relevant registers from the copied manual and source bundle.

### Identity And Model

- `30000` quantity `15`: model string
- `30015` quantity `10`: serial number
- `30025` quantity `10`: part number
- `30070` quantity `1`: model ID
- `31025` quantity `15`: monitoring software version

### Production Telemetry

- `30073` quantity `2`: rated power `Pn`
- `30075` quantity `2`: maximum active power `Pmax`
- `32064` quantity `2`: input power
- `32080` quantity `2`: active power
- `32089` quantity `1`: device status enum
- `32106` quantity `2`: accumulated energy yield
- `32114` quantity `2`: daily energy yield

### Meter And Grid Flow

- `37100` quantity `1`: meter status
- `37113` quantity `2`: active power

The manual defines `37113` as:

- `> 0`: feeding power to the grid
- `< 0`: obtaining power from the grid

This matters because EMSD may be able to avoid a separate P1 dependency when a Huawei smart meter is present and exposed through the inverter.

### Production-Control And Power-Limit Registers

- `40125` quantity `1`: active power percentage derating `(0.1%)`
- `40126` quantity `2`: fixed active power derated `(W)`
- `40200` quantity `1`: startup command
- `40201` quantity `1`: shutdown command
- `42019` quantity `2`: schedule instruction valid duration
- `47415` quantity `1`: active power control mode
- `47416` quantity `2`: maximum feed grid power `(kW)`
- `47418` quantity `1`: maximum feed grid power `(%)`
- `45086` quantity `1`: fast power scheduling enable or disable

The active power control mode enum in the manual includes:

- `0`: unlimited
- `5`: zero power grid connection
- `6`: power-limited grid connection `(kW)`
- `7`: power-limited grid connection `(%)`

This suggests Huawei may support more than simple on or off limiting. The source bundle only demonstrates `40126` writes.

## What We Can Infer For EMSD

### Read-Only Telemetry Looks Feasible

A minimal Huawei solar provider should be able to read at least:

- model
- serial number
- firmware version
- current active power
- device status

all over Modbus-TCP.

### Discovery Should Probably Be Modbus-Native

The current EMSD discovery system is HTTP request/response based. Huawei is different:

- the vendor document gives a direct Modbus-TCP port
- the device-identification function is explicit
- the source bundle does not rely on HTTP at all

So Huawei discovery should likely probe port `6607` and use Modbus device-identification or register reads.

### Production Control Is More Likely A Limit Write Than A True Power Toggle

The source bundle shows a working local path by writing `40126`.

That implies EMSD should initially think in terms of:

- `disable`: write a `0 W` power limit
- `enable`: write a high non-zero power limit

The main implementation detail we want from the source bundle is the successful local write to `40126`.

## Gaps And Unknowns

The source bundle does not answer these questions:

- how Modbus-TCP is enabled on the Huawei inverter
- whether installer privileges are required
- whether Huawei exposes permission failures before or after a TCP connection is established
- whether `40126` works uniformly across other Huawei model families
- whether `40200` and `40201` are safer or more durable than `40126` for true stop or start behavior
- whether `47415` plus `47416` is the better EMSD abstraction for export-limiting scenarios
- whether current-limit writes remain in effect across inverter restart or power-cycle

The bundled manual also signals a real permission model because it defines Modbus exception `0x80` as `No permission`.

## Recommended EMSD Interpretation

Start with a narrow claim:

- provider family: `Huawei SUN2000 Modbus`
- validated source: the copied source bundle plus the copied `SUN2000LB` register manual
- initial EMSD scope: read telemetry and coarse production enable or disable

Do not initially promise:

- all Huawei inverter families
- full export-limiting feature coverage
- closed-loop panel matching
- zero-config discovery without Modbus-specific probing support

## Source Notes

Useful source-bundle observations:

- `pymodbus==3.12.1` is enough for the working prototype
- the source bundle uses `ModbusTcpClient.write_registers()` for `40126`
- the source bundle reads `32080` and `40126` as two-register values and then uses the low register word directly
- that low-word approach is probably acceptable for small residential power values, but EMSD should decode full 32-bit values properly in TypeScript
- `run.sh` assumes a local `.env`, a Python venv, and self-updating `git pull`, which are implementation details EMSD should not copy

## Bottom Line

The source bundle gives EMSD one concrete Huawei production-control lead:

- local Modbus-TCP writes to `40126`

The bundled Huawei manual adds the missing wider context:

- identity registers
- telemetry registers
- meter registers
- control-mode registers
- Modbus-TCP port `6607`
- device-identification support
- permission failure code `0x80`

That is enough to justify a Huawei-specific EMSD provider plan, but not enough to claim a finished drop-in provider without real-device validation.
