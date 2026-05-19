# Dynamic Price Target Estimation

## Purpose

`Dynamic` is the daemon-owned dynamic price target method for scheduled battery strategy items. It is persisted as target method `auto`.

When a scheduled item with `targetMethod === "auto"` becomes active, the daemon computes a dynamic target percentage and applies it to the live battery strategy. Fixed target methods (`soc`, `duration`, `end-time`) are unchanged.

The goal is:
- choose a `targetTime` where solar production is expected to take over from the battery again
- choose a reserve percentage that should still be held at that `targetTime`
- convert that into the stop target percentage to use for the active scheduled item

For delayed-charging schedules with `targetMethod === "auto"`, the flow is:
- resolve the upcoming delayed-charging marker as the local low-price marker
- compute the battery energy still needed to reach `100%`
- if the marker price is above `0`, use `expectedSolarAtMarkerW - expectedHouseLoadAtMarkerW` as the effective fill power and apply `self-consumption`
- if the marker price is `0` or below, use `battery.maximumChargePowerW` as the effective fill power and apply full charging
- compute `timeToFull`
- compute lead time as `timeToFull * 0.5 * triggerMarginFactor`
- trigger delayed charging at `lowPriceMarkerTime - leadTime`
- skip positive-price markers when the expected net solar fill power at the marker is not positive
- complete the delayed-charging item when the battery reaches `100%`, then restore the default strategy

For import-shortage schedules with `targetMethod === "auto"`, the flow is:
- resolve the upcoming import-shortage marker as the local low import-price marker used for scheduling any cheap grid top-up
- find the first same-day solar-surplus start and final same-day solar-surplus end
- integrate expected net demand from the decision time until solar surplus starts
- integrate expected net solar recovery from solar surplus start until final solar-surplus end
- compute the projected end-of-surplus SoC without grid import
- compute the shortage to `100%` and add the import-shortage time buffer, currently `0.2%/hour` from the decision time until the final solar-surplus end
- compute the charge target as `currentSoc + shortageToFull + buffer`, clamped to `100%`, and skip when there is no shortage
- compute required charge time from `energyToImportWh / battery.maximumChargePowerW`
- compute lead time as `requiredChargeMinutes * IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR * IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR`
- trigger import shortage at `lowPriceMarkerTime - leadTime`
- complete the import-shortage item when the battery reaches the calculated target, then restore the default strategy

Important:
- delayed charging start time is based on the low-price marker only
- the delayed-charging estimator uses the marker signal only; it does not average across a larger delayed-charging window
- the import-shortage estimator uses the low import-price marker for timing, but the SoC projection runs from the current decision time through solar-surplus start and end
- the separate `Delayed-charge prep` built-in item is not estimated here; it has its own marker-based trigger before delayed charging becomes due

This same estimator is used by:
- the daemon activation path for dynamic target schedule items
- `bun run dynamic-price-target:evaluate`

## Strategy Notes

Product-facing explanations for the built-in rules now live in:
- `../strategies/self-consumption.md`
- `../strategies/export-surplus.md`
- `../strategies/delayed-charge-prep.md`
- `../strategies/delayed-charging.md`
- `../plans/import-shortage-plan.md`

Important:
- `Export surplus` is documented as an active built-in rule
- `Delayed-charge prep` is documented as an active built-in rule
- `Delayed charging` is documented as an active built-in rule
- `Import shortage` is documented as an active built-in rule
- this file documents the shared estimator and evaluation script, not the final product wording for each strategy type

## Export-Surplus Core Model

For dynamic discharge strategies such as export surplus, the estimator answers this question:

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
- dynamic price source export deduction for the normalized import/export spread
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

## Export-Surplus Target Time

`targetTime` is the first future break-even bucket.

The estimator steps forward bucket by bucket from the selected start time until:

`predictedSolarGenerationW > expectedHouseLoadW + minimumSolarSurplusW`

Notes:
- `minimumSolarSurplusW` prevents tiny forecast noise from counting as recovery
- this can land later the same morning or the next morning depending on the selected time
- if no break-even bucket can be found confidently, the estimator falls back to the next relevant schedule boundary and then broader time fallbacks

## Export-Surplus Stop Target Calculation

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

Delayed charging no longer uses a pre-discharge floor or a separate delayed-charging reserve rule.

## Daemon Behavior

When a dynamic schedule item activates:
- the daemon computes the estimate in `apps/daemon/src/dynamic-price-target.ts`
- applies the computed stop target to the activated strategy
- delayed-charging auto items now resolve to either runtime `self-consumption` or runtime full `charging`
- stores the resolved target SoC and target time in runtime state
- stores the resolved runtime manual state for completion checks and status text
- uses that same resolved target for completion checks
- logs the dynamic estimate in the normal scheduled-start log line

The delayed-charging start time should be derived directly from the low-price marker and the explicit lead-time formula. It is not derived from a preceding `export-surplus` marker.

This logic is wired from `apps/daemon/src/index.ts` and the completion logic lives in `apps/daemon/src/strategy-scheduler.ts`.

If a higher-index schedule item becomes due while a lower-index item is still active, the daemon cancels the lower-index active item in the same poll cycle and immediately activates the higher-index item.

## CLI Evaluation Script

`bun run dynamic-price-target:evaluate` uses the same estimator to evaluate a synthetic action from a chosen local daemon-like time.

If neither `--date` nor `--time` is supplied, the script evaluates from the current local wall-clock time. The selected price marker is resolved from that time according to the chosen strategy.

Default behavior:
- prints a concise block for each evaluated strategy and battery
- includes an empty line between blocks
- shows the evaluated local time and selected strategy marker
- includes the exact `--verbose=...` suggestion to use for more detail
- shows `Status: skipped` and a `Reason` when the estimator decides not to run the evaluated strategy

For export-surplus evaluation, the concise output includes the current high-price marker and the next high-price marker when available. Export-surplus is skipped when an afternoon/evening high-price marker is followed by a higher-priced morning high-price marker. It is not skipped for this reason when no next high-price marker is available.

For import-shortage evaluation, the script calls the same `estimateImportShortageDynamicTarget()` helper used by the daemon. Concise output names the low import-price marker, shows the solar-surplus window, explains the expected SoC path from current SoC to solar-surplus start and then to solar-surplus end, and states whether any grid import is needed.

Verbose behavior:
- `--verbose` shows all detail blocks
- `--verbose=<comma-separated-blocks>` shows selected blocks only

Available verbose blocks:
- `meta`
- `current`
- `energy`
- `energy-buckets`
- `why`
- `break-even`
- `history`

The script supports:
- `--date YYYY-MM-DD`
- `--time HH:MM` or `--time HH:MM:SS`
- `--strategy export-surplus,delayed-charging,import-shortage`
- `--backup-reserve-margin <percent>`
- `--backup-reserve-margin-per-hour <percent>`
- `--power <watts>`
- `--site <site-id>`
- `--days <n>`

For delayed-charging auto evaluation, `--date` and `--time` select the local as-of time. The evaluator resolves the delayed-charging low-price marker from that time. Verbose `why` output explains the marker, resolved activation mode, marker load/solar signal, effective fill power, time to full, trigger lead time, and computed trigger time.

For import-shortage auto evaluation, `--date` and `--time` select the local as-of time, matching daemon log timestamps such as `02:19:20`. The evaluator resolves the import-shortage low import-price marker from that time. Verbose `why` and `energy` output explains the solar-surplus start and end, pre-surplus demand, net solar recovery, projected end SoC without import, shortage to full, hourly buffer, effective charge power, required charge time, trigger lead time, and computed trigger time.

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
- `bun run dynamic-price-target:evaluate -- --verbose=why,energy,energy-buckets,history`
