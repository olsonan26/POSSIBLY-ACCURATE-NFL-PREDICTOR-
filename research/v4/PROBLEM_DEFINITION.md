# NFL Edge Engine v4 — Problem Definition

Date: 2026-10-04. Status: INITIAL DESIGN; not implemented or validated.

## Objective

Forecast game outcome distributions from information available at a declared pregame cutoff. Identify repeatable incremental information beyond the contemporaneous market and frozen football control. Preserve the existing ability to predict every supported game. Predicted winner and actionable edge are separate outputs: NO EDGE never means NO PREDICTION.

## Forecast targets

- WIN: home/away/tie probabilities with explicit moneyline settlement semantics.
- MARGIN: integer home-minus-away scoring distribution, including zero and spread pushes.
- TOTAL: combined scoring distribution, including total pushes.
- VOLATILITY: a preregistered tail event probability, not an undefined chaos score.
- MARKET_RESIDUAL: difference from a market snapshot at the same evaluated horizon.
- LINE_MOVEMENT: separate research target requiring actual timestamped quote history.

Upset probability is not interchangeable with volatility. Features require explicit allowed targets; none automatically affects every head. Proposed feature mechanisms remain hypotheses until independently tested.

## Market baseline

Preserve EXP-019 and its original evidence. A new model may use L_ours=logit(P_market)+Delta(x), with a frozen residual specification. Store both quoted prices, book/source, observed time, source-issued time where available, normalization method and horizon. Proportional no-vig conversion is a convention, not proof of true probability. Define tie/settlement conditioning. Never substitute closing odds for an earlier quote. Missing market input means residual unavailable, not a fabricated 50% market.

## Research-program problem

EXP-030 uses 2025 for final variant selection; faulty subgroup diagnostics and inconsistent report artifacts weaken subsequent hypothesis generation. Already-analyzed 2025 and inspected 2026 games are development evidence for newly invented models. Preserve original evidence, but append eligibility corrections. Historical usefulness is not prospective validation.

Model selection must be included in the evaluation procedure. Methodological reference: [Cawley and Talbot, 2010](https://www.jmlr.org/papers/v11/cawley10a.html). This supports selection-bias safeguards, not any NFL performance estimate.

## Research firewall

Use development_backtest, historical_confirmation, prospective_shadow and prospective_champion. Historical confirmation does not imply a globally unseen research-program holdout.

Record experiment ID, immutable version, parent, createdAt, frozenAt, eligibleForwardStart, Git SHA, parameter/source hashes, allowed targets, dependencies, missingness policy, success/failure conditions and minimum sample rationale. No numerical promotion threshold or minimum sample is invented here.

Prospective eligibility requires specification frozen before prediction, durable insertion before kickoff, and all source information available by the evaluated cutoff. A model created after a game is observed cannot count that game as prospective. Post-freeze parameter/feature changes create a new version and future eligibility. Never rewrite original predictions.

## Point-in-time integrity

Record event time, source-issued/available time, retrieval time, feature time, cutoff, target game/kickoff, algorithm version, historical/live status and availability. A timestamp wrapper around season-final aggregates is not a leakage guard. Exclude target-game statistics and require eligible completed prior-game records. Aggregate caches must include cutoff/source revision or cache raw immutable revisions before filtering.

Historical observations are not pregame forecasts. [Open-Meteo historical forecast documentation](https://open-meteo.com/en/docs/historical-forecast-api) describes stitched initial forecast hours; exact earlier-cutoff reconstruction needs appropriate issue/run-specific data.

## Success and rejection

Preregister target, primary metric, same-horizon comparator, population, uncertainty/multiplicity method, practical effect threshold, failure condition and future sample rationale. Report accuracy, Brier, log loss, ECE/bin specification and reliability for win forecasts. Report distributional quality, coverage, margin MAE/RMSE, total errors and push-aware settlement calibration for relevant heads. ROI/CLV claims require actual prices, costs and frozen decisions; they cannot be inferred from quotes never captured.

Compare market-only, football-only, market-plus-football and candidate additions on identical eligible games. Preserve failures and label exploratory slices exploratory. A small p-value, one good week or more Monte Carlo runs never authorizes promotion. Separate sampling noise from parameter, structural and data uncertainty.

Reject candidates without verified pregame provenance or repeatable practically meaningful incremental value. No production astrology contribution is authorized. Preserve authoritative PURE rules and test its outputs separately against market/football controls.

## Compatibility and deployment

Keep legacy prediction contracts initially. Optional v4/research/cache failure must not remove a football prediction. Failed authoritative freezes must show NOT FROZEN / NOT PROSPECTIVE while allowing the prediction to be viewed. Keep database credentials and provider secrets server-side.

Evaluate external managed Postgres through [Vercel Marketplace](https://vercel.com/docs/postgres); no provider is provisioned or selected here. Keep forecasts insert-only and outcomes as separate versioned events. GitHub Actions may perform batch capture/freeze/scoring/reporting, but [official scheduling documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) warns of delayed/dropped schedules. Record actual capture times, reject late freezes and never backdate horizons.

## Controlled stages

1. Finish repository audit.
2. Freeze control fixtures and source revisions.
3. Correct diagnostics in isolated versioned research changes.
4. Add point-in-time guards and feature-target registry.
5. Implement authenticated immutable ledger and separate outcome scoring.
6. Develop and validate simple multi-head/market-residual baselines.
7. Freeze challenger and collect genuinely future shadow evidence.
8. Add side-by-side UI without suppressing existing picks.
9. Run actual install/typecheck/tests/build, Vercel preview and human review.

These stages are not completed by this document.
