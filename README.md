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

## Requirements

- Bun
- Node.js-compatible environment for Next.js and tooling
- PM2 if you want to run the daemon under PM2

## Install

```bash
bun install
```

## Common Commands

### Quality

```bash
bun run build
bun run typecheck
bun run lint
bun run format
bun run test
```

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

Expected EMS output on a fresh install is:

```text
No batteries configured for the active site.
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

See `plans/EMSD-plan.md` for the broader product direction and intended delivery phases.
