# Web Backend CLI-Only Migration Plan

## Goal

Ensure `apps/web` reaches daemon-backed functionality only through the EMS CLI surface, with no direct database access and no imports from daemon or EMS internal modules.

## Current Problems

- `apps/web/server/ems-web-api.ts` imports `../../daemon/src/database` and opens the SQLite database directly.
- `apps/web/server/ems-web-api.ts` imports EMS internal modules such as `../../ems/src/managed-site-store`, `../../ems/src/discover`, and plugin code.
- `apps/web/lib/ems-bridge.ts` runs a custom web bridge script instead of `bun run ems -- ...`.
- The web bridge currently implements capabilities that do not exist as CLI commands yet, including snapshot, live status, history archive, forecast read/refresh, and price snapshot read/refresh.
- The web backend currently pokes the daemon process directly with `SIGUSR1`.

## Target State

- `apps/web` only talks to the EMS CLI.
- `apps/web` does not import from `apps/daemon/src/*`.
- `apps/web` does not import from `apps/ems/src/*` internals.
- All server-side web actions use stable CLI commands that return structured JSON.
- Database ownership remains with the daemon; the web app never opens the database file directly.

## Proposed Approach

Add the missing read and control capabilities to the EMS CLI first, then switch the web backend bridge to invoke those commands. After the web backend is fully moved over, remove the custom bridge code and add guardrails so this regression cannot return.

## Work Plan

### 1. Inventory and map every web bridge action

- List every action currently handled in `apps/web/server/ems-web-api.ts`.
- For each action, map it to one of:
  - existing CLI command that can already serve it
  - CLI command that needs JSON output support
  - new CLI command/subcommand that must be added
- Mark which actions currently depend on direct database reads or direct daemon signaling.

### 2. Define a CLI contract for web consumption

- Decide on a consistent machine-readable output format for CLI commands, likely JSON only for web-facing commands.
- Prefer extending existing command groups such as `site`, `battery`, `meter`, `weather`, and `price` before inventing new top-level groups.
- Add dedicated read-side commands for data the web needs but the CLI does not currently expose, for example:
  - dashboard snapshot or equivalent site/device/status listing
  - live status
  - history archive export
  - weather forecast get/refresh
  - dynamic price snapshot get/refresh
- Define exit code and stderr/stdout rules so the web bridge can reliably detect failures.

### 3. Move daemon-triggered refresh behavior behind the CLI

- Add CLI commands that request refresh work instead of letting `apps/web` send signals itself.
- Keep daemon interaction details inside EMS or another server-owned layer, not the web app.
- If refresh polling is still needed, perform it inside the CLI command or another non-web layer so the web app only waits for command completion.

### 4. Move direct database reads behind the CLI

- Replace every `openDaemonDatabase()` usage currently reachable from `apps/web` with CLI-backed commands.
- For history, forecast, price, telemetry, and status data, add or extend EMS read-side commands that own any DB access they require.
- Ensure the CLI returns the same or intentionally revised JSON shape the web pages need.

### 5. Refactor the web bridge to call the CLI only

- Replace `apps/web/lib/ems-bridge.ts` execution of `server/ems-web-api.ts` with direct `bun run ems -- ...` calls.
- Keep the bridge thin: build args, execute the CLI, parse JSON, surface errors.
- Remove type imports in `apps/web` that come from daemon internals.
- If shared response types are needed by both web and EMS, move them into `packages/core`.

### 6. Remove the custom web bridge implementation

- Delete `apps/web/server/ems-web-api.ts` once all callers are migrated.
- Remove any now-unused imports, helper functions, and code paths tied to the old bridge.
- Confirm there are no remaining `apps/web` imports from `apps/daemon/src/*` or `apps/ems/src/*` internals.

### 7. Add regression protection

- Add tests around new CLI JSON commands.
- Add focused web bridge tests for command execution and error handling.
- Add a repository check or test assertion that `apps/web` cannot import from daemon internals.
- Consider a simple grep-based test or lint rule that fails on forbidden import paths from `apps/web`.

## Suggested Delivery Order

1. Add missing CLI read APIs.
2. Add missing CLI refresh/control APIs.
3. Standardize JSON output and error handling.
4. Switch `apps/web/lib/ems-bridge.ts` to CLI execution.
5. Update web callers if response shapes changed.
6. Delete `apps/web/server/ems-web-api.ts`.
7. Add regression checks and run targeted validation.

## Validation Checklist

- Web dashboard data loads using CLI-backed responses only.
- Device discovery from the web still works through the CLI.
- Site, battery, meter, weather, and price mutations from the web still work.
- Forecast refresh and price refresh still complete successfully without direct daemon signaling from `apps/web`.
- History pages still render from CLI-provided data.
- No files under `apps/web` import from `apps/daemon/src/*`.
- No runtime code under `apps/web` imports from `apps/ems/src/*` internals.

## Risks To Watch

- CLI output intended for humans may conflict with structured web parsing unless JSON output is explicitly standardized.
- Some current web bridge actions combine multiple internal operations; those may need carefully designed CLI commands rather than a one-to-one port.
- If response types currently depend on daemon-only types, shared contracts may need to move into `packages/core`.
- Refresh commands that currently use direct polling against the database may need a clearer CLI-side completion model.

## Done When

- The web backend uses only `bun run ems -- ...` for daemon-backed operations.
- The web app has no direct database access.
- The custom web bridge script is removed.
- The repo contains tests or checks that prevent direct backend bypass from returning.
