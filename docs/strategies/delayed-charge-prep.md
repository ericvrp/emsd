# Delayed-Charge Prep Strategy

## Purpose

`Delayed-charge prep` is the built-in bridge between `Export surplus` and `Delayed charging`.

Its job is to hold the battery out of active charging or discharging after the last relevant high-price export marker and before the upcoming low-price delayed-charging marker.

## Current Behavior

`Delayed-charge prep` is a fixed built-in strategy item.

- it is normalized into the battery strategy plan at index `2`
- it uses `triggerKind: delayed-charge-prep`
- it uses `targetMethod: auto`
- it applies manual `idle`
- it is disabled automatically when built-in `Delayed charging` is disabled

The built-in order is:

1. `Self-consumption`
2. `Export surplus`
3. `Delayed-charge prep`
4. `Delayed charging`

## Trigger Time

Prep time is derived from price markers.

The daemon:

1. resolves the upcoming delayed-charging marker as the next centered moving-average low-price marker
2. finds the most recent export-surplus marker before that low-price marker
3. sets prep trigger time to one hour after that prior high-price marker

In shorthand:

`prepTriggerAt = priorHighPriceMarkerTime + 1 hour`

If either marker is missing, prep does not trigger.

## Runtime Role

When active, prep applies manual `idle`.

That means the battery is held between the export window and the delayed-charging window instead of continuing export discharge or starting charge early.

Prep only activates when the upcoming delayed-charging low-price marker is expected to have solar production above expected house load.

If that low-price marker does not have expected solar surplus, prep is skipped instead of holding the battery idle.

Prep does not have its own SoC completion rule. It stays active until a higher-priority item replaces it.

In the normal built-in flow, that replacement is `Delayed charging`.

## Export-Surplus Handoff

Prep is intentionally aware of `Export surplus`.

If prep is due while `Export surplus` is still active, the daemon waits rather than interrupting export immediately.

Once `Export surplus` completes, the daemon checks the next higher built-in slot and activates `Delayed-charge prep` right away when it is eligible.

## Priority And Preemption

Cross-strategy priority, blocking, and preemption rules are documented in `priority.md`.

For prep specifically:

- it has higher priority than built-in `Export surplus`
- it has lower priority than built-in `Delayed charging`
- a higher-priority user schedule can preempt it
- it does not complete itself; it is normally replaced by a higher-priority item

## Status

`Delayed-charge prep` is implemented as an active built-in rule.

The current daemon behavior is to derive prep from price markers, require the same low-price-marker solar-surplus condition as `Delayed charging`, hold the battery in manual `idle` after the relevant export marker, and hand off to `Delayed charging` when the low-price window becomes due.
