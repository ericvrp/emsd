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

The daemon can skip an export-surplus marker when the next high-price marker is a better export opportunity:
- the current high-price marker is at or after local midday
- the next high-price marker is before local midday
- the next marker's export price is higher than the current marker's export price

If there is no next high-price marker, export-surplus does not skip for this reason.

Skipped export-surplus decisions are reported with `Status: skipped` in `bun run dynamic-price-target:evaluate` and use local datetime output like `YYYY-MM-DD HH:mm` in the reason text.

## Status

This is an active built-in rule and should be documented as current behavior.

Implementation details for the shared estimator live in `../scripts/dynamic-price-target.md`.
