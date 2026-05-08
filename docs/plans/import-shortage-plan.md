# Import Shortage Strategy Plan

## Goal

Add a new built-in battery strategy item named `Import shortage`.

The first version should make the daemon log battery charge and projected solar recovery context when the strategy reaches a low-price trigger point. The purpose is to estimate whether expected solar surplus can fully recharge the battery without additional grid import.

## Product Intent

- built-in item name: `Import shortage`
- type: built-in battery strategy item
- expected role: detect whether a low-price import opportunity is needed because expected solar surplus will not fully recover the battery later in the day
- first runtime behavior: daemon calculation and logging only

## Required Ordering

`Import shortage` should become part of the built-in normalized strategy plan order.

Target built-in order:

1. `Self-consumption`
2. `Export surplus`
3. `Delayed-charge prep`
4. `Delayed charging`
5. `Import shortage`
6. `Solar production control`

Notes:

- `Import shortage` must have higher priority than `Delayed charging`
- `Solar production control` already keeps its own independent execution model and should stay independent
- in the strategy dialog, `Import shortage` should appear before `Solar production control`
- user-added scheduled items should continue to appear after the built-in items

## Priority Model

`Import shortage` is planned as a normal built-in battery strategy item, not an independent sidecar item.

That means the intended future behavior is:

- it participates in the daemon's existing battery strategy priority system
- it can preempt lower-priority built-in battery items when due
- it can itself be preempted by higher-priority user-defined scheduled items
- it should block lower-priority built-in battery items while active

`Solar production control` should remain outside that battery-item priority stack.

## First Version

At each low-price trigger point, the daemon should compute and log whether expected solar surplus later in the day is enough to refill the battery.

Minimum log context:

- add a built-in item key for `import-shortage`
- add a trigger kind for `import-shortage`
- normalize the built-in item into the strategy plan ahead of `Solar production control`
- add a label and description in the strategy UI
- when the trigger is reached, log the current battery charge percentage
- include the battery id and the trigger timestamp in the daemon log message
- keep the item non-invasive: do not change battery mode, do not claim a manual override, and do not alter `Delayed charging` behavior yet
- avoid changing the current `Solar production control` independence model

The log should be emitted only when evaluating a relevant low-price point, so it should normally appear once or twice per day rather than every daemon poll. The message can be comprehensive because it is tied to price-point evaluation, not continuous polling.

## First-Version Calculation

The first implementation should estimate whether the battery can become full from expected solar surplus after the low-price trigger.

Example scenario:

- current time is `03:00`
- the energy price is low, so this is the center trigger for `Import shortage`
- early-spring solar forecast predicts enough production during the day to possibly refill the battery
- expected house load is about `200W`

At the low-price trigger, the daemon should answer these questions:

1. When will the battery start charging again from solar surplus?
2. Until when will solar surplus continue to charge the battery?
3. How much surplus energy is expected during that charging window?
4. How much battery energy will be left when the charging window starts?
5. What battery percentage is expected at the end of the charging window?
6. If the battery does not reach full charge, how large is the import shortage?

The daemon should compute and log these values:

1. Current battery charge at the low-price trigger.
2. The first future time when expected solar generation covers expected house load. This is the expected charging start, for example around `07:00`.
3. The later time when expected solar generation no longer covers expected house load. This is the expected solar-surplus end, often late afternoon or evening.
4. Expected solar generation over that surplus window.
5. Expected house load over that surplus window.
6. Expected surplus energy over that surplus window, calculated from solar generation minus house load.
7. Expected house energy needed from the current trigger time until charging starts.
8. Estimated battery state of charge at the end of the surplus window.
9. Remaining deficit to full charge, expressed as a percentage. For example, if the projected end charge is `80%`, log a `20%` shortage.

The calculation should use the whole remaining day from the low-price trigger. For a `03:00` trigger, that means the daemon should look forward through the day, find when solar first covers house demand, and then continue until solar no longer covers house demand.

If expected solar generation covers the `200W` house load from `07:00` until `20:00`, that `07:00` to `20:00` span is the solar-surplus window. During that window, the daemon should integrate expected solar production and subtract expected house needs. The result is the surplus energy available for charging the battery.

From the `03:00` trigger to the `07:00` charging start, the daemon should also estimate how much house energy must be supplied before solar covers the house load. That expected pre-charge energy use reduces the battery charge available at the start of the solar-surplus window.

With these numbers, the daemon can estimate the battery percentage at the end of the solar-surplus window. If the projected end percentage is `80%`, the daemon should log a `20%` deficit to full charge. That deficit is the import shortage candidate for future versions.

If the surplus estimate reaches full charge before the surplus window ends, the daemon should log the expected full-charge time. It should also log the expected battery state after the battery becomes full and later starts draining again.

The calculation can reuse the existing logic that estimates battery drain percentage and detects when expected solar generation covers house needs.

## Example Log Shape

The exact wording can change, but one comprehensive daemon message should include the calculation inputs and result:

`import-shortage estimate for battery <batteryId>: triggerAt=<time> currentSoc=<percent>% chargeStart=<time> surplusEnd=<time> solarEnergy=<kWh> houseEnergyDuringSurplus=<kWh> surplusEnergy=<kWh> houseEnergyUntilChargeStart=<kWh> projectedEndSoc=<percent>% shortageToFull=<percent>%`

If the battery is expected to become full during the surplus window, include:

`expectedFullAt=<time>`

## Files Likely To Change Later

- `packages/core/src/battery-strategy-shared.ts`
- `packages/core/src/index.ts`
- `apps/daemon/src/index.ts`
- `apps/web/components/battery-strategy-plan-form.tsx`
- related daemon, core, and web tests

## Non-Goals For This Step

- no daemon activation logic
- no battery mode changes
- no automatic import decision
- no shortage-condition enforcement
- no persistence migration beyond what placeholder normalization later requires
- no UI workflow changes beyond built-in item placement
