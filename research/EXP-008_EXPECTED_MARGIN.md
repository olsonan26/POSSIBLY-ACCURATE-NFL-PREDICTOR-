# EXP-008 — Expected Margin Engine

## Status
Research challenger only. Production v2.2 remains frozen and unchanged.

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

A separate explicit promotion decision would still be required before any production change.

## Reproduce

```bash
bun run research:margin
```

Runtime outputs are written to:

- `research/runtime/exp-008.json`
- `research/reports/exp-008.md`
