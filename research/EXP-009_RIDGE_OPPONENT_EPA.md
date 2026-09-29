# EXP-009 — Ridge Opponent-Adjusted EPA

## Status

Research challenger only. Production v2.2 remains frozen and unchanged.

## Hypothesis

Simple opponent-adjusted point differential failed in EXP-006, but that does not prove opponent adjustment itself is useless. A stronger approach is to estimate offensive and defensive quality **simultaneously at the play level** using regularized EPA.

EXP-009 tests whether leakage-safe ridge-regression ratings for passing EPA and rushing EPA add repeatable predictive value beyond v2.2.

## Why this is different from EXP-006

EXP-006 adjusted team point differential after games were complete. EXP-009 instead uses individual offensive plays and solves offense and defense effects together:

`play EPA = intercept + offense team effect + defense team effect + error`

The model is fit separately for pass plays and rush plays. Ridge regularization shrinks noisy team effects toward league average.

## Research contract

1. Use nflverse regular-season play-by-play only.
2. For a target game in Week N, use only plays from Weeks `< N` of that same season.
3. Exclude no-plays, kneels, spikes, the target game, and all same-week games.
4. Fit separate ridge models for pass EPA and rush EPA.
5. Predeclare ridge penalties `25`, `100`, and `400`.
6. Predeclare four early-season ramp functions:
   - `NONE`: full signal from Week 2 onward,
   - `FAST`: 0.50 / 0.75 / 1.00 from Weeks 2/3/4+,
   - `MODERATE`: 0.25 / 0.50 / 0.75 / 1.00 from Weeks 2/3/4/5+,
   - `CONSERVATIVE`: 0 / 0.25 / 0.50 / 0.75 / 1.00 from Weeks 2/3/4/5/6+.
7. Predeclare logit weights `0`, `0.05`, `0.10`, `0.15`, and `0.20`.
8. This creates **60 preregistered discovery variants**: 3 ridge penalties × 4 ramp rules × 5 weights.
9. Select the complete specification on **2024 Brier score only**, with log loss as tie-breaker.
10. Lock the selected penalty, ramp, and weight before revealing the 2025 confirmation result.
11. Evaluate unchanged on untouched 2025.
12. Observe completed 2026 games without retuning.
13. Run post-confirmation component ablation and neighboring-parameter diagnostics only after the locked result is known.
14. Do not promote automatically.

## Rating construction

For each week and play type, EXP-009 solves one ridge model containing:

- an intercept,
- one offensive team coefficient per team,
- one defensive team coefficient per team.

The team coefficients are ridge-penalized while the intercept is effectively unpenalized.

A positive offensive coefficient means stronger EPA production. A positive defensive coefficient means more EPA allowed and therefore weaker defense.

The matchup edge is built from standardized offensive and defensive coefficients. For the home team, a favorable edge means:

- stronger home offense than away offense,
- weaker away defense than home defense.

Pass and rush edges are averaged in the locked primary specification before applying the early-season ramp and logit weight.

## Leakage firewall

- Same-week completed games are excluded.
- Target-game plays are impossible to enter the target-game ratings.
- No present-day roster or injury information is inserted retrospectively.
- No sportsbook market information is used.
- No astrology or Lettrology information is used.
- Week 1 receives zero same-season opponent-adjusted EPA contribution.

## Required evaluation

Primary metrics:

- straight-up accuracy,
- Brier score,
- log loss,
- expected calibration error,
- challenger-only vs control-only correct flips,
- exact paired McNemar/binomial p-value.

Required splits:

- Weeks 1–4,
- Weeks 5–9,
- Weeks 10–18,
- actual home winners,
- actual away winners,
- one-score games,
- blowouts,
- neutral-site games.

## Ablation

After untouched 2025 is revealed, evaluate:

- pass EPA ridge edge only,
- rush EPA ridge edge only.

These are diagnostic only and may not be used to rewrite EXP-009 and still call 2025 untouched.

## Robustness

After confirmation, test:

- alternative preregistered ridge penalties,
- the immediate neighboring logit weight,
- alternative preregistered early-season ramps.

Again, these are diagnostic only.

## Reproduce

```bash
bun run research:ridge-epa
```

Runtime outputs:

- `research/runtime/exp-009.json`
- `research/reports/exp-009.md`
