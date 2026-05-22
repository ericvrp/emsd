# Import Shortage Strategy Plan

## Goal

Add a built-in battery strategy item named `Import shortage` that charges from the grid before a low-price import marker when expected solar surplus later in the day will not fully recover the battery.

## Current Status

The active import-shortage behavior is implemented.

- `Import shortage` exists as a built-in battery strategy item.
- The strategy dialog toggle enables or disables the item.
- When enabled, the daemon selects a low import-price marker for scheduling, then projects the battery path from the current daemon decision time through the first same-day solar-surplus start and final solar-surplus end.
- The target calculation subtracts expected pre-surplus house-load demand, adds expected solar recovery during the surplus window, and only imports the shortage needed to reach `100%` when solar surplus ends.
- The daemon schedules the item before the low-price marker using required charge time and import-shortage-specific lead-time constants.
- If the daemon misses the calculated pre-marker start time, the item can still activate until the low-price marker expiry window rather than expiring immediately after the pre-marker start.
- When due, the item activates normal battery charging to the calculated target state of charge.
- When it activates, lower-priority built-ins are suppressed for the rest of the same local day: `Export surplus`, `Delayed-charge prep`, and `Delayed charging`.
- The item uses the existing strategy priority system for blocking and preemption; it does not add custom interaction rules for `Delayed charging` or user-defined items.

The earlier diagnostic-only evaluator behavior has been replaced by active pre-marker charging behavior.

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
- added daemon projected-end-of-surplus shortage estimation
- added pre-marker trigger timing
- added active charging to the calculated target state of charge
- added same-day suppression of lower-priority built-ins after import-shortage activation
- added `bun run dynamic-price-target:evaluate` support using the same daemon import-shortage estimator
- added tests for fixed order, trigger resolution, estimate calculation, pre-marker timing, and target calculation

The active target calculation is based on the full projected path from the current daemon decision time until the final solar-surplus end of the day. That keeps `Import shortage` conceptually opposite to `Export surplus`: export surplus asks how far the battery may discharge until solar recovery, while import shortage asks how much grid import is needed so predicted pre-surplus demand plus predicted solar recovery still leaves the battery at 100% when solar surplus ends.

## Pre-Marker Decision Timing

The selected low import-price marker is a centered 4-hour moving-average price marker used to schedule any cheap grid top-up. It is not the start of the solar projection window. The projection window starts at the daemon's current decision time and runs through the final same-day solar-surplus end.

The decision is scheduled before the selected low import-price marker, using the same trigger lead-time shape as `Delayed charging` but with import-shortage-specific constants.

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

The target should cover the projected shortage at solar-surplus end, not blindly charge to full.

The target should also include a time-based uncertainty buffer. Do not use a fixed percentage margin.

Current buffer constant:

- `IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR = 0.2`

Target model:

`shortageBufferPercent = hoursFromDecisionTimeToSolarSurplusEnd * IMPORT_SHORTAGE_BUFFER_PERCENT_PER_HOUR`

`projectedEndSocWithoutImport = currentSoc - expectedNetDemandBeforeSolarSurplus + expectedNetSolarRecoveryUntilSurplusEnd`

`shortageToFull = max(0, 100 - projectedEndSocWithoutImport)`

`baseTargetSoc = min(100, currentSoc + shortageToFull)`

`targetSoc = currentSoc when shortageToFull is 0, otherwise min(100, baseTargetSoc + shortageBufferPercent)`

Decision story:

`currentSoc -> projectedSurplusStartSoc by solarSurplusStart after pre-surplus demand`

`projectedSurplusStartSoc -> projectedEndSocWithoutImport by solarSurplusEnd after solar recovery`

If `projectedEndSocWithoutImport` is already `100%`, import shortage skips and does not charge from the grid.

Where:

- `solarSurplusEnd` is the final same-day point where expected solar stops covering house load after a solar-surplus period.
- `solarSurplusStart` is the first same-day point after the current decision time where expected solar covers house load.
- `expectedNetDemandBeforeSolarSurplus` is expected house load minus expected solar generation from the current decision time until `solarSurplusStart`.
- `expectedNetSolarRecoveryUntilSurplusEnd` is expected solar generation minus expected house load from `solarSurplusStart` until `solarSurplusEnd`.
- `projectedEndSocWithoutImport` is the expected SoC at `solarSurplusEnd` if import-shortage does not charge from the grid.
- `projectedSurplusStartSoc` is the expected SoC at `solarSurplusStart` after covering pre-surplus demand.
- `baseTargetSoc` is the charge target before the time-based uncertainty buffer.
- `batteryMaxChargePowerW` is the battery maximum charge power used for estimating charging duration.
- small required top-ups should not be ignored; even a small calculated top-up is actionable if the current charge is below the target.

The buffer mirrors the intent of the export-surplus reserve buffer, but it must use separate import-shortage constants.

## Battery Activation

Activation behavior:

1. Select the relevant centered moving-average low import-price marker.
2. Find the first solar-surplus start and final solar-surplus end for that same day.
3. Integrate expected net demand from the current decision time until solar surplus starts.
4. Integrate expected net solar recovery from solar surplus start until final solar-surplus end.
5. Calculate the projected end-of-surplus SoC without grid import.
6. Calculate the import target needed to cover the shortage to 100%, then add the time-based buffer.
7. Calculate the pre-marker trigger time from required charge minutes and import-shortage lead-time constants.
8. When due, activate charging to the calculated target.
9. Mark lower-priority built-ins as triggered through local end-of-day so they cannot activate later that day.
10. Let the existing strategy priority system handle conflicts, blocking, and preemption.
11. Complete when the calculated target charge is reached or when normal strategy completion rules determine that the item is finished.

`Import shortage` does not add custom interaction rules for `Delayed charging`. The existing priority model decides which item wins. Because `Import shortage` has a higher index than `Delayed charging`, it can preempt or block lower-priority battery items when active.

## Evaluation Script

`bun run dynamic-price-target:evaluate` supports `--strategy=import-shortage` and includes import shortage in the default strategy set.

The evaluator must stay in sync with daemon behavior. It calls the same `estimateImportShortageDynamicTarget()` helper that the daemon activation path uses instead of duplicating import-shortage target or trigger calculations.

Default output is concise and includes:

- evaluated local time
- low import-price marker used to schedule any cheap grid top-up
- solar-surplus start and final solar-surplus end
- current SoC
- expected SoC path from current SoC to solar-surplus start, then through solar-surplus end
- shortage to full and whether grid import is needed
- charge target, energy to import, and calculated start time when import is needed

Verbose output can show the detailed energy and reasoning fields when requested with `--verbose=why,energy,history`.

The evaluator's `--date` and `--time` flags are as-of inputs, not direct marker inputs. The script resolves the import-shortage low-price marker from that as-of time using the same strategy marker logic as the daemon. `--time` accepts `HH:MM` and `HH:MM:SS` so daemon log timestamps can be replayed precisely.

## Dubious Or Needs Validation

These items still need validation and tuning:

- solar forecast reliability across sunny, cloudy, and mixed days
- house-load estimate reliability compared with actual same-day load
- battery capacity and state-of-charge availability
- whether the `0.2%/hour` buffer is too low, too high, or acceptable in real use
- whether the current import-shortage lead-time constants are too early, too late, or acceptable
- whether the current log story is concise enough for long-running daemon logs while still showing why a low import-price marker was selected
- whether the current estimate should explicitly model and log post-full later-day drain after solar-surplus end

## Follow-Up Criteria

Before considering the feature stable:

1. Review real daemon logs over enough days to cover different weather and consumption patterns.
2. Confirm that projected solar-surplus-start SoC, solar-surplus-end SoC, and shortage-to-full values are plausible compared with actual same-day charge.
3. Confirm the `0.2%/hour` buffer is directionally correct.
4. Tune `IMPORT_SHORTAGE_TRIGGER_BASE_FACTOR` and `IMPORT_SHORTAGE_TRIGGER_MARGIN_FACTOR` if the activation timing is consistently too early or too late.
5. Add broader tests for priority interactions if real behavior shows unclear overlaps with user-defined items.
6. Keep the behavior server-side in the daemon and do not add web-only business rules.

## Non-Goals

- no high-frequency optimization loop
- no real-time demand-matching control loop
- no web-only strategy rules
- no custom priority rules outside the existing strategy priority system
