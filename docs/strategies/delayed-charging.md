# Delayed Charging Strategy

## Purpose

`Delayed charging` is the built-in low-price solar-capture rule.

Its job is to activate shortly before a low-price marker and then choose the battery behavior that best fits that marker.

It is the charging-side phase that follows built-in `Delayed-charge prep`, which is documented separately in `delayed-charge-prep.md`.

## Current Behavior

Delayed charging now starts from the low-price marker only.

The daemon resolves the next delayed-charging marker as the local low-price point from price selection.

In the built-in flow, `Delayed-charge prep` may already be holding the battery in `idle` before this rule starts.

From that marker it computes:

1. The battery energy still needed to reach full charge.
2. Which delayed-charging mode should apply at that marker.
3. How long before the marker the rule should start.

## Marker Branches

Delayed charging has two branches:

1. If the low-price marker price is above `0`, delayed charging activates `self-consumption`.
2. If the low-price marker price is `0` or below, delayed charging activates full manual charging to `100%`.

This means delayed charging is still an automatically decided built-in rule, but the applied battery behavior depends on the marker price.

## Positive-Price Branch

When the low-price marker is still above zero, delayed charging assumes the battery should fill naturally from solar rather than force grid charging.

At the marker, the daemon computes:

`effectiveFillPowerW = expectedSolarAtMarkerW - expectedHouseLoadAtMarkerW`

The values are taken at the marker itself, not over a larger window.

If `effectiveFillPowerW <= 0`, delayed charging is skipped for that marker.

The skip reason should stay visible in daemon logs and in `bun run dynamic-price-target:evaluate` output.

## Non-Positive-Price Branch

When the low-price marker is `0` or below, delayed charging switches to full charging.

In that branch the daemon uses:

`effectiveFillPowerW = battery.maximumChargePowerW`

This branch does not depend on expected solar surplus.

## Start Time Formula

For both branches, the daemon computes the energy still needed to reach full charge:

`energyToFullWh = capacityWh * ((100 - currentSocPercent) / 100)`

Then:

`timeToFullHours = energyToFullWh / effectiveFillPowerW`

To decide how much earlier than the marker delayed charging should start, the daemon uses:

`leadTimeHours = timeToFullHours * 0.5 * triggerMarginFactor`

The current `triggerMarginFactor` is `1.2`, so this is effectively:

`leadTimeHours = timeToFullHours * 0.6`

Finally:

`triggerAt = lowPriceMarkerTime - leadTimeHours`

## Completion

Delayed charging no longer pre-discharges and no longer has an intermediate idle-hold phase.

That prior idle bridge is now represented by the separate built-in `Delayed-charge prep` item.

The active delayed-charging item now completes when the battery reaches `100%` charge.

After completion, the daemon restores the fallback strategy from `strategyPlan[0]`, which is currently the default `self-consumption` item.

## What Was Removed

The current implementation no longer uses:

- pre-discharge target SoC calculation
- iterative delayed-charging window solving
- delayed-charging discharging phase
- delayed-charging idle hold before the marker
- completion at low-price-window start

## Evaluation Output

Verbose delayed-charging evaluation should show:

- the low-price marker time
- the marker price
- the resolved activation mode: `self-consumption` or full `charging`
- expected house load at the marker
- predicted solar at the marker
- expected net solar fill power at the marker
- energy needed to reach `100%`
- time to full
- computed lead time
- computed trigger time
- any skip reason

## Strategy Collisions & Precedence

Cross-strategy priority, blocking, and preemption rules are documented in `priority.md`.

For delayed charging specifically:

- `Delayed charging` has higher priority than built-in `Export surplus`
- `Delayed charging` has higher priority than built-in `Delayed-charge prep`
- a higher-priority user schedule can preempt delayed charging
- delayed charging blocks lower-priority items while it remains active

## Status

`Delayed charging` is implemented as an active built-in rule.

The daemon now resolves delayed charging from the low-price marker only, picks either `self-consumption` or full charging from that marker price, starts earlier using the explicit lead-time formula, skips positive-price markers that have no positive net solar fill power, and restores the fallback strategy after the battery reaches `100%`.
