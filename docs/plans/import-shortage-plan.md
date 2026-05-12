# Import Shortage Strategy Plan

## Goal

Add a built-in battery strategy item named `Import shortage` that charges from the grid before a low-price import marker when expected solar surplus later in the day will not fully recover the battery.

## Current Status

The active import-shortage behavior is implemented.

- `Import shortage` exists as a built-in battery strategy item.
- The strategy dialog toggle enables or disables the item.
- When enabled, the daemon selects a low import-price marker, estimates whether expected solar surplus can refill the battery later in the day, and calculates a charge target if solar alone is projected to fall short.
- The daemon schedules the item before the low-price marker using required charge time and import-shortage-specific lead-time constants.
- If the daemon misses the calculated pre-marker start time, the item can still activate until the low-price marker expiry window rather than expiring immediately after the pre-marker start.
- When due, the item activates normal battery charging to the calculated target state of charge.
- The item uses the existing strategy priority system for blocking and preemption; it does not add custom interaction rules for `Delayed charging` or user-defined items.

The old diagnostic-only marker-time behavior has been replaced by active pre-marker charging behavior.

## Built-In Order And Priority

The built-in normalized strategy order is:

1. `Self-consumption`
2. `Export surplus`
3. `Delayed-charge prep`
4. `Delayed charging`
5. `Import shortage`
6. `Solar production control`

The daemon priority rule is documented in `docs/strategies/priority.md`: higher-index items have higher priority. Because `Import shortage` is after `Delayed charging`, it has higher battery-strategy activation priority than `Delayed charging` when it is active or due.

`Solar production control` remains independent from the battery activation stack. It is present in the normalized plan order for persistence and UI consistency, but it does not participate as a normal battery strategy activation item.

## Implemented Behavior

Implemented work:

- added the `import-shortage` built-in item key
- added the `import-shortage` trigger kind
- normalized the built-in item into the fixed strategy plan before `Solar production control`
- added the strategy dialog label, description, and toggle
- added low-price-marker trigger resolution
- added daemon solar recovery shortage estimation
- added pre-marker trigger timing
- added active charging to the calculated target state of charge
- added `bun run dynamic-price-target:evaluate` support using the same daemon import-shortage estimator
- added tests for fixed order, trigger resolution, estimate calculation, pre-marker timing, and target calculation

The daemon still uses the import-shortage estimate fields internally:

`import-shortage estimate for battery <batteryId>: triggerAt=<time> currentSoc=<percent>% chargeStart=<time> surplusEnd=<time> solarEnergy=<kWh> houseEnergyDuringSurplus=<kWh> surplusEnergy=<kWh> houseEnergyUntilChargeStart=<kWh> projectedChargeStartSoc=<percent>% projectedEndSoc=<percent>% shortageToFull=<percent>% availability=<availability> expectedFullAt=<time>`

Notes about estimate fields:

- `triggerAt` in the raw estimate is the calculation start time.
- `chargeStart` is the first future time when expected solar generation exceeds expected house load.
- `surplusEnd` is the later time when expected solar generation no longer exceeds expected house load.
- `houseEnergyUntilChargeStart` is effectively expected net demand before solar surplus begins, after subtracting expected solar production during that pre-surplus period.
- `expectedFullAt` is only present when the estimate expects the battery to become full during the surplus window.

## Pre-Marker Decision Timing

The decision is scheduled before the selected low import-price marker, using the same algorithm shape as `Delayed charging` but with import-shortage-specific constants.

Delayed charging currently uses this shape:

`timeToFullMinutes = ceil(energyToFullWh / effectiveFillPowerW * 60)`

`triggerLeadTimeMinutes = ceil(timeToFullMinutes * baseFactor * marginFactor)`

`triggerAt = lowPriceMarkerTime - triggerLeadTimeMinutes`

For import shortage, the equivalent is:

`requiredChargeMinutes = ceil(energyToImportWh / batteryMaxChargePowerW * 60)`

`triggerLeadTimeMinutes = ceil(requiredChargeMinutes * IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR * IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR)`

`triggerAt = lowPriceMarkerTime - triggerLeadTimeMinutes`

Current import-shortage lead-time constants:

- `IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR = 1`
- `IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR = 1.2`

The import-shortage constants are separate from the delayed-charging constants because the risk profile is different.

## Target Calculation

The target should cover the projected shortage, not blindly charge to full.

The target should also include a time-based uncertainty buffer. Do not use a fixed percentage margin.

Current buffer constant:

- `IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR = 3`

Target model:

`shortageBufferPercent = hoursUntilSolarSurplusRecovery * IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR`

`targetSoc = min(100, currentSocPercent + projectedShortagePercent + shortageBufferPercent)`

Where:

- `projectedShortagePercent` is the estimated deficit to full after the expected solar-surplus window.
- `hoursUntilSolarSurplusRecovery` is the time between the import-shortage decision point and the expected solar-surplus charging start.
- `batteryMaxChargePowerW` is the battery maximum charge power used for estimating charging duration.
- small projected shortages should not be ignored; even a small shortage is actionable if the calculation says it exists.

The buffer mirrors the intent of the export-surplus reserve buffer, but it must use separate import-shortage constants.

## Battery Activation

Activation behavior:

1. Select the relevant low import-price marker.
2. Estimate the projected solar recovery shortage for the rest of the day.
3. Calculate the target charge percentage from projected shortage plus the time-based buffer.
4. Calculate the pre-marker trigger time from required charge minutes and import-shortage lead-time constants.
5. When due, activate charging to the calculated target.
6. Let the existing strategy priority system handle conflicts, blocking, and preemption.
7. Complete when the calculated target charge is reached or when normal strategy completion rules determine that the item is finished.

`Import shortage` does not add custom interaction rules for `Delayed charging`. The existing priority model decides which item wins. Because `Import shortage` has a higher index than `Delayed charging`, it can preempt or block lower-priority battery items when active.

## Evaluation Script

`bun run dynamic-price-target:evaluate` supports `--strategy=import-shortage` and includes import shortage in the default strategy set.

The evaluator must stay in sync with daemon behavior. It calls the same `estimateImportShortageDynamicTarget()` helper that the daemon activation path uses instead of duplicating import-shortage target or trigger calculations.

Default output is concise and includes:

- low-price marker
- expected solar recovery start
- projected end state of charge without import
- projected shortage plus time-based buffer
- charge target and energy to import
- calculated start time before the marker

Verbose output can show the detailed energy and reasoning fields when requested with `--verbose=why,energy,history`.

## Dubious Or Needs Validation

These items still need validation and tuning:

- solar forecast reliability across sunny, cloudy, and mixed days
- house-load estimate reliability compared with actual same-day load
- battery capacity and state-of-charge availability
- whether the `3%/hour` buffer is too low, too high, or acceptable in real use
- whether the current import-shortage lead-time constants are too early, too late, or acceptable
- whether the current log field names are precise enough, especially `houseEnergyUntilChargeStart`
- whether the current estimate should explicitly model and log post-full later-day drain after `expectedFullAt`

## Follow-Up Criteria

Before considering the feature stable:

1. Review real daemon logs over enough days to cover different weather and consumption patterns.
2. Confirm that projected shortage percentages are plausible compared with actual end-of-day charge.
3. Confirm the `3%/hour` buffer is directionally correct.
4. Tune `IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR` and `IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR` if the activation timing is consistently too early or too late.
5. Add broader tests for priority interactions if real behavior shows unclear overlaps with user-defined items.
6. Keep the behavior server-side in the daemon and do not add web-only business rules.

## Non-Goals

- no high-frequency optimization loop
- no real-time demand-matching control loop
- no web-only strategy rules
- no custom priority rules outside the existing strategy priority system
