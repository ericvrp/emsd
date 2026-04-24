# Self-Consumption Strategy

## Purpose

`Self-consumption` is the default fallback battery strategy.

It exists so the battery has a safe baseline behavior whenever no scheduled strategy item is active.

## Current Behavior

- always included in the battery strategy plan
- represented by the default plan item
- uses `strategyMode: self-consumption`
- keeps the configured discharge floor, which normally follows the battery's `minimumDischargePercent`
- becomes active again after a scheduled item completes or when the daemon restores the fallback strategy

In daemon logs this is typically described as `self-consumption with a <percent>% discharge floor`.

## Notes

- this is the stable baseline strategy, not an experimental rule
- it is separate from price-triggered built-in rules such as export surplus and delayed charging
