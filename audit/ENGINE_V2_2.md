# NFL Predictor v2.2 — Current-season reset

Date reviewed: 2026-09-19

## Change from v2.1

v2.2 changes only the recent-form / home-road context at NFL season boundaries: prior-season games receive zero weight in those short-horizon form features. Long-horizon Elo and generic same-venue H2H history remain available, so the model does not forget team history entirely.

The purpose is to prevent last season's late-form profile from being treated as if it were current form at the start of a new season.

## Selection protocol

The reset rule was evaluated on 2024 **before** inspecting 2025 as the confirmation season. The predeclared selection criterion for the carryover ablation was Brier score on 2024.

2024:

| Variant | Accuracy | Brier | Log loss |
|---|---:|---:|---:|
| v2.1 cross-season recent form | 182/272 = 66.91% | 0.2128 | 0.6138 |
| current-season reset | 180/272 = 66.18% | **0.2118** | **0.6122** |

The reset therefore passed the predeclared 2024 Brier gate, although raw winner accuracy was 0.74 percentage points lower.

## 2025 confirmation

2025 was not used to choose the reset rule.

| Variant | Accuracy | Brier | Log loss |
|---|---:|---:|---:|
| v2.1 cross-season recent form | 177/271 = 65.31% | **0.2245** | **0.6400** |
| current-season reset | **180/271 = 66.42%** | 0.2250 | 0.6415 |

The result is **mixed**, not a universal improvement:

- winner accuracy improved by **+1.11 percentage points** (three additional correct winners)
- Brier worsened by **0.0005**
- log loss worsened by **0.0015**

For a binary winner-prediction product, v2.2 retains the preselected reset because the later season improved the primary practical outcome (correct winner decisions) and the probability-score deterioration was small. This should not be described as improving every validation metric.

## 2026 observation

Through the locked observation cutoff of 2026-09-14:

| Variant | Accuracy | Brier | Log loss |
|---|---:|---:|---:|
| v2.1 cross-season recent form | 9/16 = 56.25% | 0.2244 | 0.6407 |
| current-season reset | 10/16 = 62.50% | 0.2200 | 0.6307 |

This sample is only 16 games and is observational. It must not be used to retune the rule.

## Production interpretation

v2.2 is a **winner-accuracy-oriented** refinement with a documented calibration tradeoff. It is not evidence that current-season reset is categorically superior on all scoring rules.

The following remain research-only and cannot change the production winner:

- numerology
- PURE Astrology, including the currently interesting QB-only research signal
- rest adjustment

No matchup-specific exceptions are permitted.

## Revisit rule

Continue to record prospective results. If a larger untouched sample shows the season-reset rule consistently degrades probability quality without preserving winner accuracy, reconsider it as a fixed architectural choice rather than tuning it game-by-game.
