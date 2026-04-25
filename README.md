# EMSD

EMSD is a local energy management system for a single household. The long-term plan is a Bun + TypeScript daemon with an EMS-first command surface, SQLite persistence, and a lower-priority Next.js web UI.

This repository currently contains an initial runnable scaffold:

- `apps/daemon`: daemon that owns and initializes the SQLite database
- `apps/ems`: EMS command app that currently exposes `battery list`
- `apps/web`: Next.js app with an under-construction page
- `packages/core`: shared paths and battery types

## Current Status

- The daemon creates and owns `data/emsd.sqlite`.
- On first start, the daemon creates the SQLite schema but does not seed mock battery data.
- The EMS command app reads battery state from the daemon-owned database.
- The web app is placeholder-only for now.
- The daemon enforces a single running instance by taking a runtime lock in `var/run/emsd.lock`.

## Documentation

- Battery strategy docs live in `docs/strategies/README.md`, with one page per built-in strategy type.
- The shared `targetMethod: auto` estimator and evaluator script are documented in `docs/scripts/dynamic-price-target.md`.

## Requirements

- Bun
- Node.js-compatible environment for Next.js and tooling
- PM2 if you want to run the daemon under PM2

## Install

```bash
bun install
```

## Onboarding (First Run)

For local development, create real env files from the checked-in examples before starting services.

```bash
cp apps/daemon/.env.example apps/daemon/.env
cp apps/web/.env.example apps/web/.env.local
```

Then edit those files:

- `apps/daemon/.env`
  - Set `TIBBER_ACCESS_TOKEN` if you want Tibber price data.
  - Optionally set `TIBBER_HOME_ID` when your Tibber account has multiple homes.
  - Set `ENPHASE_ENLIGHTEN_USERNAME` and `ENPHASE_ENLIGHTEN_PASSWORD` when your Enphase firmware requires owner authentication.
- `apps/web/.env.local`
  - Set a strong `NEXTAUTH_SECRET`.
  - Set a strong `EMSD_ADMIN_PASSWORD` for local login.
  - Keep `AUTH_TRUST_HOST=true` unless you have a specific deployment reason to change it.
  - `PORT=3300` is the default local web port and can be changed if needed.

After env setup:

```bash
bun run daemon:start
bun run battery:list
bun run web:dev
```

Expected EMS output on a fresh install is:

```text
No batteries configured for the active site.
```

When you are done:

```bash
bun run daemon:stop
```

### Onboarding Troubleshooting

- Missing web auth env vars (`NEXTAUTH_SECRET` or `EMSD_ADMIN_PASSWORD`): make sure `apps/web/.env.local` exists and restart `bun run web:dev` after editing it.
- Missing Tibber token (`TIBBER_ACCESS_TOKEN`): set it in `apps/daemon/.env` if you are using Tibber price features.
- Daemon does not start: check `var/log/emsd.error.log` and ensure no previous instance is still running (`bun run daemon:stop`).
- `battery list` fails because DB is missing: start the daemon once with `bun run daemon:start` so it initializes `data/emsd.sqlite`.

## Common Commands

### Quality

```bash
bun run build
bun run typecheck
bun run lint
bun run format
bun run test
bun run solar-prediction:evaluate
bun run dynamic-price-target:evaluate
```

- `bun run solar-prediction:evaluate` evaluates the solar prediction algorithm used by the daemon and UI against local forecast and production history.
- `bun run dynamic-price-target:evaluate` evaluates the dynamic price target method used by the daemon for export-surplus and delayed-charging battery strategy items.

### Daemon

```bash
bun run daemon:dev
bun run daemon:start
bun run daemon:stop
bun run daemon:start:pm2
bun run daemon:stop:pm2
bun run daemon:logs:pm2
```

The direct start script writes logs to `var/log/` and stores a PID file in `var/run/`.
It also refuses to start if another daemon instance already owns the runtime lock.

### EMS

```bash
bun run ems -- battery list
```

Shortcut:

```bash
bun run battery:list
```

### Web

```bash
bun run web:dev
bun run web:build
bun run web:start
```

## Single-Test Commands

```bash
bun test packages/core/src/index.test.ts
bun test apps/daemon/src/database.test.ts
bun test apps/ems/src/battery-list.test.ts
bun test --test-name-pattern "test name"
```

## Example Flow

Start the daemon, inspect the current battery list, optionally scan for reachable devices, then stop the daemon:

```bash
bun run daemon:start
bun run battery:list
bun run discover
bun run daemon:stop
```

## Development Workflow

For the current scaffold, a simple local workflow is:

```bash
bun install
bun run daemon:start
bun run battery:list
bun run discover
bun run web:dev
```

- `bun install` installs workspace dependencies.
- `bun run daemon:start` starts the daemon in the background and initializes the SQLite database.
- `bun run battery:list` confirms the EMS command app can read the daemon-owned managed battery data.
- `bun run discover` shows the devices that are reachable right now without storing discovery history.
- `bun run web:dev` starts the placeholder Next.js app for UI iteration.

When you are done, stop the background daemon with:

```bash
bun run daemon:stop
```

## Architecture Notes

- The daemon is the owner of persistence and long-running orchestration.
- The EMS command app is the primary user-facing interface.
- The web app should not gain capabilities before the EMS command app exposes them.
- Shared reusable domain types belong in `packages/core`.

See `docs/README.md` for the documentation index, including plugin authoring guides.
