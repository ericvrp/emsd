# Solar Prediction Improvements Plan

## Problem Statement

The current solar prediction algorithm uses per-bucket averages of recent days with a ratio-based approach (`generation / forecast`). However:
1. Low forecast days (e.g., 9 W/m²) create extreme outlier ratios (e.g., 57.4) that skew the mean
2. The algorithm is duplicated: exists in `packages/core` AND `apps/web/components/forecast-page.tsx`
3. No threshold filtering to exclude unreliable historical days

## Current Behavior

From database query at 14:45 UTC:
- 7 days of data
- Mean ratio: 12.91 (skewed by outlier)
- Median ratio: 5.22
- Mean without outlier (forecast > 10): 5.49

| Date | Generation (W) | Forecast (W/m²) | Ratio |
|------|----------------|-----------------|-------|
| 2026‑04‑09 | 1323.7 | 401.0 | 3.30 |
| 2026‑04‑10 | 1396.7 | 294.0 | 4.75 |
| 2026‑04‑11 | 516.7 | 9.0 | **57.41** |
| 2026‑04‑12 | 1847.3 | 397.0 | 4.65 |
| 2026‑04‑13 | 1048.6 | 108.0 | 9.71 |
| 2026‑04‑14 | 2600.3 | 498.0 | 5.22 |
| 2026‑04‑15 | 2117.0 | 398.0 | 5.32 |

## Requirements

1. **Forecast threshold**: Exclude days where forecast < 5 W/m²
2. **Outlier removal**: Use Winsorized mean - drop min and max ratios when we have ≥4 valid ratios
3. **Smoothing**: Keep as UI-only concern (separate from core algorithm, like current behavior)
4. **Temporary UI toggle**: Ground light pill toggles new vs old behavior for debugging
5. **Single algorithm**: Move from `forecast-page.tsx` to `packages/core/src/solar-prediction.ts` (like `price-selection.ts`)

## Implementation Plan

### Phase 1: Create New Core Module

**File:** `packages/core/src/solar-prediction.ts`

1. Move helper functions from `packages/core/src/index.ts`:
   - `aggregateSolarGenerationByPeriodStart`
   - `buildTimestampedValueIndex`
   - `findClosestTimestampedValueWithin`

2. Add new options to `buildPredictedSolarGenerationSeries`:
   ```typescript
   interface SolarPredictionOptions {
     maxPrecedingDays?: number;        // Default: 7
     matchToleranceMs?: number;      // Default: 7.5 * 60 * 1000
      minForecastWm2?: number;        // Default: 0 (new: 5)
     useOutlierRemoval?: boolean;      // Default: false (new: true)
   }
   ```

3. Implement outlier removal logic (Winsorized mean):
   - When we have ≥4 valid ratios, drop the lowest and highest ratio before computing mean
   - Sort ratios, remove first and last element, average remaining

### Phase 2: Update tests/core

**File:** `packages/core/src/solar-prediction.test.ts`

Add tests:
- `threshold excludes low forecast days`
- `winsorized mean drops min/max when >= 4 ratios`
- `winsorized mean keeps all when < 4 ratios`

Update existing tests in `packages/core/src/index.test.ts` to use new defaults:
- Test expectations reflect threshold 5 and winsorize enabled

### Phase 3: Update UI to Use New Algorithm

**File:** `apps/web/components/forecast-page.tsx`

1. Import `buildPredictedSolarGenerationSeries` from `@emsd/core` (already imported)
2. Replace local `buildPredictedSolarGenerationSeries` with core version
3. Pass new options:
   ```typescript
   const predictedSolarGeneration = buildPredictedSolarGenerationSeries({
     forecastSamples: archive.solarForecastSamples,
     solarEnergyProviderSamples: archive.solarEnergyProviderSamples,
      minForecastWm2: 5,
     useOutlierRemoval: predictionMode === 'improved',
   });
   ```

### Phase 4: Add Temporary Toggle

**File:** `apps/web/components/forecast-page.tsx`

1. Add state:
   ```typescript
   const [predictionMode, setPredictionMode] = useState<'improved' | 'legacy'>('legacy');
   ```

2. Make ground light pill clickable:
   - Find `LegendChip` for "Solar Forecast" / ground light
   - Add `onClick` handler to toggle mode
   - Visual feedback: show active mode in tooltip or label

### Phase 5: Verification

Steps to verify implementation:

1. **Run core tests:**
   ```bash
   bun test packages/core/src/index.test.ts
   ```

2. **Run solar prediction tests:**
   ```bash
   bun test packages/core/src/solar-prediction.test.ts
   ```

3. **Query database for 14:45 ratios:**
   ```sql
   WITH ratios AS (
     SELECT s.power_w / f.value as ratio, f.value as forecast
     FROM solar_energy_provider_samples s
     JOIN solar_forecast_samples f ON s.site_id = f.site_id AND s.period_start = f.period_start
     WHERE s.site_id = 'eric'
       AND strftime('%H:%M', s.period_start) BETWEEN '14:37' AND '14:52'
       AND f.value > 0
   )
   SELECT
      (SELECT AVG(ratio) FROM ratios WHERE forecast >= 5) as mean_filtered,
      (SELECT AVG(ratio) FROM ratios WHERE forecast >= 5 ORDER BY ratio LIMIT 1 OFFSET 2) as winsorized_mean;
   ```

    Expected: ~12.91 (filtered mean includes outlier), ~5.93 (winsorized)

4. **Visual verification:**
   - Navigate to `/solar` page
   - Toggle ground light pill
   - Compare predicted values

## To-Do List

- [x] Phase 1: Create `packages/core/src/solar-prediction.ts` with new algorithm
- [x] Phase 1: Add `SolarPredictionOptions` interface
- [x] Phase 1: Implement threshold filtering (minForecastWm2)
- [x] Phase 1: Implement Winsorized mean outlier removal
- [x] Phase 2: Create `packages/core/src/solar-prediction.test.ts`
- [x] Phase 2: Update tests in `packages/core/src/index.test.ts`
- [x] Phase 3: Update `forecast-page.tsx` to use core algorithm with options
- [x] Phase 4: Add temporary toggle state for prediction mode
- [x] Phase 4: Make ground light pill clickable for toggle
- [x] Phase 5: Run tests and verify with database query
- [ ] Phase 5: Visual verification on `/solar` page

## Notes

- **Temporary toggle**: Remove after debugging is complete
- **Backward compatibility**: Keep legacy behavior as default initially, then flip to new after verification
- **Smoothing**: Continues to be applied in UI layer, not core algorithm
- **Daemon integration**: The core module can be imported by daemon once `"expected-solar"` trigger is implemented
- **Threshold update**: Changed from 10 W/m² to 5 W/m² after initial verification

## Current Status (2026‑04‑16)

- Core module and tests: ✅
- UI integration with toggle: ✅
- Lint and typecheck: ✅
- Database verification: ✅ (winsorized mean ≈ 5.93)
- Node built‑in import fix: ✅ (updated client components to import from `@emsd/core/client`)
- Visual verification: pending (Next.js build now succeeds; please verify toggle on /solar page)

The improved algorithm is active by default; clicking the “Solar Forecast” legend pill toggles between improved (threshold 5 W/m², Winsorized mean) and legacy (no threshold, simple mean).