# Export Surplus Strategy

## Purpose

`Export surplus` is the built-in price-triggered discharge rule.

Its purpose is to make money from otherwise unneeded battery capacity during favorable export windows, while still keeping enough reserve for expected household demand.

## Current Behavior

- built in as `triggerKind: export-surplus`
- enabled by default in the normalized strategy plan
- persisted as a manual discharging item with `targetMethod: auto`
- triggered on the day's local high-price markers from the shared price-selection path

When it activates, the daemon uses the shared dynamic target estimator to:
- look ahead to the next solar-recovery point
- estimate how much energy the house will need until then
- keep a reserve floor for that horizon
- convert that into the discharge target for the active strategy item

## Status

This is an active built-in rule and should be documented as current behavior.

Implementation details for the shared estimator live in `../dynamic-price-target.md`.
