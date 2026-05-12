# Strategy Priority

## Purpose

Battery strategy plan items are ordered by array index.

That order is the daemon's priority rule for activation, preemption, and blocking.

## Rule

- higher-index items have higher priority than lower-index items
- index `0` is the default fallback strategy
- only one non-default scheduled item may be active at a time

## Activation Behavior

When no non-default item is active, the daemon scans the enabled scheduled items from highest index to lowest index and activates the first item that is due and allowed to start.

This means that if multiple items are due in the same poll cycle, the highest-index due item wins.

## Active Item Behavior

When a non-default item is already active:

- lower-index items are blocked and cannot activate
- same-index replacement does not apply because the active item already owns that slot
- higher-index items may still activate

If a higher-index item becomes due while a lower-index item is active, the daemon cancels the lower-index active item in the same poll cycle and immediately applies the higher-index item.

This also means a lower-index item can never activate as long as a higher-index item is still active.

## Built-In Order

The built-in normalized strategy order is:

1. `Self-consumption` at index `0` as the default fallback
2. `Export surplus` at index `1`
3. `Delayed-charge prep` at index `2`
4. `Delayed charging` at index `3`
5. `Import shortage` at index `4`
6. `Solar production control` at index `5`

`Import shortage` is after `Delayed charging`, so it has higher battery-strategy priority when it is active or due.

`Solar production control` is kept in the normalized built-in order for persistence and UI consistency, but it runs as an independent sidecar behavior rather than a normal battery activation item.

User-added scheduled items appear after the built-in items and therefore have higher priority than the built-in non-default battery rules.

## Delayed Charging Example

If `Export surplus` is active and `Delayed-charge prep` becomes due, prep does not cut export short. The daemon waits for export completion and then activates prep.

If `Delayed-charge prep` is active and `Delayed charging` becomes due, `Delayed charging` wins because its index is higher.

If a user-added evening discharge item is active, `Export surplus` and `Delayed charging` are both blocked until that user item completes or until an even higher-index item preempts it.

## Implementation Notes

The daemon enforces this rule in `apps/daemon/src/index.ts` during scheduled strategy evaluation.

The daemon:

- keeps the current active item if no higher-priority candidate is ready
- looks only at higher-index items for preemption while an item is active
- scans from highest to lowest index when selecting a new item with no active override
