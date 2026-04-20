# Dynamic Target Estimation

## Purpose

`Dynamic` is the daemon-owned target method for scheduled battery strategy items. It is persisted as target method `auto`.

When a scheduled item with `targetMethod === "auto"` becomes active, the daemon computes a stop target percentage and applies it to the live battery strategy. Fixed target methods (`soc`, `duration`, `end-time`) are unchanged.

The goal is:
- choose a `targetTime` where solar production is expected to take over from the battery again
- choose a reserve percentage that should still be held at that `targetTime`
- convert that into the stop target percentage to use for the active scheduled item

This same estimator is used by:
- the daemon activation path for dynamic schedule items
- `bun run estimate:score`

## Core Model

The estimator answers this question:

`Until what percentage may we discharge for the selected date/time so the battery is still expected to hold the desired reserve at the solar break-even point?`

The current battery SoC is not part of that target calculation. If the real battery SoC is already below the computed target, the active discharging strategy simply has nothing to do.

The main outputs are:
- `targetTime`: first future break-even bucket
- `estimatedRemainingEnergyWh`: net battery energy needed between the selected time and `targetTime`
- `estimatedReservePercentAtTargetTime`: reserve to still hold at `targetTime`
- `estimatedTargetPercent`: stop target percentage to use for the active strategy

## Data Sources

The estimator uses existing daemon-owned data only:
- `readSolarForecastSamples(db, battery.siteId)`
- `readSolarEnergyProviderSamples(db, battery.siteId)`
- `readP1MeterSamples(db, battery.siteId)`
- `readBatteryPowerSamples(db, battery.siteId)`
- battery config from `BatteryRecord`

Weather forecast rows are not used directly as energy values. The estimator uses the existing solar prediction path built from forecast plus historical solar production.

## Historical House Load

Historical house load is inferred from site energy balance:

`houseLoadW = solarGenerationW + gridPowerW - batteryPowerW`

Sign conventions:
- grid import is positive
- grid export is negative
- solar generation is positive

Some battery plugins currently store battery power as magnitude without a reliable historical sign. For that reason, the estimator infers charge/discharge direction from adjacent SoC movement before battery power is folded back into the site energy balance.

Expected house load per time bucket is then built from recent history using:
- last 7 days as the main lookback window
- up to 4 same-weekday matches for extra weighting
- median by time slot
- light smoothing across neighboring slots to avoid noisy zero buckets

## Target Time

`targetTime` is the first future break-even bucket.

The estimator steps forward bucket by bucket from the selected start time until:

`predictedSolarGenerationW > max(expectedHouseLoadW, minimumMeaningfulSolarW)`

Notes:
- `minimumMeaningfulSolarW` prevents tiny forecast noise from counting as recovery
- this can land later the same morning or the next morning depending on the selected time
- if no break-even bucket can be found confidently, the estimator falls back to the next relevant schedule boundary and then broader time fallbacks

## Stop Target Calculation

Once `targetTime` is known:

1. Integrate expected house load until `targetTime`
2. Integrate predicted solar generation until `targetTime`
3. Compute net battery energy needed:

`estimatedRemainingEnergyWh = max(0, expectedHouseLoadWh - predictedSolarGenerationWh)`

4. Choose the reserve to still hold at `targetTime`
5. Convert that into the stop target percentage to use for the active strategy:

`estimatedTargetPercent = estimatedReservePercentAtTargetTime + ceil(estimatedRemainingEnergyWh / capacityWh * 100)`

6. Clamp to a safe range:
- at least `minimumDischargePercent`
- at most `100`

For discharge strategies that protect until solar recovery, the current implementation keeps a small reserve margin above minimum discharge so self-consumption can still remain active at the recovery point.

## Daemon Behavior

When a dynamic schedule item activates:
- the daemon computes the estimate in `apps/daemon/src/strategy-estimate.ts`
- applies the computed stop target to the activated strategy
- stores the resolved target SoC and target time in runtime state
- uses that same resolved target for completion checks
- logs the dynamic estimate in the normal scheduled-start log line

This logic is wired from `apps/daemon/src/index.ts` and the completion logic lives in `apps/daemon/src/strategy-scheduler.ts`.

## CLI Scoring Script

`bun run estimate:score` uses the same estimator to evaluate a synthetic action for a chosen date and time.

Default behavior:
- prints one concise summary line per battery

Verbose behavior:
- `--verbose` shows all detail blocks
- `--verbose=<comma-separated-blocks>` shows selected blocks only

Available verbose blocks:
- `meta`
- `current`
- `energy`
- `why`
- `break-even`
- `history`
- `replay`

The script supports:
- `--date YYYY-MM-DD`
- `--time HH:MM`
- `--price high,low`
- `--backup-reserve-margin <percent>`
- `--power <watts>`
- `--site <site-id>`
- `--days <n>`

By default, the replay reserve target is the battery's own `minimumDischargePercent` plus a `2%` backup reserve margin.

## Main Files

- `apps/daemon/src/strategy-estimate.ts`
- `apps/daemon/src/strategy-estimate.test.ts`
- `apps/daemon/src/index.ts`
- `apps/daemon/src/strategy-scheduler.ts`
- `apps/daemon/src/strategy-log.ts`
- `scripts/score-strategy-estimate.ts`
- `apps/ems/src/battery.ts`

## Validation

Useful checks:
- `bun test apps/daemon/src/strategy-estimate.test.ts`
- `bun test apps/daemon/src/strategy-scheduler.test.ts`
- `bun test apps/daemon/src/strategy-log.test.ts`
- `bun run --cwd apps/daemon typecheck`
- `bun run estimate:score`
- `bun run estimate:score -- --verbose=why,break-even,history,replay`
