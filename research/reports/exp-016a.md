# EXP-016A — Long-History Play-by-Play Architecture Benchmark

Status: **REJECT as a standalone replacement; retain methodology findings for future shadow-model research**

Production `v2.2-validated-current-season` is unchanged.

## Why this experiment exists

EXP-016A independently reproduced the useful architecture concepts identified in `Damepivot/nfl-game-model` instead of copying its predictions or code. The purpose was to test whether long-history play-by-play ratings, cross-season quarterback form, early-season priors, delayed opponent adjustment, and a margin-first target could solve the weak 2026 Weeks 1–3 behavior seen in v2.2.

Because 2025 and the first three weeks of 2026 had already been inspected elsewhere in this project, neither season was used to select EXP-016A parameters.

## Data and firewall

- **845,276** eligible regular-season pass/run plays processed from nflverse, seasons **2000–2026**.
- **3,698** completed regular-season feature rows from 2012–2026.
- Model training: **2012–2018** — 1,785 games.
- Margin-alpha validation: **2019–2022** — 1,050 games.
- Retrospective architecture benchmark: **2023–2025** — 815 games.
- 2026 observational scoring: **48 games**.
- 2025 and 2026 selected **no** architecture parameter.

## Architecture reproduced

1. Raw and ridge opponent-attributed offense/defense ratings from play-by-play.
2. EPA/play, pass EPA, rush EPA, success rate, explosive rate, and QB-hit-or-sack pressure rate.
3. Fixed team-effect ridge penalty of **400**.
4. Separate offense/defense season-to-season carryover fitted only through target season 2022.
5. Current/prior blend `n/(n+6)` using actual games already played.
6. Weeks 1–3 use raw current-season ratings; Week 4 uses 50/50 raw + opponent-adjusted; Week 5+ uses opponent-adjusted ratings.
7. Starting-QB rolling **16 prior games**, crossing season boundaries, using EPA/dropback, CPOE and sack avoidance.
8. Standardized ridge regression predicts scoring margin first.
9. Win probability is derived from the predicted margin distribution and a zero-intercept calibration slope fit only from pre-holdout out-of-sample predictions.

## Season-to-season persistence found

The long-history data independently reproduced the external repository's central persistence finding: offense carries over materially better than defense.

| Rating | Carryover slope | Year-to-year r | Team-seasons |
|---|---:|---:|---:|
| Overall EPA offense | **0.469** | **0.472** | 704 |
| Overall EPA defense | **0.317** | **0.321** | 704 |
| Pass EPA offense | **0.472** | **0.475** | 704 |
| Pass EPA defense | **0.297** | **0.300** | 704 |
| Protection pressure allowed | **0.496** | **0.485** | 704 |
| Defensive pressure generated | **0.332** | **0.326** | 704 |

This validates the *structural insight* that prior offense and defense should not automatically be carried forward at the same rate.

## Margin-model selection

Only 2019–2022 was allowed to select the ridge penalty.

| Alpha | Validation MAE | Validation RMSE |
|---:|---:|---:|
| 30 | 10.244 | 13.204 |
| 100 | 10.235 | 13.189 |
| 300 | 10.228 | 13.175 |
| **1000** | **10.225** | 13.177 |
| 3000 | 10.287 | 13.269 |
| 10000 | 10.541 | 13.587 |

Locked margin alpha: **1000**.

The pre-holdout out-of-sample calibration slope was **1.194** from **2,325** games.

## 2023–2025 architecture benchmark

Overall:

- **527/815 = 64.66%** winner accuracy
- Brier **0.2225**
- Log loss **0.6353**
- ECE **0.0368**
- Margin MAE **10.136**
- Margin RMSE **13.053**

By season:

| Season | Accuracy | Brier | Log loss | ECE | Margin MAE |
|---|---:|---:|---:|---:|---:|
| 2023 | 175/272 = 64.34% | 0.2279 | 0.6484 | 0.0677 | 10.202 |
| 2024 | 187/272 = **68.75%** | 0.2101 | 0.6085 | 0.0828 | 9.927 |
| 2025 | 165/271 = **60.89%** | 0.2295 | 0.6491 | 0.0662 | 10.278 |

The 2024 result looked strong, but it did not generalize into 2025. This is exactly why the multi-season firewall mattered.

## 2025 direct comparison with production v2.2

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| **v2.2 control** | **180/271 = 66.42%** | **0.2250** | **0.6416** | 0.0840 |
| EXP-016A | 165/271 = 60.89% | 0.2295 | 0.6491 | **0.0662** |

EXP-016A calibrated probabilities somewhat more evenly, but it lost **15 net winners** and worsened both Brier and log loss. It therefore does not qualify as a replacement for v2.2.

## 2026 observational comparison

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| **v2.2 control** | **28/48 = 58.33%** | **0.2331** | **0.6602** | **0.1375** |
| EXP-016A | 26/48 = 54.17% | 0.2568 | 0.7046 | 0.1757 |

### Weeks 1–3

| Week | v2.2 | EXP-016A |
|---:|---:|---:|
| 1 | **10/16 = 62.50%** | 9/16 = 56.25% |
| 2 | **9/16 = 56.25%** | 8/16 = 50.00% |
| 3 | 9/16 = 56.25% | 9/16 = 56.25% |

The architecture therefore **did not fix the observed early-2026 weakness**. It made Weeks 1 and 2 worse and tied Week 3.

## What survived the test

The standalone forecast is rejected, but several findings are useful and were learned from a genuinely broad historical sample:

- Offense persistence is materially higher than defense persistence.
- Pass-offense persistence is especially stronger than pass-defense persistence.
- Protection/pressure on the offensive side persists more strongly year-to-year than defensive pressure.
- A 16-game cross-season QB history is operationally feasible with the available nflverse player data.
- A margin-first architecture can achieve roughly 10.1-point MAE and strong calibration without relying on market data.
- A visually impressive single season (2024 at 68.75%) can fail badly the following year, reinforcing the need for multi-season and prospective validation.

These findings may inform a later ensemble/shadow challenger, but they cannot be used to retrospectively rewrite EXP-016A or tune it against 2025/2026.

## Decision

**REJECT EXP-016A AS A STANDALONE V3 SHADOW REPLACEMENT.**

Do not put this architecture's standalone probability into production. Do not tune it to rescue 2025 or the already-observed 2026 Weeks 1–3.

The next research decision should preserve v2.2 and test whether genuinely independent survivor signals add incremental value to it across older walk-forward seasons, rather than replacing a stronger control with the weaker standalone architecture.
