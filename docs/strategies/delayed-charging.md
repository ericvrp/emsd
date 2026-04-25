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
7. When the low-price period starts, cancel the delayed-charging item and switch back to the default `self-consumption` item so excess solar charges the battery naturally.
8. The delayed-charging item itself ends at the low-price period start; the battery then follows the normal default strategy flow during the rest of the window.

## Net Charge Estimate

The expected battery fill opportunity during the low-price period should be based on:

`expected net charge = expected solar charge - expected site energy needs`

This means the strategy should estimate how much solar energy is likely to remain available for battery charging after household demand is covered during the same low-price window.

That expected net charge then determines how much empty capacity the battery should have at the start of the low-price period.

The provisional start threshold (pre-discharge target floor) is the battery's backup reserve plus 10%. The battery should not be discharged below this level in anticipation of solar charging.

## Minimum Time To Full Charge

Before resolving the final low-price window, delayed charging should estimate how long the battery would need to charge from the expected SoC at the start of the low-price window to full.

This value is provisionally called `minimumTimeToFullCharge`.

The calculation is:

`energyToFullWh = capacityWh * ((100 - lowPriceWindowStartSocPercent) / 100)`

`minimumTimeToFullChargeHours = energyToFullWh / effectiveChargePowerW`

For example, if the battery capacity is 6 kWh and the battery is expected to be at 20% when the low-price window starts, then 80% remains to be charged:

`energyToFullWh = 6000 Wh * 0.80 = 4800 Wh`

If the effective charge power is 2400 W:

`minimumTimeToFullChargeHours = 4800 Wh / 2400 W = 2 hours`

This value is not a command to charge from the grid. It is used to estimate how wide the relevant low-price search window should be around the low-price marker once the strategy has determined the SoC it expects to have at the start of that window.

`effectiveChargePowerW` is resolved from the strategy item's configured manual power when present, otherwise from the battery's configured maximum charge power.

## Low-Price Window Detection

Delayed charging starts from a low-price marker. The marker is the point price selection identifies as the local low price.

The strategy should then derive a low-price window around that marker instead of treating the marker itself as the full window.

The window detection flow is:

1. Estimate the expected net charge opportunity in the candidate low-price window.
2. Compute the pre-discharge target SoC at the actual low-price window start.
3. Compute `minimumTimeToFullCharge` from that low-price-window-start SoC.
4. Build a potential low-price window around the marker:

`potentialWindowStart = lowPriceMarkerTime - minimumTimeToFullCharge`

`potentialWindowEnd = lowPriceMarkerTime + minimumTimeToFullCharge`

5. Resolve the lowest price at the marker.
6. Define a low-price threshold:

`lowPriceThreshold = lowestPrice + lowPriceMargin`

7. Starting from `potentialWindowStart`, scan forward through price samples to find the boundary where prices first become higher than `lowPriceThreshold` before the marker-side low-price region.
8. Starting from `potentialWindowEnd`, scan backward through price samples to find the boundary where prices first become higher than `lowPriceThreshold` after the marker-side low-price region.
9. The actual low-price window is the region between those two threshold boundaries.

This creates an asymmetric, non-fixed window centered around the low-price marker. The low-price marker can be closer to the beginning or end of the actual low-price window depending on the price curve.

## Low-Price Margin

`lowPriceMargin` should not be a fixed currency amount.

Fixed margins age poorly: if energy prices increase significantly, a static value like a few cents becomes meaningless relative to the current market spread.

Instead, `lowPriceMargin` should be derived from the normalized energy price provider output. The intended first rule is:

`lowPriceMargin = normalizedImportExportSpread * 3.0`

For the current Tibber price source, the normalized import/export spread is represented by the provider's configured export deduction. If that value is `0.13 EUR/kWh`, the delayed-charging low-price margin is:

`lowPriceMargin = 0.13 EUR/kWh * 3.0 = 0.39 EUR/kWh`

So the margin would be about 39 cents per kWh.

The important property is that the margin scales with the normalized provider economics rather than being a hard-coded amount. If provider prices or tariff spreads change materially, the delayed-charging low-price window expands or contracts in proportion to that configured spread.

If a future install supports battery-specific import/export economics, the margin should use the spread that applies to the battery being evaluated. Until then, the site-level normalized price source spread is the source of truth.

The derived low-price window then drives delayed charging behavior:

- the pre-discharge target is the SoC we want at `actualLowPriceWindowStart`
- the battery should discharge only as late as necessary to reach that target by `actualLowPriceWindowStart`
- at `actualLowPriceWindowStart`, the daemon should complete the delayed-charging item and restore the default `self-consumption` strategy
- the battery is expected to refill naturally from excess solar during the actual low-price window
- by `actualLowPriceWindowEnd`, the strategy expects the battery to be as full as practical based on the net solar opportunity

## Evaluation Verbose Output

The dynamic price target evaluation script should expose enough detail to review the delayed-charging window calculation, including the potential low-price window used before the actual low-price window is tightened.

For delayed charging, verbose output should include:

- the low-price marker time
- the lowest price at that marker
- the normalized import/export spread used for `lowPriceMargin`
- the computed `lowPriceMargin`
- `minimumTimeToFullCharge`
- the potential low-price window start and end
- the actual low-price window start and end
- the price at the start edge of the actual low-price window
- the price at the end edge of the actual low-price window
- the computed pre-discharge target SoC at the actual low-price window start
- the computed latest feasible pre-discharge start time

## Start Time

The delayed-charging start time is not defined by a preceding `export-surplus` or other high-price marker.

Instead, once the low-price period start and the desired battery level at that moment are known, the daemon should compute the latest feasible pre-discharge start time that still allows the battery to reach that level before the low-price period begins.

In practice this means the start time should be derived from:

- the low-price period start time
- the battery's current SoC
- the desired SoC at the low-price period start
- the effective available discharge power

The intent is:

- if the battery is already at or below the desired pre-discharge level, do not start pre-discharging and simply wait
- if the battery is above that level, start discharging only as late as necessary to arrive at the desired level by the low-price period start
- never discharge below the provisional start threshold of backup reserve plus 10%

## Design Goal

The goal is not to charge from the grid during the low-price period.

The goal is to enter the low-price period with enough battery headroom that excess daytime solar can refill the battery as much as possible by the end of that period.

## Strategy Collisions & Precedence

Cross-strategy priority, blocking, and preemption rules are documented in `priority.md`.

For delayed charging specifically:

- `Delayed charging` has higher priority than built-in `Export surplus`
- a higher-priority user schedule can preempt delayed charging
- delayed charging blocks lower-priority items while it remains active

## Scope For Now

- only daytime low-price periods are considered
- the strategy depends on expected solar being available during that period
- the pre-discharge target is based on expected net solar surplus during the low-price window
- the low-price window is derived from the low-price marker and `minimumTimeToFullCharge`, then tightened using `lowestPrice + lowPriceMargin`
- once the battery reaches the desired start level, it should wait rather than continue discharging
- the provisional start threshold is the battery backup reserve plus 10%
- `lowPriceMargin` is derived from the normalized import/export spread using the current factor of 300%
- `effectiveChargePowerW` comes from the strategy item's configured manual power or the battery's maximum charge power

## Status

`Delayed charging` is implemented as an active built-in rule.

The daemon uses the documented low-price window calculation, pre-discharge target, latest feasible pre-discharge start time, idle hold after the target is reached early, and default-strategy handoff at the start of the low-price window. `bun run dynamic-price-target:evaluate` exposes the same calculation details through its verbose output.
