# PURE v3.2 — QB-only falsification result

Date: 2026-09-19

## Decision

**Do not promote QB PURE into production scoring. Keep it as a frozen research-only candidate.**

The pregame starting-QB astrology layer produced a small improvement in probabilistic score (Brier/log loss) in both chronological test windows, but stricter falsification did not establish that the improvement is distinguishable from noise.

No weights, aspects, role definitions, or thresholds should be changed from the 2026 results. Future games are the next evidence.

## Identity / leakage gate

Phase 2B replaces postgame passer-derived QB identity with archived pregame depth-chart identity before calculating the QB layer.

Latest archive coverage during the strict run:

- archived QB depth index: 2,431 legacy team-weeks plus 41,466 timestamped QB rows
- pregame QB identity available for both teams in 1,667 / 1,696 eligible rows (98.3%)
- pregame depth identity differed from the postgame passer identity in hundreds of rows (387 home, 406 away in the strict run)
- NFLverse player master supplied QB birth dates; no birth time was invented

The strict falsification runner also enforces a missing-data symmetry rule: if either side lacks a verified DOB for a role, that entire role contributes a zero-information vector for that game. A known birth date is never compared against an artificial all-zero 'unknown opponent' vector.

## Chronological results

### Forward window A — 2024 test

Training: 2021–2022  
Tuning: 2023  
Testing: 2024

| Model | Accuracy | Brier | Log loss |
|---|---:|---:|---:|
| Football only | 180/272 = 66.18% | 0.2117 | 0.6119 |
| Football + pregame QB PURE | 183/272 = 67.28% | 0.2105 | 0.6098 |

Observed Brier improvement (base − QB): **+0.00121**.

Strict tests:

- 5,000-permutation residual test: **p ≈ 0.1782**
- 10,000 paired bootstrap: **95% CI [-0.00500, 0.00753]**
- bootstrap probability that improvement is non-positive: **≈ 0.3600**

### Forward window B — 2025 primary validation

Training: 2021–2023  
Tuning: 2024  
Testing: 2025

| Model | Accuracy | Brier | Log loss |
|---|---:|---:|---:|
| Football only | 180/271 = 66.42% | 0.2243 | 0.6399 |
| Football + pregame QB PURE | 175/271 = 64.58% | 0.2230 | 0.6380 |

Observed Brier improvement (base − QB): **+0.00127** while winner accuracy declined.

Strict tests:

- 5,000-permutation residual test: **p ≈ 0.1836**
- 10,000 paired bootstrap: **95% CI [-0.00493, 0.00735]**
- bootstrap probability that improvement is non-positive: **≈ 0.3527**

### Pooled 2024 + 2025

- observed mean Brier improvement: **+0.00124**
- 10,000 paired bootstrap: **95% CI [-0.00314, 0.00569]**
- bootstrap probability that improvement is non-positive: **≈ 0.2833**
- n = 543 games

The direction is interesting, but the interval includes zero by a wide enough margin that the layer has not earned production influence.

## 2026 observation

Through the locked observation cutoff of 2026-09-14:

- football only: 10/16, Brier 0.2200
- football + pregame QB PURE: 10/16, Brier 0.2234

This is only 16 games and is explicitly **not** used for retuning.

## What failed

The larger astrology combinations are not supported by the current tests. In particular, the full Phase 2 stack materially degraded 2025 performance; its strict-run 2025 residual permutation result was p ≈ 0.760. Franchise PURE also worsened 2025 Brier and accuracy.

Coach astrology is not interpretable yet because verified DOB coverage is sparse. It should not be judged or promoted from the current coach test.

## Frozen prospective rule

For future testing:

1. Keep the QB feature definition, aspects, orb, regularization grid, and pregame identity source frozen.
2. Record predictions before games are played.
3. Do not use 2026 outcomes to change the QB formula while evaluating it.
4. Re-evaluate only after a materially larger untouched prospective sample exists.
5. Promotion requires repeatable incremental improvement over the football baseline, not a visually interesting small sample.

This preserves the potentially useful signal without contaminating the production predictor or turning retrospective patterns into rules.
