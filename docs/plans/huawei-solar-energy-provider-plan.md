# Huawei Solar Energy Provider Plan

## Goal

Add a Huawei solar energy provider to EMSD with a clear first supported scope:

- family name in product docs: `Huawei SUN2000 Modbus`
- initial capabilities: discovery, normalized production telemetry, and coarse production enable or disable
- non-goal for the first implementation: high-frequency demand-matching or export-limiting control loops

This plan is implementation planning only.

## Current EMSD Baseline

- Solar provider plugins already exist under `apps/ems/src/plugins/solar-energy-provider/`.
- The plugin contract already supports both `getNormalizedInfo()` and `setProductionEnabled(enabled)`.
- The daemon already persists provider production-control status and already queues provider control requests.
- The Settings UI already shows provider production-control state and already disables the control UI for unsupported providers.
- Discovery is still HTTP or HTTPS request based. The current `DiscoveryPlugin` model assumes a request `path`, a `port`, a text response match, and an optional supplemental HTTP request.
- `SolarEnergyProviderRecord` is still thin. It currently stores `id`, `siteId`, `name`, `plugin`, `ipAddress`, `enabled`, `connected`, `serialNumber`, and `updatedAt`.

## Local Research Summary

From `docs/reference/solar-energy-provider/huawei.md`:

- The local source bundle demonstrates a working local Modbus-TCP write path.
- The demonstrated write target is `40126` (`Fixed active power derated (W)`), not Huawei startup or shutdown commands.
- The bundled vendor manual documents Modbus-TCP on port `6607`, logical device ID `0`, identity reads via `0x2B / 0x0E`, and Huawei permission error `0x80`.
- The manual also exposes enough read registers for model, serial, firmware, active power, energy totals, device status, and smart-meter power.

## Product Recommendation

Do not call the first plugin simply `huawei-local`.

Recommended initial plugin identifier:

- `huawei-sun2000-modbus`

Reason:

- the bundled manual is model-family specific
- the proven write path is specific to SUN2000-style Modbus control
- this avoids over-claiming support for all Huawei solar products before verification

## Delivery Phases

### Phase 1

Discovery.

### Phase 2

Enable or disable in `Settings -> Devices` after adding the discovered provider.

### Phase 3

The new built-in strategy item that can drive provider production control.

### Out Of Scope

- high-frequency control loops
- broader export-limiting controls
- zero-export closed-loop behavior

## Planned Changes

## 1. Shared Provider Model And Persistence

Files:

- `packages/core/src/index.ts`
- `apps/ems/src/managed-site-store.ts`
- `apps/daemon/src/database.ts`
- related tests

Plan:

1. Add enough persisted connection data for Modbus providers.
2. Keep the first change minimal.

Recommended minimal additions:

- add `port: number | null` to `SolarEnergyProviderRecord`
- default Huawei providers to `6607`
- keep Modbus logical device ID at `0` initially unless real hardware proves we need it configurable

Optional follow-up only if needed after device testing:

- add `unitId` or `logicalDeviceId`
- add a provider `details` field or provider metadata storage for model and firmware snapshots

Reason:

- the current record cannot express a non-default network port
- Huawei support should not depend on hidden environment variables once the device is managed in EMSD

## 2. Discovery Architecture For Modbus

Files:

- `apps/ems/src/plugins/types.ts`
- `apps/ems/src/discover.ts`
- `apps/ems/src/discover.test.ts`
- `apps/ems/src/plugins/solar-energy-provider/index.ts`

Current blocker:

- discovery is HTTP text-response driven today
- Huawei should be probed over Modbus-TCP rather than HTTP

Plan:

1. Extend the discovery system so a plugin can perform a custom probe instead of only an HTTP request.
2. Keep existing HTTP plugins unchanged.
3. Let Huawei discovery provide its own probe implementation.

Recommended discovery behavior for Huawei:

1. Open a TCP connection to port `6607`.
2. Attempt Modbus device identification using `0x2B / 0x0E`.
3. Fallback to direct register reads when device identification is unavailable.
4. Read enough fields to populate a stable discovered device summary.

Recommended fields for discovery:

- manufacturer: `HUAWEI`
- product family: `SUN2000`
- model string from `30000`
- serial from `30015`
- firmware or monitoring software version from `31025`
- optional live power from `32080`

Recommended discovered-device output:

- category: `solar-energy-provider`
- model: `huawei-sun2000-modbus`
- name: `Huawei SUN2000`
- details: model, serial, firmware, optional live power, and `port 6607`

## 3. Modbus Client Implementation

Files:

- new helper under `apps/ems/src/plugins/shared/` or `apps/ems/src/plugins/solar-energy-provider/`
- `apps/ems/src/plugins/solar-energy-provider/huawei.ts`
- `apps/ems/src/solar-energy-provider-plugin.test.ts`

Plan:

Implement a small TypeScript Modbus-TCP client that covers only what EMSD needs.

Minimum protocol surface:

- read holding registers `0x03`
- write single register `0x06` if needed
- write multiple registers `0x10`
- read device identifiers `0x2B / 0x0E`

Requirements:

- decode signed and unsigned 16-bit and 32-bit values correctly
- surface Huawei exception `0x80` as an actionable permission error
- include port and register context in errors
- avoid Python and avoid shelling out to external tools

Implementation note:

- the local source bundle uses only the low 16-bit register when values fit in residential ranges
- EMSD should decode the full 32-bit values properly instead of copying that shortcut

## 4. Huawei Telemetry Plugin

Files:

- `apps/ems/src/plugins/solar-energy-provider/huawei.ts`
- `apps/ems/src/plugins/solar-energy-provider/index.ts`
- `packages/core/src/index.ts` if new shared normalized fields become necessary

Plan:

Add a Huawei plugin that reads normalized production telemetry.

Recommended initial telemetry mapping:

- `currentPowerW`: read from `32080`
- `status`: derive from successful polling plus optional device-status mapping from `32089`
- `productionControlStatus`: use the control registers when they can be read, otherwise `unavailable`

Useful identity reads:

- model: `30000`
- serial: `30015`
- monitoring software version: `31025`
- rated power `Pn`: `30073`
- maximum active power `Pmax`: `30075`

Optional future telemetry after the first version:

- lifetime energy from `32106`
- daily energy from `32114`
- meter status and active power from `37100` and `37113`

## 5. Huawei Production Control

Files:

- `apps/ems/src/plugins/solar-energy-provider/huawei.ts`
- `apps/ems/src/solar-energy-provider-plugin.test.ts`

Recommended first implementation:

- treat `disable` as writing `40126` to `0 W`
- treat `enable` as writing a high fixed non-zero power limit

Recommended first enable logic:

1. Use a hardcoded high wattage rather than trying to preserve and restore prior provider-side state.
2. Do not spend first-version effort on remembering previous Huawei limits.
3. Treat `3000 W` as only evidence that the register write works, not as the target EMSD default.

Recommended read-side status logic:

- if control registers are readable and the effective fixed limit is `0`, report `disabled`
- if control registers are readable and the effective fixed limit is non-zero, report `enabled`
- if permissions or hardware prevent reliable reads, report `unavailable`

Open implementation choice to resolve on hardware:

- whether `40126` alone is enough
- whether EMSD also needs `47415` active power control mode to make the limit deterministic
- whether Huawei `40200` and `40201` should be avoided entirely for now

## 6. Discovery Add And Settings UX

Files:

- `apps/web/components/discovery-panel.tsx`
- `apps/web/components/settings-panel.tsx`
- any server-action or bridge paths already used for solar providers

Plan:

1. Make discovery the primary add path for Huawei.
2. Let the discovered device be added through the existing managed-device flow.
3. Use the existing Settings production-control UI once the plugin is wired in.

Do not add advanced Huawei-only fields until real-device testing proves they are needed.

## 7. Testing Plan

### Unit tests

Files:

- `apps/ems/src/solar-energy-provider-plugin.test.ts`
- `apps/ems/src/discover.test.ts`
- `apps/daemon/src/database.test.ts` if record schema changes

Plan:

- decode 32-bit register values correctly
- map `32080` to normalized current power
- map Huawei permission failure `0x80` to actionable errors
- verify disable writes `40126` to `0 W`
- verify enable restores prior limit or `Pmax`
- verify discovery reads manufacturer and product identity
- verify unsupported or unreadable control surfaces return `productionControlStatus: "unavailable"`

### Real-device validation

Required before claiming support:

1. Read identity registers.
2. Read active power.
3. Read current control status.
4. Disable production.
5. Re-enable production.
6. Verify behavior after inverter restart if possible.
7. Verify permission failure behavior on a less-privileged account or configuration if possible.

## 8. Out Of Scope Work

Do not include these in the Huawei provider delivery plan:

- HomeWizard-specific integration inside the provider plugin
- export limiting by kW or percent as a user-facing EMSD setting
- optimizer file-upload parsing via Huawei `0x41` custom functions
- broad claims about non-SUN2000 Huawei families
- demand-matching control loops

## Recommended Delivery Order

1. Add provider record support for `port` and the Modbus discovery path.
2. Implement Huawei discovery first.
3. Implement Huawei production enable or disable in the device Settings flow after add.
4. Implement the built-in strategy item afterward.
5. Validate on real hardware and then document the exact tested models and firmware.

## Open Questions

1. Is Modbus-TCP already exposed on the target Huawei installation, or does installer-side enablement still need to be documented?
2. Is `40126` sufficient on real hardware, or must EMSD also set `47415` control mode before writes reliably take effect?
3. Should the first supported plugin name stay narrow as `huawei-sun2000-modbus`, or does your target hardware set justify a broader name later?
4. Can EMSD rely on Huawei meter register `37113` for net-grid flow, or is an external meter still required on the installations you care about?
