# Import Shortage Strategy Plan

## Goal

Add a built-in battery strategy item named `Import shortage` that charges from the grid before a low-price import marker when expected solar surplus later in the day will not fully recover the battery.

## Current Status

The active import-shortage behavior is implemented.

- `Import shortage` exists as a built-in battery strategy item.
- The strategy dialog toggle enables or disables the item.
- When enabled, the daemon selects a low import-price marker, estimates the expected net solar surplus from that marker until the final solar-surplus end of the day, and calculates the SoC needed at the marker so that net surplus can fill the battery.
- The daemon schedules the item before the low-price marker using required charge time and import-shortage-specific lead-time constants.
- If the daemon misses the calculated pre-marker start time, the item can still activate until the low-price marker expiry window rather than expiring immediately after the pre-marker start.
- When due, the item activates normal battery charging to the calculated target state of charge.
- When it activates, lower-priority built-ins are suppressed for the rest of the same local day: `Export surplus`, `Delayed-charge prep`, and `Delayed charging`.
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
- added daemon net-surplus-until-day-end shortage estimation
- added pre-marker trigger timing
- added active charging to the calculated target state of charge
- added same-day suppression of lower-priority built-ins after import-shortage activation
- added `bun run dynamic-price-target:evaluate` support using the same daemon import-shortage estimator
- added tests for fixed order, trigger resolution, estimate calculation, pre-marker timing, and target calculation

The active target calculation is based on the final solar-surplus end of the day, not the first time solar starts covering house load. That keeps `Import shortage` conceptually opposite to `Export surplus`: export surplus asks how far the battery may discharge until solar recovery, while import shortage asks how full the battery must be at the low-price marker so the remaining net solar surplus can still reach 100%.

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

The target should cover the required marker SoC, not blindly charge to full.

The target should also include a time-based uncertainty buffer. Do not use a fixed percentage margin.

Current buffer constant:

- `IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR = 0.2`

Target model:

`shortageBufferPercent = hoursFromLowPriceMarkerToSolarSurplusEnd * IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR`

`baseTargetSoc = 100 - expectedNetSolarSurplusPercentUntilSurplusEnd`

`targetSoc = min(100, max(0, baseTargetSoc + shortageBufferPercent))`

Where:

- `solarSurplusEnd` is the final same-day point where expected solar stops covering house load after a solar-surplus period.
- `expectedNetSolarSurplusPercentUntilSurplusEnd` is expected solar generation minus expected house load from the low-price marker until `solarSurplusEnd`, converted to battery-capacity percentage.
- `baseTargetSoc` is the unclamped SoC needed at the marker so that the expected net surplus can bring the battery to 100% by `solarSurplusEnd`. It may be negative when expected net solar surplus exceeds a full battery.
- `batteryMaxChargePowerW` is the battery maximum charge power used for estimating charging duration.
- small required top-ups should not be ignored; even a small calculated top-up is actionable if the current charge is below the target.

The buffer mirrors the intent of the export-surplus reserve buffer, but it must use separate import-shortage constants.

## Battery Activation

Activation behavior:

1. Select the relevant low import-price marker.
2. Find the final solar-surplus end for that same day.
3. Integrate expected solar generation minus expected house load from the marker until that final surplus end.
4. Calculate the marker SoC required to reach 100% by that final surplus end.
5. Add the time-based buffer and calculate the target charge percentage.
6. Calculate the pre-marker trigger time from required charge minutes and import-shortage lead-time constants.
7. When due, activate charging to the calculated target.
8. Mark lower-priority built-ins as triggered through local end-of-day so they cannot activate later that day.
9. Let the existing strategy priority system handle conflicts, blocking, and preemption.
10. Complete when the calculated target charge is reached or when normal strategy completion rules determine that the item is finished.

`Import shortage` does not add custom interaction rules for `Delayed charging`. The existing priority model decides which item wins. Because `Import shortage` has a higher index than `Delayed charging`, it can preempt or block lower-priority battery items when active.

## Evaluation Script

`bun run dynamic-price-target:evaluate` supports `--strategy=import-shortage` and includes import shortage in the default strategy set.

The evaluator must stay in sync with daemon behavior. It calls the same `estimateImportShortageDynamicTarget()` helper that the daemon activation path uses instead of duplicating import-shortage target or trigger calculations.

Default output is concise and includes:

- low-price marker
- final solar-surplus end
- current SoC
- expected net solar surplus until that final surplus end
- needed SoC before solar surplus plus time-based buffer
- charge target and energy to import
- calculated start time before the marker

Verbose output can show the detailed energy and reasoning fields when requested with `--verbose=why,energy,history`.

## Dubious Or Needs Validation

These items still need validation and tuning:

- solar forecast reliability across sunny, cloudy, and mixed days
- house-load estimate reliability compared with actual same-day load
- battery capacity and state-of-charge availability
- whether the `0.2%/hour` buffer is too low, too high, or acceptable in real use
- whether the current import-shortage lead-time constants are too early, too late, or acceptable
- whether the current log field names are precise enough, especially `houseEnergyUntilChargeStart`
- whether the current estimate should explicitly model and log post-full later-day drain after `expectedFullAt`

## Follow-Up Criteria

Before considering the feature stable:

1. Review real daemon logs over enough days to cover different weather and consumption patterns.
2. Confirm that required marker SoC values are plausible compared with actual end-of-day charge.
3. Confirm the `0.2%/hour` buffer is directionally correct.
4. Tune `IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR` and `IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR` if the activation timing is consistently too early or too late.
5. Add broader tests for priority interactions if real behavior shows unclear overlaps with user-defined items.
6. Keep the behavior server-side in the daemon and do not add web-only business rules.

## Non-Goals

- no high-frequency optimization loop
- no real-time demand-matching control loop
- no web-only strategy rules
- no custom priority rules outside the existing strategy priority system
