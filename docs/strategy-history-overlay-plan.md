# Strategy History Overlay Plan

## Purpose

Add strategy history visualization in a way that fits the current battery page best.

The preferred first version is not a separate strategy-only bar graph. It is a strategy history overlay on the existing battery chart, using colored background areas behind the battery power and charge series to show which strategy state was active at each time.

This document is a corrected implementation plan only. It does not include code changes.

## Scope

- Show strategy history for one battery at a time.
- Reuse the existing battery history section and day selector.
- Add colored background state bands for the four supported strategy states.
- Keep the battery power and charge lines as the primary data series.
- Show the exact user-facing strategy label on hover.
- Keep wording aligned with the current strategy dialog.

## Existing Constraints

- The daemon owns persistence and historical sampling.
- The web app must consume server-owned data and should not invent its own business rules.
- New web behavior should be backed by an EMS or shared backend contract, not by direct database access from the web app.
- The existing history pages use 15-minute buckets and `TopLevelDaySelect`.

## Review Summary

The original standalone bar-graph direction was useful, but it had four issues that should change the plan.

### 1. Fifteen-minute power samples are too coarse for strategy history

If strategy state changes at 10:03 and again at 10:11, a single 10:00-10:15 power bucket cannot represent both transitions correctly. The graph requirement says the system must track and update whenever strategy state changes. That needs a strategy history source that records state transitions when they happen, not only when battery power is sampled.

### 2. Storing only `active_item_id`, `strategy_mode`, and `manual_state` is not enough for stable hover labels

Hover needs the exact strategy name that the user expects to see. Looking that up later from the current strategy plan is fragile because the plan may have been edited after the historical event was recorded. Historical records should preserve the display label, or preserve enough immutable fields to rebuild it exactly.

### 3. The plan should explicitly preserve the EMS-first contract

The web graph should consume a backend history contract exposed through the existing EMS or shared API path. The plan should not frame this as a web-only archive change without also updating the server-side contract that owns the history payload.

### 4. The battery page is the right home for this feature

`apps/web/components/home-battery-history-section.tsx` already has the battery power and charge chart, the day selector, the refresh flow, and the right page context. Showing strategy as colored background bands behind those existing lines is better than introducing a separate chart that duplicates the same time axis and navigation.

## Recommended Design

Add strategy-state background overlays to the existing battery history chart.

What the user sees:

- the current battery power line
- the current battery charge line
- soft full-height background bands showing which strategy state was active at a given time
- a legend for the four states
- hover text that combines the battery point data with the active strategy label for that time window

Why this first:

- it reuses the battery page where the data already belongs
- it avoids splitting battery context across two different charts
- it makes it easy to compare commanded state with measured battery behavior
- it keeps the visual hierarchy right: battery metrics remain primary, strategy context remains secondary

### 1. Add dedicated strategy history records

Use a separate history table instead of overloading `battery_power_samples`.

Recommended table: `battery_strategy_history`

Suggested columns:

- `site_id` TEXT NOT NULL
- `battery_id` TEXT NOT NULL
- `started_at` TEXT NOT NULL
- `ended_at` TEXT NULL
- `observed_at` TEXT NOT NULL
- `source` TEXT NOT NULL
- `strategy_mode` TEXT NOT NULL
- `manual_state` TEXT NULL
- `active_item_id` TEXT NULL
- `trigger_kind` TEXT NULL
- `display_label` TEXT NOT NULL
- `display_state` TEXT NOT NULL

Notes:

- `started_at` and `ended_at` allow exact time ranges instead of coarse buckets.
- `display_label` preserves the historical hover text even if the current plan is edited.
- `display_state` is the chart coloring key, such as `self-consumption`, `charging`, `discharging`, or `idle`.
- `source` can distinguish `manual`, `schedule`, and `fallback`.

### 2. Record transitions in the daemon when state changes

The daemon already owns strategy execution and runtime transitions. That is the right place to write history records.

When any of these happen, close the previous history row and insert a new one:

- manual mode starts
- manual mode ends
- scheduled item starts
- scheduled item completes
- fallback strategy is restored
- self-consumption becomes active
- idle, charge, or discharge state changes

This should happen in the same server-side flow that updates `strategy_runtime_json` and battery strategy state, so the history cannot drift from the actual executed state.

### 3. Preserve user-facing terminology at write time

Do not rebuild hover labels from the current plan.

At the moment a transition is recorded, derive and store the display label using the same wording as the current strategy UI. Today that includes:

- `Self-consumption`
- `Charge`
- `Discharge`
- `Idle`
- `Scheduled`

If the scheduled strategy UI exposes richer names in the current product, store those exact names in `display_label` when the event is written.

### 4. Expose strategy history through the shared history contract

Extend the server-owned history payload to include strategy history records for the selected site and battery.

Recommended additions in shared types:

- `BatteryStrategyHistoryRecord`
- `HistoryArchive.batteryStrategyHistory`

The web app should read this through the same history fetch flow already used for graph pages.

### 5. Build chart-ready day segments in the web layer

The web layer should transform the transition records for the selected day into contiguous visual segments.

Rules:

- Split records at day boundaries.
- Clamp open-ended records to the selected day range.
- Fill gaps only when there is a clearly defined fallback rule from persisted history. Do not invent missing states.
- Convert each visible segment into a chart overlay datum with `start`, `end`, `displayLabel`, and `displayState`.

This is similar to existing chart shaping work, but the source is event history rather than fixed interval samples.

## UI Plan

### Battery Page First

Target component:

- `apps/web/components/home-battery-history-section.tsx`

Target chart:

- `BatteryHistoryChart` in `apps/web/components/history/charts.tsx`

Recommended presentation:

- render strategy state as translucent background ranges spanning the full chart height
- keep battery power and charge lines above the overlay
- keep the current day selector and refresh behavior unchanged
- add a compact strategy legend near the existing chart legend

This should feel like one chart with layered meaning, not two stacked charts.

### Page Behavior

- Reuse `TopLevelDaySelect` and `useTopLevelDaySelection`.
- Match the existing battery section framing and interaction patterns.
- Refresh using the existing graph refresh approach so current-day changes appear without a full reload.

### Overlay Behavior

- Use the existing battery chart in the Recharts stack.
- Each visible segment should render as a colored time range background overlay.
- Hover should show:
  - formatted time range
  - exact stored `display_label`
  - battery power and charge values already shown for that point
  - optional secondary detail like `Manual`, `Scheduled`, or trigger type when available

### Legend And Filter Pills

Include pills for the states actually present in the selected day.

Recommended states:

- `Self-consumption`
- `Charge`
- `Discharge`
- `Idle`

If scheduled modes expose richer labels in the current UI, keep the filter model state-based and use hover for the item-specific name. That keeps the legend compact and consistent.

Initial filtering can be optional. The important first step is that the overlay is visible and readable on the battery chart.

## Color Mapping

Use a fixed semantic palette, not a per-item rotating palette.

Recommended mapping:

- `Charge`: `UI_COLORS.batteryPowerCharging`
- `Discharge`: `UI_COLORS.batteryPowerDischarging`
- `Idle`: muted slate gray
- `Self-consumption`: dedicated violet accent

Why fixed semantic colors:

- The requirement explicitly calls out distinct colors for charging, discharging, and idle.
- A rotating per-item palette makes the same operational state look different across days.
- Fixed colors make day-to-day comparison easier.

If the UI needs to distinguish different scheduled items with the same operational state, do that in hover text first, not by changing the state color model.

## Terminology Rules

Match the current strategy dialog text exactly.

Current known labels from the UI:

- `Self-consumption`
- `Charge`
- `Discharge`
- `Idle`
- `Scheduled`

The graph plan should use `Self-consumption`, not `Self-Conservation`.

## Suggested Implementation Phases

### Phase 1: Shared model and persistence

- Add `BatteryStrategyHistoryRecord` to `packages/core`.
- Add daemon database schema for `battery_strategy_history`.
- Add read and write helpers in `apps/daemon/src/database.ts`.

### Phase 2: Daemon transition logging

- Write a new history row whenever executed strategy state changes.
- Close the prior row when a new state begins.
- Reuse existing strategy execution paths so history reflects actual runtime behavior.

### Phase 3: History contract

- Extend the history archive payload to include strategy history.
- Ensure EMS or shared server APIs return it for the web app.

### Phase 4: Web data shaping

- Convert transition history into selected-day chart segments.
- Map segments to translucent overlay regions.
- Add tooltip label formatting from stored `display_label`.

### Phase 5: Battery chart overlay UI

- Add strategy overlay rendering to the existing battery chart.
- Reuse day selector, refresh warnings, and section summary patterns already present on the battery page.
- Add a small semantic legend for the four states.
- Verify mobile and desktop layouts.

## Validation Checklist

- Transition history is written when strategy state changes, not just on a 15-minute sample boundary.
- Hover labels remain correct after the user edits the current strategy plan.
- Current-day graph refresh shows newly started or completed strategy states.
- Day navigation shows correct clipped ranges at midnight boundaries.
- Labels match the strategy dialog exactly.
- The web app consumes strategy history through the server-owned history contract.

## Out Of Scope

- Editing strategies from the graph
- Multi-battery combined graphs
- Client-side execution of strategy logic
- Reconstructing missing historical labels from edited plans

## Recommendation Summary

The feature should be implemented as transition-based strategy history owned by the daemon, not as extra fields on 15-minute battery power samples.

The first UI should be a strategy-state background overlay on the existing battery history chart, because that places the strategy context directly behind the battery power and charge lines the user is already reading.
