# Master NFL Predictor Prompt — Application Audit

Date: 2026-09-28

## Preserved control

- `v2.2-validated-current-season` remains the production/control model.
- Historical predictions were not rewritten.
- PURE Astrology and Lettrology remain research-only with zero production weight.
- Retrospective current-roster/injury leakage remains blocked.
- Production UI behavior and production prediction weights were not changed in this pass.

## Governance/evaluation added

- `research/FEATURE_REGISTRY.md`
- `research/EXPERIMENT_LEDGER.md`
- frozen/scored `research/forward-results/nfl-v3.2-week1-2026.json`
- `scripts/evaluate-model.ts` with accuracy, Brier, log loss, ECE-style calibration, week/home-away/neutral/close/blowout/confidence splits
- CI coverage for typecheck, build, baseline backtest, full evaluation, research challengers, and 2026 forward-style check

## Frozen v3.2 astrology forward result

The 15-game Week 1 v3.2 slate scored **6-9 (40.00%)**. The Sunday September 13 subset scored **4-9 (30.77%)**. This is negative prospective evidence. v3.2 remains research-only and is rejected for production promotion on this sample.

## EXP-006 — simple opponent-adjusted point differential

Five weights were selected only on 2024; Brier selected **0.03**. On untouched 2025:

- Control v2.2: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**
- Challenger: **179/271 = 66.05%**, Brier **0.2259**, log loss **0.6448**

Verdict: **REJECT FOR PROMOTION**. It looked better in discovery and failed confirmation, so it was not retuned on 2025.

## EXP-007 — offense-vs-defense matchup efficiency

Uses prior-week nflverse team data only:

- passing EPA/dropback matchup
- rushing yards/carry matchup
- protection/sack-rate matchup
- ball-security/turnover matchup

2024 Brier selected a frozen **0.15** matchup logit weight before 2025 was revealed.

Untouched 2025:

- Control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**
- Challenger: **184/271 = 67.90%**, Brier **0.2243**, log loss **0.6412**
- Accuracy delta: **+1.48 percentage points**
- Brier delta: **-0.0007**
- Log-loss delta: **-0.0004**

Neighboring-weight diagnostics after confirmation:

- 0.10: **67.53%**, Brier 0.2243, log loss 0.6405
- 0.15: **67.90%**, Brier 0.2243, log loss 0.6412
- 0.20: **67.16%**, Brier 0.2247, log loss 0.6428

Ablation showed that the improvement is not uniformly distributed across components. Removing ball security eliminated the winner-accuracy gain; removing protection degraded probability quality. Removing passing or rushing did not reduce winner accuracy in this one observed test, so those observations are hypothesis-generating only and cannot be used to retune 2025.

Split behavior also showed concentration: Weeks 5–9 improved most and control-home picks improved, while control-away picks did not.

Paired winner discordance was 9 games fixed versus 5 games broken. Exact two-sided McNemar/binomial **p = 0.4240**, so the apparent gain is not statistically established.

Verdict: **KEEP FOR RESEARCH — NOT PROMOTED**. Required next evidence is broader walk-forward replication and genuine future observations once enough 2026 prior-week data exist.

## Calibration finding

The expanded 2025 evaluation measured ECE **0.0804** and exposed non-monotonic confidence behavior. Probability calibration is therefore a justified separate research target, but it has not been silently applied to production.

## Remaining source/data gaps

- no trustworthy point-in-time historical injury database has yet been integrated
- no point-in-time historical market-line pipeline has yet been integrated
- full opponent-adjusted EPA/success-rate play-by-play work remains a separate future challenger from EXP-006
- OL/pass-rush, weather, QB-value shrinkage, and roster continuity remain future independent feature families

## Current decision

The master prompt has changed the **research process** immediately, not the production winner formula prematurely. v2.2 remains the control while challengers must earn promotion through chronological, leakage-safe evidence.
