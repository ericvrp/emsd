# Price Selection

## Low-Price Markers

Low-price markers identify cheap import-price opportunities for the UI, local API, and low-price battery strategies.

The low marker algorithm uses a centered 4-hour moving average:

1. Sort valid import-price samples by `periodStart`.
2. For each sample, average the prices from 2 hours before through 2 hours after that sample.
3. Treat the sample time as the midpoint marker for that 4-hour average.
4. Keep candidates whose average is meaningfully lower than nearby averages on both sides.
5. When candidates are closer than 4 hours, keep the candidate with the lowest average. If averages tie, keep the earliest candidate.

The minimum average-price improvement is currently `0.005 EUR/kWh`. This avoids low markers caused by tiny price noise while still allowing broad or flat cheap valleys to produce a marker.

This means a flat midday low can produce one low marker even when no single price sample is strictly lower than its neighbors.

## Multiple Markers

Multiple low-price markers can exist on the same local day when cheap periods are separated by at least 4 hours and each period is meaningfully cheaper than its surrounding prices.

## High-Price Markers

High-price markers still use strict local high selection from the shared price-selection path. Export-surplus behavior should be reviewed separately before changing high marker selection.
