# EXP-011 — Dynamic Prior-Season Shrinkage

## Status

Research challenger only. Production `v2.2-validated-current-season` remains frozen and unchanged.

**Manager decision after untouched 2025 confirmation: REJECT FOR PROMOTION.**

The full offense+defense prior-season carryover specification did not improve straight-up accuracy, Brier score, or log loss on untouched 2025. Its frozen 2026 observational sample tied winner accuracy but materially worsened probability quality. The experiment stays in the repository as a permanent failed experiment and source of future hypotheses.

## Hypothesis

Early-season NFL estimates have very little current-season information. Rather than discarding the prior season completely, a regressed carryover signal might stabilize Weeks 1–4 while fading automatically as current-season games accumulate.

The tested blend was conceptually:

`current_weight = games_played / (games_played + K)`

`blended_metric = current_weight * current_metric + (1 - current_weight) * retained_prior_metric`

Previous-season values were first shrunk toward the previous-season league mean by the preregistered retention factor.

## Data and features

Data source: nflverse weekly team statistics.

The challenger used prior-game information only:

- offensive passing EPA per dropback,
- offensive rushing EPA per carry,
- defensive passing EPA allowed per dropback,
- defensive rushing EPA allowed per carry.

For each target week, current-season profiles used weeks strictly before the target week. Previous-season regular-season profiles were allowed because they necessarily predated the target game.

The resulting team efficiencies were standardized across teams and converted to a home-minus-away edge, then applied as a logit adjustment to the frozen v2.2 probability.

## Leakage firewall

- The target game's statistics never enter its own prediction.
- Same-week target information is excluded from current-season profiles.
- No present-day roster or injury information is inserted retrospectively.
- No sportsbook market data is used.
- No astrology or Lettrology data is used.
- 2025 was not used to choose the locked specification.
- 2026 is observational only and cannot be used to rescue the experiment.

## Preregistered 2024 discovery grid

The experiment tested **135 variants**:

- offense shrinkage K: `2`, `4`, `6`
- defense shrinkage K: `3`, `6`, `9`
- previous-season retention: `0.50`, `0.75`, `1.00`
- logit weight: `0`, `0.05`, `0.10`, `0.15`, `0.20`

Selection rule: lowest 2024 Brier score, with log loss as tie-breaker.

## Locked specification

Before revealing 2025, discovery selected:

- offense K: **2**
- defense K: **3**
- prior-season retention: **0.50**
- logit weight: **0.20**

2024 control performance was **181/272 = 66.54%**, Brier **0.2118**, log loss **0.6122**, ECE **0.0602**.

## Untouched 2025 confirmation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **66.42%** (180/271) | **0.2250** | **0.6416** | 0.0840 |
| EXP-011 | 66.05% (179/271) | 0.2267 | 0.6500 | **0.0786** |

Results:

- accuracy delta: **-0.37 percentage points**
- Brier delta: **+0.0016** — worse
- log-loss delta: **+0.0084** — worse
- challenger-only correct flips: **7**
- control-only correct flips: **8**
- exact paired p-value: **1.0000**

Lower ECE alone is not sufficient to save a model that worsened the other primary metrics.

## Early-season objective

EXP-011 specifically aimed to improve early-season forecasting. It did not achieve that objective as a locked full specification.

- Week 1: **75.00% → 75.00%**, Brier delta **-0.0226**
- Week 2: **81.25% → 81.25%**, Brier delta **-0.0022**
- Week 3: **68.75% → 62.50%**, Brier delta **+0.0169**
- Week 4: **66.67% → 60.00%**, Brier delta **+0.0080**
- Weeks 1–4 combined: **73.02% → 69.84%**, accuracy delta **-3.17 points**

The prior helped probability quality in Weeks 1–2, then became harmful in Weeks 3–4 under the locked decay schedule.

## Other 2025 splits

- Weeks 5–9: **64.79% → 67.61%**, Brier improved by **0.0020**
- Weeks 10–18: **64.23% → 63.50%**, Brier worsened by **0.0044**
- one-score results ≤8: **56.94% → 57.64%**, but Brier worsened by **0.0079**
- blowouts ≥14: **77.08% → 75.00%**, Brier improved by **0.0036**
- neutral site: accuracy unchanged at **71.43%** on seven games

The mixed split behavior is not robust enough for promotion.

## Post-confirmation ablation — diagnostic only

These tests were run only after 2025 was opened. They can generate future hypotheses but cannot be used to retune EXP-011 and call the result untouched.

- offense-only: **175/271 = 64.58%**, Brier **0.2291**, log loss **0.6525**, ECE **0.0838**
- defense-only: **180/271 = 66.42%**, Brier **0.2235**, log loss **0.6403**, ECE **0.0646**
- pass-only: **180/271 = 66.42%**, Brier **0.2256**, log loss **0.6484**, ECE **0.0938**
- rush-only: **174/271 = 64.21%**, Brier **0.2313**, log loss **0.6602**, ECE **0.0731**

### Important future hypothesis

The **defense-only** carryover is the notable clue. It tied v2.2's 2025 straight-up accuracy while improving Brier, log loss, and ECE.

That is **not** a valid EXP-011 rescue because it was discovered after 2025 confirmation. It may only be tested later as a new preregistered experiment on a different untouched period or proper multi-season walk-forward design.

## Neighboring-parameter diagnostics

The locked model was not robustly rescued by nearby parameters. Examples:

- offense K=1: **66.05%**, Brier 0.2267, log loss 0.6497
- offense K=4: **66.42%**, Brier 0.2268, log loss 0.6507
- defense K=1: **66.05%**, Brier 0.2265, log loss 0.6492
- defense K=6: **66.05%**, Brier 0.2270, log loss 0.6510
- retention 0.25: **65.68%**, Brier 0.2265, log loss 0.6491
- retention 0.75: **66.05%**, Brier 0.2269, log loss 0.6509
- weight 0.15: **66.79%**, Brier 0.2258, log loss 0.6464
- weight 0.25: **65.68%**, Brier 0.2278, log loss 0.6545

The apparent 66.79% at post-confirmation weight 0.15 is explicitly quarantined. It cannot be selected after observing 2025.

## 2026 observational check

The original locked 2024 parameters were kept unchanged.

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **58.33%** (28/48) | **0.2331** | **0.6602** | 0.1375 |
| EXP-011 | **58.33%** (28/48) | 0.2464 | 0.6911 | **0.1123** |

The tied winner accuracy does not offset the much worse probability quality.

## Management conclusion

**REJECT FOR PROMOTION.**

The combined prior-season offense+defense carryover did not generalize. It especially failed the intended Weeks 1–4 accuracy objective after good Week 1–2 probability behavior broke down in Weeks 3–4.

What survives as knowledge rather than production code:

1. blunt prior-season carryover is not automatically beneficial;
2. offense carryover was especially weak in the post-confirmation ablation;
3. defense-only carryover is a promising future hypothesis, but must be tested from scratch on untouched evidence;
4. the timing/decay function matters, because Week 1–2 behavior differed sharply from Week 3–4;
5. production v2.2 remains unchanged.

## Reproduce

```bash
bun run research:priors
```

Runtime outputs:

- `research/runtime/exp-011.json`
- `research/reports/exp-011.md`
