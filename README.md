# EMSD

EMSD is a local energy management system for a single household.

The project is intentionally EMS-first:

- the daemon owns persistence, scheduling, polling, and long-running orchestration
- the EMS command app is the primary control surface
- the web app follows that EMS surface instead of inventing web-only capabilities

## Repository Layout

- `apps/daemon`: Bun + TypeScript daemon that owns `data/emsd.sqlite`
- `apps/ems`: Bun + TypeScript EMS command app for local management and bridge operations
- `apps/web`: Next.js app for status, setup, strategy controls, and the local API
- `packages/core`: shared paths, domain types, and client contracts
- `scripts`: daemon helper scripts and evaluation tooling

## Current Capabilities

- The daemon creates and owns the SQLite schema at `data/emsd.sqlite`.
- The daemon enforces a single running instance with `var/run/emsd.lock`.
- The EMS CLI can manage sites, batteries, meters, dynamic price sources, and solar forecast sources.
- The EMS CLI can scan the local network for supported devices with `discover`.
- The EMS CLI can read and replace the house battery strategy plan with `battery strategy-plan get` and `battery strategy-plan set`.
- The web app includes live status, battery history views, site and device management, discovery onboarding, provider settings, battery strategy scheduling, and temporary manual battery control.
- The web app also exposes a local HTTP API intended primarily for Home Assistant.

## Product Constraints

- Keep the one-household-per-install assumption unless requirements change.
- Do not add user-facing web capabilities before the EMS app exposes them.
- Keep database ownership in the daemon.
- Keep plugin execution server-side only.

## Requirements

- Bun
- A Node.js-compatible environment for Next.js and related tooling
- PM2 if you want to run the daemon under PM2

## Install

```bash
bun install
```

## Environment Setup

Create a real root env file from the checked-in example:

```bash
cp .env.example .env
```

Then update it as needed.

`.env`

- `PORT=3300`: default local web port
- `NEXTAUTH_SECRET`: required for web auth and signed discovery payloads
- `EMSD_ADMIN_PASSWORD`: required for the local admin login
- `AUTH_TRUST_HOST=true`: keep the default unless you have a deployment reason to change it
- `EMSD_LOCAL_API_TOKEN`: optional fixed bearer token for `/api/local/v1/current`
- `TIBBER_ACCESS_TOKEN`: required if you want Tibber price data
- `TIBBER_HOME_ID`: optional when your Tibber account has multiple homes
- `ENPHASE_ENLIGHTEN_USERNAME`: required for some Enphase local API setups
- `ENPHASE_ENLIGHTEN_PASSWORD`: required for some Enphase local API setups

The root `bun run dev` and `bun run prod` commands load this file and pass it to both child processes.

The older app-local env examples are still in `apps/daemon/.env.example` and `apps/web/.env.example` for reference, but the root `.env` is now the canonical setup.

## Quick Start

### Development

Start the daemon and web app together:

```bash
bun run dev
```

This starts:

- the daemon in watch mode
- the Next.js app in dev mode

Then open `http://localhost:3300`, sign in with `EMSD_ADMIN_PASSWORD`, create a site, run discovery, and add devices from the Settings screens.

### Production-Like Local Run

Build everything, then run the built daemon and built Next.js app together:

```bash
bun run prod
```

This runs the fastest non-watch setup and is useful for checking the production runtime locally.

### CLI-First

```bash
bun run ems -- site create home "Main House"
bun run ems -- battery list --site-id home
bun run ems -- discover
```

Useful follow-up commands:

```bash
bun run ems -- meter list --site-id home
bun run ems -- price list --site-id home
bun run ems -- weather list --site-id home
bun run ems -- battery strategy-plan get --site-id home
```

You can still run the daemon, EMS CLI, and web app separately if needed. The combined `dev` and `prod` flows are now the main entry points for local use.

## Troubleshooting

- Missing `NEXTAUTH_SECRET` or `EMSD_ADMIN_PASSWORD`: confirm `.env` exists at the repo root and restart `bun run dev` after editing it.
- Missing Tibber token: set `TIBBER_ACCESS_TOKEN` in `.env` before using Tibber-backed price features.
- `bun run prod` fails during the build step: fix the reported build error and rerun the command.
- Daemon does not start in the standalone flow: check `var/log/emsd.error.log`, then stop any previous instance with `bun run daemon:stop`.
- Database-dependent EMS commands fail on a fresh checkout: start the daemon once with `bun run dev`, `bun run prod`, or `bun run daemon:start` so it can create `data/emsd.sqlite`.

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

- `bun run solar-prediction:evaluate` evaluates the solar prediction algorithm used by the daemon and web UI against local history.
- `bun run dynamic-price-target:evaluate` evaluates the shared dynamic target estimator used by `targetMethod: auto` strategy items.

### Daemon

```bash
bun run daemon:dev
bun run daemon:start
bun run daemon:stop
bun run daemon:start:pm2
bun run daemon:restart:pm2
bun run daemon:stop:pm2
bun run daemon:logs:pm2
```

The direct start flow writes logs under `var/log/` and a PID file under `var/run/`.

### Combined Runtime

```bash
bun run dev
bun run prod
```

- `bun run dev` starts the daemon in watch mode and Next.js in dev mode.
- `bun run prod` builds everything and starts the built daemon plus the built Next.js app.

### EMS

```bash
bun run ems -- help
bun run ems -- site --help
bun run ems -- battery --help
bun run ems -- meter --help
bun run ems -- price --help
bun run ems -- weather --help
bun run ems -- discover --help
```

Shortcuts that still exist at the root:

```bash
bun run discover
```

### Web

```bash
bun run web:dev
bun run web:build
bun run web:start
```

These separate commands still exist for focused debugging and manual control.

## Single-Test Commands

```bash
bun test packages/core/src/index.test.ts
bun test apps/daemon/src/database.test.ts
bun test apps/ems/src/battery-list.test.ts
bun test --test-name-pattern "test name"
```

## Documentation

- `docs/README.md`: documentation index
- `docs/local-api.md`: local HTTP API and Home Assistant setup
- `docs/strategies/README.md`: built-in battery strategy docs
- `docs/scripts/dynamic-price-target.md`: shared `targetMethod: auto` estimator and evaluator
- `docs/plugins/README.md`: plugin authoring entrypoint
- `docs/plans/README.md`: active implementation plans

## Architecture Notes

- The daemon owns persistence and runtime orchestration.
- The EMS app is the primary management surface.
- The Next.js backend should go through the EMS bridge instead of opening SQLite directly.
- Shared reusable domain types belong in `packages/core`.
