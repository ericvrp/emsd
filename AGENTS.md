# AGENTS.md

## Repository State

- This repository now contains a minimal runnable scaffold for `EMSD`.
- Main folders:
  - `apps/daemon`: Bun + TypeScript daemon
  - `apps/ems`: Bun + TypeScript EMS command app
  - `apps/web`: Next.js app
  - `packages/core`: shared paths and domain types
  - `scripts`: root helper scripts for starting and stopping the daemon
- The daemon owns the SQLite database and initializes it at `data/emsd.sqlite`.
- The EMS command app currently reads battery state from that database.
- The web app now includes live status, managed device configuration, and battery strategy controls, but should remain lower priority than the daemon and EMS command app.

## Product Constraints

- Do not add user-facing capabilities to the web app before the EMS command app exposes them.
- Keep the one-household-per-install assumption unless requirements change.
- Treat the daemon as the owner of persistence, scheduling, polling, and long-running orchestration.

## Rule Files Checked

- Checked for `.cursorrules`.
- Checked for `.cursor/rules/`.
- Checked for `.github/copilot-instructions.md`.
- Result: none of those files exist right now.
- This file is the only repository-local agent instruction source at the moment.

## Verified Commands

### Install

- Install dependencies: `bun install`

### Root Quality Commands

- Build all parts: `bun run build`
- Typecheck all parts: `bun run typecheck`
- Lint the repo: `bun run lint`
- Format the repo: `bun run format`
- Run all tests: `bun run test`
- Score solar prediction quality over local history: `bun run solar:score`
- Score dynamic target reserve heuristics over local history: `bun run estimate:score`

### Daemon Commands

- Run daemon in watch mode: `bun run daemon:dev`
- Start daemon in background without PM2: `bun run daemon:start`
- Stop daemon started without PM2: `bun run daemon:stop`
- Start daemon with PM2: `bun run daemon:start:pm2`
- Stop daemon with PM2: `bun run daemon:stop:pm2`
- View PM2 daemon logs: `bun run daemon:logs:pm2`

### EMS Commands

- Run the EMS entrypoint: `bun run ems --`
- List batteries: `bun run battery:list`
- Equivalent direct command: `bun run ems -- battery list`
- Discover supported devices on the network: `bun run discover`

### Web Commands

- Run Next.js in development: `bun run web:dev`
- Build the web app: `bun run web:build`
- Start the web app in production mode: `bun run web:start`

## Single-Test Commands

- Run one core test file: `bun test packages/core/src/index.test.ts`
- Run one daemon test file: `bun test apps/daemon/src/database.test.ts`
- Run one EMS test file: `bun test apps/ems/src/battery-list.test.ts`
- Run one test by name: `bun test --test-name-pattern "test name"`
- While iterating, prefer the narrowest single test before `bun run test`.

## Build And Runtime Notes

- `bun run build` builds `packages/core`, `apps/daemon`, `apps/ems`, and the Next.js app.
- The Next.js build may adjust `apps/web/tsconfig.json` to satisfy Next.js requirements.
- The direct daemon start script writes logs under `var/log/` and a PID file under `var/run/`.
- The daemon itself also enforces a single running instance with a runtime lock at `var/run/emsd.lock`.
- The direct daemon start script checks both the PID file and the runtime lock before reporting success.
- The SQLite database and runtime folders are ignored by Git.

## Database Ownership

- The daemon is responsible for creating and seeding the SQLite database.
- Current default database path: `data/emsd.sqlite`.
- Do not move write ownership for the database into the web app.
- Prefer keeping schema creation and write-side persistence logic inside `apps/daemon`.
- The EMS command app owns direct database access for local commands and API actions.
- The Next.js backend must go through the EMS CLI API bridge and must not open SQLite or query the database directly.
- Solar forecast providers, dynamic price providers, and similar external plugins must run server-side only.
- Do not execute forecast or price plugin code in the browser or in client-side React code.
- The web app may request server-owned results, but plugin execution must stay in the daemon or another server-side EMS layer.

## Current Behavior

- The daemon creates the SQLite schema but does not seed mock battery data.
- `ems discover` reports devices that are reachable during the current scan without persisting a discovery history.
- The EMS command app currently supports managed battery and meter commands for the default site.
- The EMS command app now also supports `battery strategy-plan get` and `battery strategy-plan set --file <path>` for house-wide schedule testing.
- The EMS command app supports solar energy provider plugins (Enphase and SolarEdge) for reading solar production data.
- The web app currently exposes live battery status, managed device settings, battery strategy schedule editing, and a temporary battery `Now Mode` manual override.
- Battery strategy schedules are persisted as a full array on each battery record.
- The first strategy schedule item acts as the default fallback strategy.
- Daily manual strategy items persist their target method and timing details, including percentage, duration, or end time.
- Strategy schedule items now persist an explicit trigger kind so the current `daily-time` trigger can expand later to price, weather, or expected-solar triggers without reshaping the saved plan.
- A temporary battery `Now Mode` override is persisted separately from the saved strategy schedule and the daemon restores the fallback strategy after the override completes.

## Plugin Dependencies

- SolarEdge local plugin uses pure TypeScript Protocol Buffer decoding and requires no external dependencies.
- Enphase local plugin uses HTTP/HTTPS requests; environment variables may be required for cloud authentication when HTTPS fails.

## Package-Specific Scripts

### `packages/core`

- Build: `bun run --cwd packages/core build`
- Typecheck: `bun run --cwd packages/core typecheck`
- Test: `bun run --cwd packages/core test`

### `apps/daemon`

- Dev: `bun run --cwd apps/daemon dev`
- Start: `bun run --cwd apps/daemon start`
- Build: `bun run --cwd apps/daemon build`
- Typecheck: `bun run --cwd apps/daemon typecheck`
- Test: `bun run --cwd apps/daemon test`

### `apps/ems`

- EMS entrypoint: `bun run --cwd apps/ems ems --`
- Build: `bun run --cwd apps/ems build`
- Typecheck: `bun run --cwd apps/ems typecheck`
- Test: `bun run --cwd apps/ems test`

### `apps/web`

- Dev: `bun run --cwd apps/web dev`
- Build: `bun run --cwd apps/web build`
- Start: `bun run --cwd apps/web start`
- Typecheck: `bun run --cwd apps/web typecheck`
- Avoid routinely running `apps/web` build/typecheck during normal iteration unless the user explicitly asks for it or the change specifically requires it.
- Prefer minimal validation for the Next.js app because repeated build/typecheck runs can disturb the local `.next` state during active development.

## Formatting

- Use Biome via the checked-in root scripts.
- Keep diffs small and avoid unrelated reformatting.
- Use UTF-8 text, Unix newlines, and no trailing whitespace.
- Follow the existing quote, comma, and semicolon style in each file.

## Imports

- Keep imports grouped and consistently ordered.
- Prefer explicit imports over wildcard imports.
- Remove unused imports.
- Use `import type` when importing types only.
- Use package imports like `@emsd/core` when shared logic already exists there.

## Types

- Prefer precise types over `any`.
- Use `unknown` at external boundaries when validation is required.
- Keep domain models explicit: batteries, meters, tariffs, strategies, schedules, measurements, simulations.
- Prefer discriminated unions for domain state where they improve clarity.
- Keep shared domain types in `packages/core` when reused across multiple apps.

## Naming

- Use `PascalCase` for types, interfaces, classes, and React components.
- Use `camelCase` for variables, functions, methods, and object properties.
- Use `SCREAMING_SNAKE_CASE` for environment variables and true constants.
- Prefer descriptive names over abbreviations except standard terms like `EMS`, `PM2`, and `P1`.

## Architecture And Modules

- Keep business logic out of UI layers.
- Keep daemon orchestration, EMS command handling, storage, and web UI concerns separate.
- Prefer pure functions for calculations and formatting where practical.
- Make side effects explicit at module boundaries.
- Avoid premature abstraction; add helpers when duplication becomes meaningful.
- Shared path helpers and shared domain types belong in `packages/core`.

## Error Handling

- Fail with actionable messages.
- Include useful identifiers in errors, such as battery ID, config path, or database path.
- Do not swallow errors silently.
- For EMS command code, return non-zero exit codes on failure.
- For daemon code, log enough context to debug long-running issues.

## Testing Guidance

- Add tests for daemon persistence behavior, EMS command behavior, and shared domain helpers.
- Prefer small fast unit tests first.
- When fixing a bug, add or update a test that reproduces it.
- Run the narrowest relevant test before broader verification.
- For `apps/web`, prefer targeted validation and avoid repeated `next build` / web typecheck loops unless required by the user or necessary to verify a risky integration change.

## Web App Guidance

- The web app should consume capabilities that already exist in the EMS command app or a shared backend contract.
- The Next.js backend should call the EMS CLI API bridge for reads and writes instead of touching the database directly.
- Do not introduce web-only business rules.
- Keep web terminology aligned with the EMS command app and plan docs.
- Keep `apps/web` iteration lightweight during active development; avoid unnecessary build/typecheck runs that churn `.next` artifacts.
- Do not fetch solar forecasts or dynamic price info client-side.
- Treat forecast and pricing plugins as server-only integrations; the web UI should only display data fetched through server-side EMS or daemon-owned paths.
- For sign-changing history series like grid or battery power, prefer one continuous line with per-segment color changes over separate positive and negative series.
- When a sign-changing line crosses zero between samples, split the rendered segment at the zero crossing so each half keeps the correct color.
- For sign-changing power tooltips, show absolute wattage values and use the label to communicate direction, such as `Take from grid`, `Return to grid`, `Battery Charging Power`, or `Battery Discharging Power`.

## Documentation Guidance

- Update this file when scripts, tooling, or workflow expectations change.
- If Cursor or Copilot rule files are later added, follow those files directly and reflect them here.

## Agent Checklist

- Confirm whether root scripts or package scripts changed before running commands.
- Prefer checked-in scripts over guessed commands.
- Run the narrowest relevant validation available.
- Keep changes aligned with the EMS-first architecture.
- Do not invent unsupported product capabilities.
