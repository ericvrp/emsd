# Delayed Charging Strategy

## Status

`Delayed charging` is under construction.

The current implementation is not correct yet, and the built-in rule remains disabled by default for that reason.

Do not treat the current daemon behavior or `bun run dynamic-price-target:evaluate` output for delayed charging as final product behavior.

## What Exists In Code Today

The current code path contains an experimental implementation for the built-in `triggerKind: delayed-charging` rule:
- the normalized built-in item is created disabled
- it is persisted as a manual charging item with `targetMethod: auto`
- the current runtime logic may reinterpret that auto item into a pre-discharge flow
- the current estimator uses the next local low-price marker as a horizon and may derive an earlier trigger from a preceding export-surplus marker

These details are useful as implementation notes only. They do not describe a validated or correct final strategy.

## Documentation Intent

For now, delayed charging should be documented primarily as:
- unfinished
- disabled by default
- still being corrected and validated

When the strategy behavior is fixed, this document should be updated to describe the intended user-facing rule rather than the current experimental implementation.
