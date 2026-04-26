# Solar Energy Provider Production Control Plan

## Goal

Add provider-reported solar production control state to the normalized solar energy provider layer so EMSD can show `enabled`, `disabled`, or `unavailable`, and add a Settings UI toggle button that is only interactive when the provider supports local or otherwise acceptable control.

This file is a plan only. No implementation is included.

## Current Codebase Baseline

- Normalized solar provider reads currently only return `currentPowerW` and connection `status` in `packages/core/src/index.ts` and the provider plugins under `apps/ems/src/plugins/solar-energy-provider/`.
- The daemon polls provider normalized info and persists only telemetry-like fields into `device_telemetry` via `apps/daemon/src/index.ts` and `apps/daemon/src/database.ts`.
- The Settings device cards in `apps/web/components/settings-panel.tsx` render from `getLiveStatus()` snapshot data, not from ad hoc provider API calls.
- There is no existing EMS API action or web action for solar production enable/disable.
- There is no existing managed-site-store setter for solar energy provider control state or capability metadata.

## Research Summary

### Enphase

- Local telemetry is already supported and uses the gateway over LAN.
- Enphase cloud API v4 is clearly split into Monitoring and Commissioning APIs, but the public docs we checked do not give us a ready-made, low-risk production enable/disable endpoint to use directly in EMSD.
- The Enlighten Manager UI exposes `Enable Power Production` / `Disable Power Production`, but web UI automation should not be the EMSD path.
- Community references strongly suggest a usable local control surface exists on some gateways through installer-oriented functionality:
  - a production switch is exposed by the `home_assistant_enphase_envoy_installer` integration
  - the same integration exposes DPEL enable/disable and limit controls
  - community examples point to local authenticated `POST https://<gateway>/ivp/ss/dpel`
- This makes Enphase the best first candidate for real provider-backed production control.
- Important caveats:
  - support appears hardware / firmware / metering dependent
  - local auth on newer firmware still depends on Enlighten bootstrap credentials
  - installer or elevated account access may be required for some control operations
  - we should not assume every Enphase gateway can expose or honor production control

### SolarEdge

- Current EMSD support is read-only and decodes `GET /web/v1/status`.
- The local API surface lists `web/v1/maintenance/standby` and multiple `web/v1/power_control/*` endpoints.
- The community `solaredge-local` reference we checked still describes the explored endpoints as GET-based and does not provide verified write semantics for standby or power control.
- Because of that, we do not currently have enough evidence for a safe EMSD implementation of write control.
- We also do not have a trustworthy explicit local field yet that means "production intentionally disabled by user" rather than night mode, idle, pairing, or another temporary operating mode.
- Recommendation: surface SolarEdge production control as `unavailable` until we capture an explicit provider-backed state field and a verified local write flow.

### Sonnen

- Sonnen is not currently an EMSD solar energy provider plugin.
- We do already have local sonnenBatterie reference material at `docs/reference/batteries/sonnenbatterie/openapi.json`.
- That API clearly exposes inverter and PV telemetry, for example `/api/v2/inverter` with `ppv`.
- The checked OpenAPI does not show an explicit solar production enable/disable endpoint.
- Recommendation: document sonnen as research-only for now, add solar-provider-specific reference notes, and treat production control as `unavailable` unless further vendor docs prove a local control endpoint.

## Recommended Product Behavior

Use a provider-owned control status instead of inferring from current watts.

Recommended normalized field:

```ts
productionControlStatus: "enabled" | "disabled" | "unavailable"
```

Recommended interpretation:

- `enabled`: the provider reports production control exists and production is enabled
- `disabled`: the provider reports production control exists and production is disabled
- `unavailable`: the provider does not expose a safe supported state, the current account lacks required privileges, the hardware/firmware does not support it, or EMSD has not implemented that provider's control path

Do not map these from `currentPowerW === 0` or from general device connectivity.

## Architecture Recommendation

Keep this daemon-first and provider-first.

1. Extend normalized solar provider info in `packages/core/src/index.ts`.
2. Let each provider plugin determine control support and current state.
3. Persist the latest provider-reported production control status through the daemon telemetry/snapshot path so the Settings screen can render from existing `getLiveStatus()` data.
4. Add a separate EMS action for toggling production on supported providers.
5. Keep the web app thin: show status, call server action, let EMS/provider logic decide support.

This matches the current repo architecture better than having the web app probe providers directly.

## Planned Code Changes

### 1. Shared Types

Files:

- `packages/core/src/index.ts`

Plan:

- Extend `NormalizedSolarEnergyProviderInfo` with `productionControlStatus`.
- Extend `ManagedDeviceTelemetryRecord` and `ManagedDeviceStatusRecord` with a solar-provider-safe place to carry that state into the live snapshot.
- Keep the field optional or null-safe for non-solar device kinds.

## 2. Daemon Persistence And Snapshot Flow

Files:

- `apps/daemon/src/index.ts`
- `apps/daemon/src/database.ts`
- `apps/daemon/src/database.test.ts`
- `apps/ems/src/api.ts`

Plan:

- Add a new `device_telemetry` column for provider production control status, or another equally small daemon-owned persistence path.
- Update daemon polling so solar provider normalized info stores both `currentPowerW` and `productionControlStatus`.
- Update snapshot building so the Settings screen receives the latest provider-reported control state without adding a separate web-only fetch path.
- Preserve current battery and meter behavior unchanged.

## 3. Solar Provider Plugin Contract

Files:

- `apps/ems/src/plugins/solar-energy-provider/index.ts`
- `apps/ems/src/plugins/solar-energy-provider/enphase.ts`
- `apps/ems/src/plugins/solar-energy-provider/solaredge.ts`
- `apps/ems/src/solar-energy-provider-plugin.test.ts`

Plan:

- Extend the plugin contract from read-only production telemetry to include production control state.
- Add a control method for supported providers, for example `setProductionEnabled(enabled: boolean)`.
- Keep unsupported providers explicit instead of trying to fake support.

### Enphase plugin plan

- Preferred path: local gateway API over HTTPS using the same auth bootstrap family already present in the plugin.
- Add a read path for control state from the local gateway.
- Add a write path that enables/disables production through the same local control surface.
- Treat control support as conditional at runtime:
  - if the gateway exposes the needed endpoint and accepts the authenticated request, return `enabled` or `disabled`
  - if the gateway lacks the endpoint, rejects access, or requires unsupported privileges, return `unavailable`
- Avoid automating Enlighten Manager HTML.
- Preserve the current local-first preference.

Specific Enphase research tasks to complete before coding:

- Verify the exact request and response shape for `ivp/ss/dpel` on your hardware and firmware.
- Verify whether the switch exposed by the Home Assistant installer integration is implemented through DPEL, another local endpoint, or both.
- Verify whether homeowner credentials are enough for local control on your system, or whether installer/developer privileges are required.
- Verify what the provider returns when production is disabled at night versus disabled by configuration, so we do not collapse those states.

### SolarEdge plugin plan

- Keep current telemetry support.
- Add a read-only investigation branch first:
  - inspect whether `status`, `maintenance/standby`, or `power_control` yields an explicit persisted disabled/enabled indicator
  - confirm that the field is not merely current operating mode
- Until a verified explicit state and write path exist, return `productionControlStatus: "unavailable"`.
- Do not infer `disabled` from `STANDBY`, `IDLE`, or `NIGHT_MODE`.
- Do not add a write implementation until we have device-backed proof of the endpoint behavior.

### Sonnen documentation-only plan

- Add a solar-provider reference note summarizing:
  - local PV telemetry exists
  - no explicit PV enable/disable endpoint has been confirmed from the checked local API material
  - expected EMSD result is `unavailable` unless later vendor docs prove otherwise

## 4. EMS API Surface

Files:

- `apps/ems/src/api.ts`
- `apps/web/lib/ems-bridge.ts`

Plan:

- Add an EMS action to toggle solar production for one provider.
- Keep the read API aligned with existing `solar-energy-provider-get-normalized-info` behavior.
- Recommended action shape:

```ts
{ action: "solar-energy-provider-set-production-enabled", id, siteId, enabled }
```

- On unsupported providers, return a clear actionable error instead of pretending success.
- On Enphase auth/privilege failures, return an explicit message that distinguishes:
  - missing Enlighten credentials
  - insufficient privileges
  - gateway does not expose the control surface
  - endpoint rejected by firmware / hardware variant

## 5. Web Settings UI

Files:

- `apps/web/components/settings-panel.tsx`
- `apps/web/app/actions.ts`

Plan:

- Add a solar provider control section to each solar energy provider card.
- Show the provider-reported state text: `Enabled`, `Disabled`, or `Unavailable`.
- Add a single button whose label changes between `Disable production` and `Enable production`.
- Disable the button when the status is `unavailable`.
- Use a server action that calls the EMS bridge action.
- Keep wording provider-agnostic in the UI, while keeping provider-specific error detail in notices.

Recommended UX details:

- If status is `unavailable`, show a short reason when available, for example `Not supported by this provider or current account`.
- If the daemon snapshot is stale, prefer showing the last known state with a disabled button during an in-flight action rather than inventing optimistic client-side state.

## 6. Managed Site Store

Files:

- `apps/ems/src/managed-site-store.ts`

Plan:

- No persistent provider configuration change is required just to store the current enabled/disabled status if that status is daemon-polled telemetry.
- Do not add a user-editable database flag that claims production is enabled or disabled independently of the provider.
- Only add managed-site-store changes if we later need provider-specific saved control parameters, such as an Enphase restore limit or remembered DPEL mode.

## Documentation Plan

Only after code work later, update reference docs. For now this plan identifies what should be written.

Files to update later:

- `docs/reference/solar-energy-provider/enphase.md`
- `docs/reference/solar-energy-provider/solaredge.md`
- `docs/reference/solar-energy-provider/sonnen.md` (new)
- `docs/plugins/solar-energy-provider/README.md`
- `docs/README.md`

### Enphase doc updates to include

- Distinguish clearly between:
  - local telemetry already used by EMSD
  - local production control candidates
  - cloud API v4 Monitoring / Commissioning separation
  - Enlighten Manager UI capabilities that we are not automating
- Add a section for production control research:
  - installer-production switch exists in practice
  - DPEL local endpoint is a likely implementation target
  - homeowner vs installer privilege differences must be validated on real hardware
  - regular account vs developer / partner account affects cloud capability, but local token bootstrap may still use owner credentials
- Add the article and developer portal links as sources.

### SolarEdge doc updates to include

- Clarify that EMSD currently relies on read-only local telemetry.
- Call out that standby / power-control endpoint names are visible, but write semantics remain unverified for EMSD use.
- Mark production control as not yet implementable with confidence.

### Sonnen doc updates to include

- Document local inverter and PV telemetry endpoints relevant to a future solar-provider plugin.
- Document the absence of a confirmed local PV enable/disable endpoint from the checked OpenAPI.
- Mark production control status as expected `unavailable` pending more vendor documentation.

## Validation Plan

### Unit tests

Files:

- `apps/ems/src/solar-energy-provider-plugin.test.ts`
- `apps/daemon/src/database.test.ts`

Plan:

- Extend plugin tests for normalized control status.
- Add Enphase tests for:
  - control state read returns `enabled`
  - control state read returns `disabled`
  - unsupported / forbidden / missing-endpoint returns `unavailable`
  - control write uses the expected endpoint and request shape
- Add SolarEdge tests that explicitly keep the provider at `unavailable` until a verified state source exists.
- Add daemon database migration tests for the new persisted status field.

### Real-device verification

#### Enphase

- Use your actual gateway first because this is the only currently realistic provider for full implementation.
- Validate on the exact gateway firmware before merging.
- Verify these cases:
  - normal telemetry only
  - read control state
  - disable production
  - re-enable production
  - daemon restart after disabled state
  - behavior during night hours
  - behavior with missing / wrong credentials

Important note:

- Do not inspect or print `.env` secrets into logs.
- Determine whether the configured account is sufficient by probing the provider capability path and reporting capability, not by exposing secret values.

#### SolarEdge

- Only perform real-device implementation once hardware is available.
- First verify whether the local API still exists on the target firmware.
- Then verify whether there is a stable explicit state field and a safe write endpoint.

#### Sonnen

- No local hardware is available right now.
- Restrict sonnen work to reference documentation unless hardware or better vendor docs become available.

## Recommended Delivery Order

1. Extend normalized types and daemon snapshot plumbing for provider control status.
2. Implement Enphase read path for control status.
3. Implement Enphase toggle action.
4. Add Settings UI button wired to the new action.
5. Keep SolarEdge at `unavailable` with explicit messaging.
6. Add reference doc updates, including new sonnen notes.

## Open Questions To Resolve During Implementation

1. What is the exact Enphase local endpoint and payload that maps best to a simple enable/disable toggle on your gateway?
2. Does your current Enphase account in `.env` have enough rights for local control, or only for telemetry auth bootstrap?
3. When Enphase production is disabled, what exact provider field proves that it is intentionally disabled rather than naturally idle?
4. Does SolarEdge expose an explicit persisted standby / active setting anywhere in the local protobuf payloads, or only transient mode values?
5. If Enphase disable is implemented through DPEL limit settings, do we need to preserve and restore the previous provider-side configuration when re-enabling?

## Decision Summary

- Enphase: proceed toward implementation later using a local-first control path, with runtime fallback to `unavailable` when the gateway/account does not support it.
- SolarEdge: keep `unavailable` for now until we have verified state and write semantics.
- Sonnen: documentation-only for now; no confirmed local production control endpoint found.
