# EMSD Plan

## Goal

Build a personal energy management system for one household per installation. It runs as a long-lived local service, supports multiple batteries, integrates dynamic pricing, and exposes its full control surface through the EMS command app, with the web UI as a lower-priority layer on top.

## Main Components

### 1. Daemon

- Bun + TypeScript service
- Runs continuously and manages scheduling, polling, persistence, and runtime connectivity checks
- Managed by PM2 for end-user startup and restart behavior
- Owns SQLite access and core business logic
- Project name: `EMSD`
- Provides the primary system behavior consumed through the EMS command app

### 2. EMS Tool

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
- Lower priority than the daemon and EMS command app
- The Next.js backend should use only the EMS command app
- The web app should not gain capabilities that are unavailable in the EMS command app
- Focus on monitoring, configuration, simulation, and strategy review

## Core Requirements

- One running instance of `EMSD` per house
- Support multiple batteries in one household
- Support multiple battery brands through adapters
- Support meter integrations, starting with the HomeWizard P1 meter
- Include a simulator for testing strategies before applying them
- Integrate dynamic pricing sources such as Nordpool and Tibber
- Keep configuration explicit, but support discovery-driven setup
- Ensure every user-facing action is available through the EMS command app first

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

### Core Model

- A `site` represents the one household installation that `EMSD` manages
- The daemon reasons about the configured entities that belong to the active site
- Discovery is transient and shows what is reachable now; it is not a long-term registry of everything ever seen
- Adding an item to the active site is an explicit user action
- Managed records should track whether they are enabled and whether they are currently connected

### Manual Mode

- User provides house settings, credentials, battery metadata, and pricing configuration
- Suitable for unsupported discovery cases or advanced setups

### Discovery Mode

- An EMS command scans for supported batteries, meters, and other supported inputs on the local network or through known vendor APIs
- Discovery output should only show what is reachable during that command run
- Discovery should produce normalized records regardless of brand
- Discovery should include HomeWizard P1 meters when available
- Discovery should default to concise human-readable output
- Discovery should support verbose JSON output for scripting and debugging
- Discovery results should expose a stable identifier that the user can use immediately to add the item to the active site

Example flow:

1. `ems discover`
2. Detect supported batteries, gateways, P1 meters, and other supported inputs that are currently reachable
3. Show concise one-line summaries by default, or full JSON with `--verbose`
4. Add a selected discovery result to the active site
5. Persist the managed record in SQLite
6. Restart or notify `EMSD` if required

### Managed Site Records

- The current scaffold should move away from persisting `discovered_devices` as a history table
- The source of truth should be the managed records attached to the active site
- Use separate managed tables for distinct domains instead of one large generic entity table
- The first managed tables should be:
  - `sites`
  - `batteries`
  - `meters`
  - `weather_sources`
- Each managed table should keep a small shared shape where it makes sense:
  - `id`
  - `site_id`
  - `name`
  - `enabled`
  - `connected` when runtime reachability applies
  - `created_at`
  - `updated_at`
- Type-specific fields should remain in the type-specific table
- Weather forecast inputs should be managed alongside batteries and meters at the site level, but stored separately because they are provider-backed inputs rather than LAN devices

### CLI Direction

- `ems discover`
  - Shows currently reachable supported devices and inputs
  - Does not create persistent records by itself
- `ems discover --verbose`
  - Emits complete JSON output for the current scan
- Prefer typed management commands over a generic catch-all command surface during the scaffold phase
- Initial managed command areas should evolve toward:
  - `battery list`
  - `battery add <discovery-id>`
  - `battery remove <battery-id>`
  - `battery enable <battery-id>`
  - `battery disable <battery-id>`
  - `meter list`
  - `meter add <discovery-id>`
  - `weather list`
  - `weather add <provider>`
- A broader cross-type inventory command can be added later if it becomes useful, but the first implementation should preserve explicit domain types

### Runtime Semantics

- `enabled` means the site configuration allows `EMSD` to use the managed record in planning and control logic
- `connected` means the daemon can currently reach or validate the managed record
- `discover` answers "what is available right now?"
- `list` commands answer "what belongs to this site?"
- Battery status remains a battery-specific runtime concern and should not define the general inventory model

## Suggested Architecture

### Backend Modules

- `battery-adapters`
- `meter-adapters`
- `weather-providers`
- `price-providers`
- `strategy-engine`
- `simulator`
- `discovery`
- `config`
- `scheduler`
- `storage`
- `ems-interface`

### Common Domain Model

- `Site`
- `Battery`
- `BatteryAdapter`
- `Meter`
- `MeterAdapter`
- `WeatherSource`
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

- Set up Bun service, EMS command app, and SQLite schema
- Define the daemon-to-EMS contract
- Add PM2 startup docs
- Add a mock battery adapter
- Add a mock meter adapter

### Phase 2

- Implement config loading and persistence
- Implement discovery framework
- Replace persistent discovery history with transient discovery output
- Add site-scoped persistence for managed batteries, meters, and weather sources
- Add EMS commands for status, config, meter inspection, managed inventory, and strategy control

### Phase 3

- Implement simulator and strategy engine
- Add strategy support for disabled, self-consumption, time-based, dynamic-pricing, and manual modes
- Add HomeWizard P1 meter integration
- Add weather forecast provider integration for solar-aware planning
- Add Nordpool and Tibber integrations
- Expand EMS coverage until it fully covers the intended product surface

### Phase 4

- Add the Next.js app on top of the EMS command app once the EMS surface is stable
- Route Next.js backend operations through the EMS command app only
- Add real battery brand adapters, starting with Sonnen
- Improve resilience, logs, retries, and long-running stability

## Near-Term Implementation Plan

### Step 1: Normalize Discovery Output

- Change `ems discover` to stop writing into SQLite as a persistent discovery history
- Return concise one-line summaries by default
- Keep `--verbose` as the machine-friendly JSON output mode
- Include a stable discovery identifier in both concise and verbose output

### Step 2: Introduce Site Persistence

- Add a `sites` table owned by the daemon database
- Create a default site for the current one-household-per-install assumption
- Prepare the schema so future multi-site support remains possible without changing the conceptual model

### Step 3: Split Managed Tables By Domain

- Refactor the current `batteries` table into a managed battery table with explicit configuration and runtime fields
- Add a `meters` table for managed meter records
- Add a `weather_sources` table for configured forecast providers
- Remove the current `discovered_devices` table from the intended architecture

### Step 4: Add Explicit Management Commands

- Replace the current discovery-backed `device` CRUD flow with typed add and list commands
- Start with battery and meter flows because they are the first supported discovered types
- Keep weather source management explicit and provider-oriented instead of forcing it through network discovery

### Step 5: Align Daemon Runtime State

- Make the daemon treat managed site records as the source of truth
- Have the daemon update `connected` and type-specific runtime state for managed records
- Keep discovery separate from runtime polling and scheduling

### Step 6: Update Tests And Documentation

- Update EMS command tests to cover discover, add, list, enable, disable, and remove flows
- Update daemon database tests to match the new schema
- Update README examples so the setup flow reflects discovery plus explicit add
