# Solar Energy Provider Production Control Plan

## Purpose

Keep the production-control planning notes in the `docs/plans/` area now that the first implementation already exists in EMSD.

The old root-level version of this file described work that is no longer purely planned.

## Current Status

The original Enphase-first production-control baseline is now implemented across the main app boundaries.

Implemented today:

- shared provider control status in `packages/core/src/index.ts`
- provider plugin contract with `setProductionEnabled()` in `apps/ems/src/plugins/solar-energy-provider/index.ts`
- Enphase local production-control support in `apps/ems/src/plugins/solar-energy-provider/enphase.ts`
- explicit `unavailable` status for unsupported providers such as SolarEdge
- daemon-owned queueing and processing of provider control requests in `apps/ems/src/api.ts` and `apps/daemon/src/index.ts`
- persisted provider control status in daemon telemetry
- Settings UI support in `apps/web/components/settings-panel.tsx`

## What This File Tracks Now

This file is no longer the main implementation plan for provider production control.

It now tracks the remaining planning split:

1. Huawei provider support and Modbus-native discovery
2. strategy-driven use of provider production control
3. smaller documentation cleanup items

## Remaining Follow-Ups

### Huawei provider support

Tracked in:

- `docs/plans/huawei-solar-energy-provider-plan.md`

### Built-in strategy integration

Tracked in:

- `docs/plans/solar-production-control-strategy-plan.md`

### Documentation cleanup still worth doing over time

- keep provider docs aligned with the actually shipped plugins
- document tested Huawei models and firmware once real-device validation exists
- keep API docs and UI docs reflecting `productionControlStatus: "enabled" | "disabled" | "unavailable"`

## Decision Summary

- Enphase remains the currently implemented provider-backed production-control path.
- SolarEdge remains explicitly unsupported for production control.
- Huawei should be added through a separate, narrower SUN2000 Modbus plan instead of broad Huawei assumptions.
- Automatic strategy-driven production control should be planned separately from provider transport and manual Settings support.
