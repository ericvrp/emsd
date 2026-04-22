# Dynamic Price Target Estimation

## Purpose

`Dynamic` is the daemon-owned dynamic price target method for scheduled battery strategy items. It is persisted as target method `auto`.

When a scheduled item with `targetMethod === "auto"` becomes active, the daemon computes a dynamic price target percentage and applies it to the live battery strategy. Fixed target methods (`soc`, `duration`, `end-time`) are unchanged.

The goal is:
- choose a `targetTime` where solar production is expected to take over from the battery again
- choose a reserve percentage that should still be held at that `targetTime`
- convert that into the stop target percentage to use for the active scheduled item

For low-price schedules with `targetMethod === "auto"`, the daemon now resolves a pre-discharge flow instead of charging at the low marker itself:
- resolve the upcoming low-price marker as the target horizon
- require solar to be expected at that low-price marker
- trigger earlier at the best preceding local high-price marker
- discharge only down to a reserve floor that should still hold enough charge at the low-price marker

This same estimator is used by:
- the daemon activation path for dynamic price target schedule items
- `bun run dynamic-price-target:evaluate`

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

`predictedSolarGenerationW > expectedHouseLoadW + minimumSolarSurplusW`

Notes:
- `minimumSolarSurplusW` prevents tiny forecast noise from counting as recovery
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

For dynamic discharge strategies, the daemon and CLI evaluation now share one reserve-floor helper:

`reserveFloorPercent = minimumDischargePercent + backupReserveMargin + round(hoursUntilTarget * backupReserveMarginPerHour)`

Default values:
- `backupReserveMargin = 2%`
- `backupReserveMarginPerHour = 0.5%`

This reserve-floor helper is used by:
- high-price auto discharge until solar recovery
- low-price auto pre-discharge until the selected low-price marker

## Daemon Behavior

When a dynamic schedule item activates:
- the daemon computes the estimate in `apps/daemon/src/dynamic-price-target.ts`
- applies the computed stop target to the activated strategy
- low-price auto items may resolve from configured `charging` to runtime `discharging`
- stores the resolved target SoC and target time in runtime state
- stores the resolved runtime manual state for completion checks and status text
- uses that same resolved target for completion checks
- logs the dynamic estimate in the normal scheduled-start log line

This logic is wired from `apps/daemon/src/index.ts` and the completion logic lives in `apps/daemon/src/strategy-scheduler.ts`.

## CLI Evaluation Script

`bun run dynamic-price-target:evaluate` uses the same estimator to evaluate a synthetic action for a chosen price marker.

If neither `--marker-date` nor `--marker-time` is supplied, the script evaluates from the next relevant price trigger instead of the current wall-clock time.

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
- `--marker-date YYYY-MM-DD`
- `--marker-time HH:MM`
- `--price high,low`
- `--backup-reserve-margin <percent>`
- `--backup-reserve-margin-per-hour <percent>`
- `--power <watts>`
- `--site <site-id>`
- `--days <n>`

For low-price auto evaluation, `--marker-date` and `--marker-time` select the low-price marker being evaluated. The script then derives the same pre-discharge start trigger that the daemon uses, so explicit marker selection matches the default low-price path.

## Main Files

- `apps/daemon/src/dynamic-price-target.ts`
- `apps/daemon/src/dynamic-price-target.test.ts`
- `apps/daemon/src/index.ts`
- `apps/daemon/src/strategy-scheduler.ts`
- `apps/daemon/src/strategy-log.ts`
- `scripts/evaluate-dynamic-price-target.ts`
- `apps/ems/src/battery.ts`

## Validation

Useful checks:
- `bun test apps/daemon/src/dynamic-price-target.test.ts`
- `bun test apps/daemon/src/strategy-scheduler.test.ts`
- `bun test apps/daemon/src/strategy-log.test.ts`
- `bun run --cwd apps/daemon typecheck`
- `bun run dynamic-price-target:evaluate`
- `bun run dynamic-price-target:evaluate -- --verbose=why,break-even,history,replay`
