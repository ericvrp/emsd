# Daemon Estimated Target Logging Plan

## Goal

Add a daemon-only informational estimate for scheduled strategy items across all current trigger kinds (`daily-time`, `low-price`, `high-price`) while keeping the configured strategy item target percentage fully unchanged for activation and completion behavior.

The daemon should log:
- the next important time horizon it is working toward
- the estimated remaining energy needed to get there
- the estimated target percentage
- concise reasoning

This must appear in normal daemon logs when a scheduled item becomes active, without requiring the verbose flag.

## Recommended Approach

1. Add a new daemon-local estimator module, for example `apps/daemon/src/strategy-estimate.ts`.
2. Keep the estimator fully read-only and side-effect free.
3. Call the estimator only from the scheduled activation path in `apps/daemon/src/index.ts`.
4. Extend the scheduled-start log formatter in `apps/daemon/src/strategy-log.ts` so the normal activation log includes the configured action plus the daemon estimate and reasoning.
5. Do not persist the estimate, do not expose it through EMS or web code, and do not feed it back into `resolveBatteryStrategyFromPlanItem`, runtime state, completion logic, or history.

## Data Sources

Use only existing daemon data paths:

- Current battery state from the existing poll sample in `apps/daemon/src/index.ts`
- Battery configuration from `BatteryRecord`
- Forecast data from `readWeatherForecast(db, battery.siteId)` in `apps/daemon/src/database.ts`
- Recent historical battery samples from `readBatteryPowerSamples(db, battery.siteId)` in `apps/daemon/src/database.ts`

Current retention is already 30 days via `SAMPLE_RETENTION_DAYS = 30` in `apps/daemon/src/database.ts`. The first implementation should use that existing window. If the estimate proves too weak, increasing retention can be a later follow-up.

## Estimation Model

Keep the first version heuristic and explainable rather than predictive.

Inputs:
- active scheduled item
- current time
- current SoC
- battery minimum discharge percent
- forecast remaining for today
- forecast total for tomorrow
- recent historical battery behavior from the retained 30-day sample window

Outputs:
- `targetTime`: the next important moment the daemon is optimizing toward
- `estimatedRemainingEnergyWh`: estimated energy still needed to cover the period until `targetTime`
- `estimatedTargetPercent`: informational target SoC implied by that energy need
- `reasoning`: compact human-readable explanation

Recommended logic shape:

1. Determine `targetTime` first.
   - `daily-time`: the item's own end condition if present, otherwise the next meaningful boundary after activation
   - `low-price` / `high-price`: the next important transition after the active price-triggered period, favoring the next later scheduled item or the next day boundary when no stronger boundary exists
2. Estimate energy demand until `targetTime`.
   - Use recent battery power history as the baseline consumption signal
   - Weight the full last 7 days most strongly
   - Also include up to 4 same-day-of-week comparisons from the 30-day window
3. Adjust for forecasted solar contribution.
   - Subtract remaining forecast production for the rest of today
   - Include tomorrow forecast when `targetTime` extends into tomorrow
4. Convert required remaining energy to an informational target percentage based on battery capacity and current SoC.
5. Clamp the estimate to a safe range: at least `minimumDischargePercent`, at most `100`.
6. Keep the configured target untouched and log both clearly when a configured target exists.

## Logging Behavior

Update the normal scheduled-start log line to include:
- the existing human-readable action summary
- the daemon's target time
- estimated remaining energy need
- estimated target percentage
- concise reasoning

Example shape:

`the high-price schedule is now active for battery-1: discharge manually to 80% at 2400W; daemon estimate 34% by 06:30 based on late-evening demand, recent Monday history, low remaining solar today, and weak solar tomorrow`

Important wording rules:
- always make it clear this is a `daemon estimate` or `informational estimate`
- never imply the configured target was changed
- if forecast or history is insufficient, log that the estimate is unavailable or partial and say why

## Critical Files

- `apps/daemon/src/index.ts`
- `apps/daemon/src/strategy-log.ts`
- `apps/daemon/src/strategy-log.test.ts`
- `apps/daemon/src/database.ts`
- `apps/daemon/src/strategy-estimate.ts` (new)
- `apps/daemon/src/strategy-estimate.test.ts` (new)

`packages/core/src/index.ts` should not need changes for this daemon-only logging feature.

## Implementation Notes

In `apps/daemon/src/index.ts`:
- compute the estimate immediately before logging a scheduled item start
- do this in both start-log paths:
  - immediate start when `!shouldWaitForObservedStart(item)`
  - delayed observed-start path when `shouldMarkScheduledItemObserved(...)` fires
- reuse the already available `sample` and `battery`
- read forecast and history on demand for the battery's site

In `apps/daemon/src/strategy-estimate.ts`:
- add helpers to aggregate forecast points into today-remaining and tomorrow totals
- add helpers to slice battery power history to the last 7 days and same-day-of-week comparisons
- keep the returned structure simple and daemon-local

In `apps/daemon/src/strategy-log.ts`:
- extend `formatScheduledStrategyStartedSummary(...)` to accept optional estimate context
- keep existing wording intact when estimate data is absent

## Verification

Focused tests:

1. `apps/daemon/src/strategy-estimate.test.ts`
   - computes a target time for each trigger kind
   - includes remaining energy needed and estimated target percent
   - uses last-week and same-day-of-week history weighting
   - reduces estimated need when solar forecast is strong
   - carries tomorrow forecast into the estimate when the target time crosses into tomorrow
   - clamps to `minimumDischargePercent...100`
   - returns a partial or unavailable estimate cleanly when forecast/history is missing

2. `apps/daemon/src/strategy-log.test.ts`
   - scheduled start summary includes daemon estimate, target time, and reasoning in the normal log line
   - wording still makes clear the configured action remains the one being applied
   - fallback formatting remains unchanged when no estimate is present

3. Regression safety
   - run `bun test apps/daemon/src/strategy-scheduler.test.ts`
   - keep scheduler activation/completion behavior unchanged

4. Narrow execution checks
   - `bun test apps/daemon/src/strategy-estimate.test.ts`
   - `bun test apps/daemon/src/strategy-log.test.ts`
   - `bun test apps/daemon/src/strategy-scheduler.test.ts`

5. End-to-end manual verification
   - run `bun run daemon:dev`
   - activate or wait for a scheduled item
   - confirm the normal daemon log now includes target time, estimated remaining energy, estimated target percent, and reasoning
   - confirm the battery still follows the user-configured strategy item target percentage rather than the estimate
