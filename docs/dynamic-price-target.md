# Dynamic Price Target Estimation

## Purpose

`Dynamic` is the daemon-owned dynamic price target method for scheduled battery strategy items. It is persisted as target method `auto`.

When a scheduled item with `targetMethod === "auto"` becomes active, the daemon computes a dynamic price target percentage and applies it to the live battery strategy. Fixed target methods (`soc`, `duration`, `end-time`) are unchanged.

The goal is:
- choose a `targetTime` where solar production is expected to take over from the battery again
- choose a reserve percentage that should still be held at that `targetTime`
- convert that into the stop target percentage to use for the active scheduled item

For delayed-charging schedules with `targetMethod === "auto"`, the intended flow is:
- resolve the upcoming delayed-charging marker as the low-price window start
- estimate the net solar charge opportunity during the low-price window itself
- compute the desired battery level at the low-price window start
- derive the latest feasible pre-discharge start time from the current SoC, the desired SoC at the low-price window start, and the effective discharge power
- never discharge below the delayed-charging provisional floor of backup reserve plus 10%

Important:
- delayed charging start time should not be tied to a preceding `export-surplus` or other high-price marker
- if the battery is already at or below the desired delayed-charging start level, the daemon should wait instead of continuing to discharge
- the current code still contains legacy experimental behavior in this area and should not be treated as the final delayed-charging implementation

This same estimator is used by:
- the daemon activation path for dynamic price target schedule items
- `bun run dynamic-price-target:evaluate`

## Strategy Notes

Product-facing explanations for the built-in rules now live in:
- `strategies/self-consumption.md`
- `strategies/export-surplus.md`
- `strategies/delayed-charging.md`

Important:
- `Export surplus` is documented as an active built-in rule
- `Delayed charging` is still under construction and the current implementation is not correct yet
- this file documents the shared estimator implementation, not the final product wording for each strategy type

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
- `backupReserveMargin = 1%`
- `backupReserveMarginPerHour = 0.2%`

This reserve-floor helper is used by:
- export-surplus auto discharge until solar recovery

Delayed charging should use its own provisional start threshold rule:

`delayedChargingStartFloorPercent = minimumDischargePercent + 10`

## Daemon Behavior

When a dynamic schedule item activates:
- the daemon computes the estimate in `apps/daemon/src/dynamic-price-target.ts`
- applies the computed stop target to the activated strategy
- delayed-charging auto items may currently resolve from configured `charging` to runtime `discharging`
- stores the resolved target SoC and target time in runtime state
- stores the resolved runtime manual state for completion checks and status text
- uses that same resolved target for completion checks
- logs the dynamic estimate in the normal scheduled-start log line

The delayed-charging start time should be the latest feasible pre-discharge start time needed to reach the computed delayed-charging start target by the low-price window start. It should not be derived from the preceding `export-surplus` marker.

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
- `--strategy export-surplus,delayed-charging`
- `--backup-reserve-margin <percent>`
- `--backup-reserve-margin-per-hour <percent>`
- `--power <watts>`
- `--site <site-id>`
- `--days <n>`

For delayed-charging auto evaluation, `--marker-date` and `--marker-time` select the delayed-charging marker being evaluated. The intended delayed-charging evaluation should then explain the computed latest feasible pre-discharge start time rather than relying on a preceding `export-surplus` marker.

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
