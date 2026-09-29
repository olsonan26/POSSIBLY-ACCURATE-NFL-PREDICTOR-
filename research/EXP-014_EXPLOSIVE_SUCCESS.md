# EXP-014 — Explosive Play + Success Rate Engine

## Status
Research challenger only. Production v2.2 remains frozen and unchanged.

**Manager decision after untouched 2025 confirmation: REJECT FOR PROMOTION.** The exact locked EXP-014 specification was worse than v2.2 on straight-up accuracy, Brier score, log loss, and calibration. Its frozen 2026 observational sample was also worse. The experiment stays in the repository as a recorded failure and a source of future hypotheses, but it does not enter production.

## Hypothesis
Pregame offense-vs-defense **success-rate** and **explosive-play-rate** matchup features may capture repeatable team quality that aggregate Elo/form and raw box-score efficiency miss.

## Research contract

1. Use nflverse play-by-play only from completed regular-season plays before the target game week.
2. Exclude the target game and all same-week plays from its feature construction.
3. Build separate offense and defense-allowed profiles for pass success, rush success, explosive pass rate, and explosive rush rate.
4. Predeclare four explosive-play threshold families: pass/rush >= 15/10, 20/10, 15/12, and 20/15 yards.
5. For each threshold family test both all eligible pass/rush plays and a garbage-time filter excluding plays with pre-play win probability below 5% or above 95%, when available.
6. Test logit weights `0, 0.05, 0.10, 0.15, 0.20`.
7. This creates **40 preregistered discovery variants**.
8. Select the complete specification on **2024 Brier score only**, with log loss as tie-breaker.
9. Lock thresholds, filtering rule, and weight before looking at 2025 confirmation performance.
10. Evaluate unchanged on untouched 2025, then observe 2026 without retuning.
11. Run component ablation, neighboring-weight/threshold/filter robustness, time splits, close-game/blowout splits, and paired winner flips.
12. Do not promote automatically.

## Leakage firewall

For a target game in Week N, EXP-014 uses only play-by-play from weeks `< N` of that same season. Completed games from the target week are conservatively excluded. The target game's plays can never affect its own prediction.

No sportsbook market information, astrology, Lettrology, current-roster hindsight, or future game information is used.

## Verified run — 2026-09-29

### Coverage

- 2024 discovery: **272** completed regular-season games
- 2025 untouched confirmation: **271** games
- 2026 observational sample at run time: **48** completed games
- eligible play-by-play rows: **33,470** in 2024, **32,941** in 2025, **5,829** in 2026

### 2024 discovery lock

The best Brier score among the 40 preregistered variants selected:

- explosive pass threshold: **20 yards**
- explosive rush threshold: **15 yards**
- garbage-time filter: **OFF**
- matchup logit weight: **0.20**

2024 discovery performance at that frozen setting:

- **187/272 = 68.75%** accuracy
- Brier **0.2068**
- log loss **0.6022**

The v2.2 2024 control was **181/272 = 66.54%**, Brier **0.2118**, log loss **0.6122**. This was a meaningful discovery-period improvement, which made the untouched confirmation especially important.

### Untouched 2025 confirmation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **66.42%** (180/271) | **0.2250** | **0.6416** | **0.0840** |
| EXP-014 | 65.68% (178/271) | 0.2253 | 0.6440 | 0.0885 |

Result:

- accuracy delta: **-0.74 percentage points**
- Brier delta: **+0.0002** (worse)
- log-loss delta: **+0.0024** (worse)
- challenger-only correct flips: **5**
- control-only correct flips: **7**
- exact paired p-value: **0.7744**

The strong 2024 discovery result therefore **did not replicate** on untouched 2025.

### 2025 split behavior

- Weeks 1–4: **73.02% → 71.43%**, Brier worse
- Weeks 5–9: **64.79% → 63.38%**, Brier improved slightly
- Weeks 10–18: **64.23% → 64.23%**, Brier improved slightly
- actual home winners: **76.71% → 76.03%**
- actual away winners: **54.40% → 53.60%**
- one-score games: **56.94% → 56.94%**
- blowouts: **77.08% → 75.00%**
- neutral site: **71.43% → 57.14%** on only seven games

### Component ablation — diagnostic only

These were examined only after untouched 2025 had been revealed, so they may not be used to rescue EXP-014 retroactively.

- remove pass success: **64.94%**, Brier 0.2261, log loss 0.6458
- remove rush success: **65.68%**, Brier 0.2258, log loss 0.6451
- remove pass explosive: **65.31%**, Brier 0.2254, log loss 0.6443
- remove rush explosive: **66.05%**, Brier 0.2250, log loss 0.6440

The least harmful ablation was removing rush explosive rate, but that remains a future hypothesis only.

### Neighboring-parameter robustness — diagnostic only

- weight 0.15: **66.42%**, Brier 0.2248, log loss 0.6422
- locked weight 0.20: **65.68%**, Brier 0.2253, log loss 0.6440
- 15/10 thresholds: **66.05%**, Brier 0.2246, log loss 0.6423
- 20/10 thresholds: **65.31%**, Brier 0.2250, log loss 0.6432
- 15/12 thresholds: **66.05%**, Brier 0.2241, log loss 0.6410
- filter twin of the locked 20/15 configuration: **66.05%**, Brier 0.2256, log loss 0.6451

Some neighboring settings were less bad and occasionally improved probability metrics, but they are **post-confirmation diagnostics** and cannot be reselected after seeing 2025.

### 2026 observational check

With the 2024 parameters still frozen:

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **58.33%** (28/48) | **0.2331** | **0.6602** | **0.1375** |
| EXP-014 | 56.25% (27/48) | 0.2479 | 0.6935 | 0.1515 |

The small forward sample also moves against this exact specification.

## Management conclusion

**REJECT FOR PROMOTION.**

This is exactly why the project keeps a discovery/confirmation firewall. EXP-014 looked materially better in 2024, but the locked version failed untouched 2025 and the current 2026 observation. We do not retune it until it looks good.

Useful lessons retained for later research:

- success/explosive information is not automatically valuable just because it sounds football-relevant;
- the strongest 2024 settings were aggressive and did not generalize;
- the 2025 diagnostics suggest smaller weights and/or different feature decomposition may deserve a future *new* hypothesis, not a rewrite of EXP-014;
- EXP-014 does not enter production, the survivor ensemble, or downstream Monte Carlo unless a separately preregistered successor earns its way back in.

## Reproduce

```bash
bun run research:explosives
```

Runtime outputs:

- `research/runtime/exp-014.json`
- `research/reports/exp-014.md`
