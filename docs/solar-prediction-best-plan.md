# Solar Prediction Best-Version Plan

## Purpose

Define the next plan for taking the solar prediction algorithm from the current ratio-based heuristic to the strongest version that fits this codebase and product architecture.

This is a planning document only.

## Current State

The current implementation is a useful short-term baseline:

- it lives in `packages/core/src/solar-prediction.ts`
- it uses recent-day matching by time bucket
- it scales forecast irradiance by historical generation-to-forecast ratios
- it supports threshold filtering and optional outlier handling
- it is used by the web app for visualization today

This is a good start, but it is still a heuristic model with several limitations:

- it uses one simple ratio family rather than a calibrated site model
- it does not handle clipping, shading windows, or inverter saturation well enough
- it does not produce confidence bands
- it does not separate offline evaluation from user-facing display logic strongly enough
- the current code and docs describe "Winsorized mean", but the implementation is currently a trimmed mean and should be corrected

## Goal

Produce the best practical EMSD solar prediction stack for one-household installs by:

- improving prediction accuracy across seasons and weather regimes
- keeping the algorithm server-side and daemon-owned, with reusable shared code where needed
- making quality measurable with repeatable backtests
- keeping the web app as a viewer, not the owner of prediction logic

## Product And Architecture Rules

- Prediction logic should live in shared or server-side code, not client components.
- The daemon should own forecast execution and persistence.
- The web app may visualize results and diagnostics, but should not become the source of truth.
- The first production target remains one household and one site at a time.

## Recommended Direction

## 1. Correct the current baseline first

Before building a better model, fix the baseline so improvements are measured against a correct reference.

- Replace the current trimmed-mean implementation with actual winsorization if that is the intended method.
- Add asymmetric-ratio test cases so trimmed vs winsorized behavior cannot regress silently.
- Remove the temporary UI debugging toggle from the product path.

## 2. Add an evaluation harness before algorithm expansion

The next step should not be more heuristics first. It should be measurement.

Add a server-side evaluation harness that can backtest prediction quality over historical data.

Recommended outputs:

- MAE
- RMSE
- MAPE or weighted percentage error
- bias
- peak-period error
- day-total energy error
- separate metrics for clear, mixed, and overcast days

Recommended comparisons:

- current legacy ratio model
- corrected robust-ratio model
- new calibrated models

This should become the decision framework for prediction changes.

## 3. Build a calibrated site model instead of a pure ratio model

The strongest next improvement is to stop treating all buckets as raw ratios and instead estimate site output from forecast inputs using a site calibration model.

Recommended model shape:

- input features:
  - forecast GHI
  - recent measured production context
  - cloud opacity if available
  - air temperature if useful
  - recent-match bucket distance within the rolling history window
- output:
  - predicted power in watts per bucket

Use a simple interpretable model family:

- piecewise linear calibration over recent matched buckets
- or ridge regression / regularized linear model over recent matched buckets
- plus explicit clipping to observed inverter/site maxima

This is still lightweight enough for Bun/TypeScript and much stronger than a single mean ratio.

## 4. Keep recent-day matching as the primary geometry signal

The strongest part of the current approach is that matching against the last 7 days already captures most of the important local geometry implicitly:

- solar position changes only modestly over a 7-day window
- panel orientation is naturally baked into measured production
- recurring local shading patterns are also partially baked into recent history

That means the next version should keep recent-day matching as the primary signal rather than replacing it with an explicit seasonal model.

Recommended direction:

- continue using recent matching windows as the base predictor
- improve weighting and calibration around those recent matches

Why:

- it preserves the main advantage of the current design
- it stays simple and site-specific
- it avoids overfitting to broad seasonal assumptions when fresh local data is available

## 5. Model site-specific nonlinear effects

The best usable version should explicitly handle the common household effects that break linear ratio models.

Recommended behavior:

- inverter clipping at peak production
- morning/evening shading windows
- low-light noise floor
- stale forecast suppression when forecast values are effectively zero

Implementation approach:

- derive a site max output from measured history
- clamp predictions to realistic site maximum
- optionally learn per-time-window adjustment factors for recurring shading patterns

## 6. Predict energy and uncertainty, not only instantaneous power

The daemon should have expected energy availability, not only point power.

Recommended outputs:

- per-bucket power prediction
- day-total predicted energy
- confidence band per bucket
- confidence band for day-total energy

Confidence can begin simply:

- percentile bands from historical residuals for similar conditions

This is more useful than a single deterministic line.

## 7. Keep prediction execution server-side and daemon-owned

Prediction execution should be produced server-side and persisted by the daemon when needed.

Recommended lifecycle:

- `packages/core`: pure prediction and evaluation helpers
- daemon: run predictions, cache results, persist snapshots if needed
- web app: read and display prediction outputs and diagnostics

## Phased Plan

### Phase 1: Baseline correction and test hardening

- Correct winsorization behavior.
- Add asymmetry-focused unit tests.
- Add fixtures with outliers, clipping, low-light, and missing periods.

### Phase 2: Backtesting and metrics

- Add a reusable evaluation module in shared or server-side code.
- Add scripts or EMS commands for running prediction backtests on local history.
- Produce comparison metrics by day and by bucket.

### Phase 3: Calibrated model v1

- Implement a site calibration model on top of recent-day matching.
- Prefer recent-match weighting and robust local calibration over broad seasonal features.
- Add inverter max clipping.
- Compare against the corrected robust-ratio baseline.

### Phase 4: Regime-aware improvements

- Separate clear, mixed, and poor-light behavior.
- Add residual-based confidence bands.
- Add shading-window corrections when the evaluation data supports them.

### Phase 5: Server ownership

- Move production prediction execution out of the web page path.
- Expose predictions and diagnostics via server-owned contracts.
- Remove temporary UI debugging controls that no longer belong in the product.

## Recommended Validation Dataset

Use local historical data segmented by:

- season
- clear days
- partly cloudy days
- overcast days
- high-production clipping days
- sparse-data days

Minimum comparison views:

- per-bucket power error
- day-total energy error
- midday peak error
- false optimism during low-light periods

## Practical Acceptance Criteria

A new prediction version is better only if it wins on backtests, not because it looks smoother.

Minimum acceptance bar:

- lower MAE and RMSE than the corrected current baseline
- lower day-total energy error on most weeks tested
- no worse behavior on low-light and missing-data cases
- all logic remains reusable outside the web app

## Recommendation

The plan is:

1. fix the current baseline so it matches the intended robust-statistics method
2. add a proper backtest harness
3. build a calibrated site model on top of recent-day matching
4. add inverter clipping, shading handling, and uncertainty bands
5. move prediction execution fully into daemon-owned server-side flow

That path is more likely to produce a genuinely better predictor than continuing to tune the current ratio heuristic in place.
