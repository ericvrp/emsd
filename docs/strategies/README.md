# Battery Strategies

Battery strategy behavior is daemon-owned.

This section documents the built-in strategy types that appear in the battery strategy plan UI:
- `self-consumption.md`
- `export-surplus.md`
- `delayed-charging.md`

Current built-in strategy status:
- `Self-consumption`: normal fallback behavior
- `Export surplus`: active built-in rule
- `Delayed charging`: active built-in rule

The shared dynamic target estimator used by strategy items with `targetMethod: auto` is documented separately in `../scripts/dynamic-price-target.md`.

Use the strategy documents as the product-facing explanation of what each rule means.
Use `../scripts/dynamic-price-target.md` as implementation documentation for the shared estimator and evaluation script that currently support those rules.
