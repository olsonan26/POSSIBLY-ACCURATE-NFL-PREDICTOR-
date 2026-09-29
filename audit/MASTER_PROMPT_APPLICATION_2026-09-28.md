# Master NFL Predictor Prompt — Application Audit

Date: 2026-09-28
Branch: `research/master-prompt-governance-v3`

## What was preserved

- `v2.2-validated-current-season` remains the production/control model.
- Historical predictions are not rewritten.
- PURE Astrology and Lettrology remain research-only and have zero production weight.
- Retrospective current-roster/injury leakage remains blocked.
- Existing production UI and deployment architecture are unchanged in this pass.

## What the repository already had

- frozen v2.2 audit documentation
- 2025 validation backtest
- 2026 forward-style observation script
- carryover ablation
- PURE Astrology research and falsification workflows
- live personnel leakage guard
- neutral-site handling
- current-season form reset

## Gaps identified from the master prompt

1. No central feature registry.
2. No central experiment ledger including failed experiments.
3. Main backtest reported accuracy and Brier but not log loss/ECE and the requested chronological split suite.
4. The 2026 v3.2 astrology slate had not been frozen into the repository as a scored forward experiment.
5. Opponent-adjusted efficiency is not yet implemented.
6. No point-in-time historical injury database is available; therefore injury validation must remain limited rather than reconstructed from current rosters.
7. No point-in-time market-line pipeline exists; market data must remain an external future benchmark unless built separately.

## Changes in this branch

### Governance
- Added `research/FEATURE_REGISTRY.md`.
- Added `research/EXPERIMENT_LEDGER.md`.
- Added frozen/scored `research/forward-results/nfl-v3.2-week1-2026.json`.

### Evaluation
- Added `scripts/evaluate-model.ts`.
- Adds accuracy, Brier, log loss, ECE-style calibration error, confidence buckets, and chronological/behavioral splits.
- Splits currently include Weeks 1-4, 5-9, 10-18, home picks, away picks, neutral site, one-score results, blowouts, and confidence tiers.
- Market/favorite and historical-injury splits are deliberately omitted until trustworthy point-in-time sources exist.

### CI
- Added the full evaluation report to `bun run verify` and the Deployment Readiness workflow.

## v3.2 Week 1 forward result

The frozen 15-game v3.2 slate scored 6-9 (40.00%). The Sunday September 13 subset scored 4-9 (30.77%). This is negative forward evidence. v3.2 therefore remains research-only and is explicitly rejected for promotion on this sample.

This result must not be tuned away and then described as untouched validation.

## Next scientifically justified challenger

The next major football challenger should be opponent-adjusted efficiency, built from point-in-time play-by-play features and evaluated chronologically against v2.2. The initial version should be intentionally simple before testing more sophisticated adjustment methods.

Candidate sequence:
1. pregame rolling EPA/play + success rate
2. opponent-adjusted residual or ridge strength
3. passing/rushing offense-vs-defense interactions
4. OL/pass-rush interaction
5. QB value with shrinkage

Each family must be tested independently before any ensemble.

## Promotion rule

No model is promoted from a single accuracy gain. Require a credible combination of accuracy, Brier, log loss, calibration, season consistency, early-season behavior, home/away behavior, and robustness to neighboring parameters/ablations.
