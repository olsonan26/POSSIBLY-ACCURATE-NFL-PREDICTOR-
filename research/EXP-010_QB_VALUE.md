# EXP-010 — QB EPA + CPOE Value Engine

## Status
Research challenger only. Production v2.2 remains frozen and unchanged.

## Hypothesis
A leakage-safe rolling quarterback value signal built from **EPA per dropback, CPOE, sack avoidance, and quarterback rushing EPA** contains predictive information that the current team-level control does not fully capture.

## Research contract

1. Use nflverse weekly player statistics.
2. Reconstruct each historical game's named starting QB from the existing `games.csv` `home_qb_name` / `away_qb_name` fields.
3. For the target game, use **only QB performance from earlier NFL weeks**. Same-week and same-game performance are excluded.
4. Build rolling profiles using candidate windows of 4, 8, and 16 QB games.
5. Shrink small samples toward the contemporaneous league average with candidate priors of 100, 200, and 400 dropbacks.
6. Convert the home-vs-away starting-QB value difference into a logit adjustment with candidate weights `0, 0.05, 0.10, 0.15, 0.20`.
7. Select the complete specification using **2024 Brier score only**, with log loss as a tie-breaker.
8. Lock the selected window, prior, and weight before revealing the 2025 confirmation result.
9. Evaluate unchanged on 2025, then observe 2026 without retuning.
10. Run component ablations, neighboring-parameter robustness, starter-change splits, cold-start splits, and paired winner testing.
11. Do not promote automatically.

This creates **45 preregistered discovery variants**: 3 windows × 3 shrinkage priors × 5 QB weights.

## QB signal

The first version uses four equally represented components after leakage-safe empirical standardization:

- passing EPA per dropback,
- passing CPOE,
- sack avoidance / protection outcome,
- quarterback rushing EPA per carry.

Each QB profile is regressed toward the league environment based on the amount of prior history available.

## Starter identity and leakage

The schedule's QB-name fields are used only to identify the QB whose **prior** performance should be queried. The target game's QB statistics are never allowed into the target game's profile.

This experiment deliberately excludes same-week completed games as well. That is conservative, but prevents subtle chronological leakage between games in the same NFL week.

## Important limitation: named backup value

EXP-010 v1 measures the **starting-QB-to-starting-QB value delta**. It does **not** claim to know the historically correct QB2 from a present-day depth chart.

A named starter-vs-backup replacement delta is deferred until the project has a validated point-in-time personnel/depth-chart layer. That is preferable to fabricating historical backup identity. The later EXP-013 personnel stage is the planned home for that extension.

## Evaluation

Primary metrics:

- straight-up accuracy,
- Brier score,
- log loss,
- expected calibration error,
- paired correct/wrong flips vs v2.2.

Required splits:

- Weeks 1–4,
- Weeks 5–9,
- Weeks 10–18,
- starter-change games,
- stable-starter games,
- cold-start / low-history quarterbacks,
- established QBs,
- one-score games,
- blowouts,
- neutral-site games.

## Ablation

At the frozen selected parameters, remove each component independently:

- EPA,
- CPOE,
- protection/sack avoidance,
- rushing.

The 2025 ablations are diagnostic only. They may create future hypotheses but may not be used to reselect EXP-010 and call it untouched validation.

## Robustness

After the locked 2025 result is known, evaluate neighboring weight, rolling-window, and shrinkage settings as **diagnostics only**.

## Reproduce

```bash
bun run research:qb
```

Runtime outputs:

- `research/runtime/exp-010.json`
- `research/reports/exp-010.md`
