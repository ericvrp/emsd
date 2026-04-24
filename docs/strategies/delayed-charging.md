# Delayed Charging Strategy

## Purpose

`Delayed charging` is the built-in price-aware solar capture rule.

Its purpose is to keep enough empty battery capacity available for daytime low-price periods where exporting solar would earn little, almost nothing, or could even cost money.

## Intended Behavior

For now, delayed charging only handles daytime low-price periods.

The intended flow is:

1. Determine when the daytime low-price period starts.
2. Determine when the daytime low-price period ends.
3. Estimate how much net battery charge can be gained during that period from excess solar.
4. Compute the battery charge level we want at the start of that period so the battery can end the period as full as possible.
5. Before the low-price period starts, discharge down to that target level if needed.
6. If the battery has already reached that target level before the low-price period starts, stop pre-discharging and stay idle.
7. When the low-price period starts, switch to `self-consumption` so excess solar charges the battery naturally.
8. When the low-price period ends, return to the normal strategy flow.

## Net Charge Estimate

The expected battery fill opportunity during the low-price period should be based on:

`expected net charge = expected solar charge - expected site energy needs`

This means the strategy should estimate how much solar energy is likely to remain available for battery charging after household demand is covered during the same low-price window.

That expected net charge then determines how much empty capacity the battery should have at the start of the low-price period.

The provisional start threshold (pre-discharge target floor) is the battery's backup reserve plus 10%. The battery should not be discharged below this level in anticipation of solar charging.

## Design Goal

The goal is not to charge from the grid during the low-price period.

The goal is to enter the low-price period with enough battery headroom that excess daytime solar can refill the battery as much as possible by the end of that period.

## Strategy Collisions & Precedence

If two or more strategy items overlap or become due at the same time, the tie-breaking rule is: **higher-indexed items always overrule lower-indexed items**.

The built-in strategy array order is:
- **Index 0:** `Self-consumption` (default fallback)
- **Index 1:** `Export surplus`
- **Index 2:** `Delayed charging`
- **Index 3+:** User-added manual schedule items

Because `Delayed charging` (Index 2) is higher than `Export surplus` (Index 1), it will natively overrule an active `Export surplus` strategy if their times overlap (e.g., if a morning export opportunity clashes with the start of a delayed charging window). In turn, user-added schedule items (Index 3 or higher) will overrule both built-in rules.

## Scope For Now

- only daytime low-price periods are considered
- the strategy depends on expected solar being available during that period
- the pre-discharge target is based on expected net solar surplus during the low-price window
- once the battery reaches the desired start level, it should wait rather than continue discharging
- the provisional start threshold is the battery backup reserve plus 5%

## Status

`Delayed charging` is still under construction.

The built-in rule remains disabled by default until the low-price window definition and runtime behavior are finalized and validated.

Do not treat the current daemon behavior or `bun run dynamic-price-target:evaluate` output for delayed charging as final product behavior.
