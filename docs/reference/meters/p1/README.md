# P1 Smart Meter Reference

This note summarizes how the Dutch DSMR `P1` smart meter interface works, what the practical API is, and which external references are most useful.

Related local notes:

- [Indevolt reference notes](../indevolt/README.md)

## What P1 Is

`P1` is the local customer-facing interface on DSMR smart meters. In practice it is a local, read-only, push-style interface exposed over a serial port on the meter.

Important distinction:

- `P1` is not a web API.
- `P1` is not a request/response protocol in the normal REST or RPC sense.
- The practical API is a stream of text telegrams, usually read from a serial device or from a serial-to-TCP bridge.

## How The Protocol Works

At a high level, the meter emits a full telegram containing current readings and counters.

Typical flow:

1. A local reader connects to the meter's `P1` port.
2. On DSMR 4+ meters, the reader typically asserts the request line (`RTS`) high to ask the meter to start sending telegrams.
3. The meter sends ASCII telegrams at a fixed interval.
4. Each telegram starts with `/`, contains one OBIS-coded reading per line, and ends with `!` plus, on newer versions, a CRC checksum.
5. The client parses the telegram and maps OBIS codes to domain values such as import/export energy, instantaneous power, voltage, current, and gas readings.

The payload format is derived from IEC 62056 / COSEM conventions and uses OBIS identifiers to label each reading.

## Practical Wire-Level API

For EMSD purposes, the useful API surface is:

- serial bytes from the `P1` port;
- framed telegrams in plain text;
- OBIS-coded values inside each telegram.

There is usually no command set beyond enabling or listening to the stream. Most integrations are therefore built as:

- `serial -> telegram parser -> domain model`, or
- `serial -> TCP bridge -> telegram parser -> domain model`.

## Telegram Shape

A typical telegram looks like this:

```text
/ISk5\2MT382-1000
0-0:96.1.1(4B384547303034303436333935353037)
1-0:1.8.1(12345.678*kWh)
1-0:1.8.2(12345.678*kWh)
1-0:2.8.1(00000.000*kWh)
1-0:2.8.2(00000.000*kWh)
0-0:96.14.0(0002)
1-0:1.7.0(001.19*kW)
1-0:2.7.0(000.00*kW)
0-1:24.2.1(240404120000S)(00123.456*m3)
!ABCD
```

Key properties:

- first line is the meter/header identifier and begins with `/`;
- each following line is an OBIS object with one or more values;
- `!` marks end-of-telegram;
- DSMR 4+ typically appends a 4-hex-character CRC after `!`;
- line endings are typically `\r\n`.

## Common OBIS Codes

Common values you are likely to need:

- `1-0:1.8.1` imported energy, tariff 1
- `1-0:1.8.2` imported energy, tariff 2
- `1-0:2.8.1` exported energy, tariff 1
- `1-0:2.8.2` exported energy, tariff 2
- `1-0:1.7.0` instantaneous import power
- `1-0:2.7.0` instantaneous export power
- `0-0:96.14.0` active tariff
- `0-0:1.0.0` electricity meter timestamp on DSMR 4+
- `0-1:24.2.1` gas meter timestamp and latest reading on DSMR 4+
- `0-0:96.1.1` equipment identifier on DSMR 3+

The exact set varies by DSMR version and by the meter.

## Version Differences That Matter

The biggest compatibility issues are serial settings, checksum presence, update frequency, and connector details.

Common versions:

- DSMR 2.x and 3.0: usually `9600 7E1`, older connector variants, no CRC
- DSMR 4.x: usually `115200 8N1`, CRC included, 10 second telegram interval
- DSMR 5.x: usually `115200 8N1`, CRC included, 1 second telegram interval

Useful implementation details collected from `dsmr-info`:

- DSMR 2.1 to 3.0 typically use `RJ11` / `6P4C`
- DSMR 4.2.2+ and 5.x typically use `RJ12` / `6P6C`
- DSMR 4.x power supply is typically `5V` up to `100 mA`
- DSMR 5.x power supply is typically `5V` up to `250 mA`

## Hardware-Level Interface

For DSMR 4+ P1 ports, the common 6-pin layout is:

1. `Vcc` (`+5V` supply)
2. `RTS` / request line
3. `GND`
4. not connected
5. `TXD` from meter
6. power ground

Important electrical notes:

- the data line is commonly described as open-collector and logically inverted;
- many readers therefore use a purpose-built `P1 -> USB` cable or a small interface circuit;
- older meters may not expose the same power behavior as DSMR 4+ meters.

In practice, using a known-good `P1 USB` cable is much easier than building an interface from scratch.

## What The "API" Means In Software

There are three practical software APIs you will see in the ecosystem:

1. Raw serial API
   Read bytes from `/dev/ttyUSB*` and frame complete telegrams.
2. TCP socket API
   Use a bridge such as `ser2net` and consume the same telegram stream over TCP.
3. Parsed object API
   Use a parser library that converts OBIS lines into typed fields.

Examples from existing parser libraries:

- Python `dsmr_parser`: serial reader, socket reader, asyncio TCP reader
- C `dsmr-p1-parser`: raw serial reading plus telegram parsing

For EMSD, the safest abstraction is:

- transport: serial or TCP bridge
- framing: detect one full telegram
- validation: verify CRC when present
- parsing: map OBIS codes to typed measurements

## Implementation Notes For EMSD

If we add P1 support, the daemon should treat the meter as a local push source.

Recommended assumptions:

- prefer serial-first ingestion from a dedicated `P1` reader device;
- support DSMR `4.x` and `5.x` first;
- make serial settings configurable per meter version;
- validate full telegram framing and checksum before persisting data;
- store both raw telegrams and parsed measurements if we want easier debugging.

## Good External References

Official and near-official references:

- Netbeheer Nederland DSMR dossier: <https://www.netbeheernederland.nl/dossiers/slimme-meter-15>
- Netbeheer Nederland P1 Companion Standard 5.0.2 PDF: <https://www.netbeheernederland.nl/sites/default/files/2024-02/dsmr_5.0.2_p1_companion_standard.pdf>
- `energietransitie/dsmr-info`: <https://github.com/energietransitie/dsmr-info>

Implementation-oriented references:

- `ndokter/dsmr_parser`: <https://github.com/ndokter/dsmr_parser>
- `lvzon/dsmr-p1-parser`: <https://github.com/lvzon/dsmr-p1-parser>
- Home Assistant DSMR integration overview: <https://www.home-assistant.io/integrations/dsmr/>

Related local references:

- [Indevolt reference notes](../indevolt/README.md)

## Non-Goals And Caveats

- `P1` is a local meter data interface, not a full device management API.
- Meter capabilities vary by DSMR version and by vendor.
- Gas and other slave meter readings can appear less frequently than electricity updates.
- DSMR `6.0.0` introduces `X1`, which is a different Ethernet/JSON/TLS interface and should not be confused with classic serial `P1`.
