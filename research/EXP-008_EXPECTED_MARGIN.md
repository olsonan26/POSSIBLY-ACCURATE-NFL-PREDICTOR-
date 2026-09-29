# EXP-008 — Expected Margin Engine

## Status
Research challenger only. Production v2.2 remains frozen and unchanged.

**Manager decision after the untouched 2025 confirmation:** retain EXP-008 as a probability/calibration research component, but **do not promote it as the straight-up winner model**. It improved Brier, log loss, and calibration, but reduced winner accuracy and corrected zero games that v2.2 missed.

## Hypothesis
Predicting a continuous pregame estimate of `home score - away score` first, then converting that margin into a win probability through a discovery-only residual distribution, may retain more information than direct winner classification.

## Research contract

1. Build leakage-safe historical snapshots from the existing v2.2 pregame feature pipeline.
2. Fit ridge coefficients on 2023 regular-season games.
3. Use 2024 as the discovery season to select the ridge penalty by **margin MAE only**.
4. Estimate the margin residual standard deviation on 2024 discovery data.
5. Lock both the ridge penalty and residual sigma before looking at 2025 confirmation metrics.
6. Refit the frozen specification on 2023+2024 and evaluate 2025 untouched.
7. Refit through 2025 using the same frozen specification for a 2026 observational check.
8. Run frozen-parameter ablations, neighboring-lambda robustness diagnostics, paired winner comparison, and descriptive failure clusters.
9. Do not promote automatically.

## Features
The first version intentionally stays simple and auditable. It uses only leakage-safe components already present in the frozen football control:

- base Elo logit
- current-season/recent form logit adjustment
- venue/home-road logit adjustment
- same-venue H2H logit adjustment

No betting-market information, astrology, Lettrology, or future game information is used by the EXP-008 challenger.

## Margin-to-probability mapping
For each predicted margin `m`, the challenger maps the result to home-win probability with the 2024 discovery residual distribution:

`P(home wins) = NormalCDF(m / sigma)`

The residual sigma is frozen before the 2025 confirmation season.

## Verified run — 2026-09-29

Historical snapshot populations:

- 2023: 272 games
- 2024: 272 games
- 2025: 271 games
- 2026 observational sample at run time: 48 completed regular-season games

### 2024 discovery lock

The preregistered ridge grid was `0, 0.01, 0.1, 1, 10, 100` and selection used 2024 margin MAE only.

- selected lambda: **100**
- frozen residual sigma: **13.342 points**
- 2024 discovery MAE at the selected lambda: **10.368 points**
- 2024 discovery RMSE: **13.366 points**

The selected lambda landed on the upper boundary of the preregistered grid. That is recorded as a robustness warning; the grid is not extended after seeing 2025.

### Untouched 2025 confirmation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **66.42%** | 0.2250 | 0.6416 | 0.0840 |
| EXP-008 expected margin | 64.94% | **0.2240** | **0.6384** | **0.0396** |

EXP-008 margin error:

- MAE: **10.283 points**
- RMSE: **12.980 points**

Paired winner comparison:

- EXP-008 correct / control wrong: **0**
- control correct / EXP-008 wrong: **4**
- exact paired p: **0.1250**

So EXP-008 improved probability quality and calibration, but lost **1.48 percentage points** of straight-up accuracy.

### 2025 split findings

- Weeks 1–4: tied control at 73.02% accuracy
- Weeks 5–9: EXP-008 60.56% vs control 64.79%
- Weeks 10–18: EXP-008 63.50% vs control 64.23%
- actual away winners: EXP-008 51.20% vs control 54.40%
- one-score games: EXP-008 55.56% vs control 56.94%
- blowouts: EXP-008 76.04% vs control 77.08%

### Frozen ablation diagnostics

These are diagnostics only and are **not** used to retune EXP-008 after 2025 was revealed.

- removing base Elo dropped accuracy to 64.21%
- removing current form dropped accuracy to 64.58%
- removing venue left accuracy at 64.94% while slightly improving Brier/log loss
- removing H2H raised accuracy to 66.05% and slightly improved probability metrics

The H2H/venue observations become future hypotheses only; they are not retroactively used to rescue EXP-008.

### 2026 observational check

At 48 completed games:

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | 58.33% | **0.2331** | **0.6602** | 0.1375 |
| EXP-008 | 58.33% | 0.2342 | 0.6612 | **0.0853** |

EXP-008 again showed better calibration but did not improve winner accuracy.

## Management conclusion

**Keep the expected-margin architecture, but do not replace v2.2 with this version.** The margin-first idea is still potentially useful as:

- a calibrated secondary probability model,
- an input to later Monte Carlo work,
- a target that can be improved by stronger QB, EPA, explosive-play, and personnel features,
- a future ensemble member only if it contributes unique out-of-fold value.

For the user's primary objective — straight-up winner accuracy — this exact EXP-008 specification is **not a promotion candidate**.

## Primary evaluation

- straight-up accuracy
- Brier score
- log loss
- expected calibration error (ECE)
- margin MAE
- margin RMSE
- paired correct/wrong flips against v2.2

## Splits

- Weeks 1–4
- Weeks 5–9
- Weeks 10–18
- actual home winners
- actual away winners
- one-score games (<= 8 points)
- blowouts (>= 14 points)

## Ablations
The script removes each feature family one at a time while keeping the chosen ridge penalty and residual sigma frozen.

## Robustness
The selected ridge penalty and its immediate neighboring candidate penalties are evaluated on 2025 only as diagnostics. 2025 is never used to reselect the penalty.

## Decision labels

- `KILL`
- `INCONCLUSIVE`
- `PROMISING`
- `SURVIVES FOR REPLICATION`

The runtime script labels the probability-quality result `PROMISING` because two of three probability metrics improved. The management decision above is stricter for straight-up winner promotion.

## Reproduce

```bash
bun run research:margin
```

Runtime outputs are written to:

- `research/runtime/exp-008.json`
- `research/reports/exp-008.md`
