# EXP-016A — Long-History Play-by-Play Architecture Benchmark

## Purpose

Test whether a Damepivot/nfl-game-model-inspired architecture materially improves this project's football forecast without changing production `v2.2-validated-current-season`.

This experiment is motivated by the weak 2026 opening sample and by an external architecture built from nflverse play-by-play. Because 2025 and 2026 Weeks 1–3 have already been inspected in this project, neither is described as a pristine untouched research-process holdout. The firewall below prevents using either season to choose EXP-016A parameters.

## External architecture source

Reference: `Damepivot/nfl-game-model` (public GitHub repository).

Concepts reproduced independently, not copied as code:

1. play-level offense and defense ratings,
2. pass/rush EPA, success, explosive-play and pressure/protection components,
3. separate season-to-season carryover for offense and defense,
4. current-season/prior-season shrinkage with `w = n / (n + 6)`, where `n` is games already played,
5. 16-game quarterback history crossing season boundaries,
6. raw current-season ratings in Weeks 1–3 and opponent-adjusted ratings introduced beginning Week 4,
7. ridge regression on expected scoring margin,
8. win probability derived from the margin distribution,
9. chronological validation rather than random train/test splitting.

## Data

- nflverse play-by-play CSV releases: regular-season pass/run plays.
- nflverse weekly player statistics: quarterback EPA/CPOE/protection history.
- nflverse/nfldata `games.csv`: game results, rest, named starting quarterbacks, venue/neutral-site information.

Legacy franchise abbreviations are normalized through the predictor's canonical team registry before joins.

## Rating construction

For each season and each entering week, use **only prior weeks from that same season**.

For each target below, produce both raw team means and ridge opponent-adjusted offense/defense effects:

- EPA/play,
- passing EPA/play,
- rushing EPA/play,
- success rate,
- explosive-play rate (`EPA > 1.0`),
- QB-hit-or-sack rate on dropbacks (protection/pass-rush interaction).

Ridge team-effect penalty is fixed at **400** from the external architecture. EXP-016A will not tune it against 2025 or 2026.

### Early-season opponent-adjustment rule

Fixed before scoring:

- Weeks 1–3: raw current-season team ratings only.
- Week 4: 50/50 raw and opponent-adjusted current-season ratings.
- Week 5+: opponent-adjusted current-season ratings.

This is deliberately different from EXP-009, which tried to make opponent adjustment work as a direct logit add-on.

## Prior-season carryover

For every offense/defense component, fit the linear carryover slope of season `N` rating to season `N+1` rating using seasons whose target season is no later than **2022**.

This means offense and defense are allowed to persist differently rather than sharing one hand-set retention rate.

For a target game:

`current_weight = games_played / (games_played + 6)`

`blended_rating = current_weight * current_season_rating + (1-current_weight) * carried_prior_rating`

Week 1 therefore uses the carried prior almost entirely; current-season evidence gradually takes over.

## Quarterback feature

For the named starter, use a rolling **16 prior-game** profile crossing season boundaries:

- passing EPA per dropback,
- CPOE,
- sack avoidance.

No target-game quarterback statistics are included. Historical starter identity comes from the game row and is therefore documented as an availability approximation rather than perfect archival pregame starter certainty.

## Margin model

Features are home-minus-away differentials of blended offense/defense components plus quarterback and basic pregame situation terms.

Model family: standardized ridge regression predicting `home_score - away_score`.

Candidate margin penalties, selected on validation only:

- 30
- 100
- 300
- 1000
- 3000
- 10000

Selection metric: validation margin MAE, then RMSE as tie-breaker.

Win probability is derived from predicted margin using the normal residual distribution. A one-parameter, zero-intercept calibration slope may be fit on pre-holdout out-of-sample probabilities; it cannot move the 50% midpoint.

## Chronological firewall

- Team-rating history: as far back as the available long-history PBP feed permits.
- Model training: **2012–2018**.
- Model/alpha validation: **2019–2022**.
- Retrospective architecture benchmark: **2023–2025**.
- 2026: observational prospective-style scoring only; no parameter selection.

After the 2023–2025 benchmark is measured, the already-locked architecture may be refit through 2025 and used to score 2026. No 2026 result may alter any parameter.

## Required outputs

1. Count of eligible play-by-play rows processed and seasons covered.
2. Fitted offense/defense carryover slopes and correlations.
3. Validation results for every candidate ridge penalty.
4. Locked 2023–2025 margin MAE/RMSE, winner accuracy, Brier, log loss and ECE.
5. 2025 side-by-side against production v2.2.
6. Frozen 2026 overall and Week 1/2/3 side-by-side against v2.2.
7. Per-game 2026 shadow predictions and misses written to machine-readable JSON.
8. Failure-family summary for 2026 misses.
9. Explicit decision: `REJECT`, `KEEP FOR RESEARCH`, or `V3-SHADOW CANDIDATE`.

## Promotion rule

EXP-016A does **not** directly replace v2.2. Even a strong retrospective result becomes a shadow candidate first. A production change requires prospective replication after the architecture is frozen.
