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
- `battery get`
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

Current control priority:

- Expose `self-consumption` and `manual` first across the EMS command app and web UI
- Keep `auto` in the normalized model, but treat it as not yet user-selectable until daemon-side automation exists

### Current Battery Strategy Surface

- Persist the saved battery strategy schedule as a full ordered array on the battery record
- Treat the first schedule item as the fallback strategy that applies outside scheduled overrides
- Allow later schedule items to represent recurring daily manual or self-consumption actions with a user-friendly daily start time
- Persist manual schedule target semantics directly on each schedule item, including percentage, duration, or end time, instead of precomputing a target percentage during editing
- Persist an explicit trigger kind on schedule items so the current `daily-time` trigger can later expand to dynamic-price, weather, or expected-solar triggers without reshaping stored schedules
- Keep temporary battery `Now Mode` separate from the saved schedule array
- Persist temporary `Now Mode` state on the battery so the UI can reflect it consistently
- Let the daemon restore the fallback strategy automatically after a temporary `Now Mode` override completes

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

- `battery-plugins`
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
- `BatteryPlugin`
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

### Current Scaffold Status

- Bun service, EMS command app, and SQLite schema are in place
- The daemon-to-EMS contract exists through the shared database and bridge layer
- PM2 and direct daemon startup scripts are available
- Discovery is transient and site-scoped managed records exist for batteries, meters, weather sources, and dynamic price sources
- The EMS command app already covers managed site CRUD, discovery, and inventory flows
- The web app already sits on top of the EMS surface for live status, configuration, and control

### Next Phase

- Implement simulator and strategy engine
- Expand strategy support beyond the currently prioritized `self-consumption` and `manual` modes
- Add HomeWizard P1 meter integration
- Add weather forecast provider integration for solar-aware planning
- Add Nordpool and Tibber integrations
- Expand EMS coverage until it fully covers the intended product surface

### Later Phase

- Route Next.js backend operations through the EMS command app only
- Add real battery brand adapters, starting with Sonnen
- Improve resilience, logs, retries, and long-running stability

## Near-Term Implementation Plan

### Step 1: Normalize Battery Runtime And Control State

- Define a shared normalized battery shape for current state, current wattage, and selected strategy
- Require battery adapters to return normalized battery information regardless of vendor
- Normalize strategy state so `manual`, `self-consumption`, and reserved `auto` are represented consistently

### Step 2: Add Adapter-Based Battery Control

- Introduce a battery plugin base class that owns battery-specific reads and writes
- Implement the default Indevolt plugin with normalized status reads and control writes
- Support switching the current default plugin between `self-consumption` and `manual`
- Support manual control for `idle`, `charging`, and `discharging` with a capped power target up to `2400 W`

### Step 3: Expand EMS Battery Commands

- Add EMS commands to inspect normalized live battery information
- Add EMS commands to read and update normalized battery strategy settings
- Keep battery control explicit under battery-oriented commands rather than adding a generic equipment abstraction first

### Step 4: Expand Web Monitoring And Control

- Keep the live page focused on large battery-centric information
- Add a dedicated top-level control page for equipment actions, starting with batteries
- Use shadcn-style UI primitives for forms, cards, selects, and buttons where they fit the current web surface

### Step 5: Prepare For Daemon-Side Automation

- Keep `auto` disabled in the current user-facing control surface until strategy-engine behavior exists
- Preserve the daemon as the future owner of automatic strategy execution
- Treat current web and EMS manual/self-consumption controls as the normalized contract that future automation will write through
