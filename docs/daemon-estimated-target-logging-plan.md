# Daemon Estimated Target Logging Plan

## Goal

Add a daemon-owned dynamic target estimate for scheduled strategy items across all current trigger kinds (`daily-time`, `low-price`, `high-price`). This should support a new scheduled-item target method that lets the daemon compute and apply the target percentage at activation time, while fixed target methods continue to behave exactly as configured.

The daemon should log:
- the next important time horizon it is working toward
- the estimated remaining energy needed to get there
- the estimated target percentage
- concise reasoning

This must appear in normal daemon logs when a scheduled item becomes active, without requiring the verbose flag.

This dynamic target computation should only run for the new schedule target method, exposed in the UI as `Dynamic` and persisted as target method `auto`.

In support of that runtime estimate, add a benchmark script similar to `solar:score` so we can replay recent history, score candidate heuristics, and tune the discharge reserve percentage separately for evening and morning high-price windows.

## Recommended Approach

1. Add a new daemon-local estimator module, for example `apps/daemon/src/strategy-estimate.ts`.
2. Keep the estimator fully read-only and side-effect free.
3. Reuse the existing solar prediction pipeline instead of treating weather forecast values as direct energy.
4. Infer expected house usage from the existing site energy-balance signals instead of using battery power alone as a demand proxy.
5. Call the estimator only from the scheduled activation path in `apps/daemon/src/index.ts` when `targetMethod === "auto"`.
6. Apply the computed target SoC to the activated battery strategy for that scheduled item and persist the active computed target in runtime state so completion logic uses the same resolved target.
7. Extend the scheduled-start log formatter in `apps/daemon/src/strategy-log.ts` so the normal activation log includes the configured action plus the daemon estimate and reasoning.
8. Add a scoring script, for example `scripts/score-strategy-estimate.ts`, with a root alias such as `bun run estimate:score`.
9. Keep fixed target methods (`soc`, `duration`, `end-time`) unchanged and do not run this estimator for them.

## Data Sources

Use only existing daemon data paths:

- Current battery state from the existing poll sample in `apps/daemon/src/index.ts`
- Battery configuration from `BatteryRecord`
- Active scheduled item and its already available schedule context
- Solar forecast samples from `readSolarForecastSamples(db, battery.siteId)` in `apps/daemon/src/database.ts`
- Historical solar generation samples from `readSolarEnergyProviderSamples(db, battery.siteId)` in `apps/daemon/src/database.ts`
- Recent P1 meter samples from `readP1MeterSamples(db, battery.siteId)` in `apps/daemon/src/database.ts`
- Recent battery power samples from `readBatteryPowerSamples(db, battery.siteId)` in `apps/daemon/src/database.ts`

Use battery power samples in two different ways:

- aggregate all batteries on the site by `periodStart` when reconstructing site-level house usage
- filter to `battery.id` when battery-specific history is needed

Do not subtract `readWeatherForecast(...)` values directly from an energy target. That record is still useful as an upstream weather cache, but the daemon estimate should consume the already normalized solar forecast samples and convert them through the existing prediction path.

Current retention is already 30 days via `SAMPLE_RETENTION_DAYS = 30` in `apps/daemon/src/database.ts`. The first implementation should use that existing window. If the estimate proves too weak, increasing retention can be a later follow-up.

## Estimation Model

Keep the first version heuristic and explainable around target-time selection and load modeling, while reusing the existing solar prediction logic for future solar contribution.

Inputs:
- active scheduled item
- current time
- battery capacity and minimum discharge percent
- predicted solar generation series built from the existing forecast and production history
- recent historical inferred house usage from the retained 30-day sample window
- nearby later schedule boundaries when available

The current battery SoC is not part of the target calculation itself. The daemon-computed target answers: "until what percentage may we discharge now so we still expect to hold the desired reserve at the solar break-even point?" If the real battery SoC is already below that computed target, the discharging action simply has nothing to do.

Outputs:
- `targetTime`: the next important moment the daemon is optimizing toward
- `estimatedRemainingEnergyWh`: estimated net energy the battery will still need to supply between now and `targetTime`
- `estimatedReservePercentAtTargetTime`: the SoC we want to still hold at `targetTime`
- `estimatedTargetPercent`: the stop target to use now so the battery can drift down toward the target-time reserve by `targetTime`
- `reasoning`: compact human-readable explanation

### Derived Signals

Build predicted solar generation by reusing the existing `buildPredictedSolarGenerationSeries(...)` path with:

- `readSolarForecastSamples(db, battery.siteId)`
- `readSolarEnergyProviderSamples(db, battery.siteId)`

If we want the runtime log to match the existing displayed prediction behavior, apply the same smoothing mode that the EMS API uses today.

Infer historical house usage from aligned site samples with the energy-balance identity:

- `houseLoadW = solarGenerationW + gridPowerW - batteryPowerW`

Use the existing raw sign conventions:

- grid import is positive and grid export is negative in the stored P1 samples
- battery charging is positive and battery discharging is negative in the stored battery samples
- solar generation is positive in the stored solar provider samples

This gives us a site-level estimate of what the house was actually consuming at each period even though we do not store house usage directly.

Because some battery plugins currently persist battery power as magnitude without a reliable historical sign, the estimator should infer historical battery charge/discharge direction from adjacent SoC movement before folding battery power back into the site energy balance.

If one or more input series is missing for a period, treat that period as partial or unavailable instead of silently inventing load values.

### Target Time Rules

The daemon estimate should answer a concrete question: how long must this battery stay conservative before the next meaningful relief point?

Recommended first-pass rules:

1. `daily-time`
   - Use the item's own end condition when present.
   - If the item has no explicit end, use the next later scheduled item boundary.
   - If no stronger boundary exists, fall back to the next day boundary.

2. `low-price`
   - Use the next later expensive or discharge-relevant schedule boundary after the active low-price period.
   - Favor the next later scheduled item over a generic day boundary.
   - This keeps the estimate focused on how much charge to keep for the next more constrained period.

3. `high-price`
   - Use the next solar recovery point, defined as the first sustained future period where predicted solar production is strong enough to carry expected demand.
   - If the active item starts in the evening, that recovery point will usually land the next morning.
   - If the active item starts early in the morning, that same rule should usually land later that same morning rather than forcing the horizon into the next day.

4. Solar recovery point
   - Define it as the first future break-even bucket where predicted solar generation becomes larger than expected house demand for that time bucket.
   - Step forward bucket by bucket from the activation time until `predictedSolarGenerationW > max(expectedHouseLoadW, minimumMeaningfulSolarW)`.
   - The `minimumMeaningfulSolarW` floor prevents tiny near-zero forecast noise from counting as recovery.
   - If that point cannot be found confidently, fall back to the next later scheduled boundary, then local noon, then the next day boundary.

### Net Energy Estimate

Recommended logic shape:

1. Build a future predicted solar series for the rest of today and tomorrow by reusing the existing solar prediction code.
2. Infer historical house usage from site-level solar, grid, and battery series.
3. Build an expected house-load profile until `targetTime`.
   - Weight the full last 7 days most strongly.
   - Also include up to 4 same-day-of-week comparisons from the 30-day window.
   - Prefer a robust average or median by time slot so one unusual day does not dominate the estimate.
4. Integrate expected house load from now until `targetTime`.
5. Integrate predicted solar generation over the same window.
6. Compute net remaining energy between now and `targetTime`:
   - `estimatedRemainingEnergyWh = max(0, expectedHouseLoadWh - predictedSolarGenerationWh)`
7. Choose a target-time reserve percentage.
   - For discharge strategies that protect until solar recovery, keep a small margin above `minimumDischargePercent` so self-consumption can still remain active at the recovery point.
   - The first implementation may use a small default margin such as `minimumDischargePercent + 1` and tune it later with the benchmark script.
8. Convert the required remaining energy plus the target-time reserve into the stop target to use now:
   - `estimatedTargetPercent = estimatedReservePercentAtTargetTime + ceil(estimatedRemainingEnergyWh / capacityWh * 100)`
   - This answers the operational question: "until what percentage may we discharge now so we still expect to hold the desired reserve at `targetTime`?"
   - This calculation is intentionally independent of the battery's current SoC.
9. Clamp the stop target to a safe range: at least `minimumDischargePercent`, at most `100`.
10. When `targetMethod === "auto"`, use that computed stop target for the activated scheduled strategy and for completion tracking.
11. Keep fixed target methods untouched and log clearly that the daemon-computed target only applies to `Dynamic` items.

The first implementation may also include a small configurable reserve margin. That margin should be benchmarked against historical replay data instead of being hard-coded blindly.

## Logging Behavior

Update the normal scheduled-start log line to include:
- the existing human-readable action summary
- the daemon's target time
- estimated remaining energy need
- estimated target percentage
- concise reasoning

Example shape:

`the high-price schedule is now active for battery-1: discharge manually to 80% at 2400W; daemon estimate 34% by 08:15 based on overnight house load, recent Monday site usage, and predicted solar recovery after sunrise`

Interpretation:
- `34% by 08:15` means the daemon will stop forced discharge at `34%` now so the battery is expected to drift down to the desired reserve by `08:15`
- it does not mean the daemon wants the battery to still be at `34%` at `08:15`

Important wording rules:
- always make it clear this is a daemon-computed dynamic target
- never imply that fixed target methods were changed
- if solar prediction or load history is insufficient, log that the estimate is unavailable or partial and say why

## Benchmark Script

Add a companion scoring script, for example `scripts/score-strategy-estimate.ts`, to replay historical windows and rank candidate reserve settings.

The script should work similarly to `solar:score`:

- accept a recent lookback such as `--days`
- optionally limit to `--site <site-id>`
- evaluate a set of candidate reserve offsets or discharge-target adjustments
- print ranked results and make the current default easy to spot

Recommended evaluation flow:

1. Select historical candidate windows from recent scheduled activations or replayable time slices.
2. For each window, run the estimator using only data that would have been available at that time.
3. Compare the estimated target against what actually happened between activation and `targetTime`.
4. Score candidate reserve-at-target percentages for the chosen date/time and compare them against historical replay at the same local clock time.
5. For debugging and tuning, show the per-bucket break-even trace from the chosen start time until the selected target time so the operator can see exactly where predicted solar first beats expected demand.

Recommended metrics:

- miss rate: how often the chosen reserve would have forced grid import before the intended relief point
- stranded energy: how much SoC was left unused at `targetTime`
- imported energy during the protected window
- optional cost-weighted import using dynamic price samples when available

The main purpose of this script is to tune the reserve or discharge percentage, not to change runtime behavior automatically.

## Critical Files

- `apps/daemon/src/index.ts`
- `apps/daemon/src/strategy-log.ts`
- `apps/daemon/src/strategy-log.test.ts`
- `apps/daemon/src/database.ts`
- `apps/daemon/src/strategy-estimate.ts` (new)
- `apps/daemon/src/strategy-estimate.test.ts` (new)
- `scripts/score-strategy-estimate.ts` (new)
- `package.json`
- `apps/ems/src/battery.ts`

`packages/core/src/index.ts` should not need domain-model changes for this daemon-only logging feature and benchmark script.

## Implementation Notes

In `apps/daemon/src/index.ts`:
- compute the estimate immediately before activating and logging a scheduled item start when `targetMethod === "auto"`
- do this in both start-log paths:
  - immediate start when `!shouldWaitForObservedStart(item)`
  - delayed observed-start path when `shouldMarkScheduledItemObserved(...)` fires
- reuse the already available `sample` and `battery`
- read solar forecast, solar production, grid, and battery history on demand for the battery's site
- store the active computed target SoC and target time in runtime state so completion logic uses the resolved value

In `apps/daemon/src/strategy-estimate.ts`:
- add helpers to build the predicted solar generation series from existing forecast and production samples
- add helpers to aggregate site battery power by `periodStart` for house-load inference
- add helpers to infer historical house load from solar, grid, and battery samples
- add helpers to slice history to the last 7 days and same-day-of-week comparisons
- add helpers to pick the solar recovery point and trigger-specific `targetTime`
- keep the returned structure simple and daemon-local

In `scripts/score-strategy-estimate.ts`:
- reuse the same pure estimator helpers instead of duplicating the runtime math
- evaluate candidate reserve offsets separately for evening and morning high-price windows
- report misses and over-conservative outcomes clearly so tuning tradeoffs are obvious

In `apps/daemon/src/strategy-log.ts`:
- extend `formatScheduledStrategyStartedSummary(...)` to accept optional estimate context
- keep existing wording intact when estimate data is absent

In `apps/ems/src/battery.ts`:
- support `battery strategy-plan get --site-id <site-id>` for exporting the current house-wide schedule
- support `battery strategy-plan set --site-id <site-id> --file <path>` for round-tripping edited schedule JSON during CLI testing

## Verification

Focused tests:

1. `apps/daemon/src/strategy-estimate.test.ts`
   - uses the existing solar prediction pipeline instead of raw weather forecast values
   - infers house load from solar, grid, and battery history
   - computes a target time for each trigger kind
   - treats evening high-price windows as "protect until solar recovery" cases
   - treats morning high-price windows as shorter, less conservative cases
   - includes remaining energy needed, target-time reserve, and the stop target percent to use now
   - uses last-week and same-day-of-week history weighting
   - reduces estimated need when predicted solar recovery is strong
   - carries tomorrow predicted solar into the estimate when the target time crosses into tomorrow
   - clamps to `minimumDischargePercent...100`
   - does not allow evening `high-price` discharge to collapse to a same-evening target time when the intent is to protect overnight until solar recovery
   - returns a partial or unavailable estimate cleanly when solar or load history is missing

2. `apps/daemon/src/strategy-log.test.ts`
   - scheduled start summary includes daemon estimate, target time, and reasoning in the normal log line
   - wording still makes clear the configured action remains the one being applied
   - fallback formatting remains unchanged when no estimate is present

3. Benchmark validation
   - run `bun run estimate:score -- --days 14`
   - confirm the script ranks reserve combinations separately for evening and morning high-price windows
   - confirm the current default reserve setting is surfaced clearly

4. Regression safety
   - run `bun test apps/daemon/src/strategy-scheduler.test.ts`
   - keep scheduler activation and completion behavior unchanged

5. Narrow execution checks
   - `bun test apps/daemon/src/strategy-estimate.test.ts`
   - `bun test apps/daemon/src/strategy-log.test.ts`
   - `bun test apps/daemon/src/strategy-scheduler.test.ts`

6. End-to-end manual verification
   - run `bun run daemon:dev`
   - activate or wait for a scheduled item
   - confirm the normal daemon log now includes target time, estimated remaining energy, estimated target percent, and reasoning
   - confirm evening `high-price` items point toward the next solar recovery time
   - confirm morning `high-price` items use a shorter, less conservative horizon
   - confirm the battery still follows the user-configured strategy item target percentage rather than the estimate
