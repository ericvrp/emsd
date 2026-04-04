# EMSD Plan

## Goal

Build a personal energy management system for one household per installation. It runs as a long-lived local service, supports multiple batteries, integrates dynamic pricing, and exposes its full control surface through a CLI, with the web UI as a lower-priority layer on top.

## Main Components

### 1. Daemon

- Bun + TypeScript service
- Runs continuously and manages scheduling, polling, discovery, and persistence
- Managed by PM2 for end-user startup and restart behavior
- Owns SQLite access and core business logic
- Project name: `EMSD`
- Provides the primary system behavior consumed through the CLI

### 2. CLI Tool

- Used to query status, inspect prices, manage strategies, trigger discovery, and generate config
- Must support everything the Next.js app can do
- Acts as the main interface for users, scripting, and integration from the Next.js backend
- May live in the same codebase and possibly the same executable family as the daemon

Example command areas:

- `status`
- `battery list`
- `strategy get`
- `strategy set`
- `price sync`
- `discover`
- `config generate`
- `db query`

### 3. Web App

- Next.js frontend plus its own backend layer
- Lower priority than the daemon and CLI
- The Next.js backend should use only the CLI tool
- The web app should not gain capabilities that are unavailable in the CLI
- Focus on monitoring, configuration, simulation, and strategy review

## Core Requirements

- One running instance of `EMSD` per house
- Support multiple batteries in one household
- Support multiple battery brands through adapters
- Support meter integrations, starting with the HomeWizard P1 meter
- Include a simulator for testing strategies before applying them
- Integrate dynamic pricing sources such as Nordpool and Tibber
- Keep configuration explicit, but support discovery-driven setup
- Ensure every user-facing action is available through the CLI first

## Supported Strategies

The system should support these strategy modes:

- `disabled`: disable automation entirely and do nothing
- `self-consumption`: optimize for consuming locally generated energy within the household
- `time-based`: run charge and discharge behavior on configured schedules, similar to cron-based automation
- `dynamic-pricing`: optimize against changing import and export prices with a highly configurable rule set
- `manual`: explicitly set the battery to `idle`, `charging`, or `discharging`

### Manual Mode Details

- Manual charging and discharging should support a configurable wattage target
- Manual power control should support grid-aware limits
- The user should be able to choose whether charging is limited by available export, allowed to import from the grid, or capped by another configured rule
- The user should be able to choose whether discharging is limited to household consumption, allowed to export to the grid, or capped by another configured rule
- The current grid flow should be visible so users can understand whether power is being imported from or exported to the grid

## Meter Support

- Read grid import and export data
- Use meter data for observability, manual mode, strategy decisions, and simulation
- Start with support for the HomeWizard P1 meter
- Keep meter support configurable through the same config system as batteries and price providers

## Discovery And Configuration

The system should support both manual configuration and assisted setup.

### Manual Mode

- User provides house settings, credentials, battery metadata, and pricing configuration
- Suitable for unsupported discovery cases or advanced setups

### Discovery Mode

- A CLI command scans for supported batteries, meters, and devices on the local network or through known vendor APIs
- The result is turned into a config draft that the user can confirm and save
- Discovery should produce normalized records regardless of brand
- Discovery should include HomeWizard P1 meters when available

Example flow:

1. `ems discover`
2. Detect supported batteries, gateways, and P1 meters
3. Show proposed config
4. Save config to disk and register devices in SQLite
5. Restart or notify `EMSD`

## Suggested Architecture

### Backend Modules

- `battery-adapters`
- `meter-adapters`
- `price-providers`
- `strategy-engine`
- `simulator`
- `discovery`
- `config`
- `scheduler`
- `storage`
- `cli-interface`

### Common Domain Model

- `House`
- `Battery`
- `BatteryAdapter`
- `Meter`
- `MeterAdapter`
- `TariffProvider`
- `PricePoint`
- `Strategy`
- `Schedule`
- `Measurement`
- `SimulationRun`

## Technology Stack

- Backend: TypeScript + Bun
- Web: Next.js
- Database: SQLite
- Process manager: PM2

## Delivery Phases

### Phase 1

- Set up Bun service, CLI, and SQLite schema
- Define the daemon-to-CLI contract
- Add PM2 startup docs
- Add a mock battery adapter
- Add a mock meter adapter

### Phase 2

- Implement config loading and persistence
- Implement discovery framework
- Add CLI commands for status, config, meter inspection, and strategy control

### Phase 3

- Implement simulator and strategy engine
- Add strategy support for disabled, self-consumption, time-based, dynamic-pricing, and manual modes
- Add HomeWizard P1 meter integration
- Add Nordpool and Tibber integrations
- Expand CLI coverage until it fully covers the intended product surface

### Phase 4

- Add the Next.js app on top of the CLI once the CLI surface is stable
- Route Next.js backend operations through the CLI only
- Add real battery brand adapters, starting with Sonnen
- Improve resilience, logs, retries, and long-running stability
