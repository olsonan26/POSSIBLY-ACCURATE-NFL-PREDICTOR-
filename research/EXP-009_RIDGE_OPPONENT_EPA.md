# EXP-009 — Ridge Opponent-Adjusted EPA

## Status

Research challenger only. Production v2.2 remains frozen and unchanged.

**Manager decision after untouched 2025 confirmation: REJECT FOR PROMOTION.** The locked play-level ridge opponent-adjusted EPA specification was worse than v2.2 on straight-up accuracy, Brier score, and log loss. The frozen 2026 observational sample tied winner accuracy but was also worse on probability quality. The experiment stays in the repository as a recorded failure and source of future hypotheses.

## Hypothesis

Simple opponent-adjusted point differential failed in EXP-006, but that did not prove opponent adjustment itself was useless. EXP-009 tested a stronger approach: estimate offensive and defensive quality **simultaneously at the play level** using regularized EPA.

## Why this is different from EXP-006

EXP-006 adjusted team point differential after games were complete. EXP-009 instead used individual offensive plays and solved offense and defense effects together:

`play EPA = intercept + offense team effect + defense team effect + error`

The model was fit separately for pass plays and rush plays. Ridge regularization shrank noisy team effects toward league average.

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
8. This created **60 preregistered discovery variants**: 3 ridge penalties × 4 ramp rules × 5 weights.
9. Select the complete specification on **2024 Brier score only**, with log loss as tie-breaker.
10. Lock the selected penalty, ramp, and weight before revealing the 2025 confirmation result.
11. Evaluate unchanged on untouched 2025.
12. Observe completed 2026 games without retuning.
13. Run post-confirmation component ablation and neighboring-parameter diagnostics only after the locked result is known.
14. Do not promote automatically.

## Rating construction

For each week and play type, EXP-009 solved one ridge model containing:

- an intercept,
- one offensive team coefficient per team,
- one defensive team coefficient per team.

The team coefficients were ridge-penalized while the intercept was effectively unpenalized.

A positive offensive coefficient means stronger EPA production. A positive defensive coefficient means more EPA allowed and therefore weaker defense.

The matchup edge was built from standardized offensive and defensive coefficients. For the home team, a favorable edge means:

- stronger home offense than away offense,
- weaker away defense than home defense.

Pass and rush edges were averaged in the locked primary specification before applying the early-season ramp and logit weight.

## Leakage firewall

- Same-week completed games were excluded.
- Target-game plays could not enter the target-game ratings.
- No present-day roster or injury information was inserted retrospectively.
- No sportsbook market information was used.
- No astrology or Lettrology information was used.
- Week 1 received zero same-season opponent-adjusted EPA contribution.

## Verified run — 2026-09-29

### Coverage

- 2024 discovery: **272** regular-season games
- 2025 untouched confirmation: **271** games
- 2026 observational sample: **48** completed games
- eligible play-by-play rows: **33,470** in 2024, **32,941** in 2025, **5,829** in 2026

### 2024 discovery lock

The best Brier result among the 60 preregistered variants selected:

- ridge penalty: **25**
- early-season ramp: **CONSERVATIVE**
- matchup logit weight: **0.20**

The conservative ramp applies zero signal in Week 2, then 0.25 / 0.50 / 0.75 in Weeks 3/4/5, reaching full weight from Week 6 onward.

The selected 2024 challenger scored **183/272 = 67.28%**, Brier **0.2066**, log loss **0.6016**, versus the v2.2 control at **181/272 = 66.54%**, Brier **0.2118**, log loss **0.6122**.

This discovery-period improvement did not survive untouched confirmation.

### Untouched 2025 confirmation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **66.42%** (180/271) | **0.2250** | **0.6416** | 0.0840 |
| EXP-009 | 66.05% (179/271) | 0.2276 | 0.6523 | **0.0707** |

Result:

- accuracy delta: **-0.37 percentage points**
- Brier delta: **+0.0026** (worse)
- log-loss delta: **+0.0107** (worse)
- challenger-only correct flips: **4**
- control-only correct flips: **5**
- exact paired p-value: **1.0000**

Calibration ECE improved, but the primary predictive metrics did not.

### 2025 split behavior

- Weeks 1–4: **73.02% → 73.02%**, Brier worse
- Weeks 5–9: **64.79% → 64.79%**, Brier slightly better
- Weeks 10–18: **64.23% → 63.50%**, Brier worse
- actual home winners: **76.71% → 74.66%**
- actual away winners: **54.40% → 56.00%**
- one-score games: **56.94% → 56.94%**, Brier materially worse
- blowouts: **77.08% → 76.04%**, Brier better
- neutral site: **71.43% → 71.43%** on seven games

### Component ablation — diagnostic only

These were examined only after untouched 2025 had been revealed and therefore cannot rescue the experiment retroactively.

- pass EPA ridge edge only: **179/271 = 66.05%**, Brier **0.2273**, log loss **0.6516**, ECE **0.0826**
- rush EPA ridge edge only: **175/271 = 64.58%**, Brier **0.2305**, log loss **0.6596**, ECE **0.0588**

The rush component appears particularly weak in this exact implementation, but that is a future hypothesis only.

### Neighboring-parameter robustness — diagnostic only

- lambda 100: **180/271 = 66.42%**, Brier 0.2273, log loss 0.6517
- lambda 400: **180/271 = 66.42%**, Brier 0.2270, log loss 0.6507
- weight 0.15: **176/271 = 64.94%**, Brier 0.2267, log loss 0.6486
- ramp NONE: **178/271 = 65.68%**, Brier 0.2288, log loss 0.6552
- ramp FAST: **178/271 = 65.68%**, Brier 0.2285, log loss 0.6545
- ramp MODERATE: **179/271 = 66.05%**, Brier 0.2281, log loss 0.6536

No preregistered neighboring setting produced a convincing post-confirmation rescue. These diagnostics are retained only to inform later hypotheses.

### 2026 observational check

With the 2024 parameters still frozen:

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **58.33%** (28/48) | **0.2331** | **0.6602** | **0.1375** |
| EXP-009 | **58.33%** (28/48) | 0.2342 | 0.6631 | 0.1528 |

The forward observation does not support promotion.

## Management conclusion

**REJECT FOR PROMOTION.**

The idea was tested in a materially stronger form than EXP-006: play-level data, simultaneous offense/defense estimation, ridge shrinkage, and a preregistered early-season ramp. It still failed untouched 2025 confirmation and did not improve the current 2026 forward sample.

What we keep from this experiment:

- the evidence that generic same-season opponent-adjusted EPA is not automatically additive to v2.2;
- the signal that pass-only was less harmful than rush-only;
- the evidence that aggressive 2024 discovery improvements can still disappear the next season;
- the requirement that future opponent-adjusted work must be a genuinely new hypothesis rather than post-hoc retuning of EXP-009.

EXP-009 does not enter production, the survivor ensemble, or downstream Monte Carlo.

## Reproduce

```bash
bun run research:ridge-epa
```

Runtime outputs:

- `research/runtime/exp-009.json`
- `research/reports/exp-009.md`
