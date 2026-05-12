# Import Shortage Strategy Plan

## Goal

Add a built-in battery strategy item named `Import shortage` that detects whether a low-price import opportunity should be used because expected solar surplus later in the day will not fully recover the battery.

The implementation is intentionally phased. Phase 1 is diagnostic only. Automatic battery activation should only be added after the logged estimates have been reviewed and trusted.

## Current Status

Phase 1 is implemented.

- `Import shortage` exists as a built-in battery strategy item.
- The strategy dialog toggle enables or disables the item.
- When enabled, the daemon evaluates the item at low import-price marker points.
- The daemon logs an estimate of whether expected solar surplus later in the day can refill the battery.
- The estimate includes current charge, expected solar-surplus window, expected surplus energy, projected end charge, and shortage to full.
- The item is non-invasive: it does not change battery mode, does not claim a manual override, does not start charging, and does not alter `Delayed charging` behavior.

The current low-price-marker timing is useful for validating the estimate, but it is not the final activation timing. Phase 2 should move the decision and eventual charging activation earlier than the low-price marker.

## Built-In Order And Priority

The built-in normalized strategy order is:

1. `Self-consumption`
2. `Export surplus`
3. `Delayed-charge prep`
4. `Delayed charging`
5. `Import shortage`
6. `Solar production control`

The daemon priority rule is documented in `docs/strategies/priority.md`: higher-index items have higher priority. Because `Import shortage` is after `Delayed charging`, it has higher battery-strategy activation priority than `Delayed charging` when it becomes an active battery-control item.

`Solar production control` remains independent from the battery activation stack. It is present in the normalized plan order for persistence and UI consistency, but it does not participate as a normal battery strategy activation item.

## Phase 1: Implemented Diagnostic Estimate

Implemented Phase 1 work:

- added the `import-shortage` built-in item key
- added the `import-shortage` trigger kind
- normalized the built-in item into the fixed strategy plan before `Solar production control`
- added the strategy dialog label, description, and toggle
- added low-price-marker trigger resolution
- added daemon estimate calculation and logging
- added tests for fixed order, trigger resolution, and estimate calculation

Current log shape:

`import-shortage estimate for battery <batteryId>: triggerAt=<time> currentSoc=<percent>% chargeStart=<time> surplusEnd=<time> solarEnergy=<kWh> houseEnergyDuringSurplus=<kWh> surplusEnergy=<kWh> houseEnergyUntilChargeStart=<kWh> projectedChargeStartSoc=<percent>% projectedEndSoc=<percent>% shortageToFull=<percent>% availability=<availability> expectedFullAt=<time>`

Notes about current fields:

- `triggerAt` is currently the low import-price marker time.
- `chargeStart` is the first future time when expected solar generation exceeds expected house load.
- `surplusEnd` is the later time when expected solar generation no longer exceeds expected house load.
- `houseEnergyUntilChargeStart` is effectively expected net demand before solar surplus begins, after subtracting expected solar production during that pre-surplus period.
- `expectedFullAt` is only present when the estimate expects the battery to become full during the surplus window.

## Phase 2: Pre-Marker Decision Timing

Phase 2 should move import-shortage evaluation from marker-time diagnostics to a pre-marker decision point.

The decision should be scheduled before the selected low import-price marker, using the same algorithm shape as `Delayed charging` but with import-shortage-specific constants.

Delayed charging currently uses this shape:

`timeToFullMinutes = ceil(energyToFullWh / effectiveFillPowerW * 60)`

`triggerLeadTimeMinutes = ceil(timeToFullMinutes * baseFactor * marginFactor)`

`triggerAt = lowPriceMarkerTime - triggerLeadTimeMinutes`

For import shortage, the equivalent should be:

`requiredChargeMinutes = ceil(energyToImportWh / batteryMaxChargePowerW * 60)`

`triggerLeadTimeMinutes = ceil(requiredChargeMinutes * IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR * IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR)`

`triggerAt = lowPriceMarkerTime - triggerLeadTimeMinutes`

The import-shortage constants should be separate from the delayed-charging constants because the risk profile is different.

## Phase 2: Target Calculation

The target should cover the projected shortage, not blindly charge to full.

The target should also include a time-based uncertainty buffer. Do not use a fixed percentage margin.

Initial buffer constant:

- `IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR = 3`

Suggested target model:

`shortageBufferPercent = hoursUntilSolarSurplusRecovery * IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR`

`targetSoc = min(100, currentSocPercent + projectedShortagePercent + shortageBufferPercent)`

Where:

- `projectedShortagePercent` is the estimated deficit to full after the expected solar-surplus window.
- `hoursUntilSolarSurplusRecovery` is the time between the import-shortage decision point and the expected solar-surplus charging start.
- `batteryMaxChargePowerW` is the battery maximum charge power used for estimating charging duration.
- small projected shortages should not be ignored; even a small shortage is actionable if the calculation says it exists.

The buffer mirrors the intent of the export-surplus reserve buffer, but it must use separate import-shortage constants.

## Phase 3: Battery Activation

After the Phase 1 logs have been reviewed and the Phase 2 decision model is accepted, `Import shortage` can become an active battery-control item.

Expected activation behavior:

1. Select the relevant low import-price marker.
2. Estimate the projected solar recovery shortage for the rest of the day.
3. Calculate the target charge percentage from projected shortage plus the time-based buffer.
4. Calculate the pre-marker trigger time from required charge minutes and import-shortage lead-time constants.
5. When due, activate charging to the calculated target.
6. Let the existing strategy priority system handle conflicts, blocking, and preemption.
7. Complete when the calculated target charge is reached or when normal strategy completion rules determine that the item is finished.

`Import shortage` should not add custom interaction rules for `Delayed charging`. The existing priority model should decide which item wins. Because `Import shortage` has a higher index than `Delayed charging`, it can preempt or block lower-priority battery items when active.

## Dubious Or Needs Validation

These items need validation before enabling automatic charging:

- solar forecast reliability across sunny, cloudy, and mixed days
- house-load estimate reliability compared with actual same-day load
- battery capacity and state-of-charge availability
- whether the `3%/hour` buffer is too low, too high, or acceptable in real use
- whether import-shortage-specific lead-time constants should be more or less conservative than delayed charging
- whether the current log field names are precise enough, especially `houseEnergyUntilChargeStart`
- whether the current estimate should explicitly model and log post-full later-day drain after `expectedFullAt`

## Acceptance Criteria Before Activation

Before Phase 3 changes battery behavior:

1. Review real daemon logs over enough days to cover different weather and consumption patterns.
2. Confirm that projected shortage percentages are plausible compared with actual end-of-day charge.
3. Confirm the `3%/hour` buffer is directionally correct.
4. Decide initial values for `IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR` and `IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR`.
5. Add tests for pre-marker trigger timing, target calculation, and priority interactions.
6. Keep the behavior server-side in the daemon and do not add web-only business rules.

## Non-Goals

- no high-frequency optimization loop
- no real-time demand-matching control loop
- no web-only strategy rules
- no automatic charging before Phase 3
- no custom priority rules outside the existing strategy priority system
