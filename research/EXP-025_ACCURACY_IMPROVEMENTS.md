# EXP-025: Accuracy Improvement Integration

## Hypothesis

Integrating EPA per play (with garbage-time filtering), weather data, travel distance, dynamic HFA, divisional matchup adjustments, and preseason win total priors into the production model will improve winner accuracy beyond the current v2.2 baseline of 66.42% on 2025.

## Background

The current production model (v2.2) uses only game-level statistics (Elo, win/loss, point differential, venue context, H2H, personnel). Six EPA experiments were conducted in research (EXP-007 through EXP-014) but none were promoted to production. The market-aware shadow (EXP-019) showed 67.16% accuracy on 2025 but remains a shadow lane.

This experiment integrates play-level efficiency metrics and situational context that the production model currently lacks.

## New Feature Modules

### Tier 1 — Highest Impact

| Module | File | Data Source | Logit Weight | Evidence |
|---|---|---|---|---|
| EPA per play + garbage-time filter | `services/epaService.ts` | nflverse play-by-play | 0.15 (locked from EXP-007) | EXP-007: 67.90% on 2025 |
| Weather data | `services/weatherService.ts` | Open-Meteo Archive API | 0.03 (wind) + 0.02 (precip) | Published research: +0.8pp from garbage-time alone |
| Travel distance + time zones | `services/travelService.ts` | `data/stadiumCoordinates.ts` | 0.02 (travel) + 0.02 (tz) | Published: 2-4pp for 3+ tz eastward |
| Market-aware promotion | `services/marketAwareService.ts` (existing) | nflverse moneylines | 0.75 market / 0.25 model (locked) | EXP-019: 67.16% on 2025, Brier 0.2137 |

### Tier 2 — Moderate Impact

| Module | File | Data Source | Logit Weight | Evidence |
|---|---|---|---|---|
| Dynamic HFA | `services/dynamicHfaService.ts` | nflverse historical games | varies (0.7x-1.3x multiplier) | HFA declining league-wide |
| Divisional adjustments | `services/divisionalService.ts` | `data/divisionMap.ts` | 0.03 (home underdog) | Market inefficiency documented |
| Preseason win total priors | `services/preseasonPriorsService.ts` | `data/preseasonWinTotals.ts` | 0.30/0.15/0.05 by phase | Early-season Elo stabilization |
| Pace metrics | `services/paceMetricsService.ts` | nflverse weekly stats | 0.02 | Game flow prediction |

### Tier 3 — Advanced

| Module | File | Data Source | Logit Weight | Evidence |
|---|---|---|---|---|
| Special teams EPA | `services/specialTeamsService.ts` | nflverse play-by-play | 0.03 | 15-20% of scoring |
| Turnover expectation | `services/turnoverExpectationService.ts` | nflverse play-by-play | 0.02 | Turnover regression to mean |
| Multi-model ensemble | `services/ensembleService.ts` | v2.2 + market + EPA | configurable | Published: +0.5-1.0pp over best single |

### Structural

| Module | File | Purpose |
|---|---|---|
| Walk-forward validation | `scripts/walk-forward-validation.ts` | 5+ season rolling validation |
| Stadium coordinates | `data/stadiumCoordinates.ts` | Travel calculation |
| Division map | `data/divisionMap.ts` | Divisional matchup detection |
| Preseason win totals | `data/preseasonWinTotals.ts` | 2026 win total priors |

## Integration Plan

### Phase 1: Wire features into validatedPredictionService.ts

Each new service returns a logit edge (or null). The production model sums all logit edges into the final home probability:

```
logit(p_final) = logit(p_elo) + football_adj + venue_adj + personnel_adj + h2h_adj
  + epa_adj + weather_adj + travel_adj + dynamic_hfa_adj + divisional_adj
  + preseason_prior_adj + pace_adj + special_teams_adj + turnover_adj
```

All new adjustments default to 0 when data is unavailable. This ensures backward compatibility — if a feature fails to load, the model behaves exactly as v2.2.

### Phase 2: Market-aware promotion

The existing `marketAwareService.ts` already computes the 75% market blend. Promote it from shadow to production by:
1. Displaying the market-aware prediction as the primary pick
2. Keeping the pure-football v2.2 prediction as a secondary lane
3. Using the market-aware blend when moneylines are available
4. Falling back to the enhanced v2.2 (with Tier 1-3 features) when moneylines are missing

### Phase 3: Validation

1. Run walk-forward validation across 2020-2025
2. Confirm that the integrated model improves over v2.2 on the untouched 2025 season
3. If accuracy improves, promote to production
4. If not, ablate features individually to identify which help and which hurt

## Pre-declared weights

All logit weights are pre-declared before evaluating on 2025:

- EPA matchup efficiency: **0.15** (locked from EXP-007)
- Weather (wind >15mph): **0.03**
- Weather (precip >0.1in): **0.02**
- Travel (log miles): **0.02**
- Time zone change: **0.02**
- Divisional home underdog: **0.03**
- Preseason prior: **0.30/0.15/0.05** (by phase)
- Pace: **0.02**
- Special teams: **0.03**
- Turnover expectation: **0.02**
- Dynamic HFA: **0.7x-1.3x** multiplier on 55 Elo base

These weights cannot be reselected after evaluating on 2025.

## Leakage guards

- EPA calculations use only plays from games with `gameday < targetIso`
- Same-week and target-game plays are excluded
- Weather data uses the game date (historical, not forecast) — acceptable because weather is pregame information
- Travel is deterministic from stadium coordinates
- Preseason win totals are published before Week 1
- Divisional matchups are determined by the NFL schedule
- All features fail closed (return 0 edge) when data is unavailable

## Expected outcome

Based on published research and the existing experiment results:

| Model | Expected 2025 Accuracy | Expected Brier |
|---|---|---|
| v2.2 control | 66.42% | 0.2250 |
| v2.2 + EPA | ~67.9% | ~0.2243 |
| v2.2 + EPA + weather + travel | ~68.5% | ~0.2220 |
| v2.2 + all Tier 1-2 features | ~69-70% | ~0.2180 |
| Market-aware blend on top | ~70-71% | ~0.2100 |

These are estimates based on published feature contributions. Actual results may differ due to feature interactions and the specific implementation.
