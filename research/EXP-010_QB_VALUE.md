# EXP-010 — QB EPA + CPOE Value Engine

## Status
Research challenger only. Production v2.2 remains frozen and unchanged.

**Manager decision after untouched 2025 confirmation: KEEP FOR RESEARCH, do not promote.** The locked QB layer did not improve straight-up accuracy in 2025, but it improved Brier score, log loss, and calibration. Its frozen 2026 observational sample is also mildly encouraging, but too small to justify promotion.

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

This created **45 preregistered discovery variants**: 3 windows × 3 shrinkage priors × 5 QB weights.

## QB signal

The first version used four equally represented components after leakage-safe empirical standardization:

- passing EPA per dropback,
- passing CPOE,
- sack avoidance / protection outcome,
- quarterback rushing EPA per carry.

Each QB profile was regressed toward the league environment based on the amount of prior history available.

## Starter identity and leakage

The schedule's QB-name fields were used only to identify the QB whose **prior** performance should be queried. The target game's QB statistics were never allowed into the target game's profile.

This experiment also excluded same-week completed games. That is conservative, but prevents subtle chronological leakage between games in the same NFL week.

## Important limitation: named backup value

EXP-010 v1 measures the **starting-QB-to-starting-QB value delta**. It does **not** claim to know the historically correct QB2 from a present-day depth chart.

A named starter-vs-backup replacement delta is deferred until the project has a validated point-in-time personnel/depth-chart layer. That is preferable to fabricating historical backup identity. The later EXP-013 personnel stage remains the planned home for that extension.

## Verified run — 2026-09-29

### Coverage

- 2024 discovery: **272** eligible regular-season games with named starters
- 2025 untouched confirmation: **271** games
- 2026 observational sample at run time: **48** completed games

### 2024 discovery lock

The best 2024 Brier result among the 45 preregistered variants selected:

- rolling window: **16 QB games**
- shrinkage prior: **100 dropbacks**
- QB logit weight: **0.20**

The selected weight sat at the top of the preregistered weight grid. That is a robustness warning and the grid was **not** extended after 2025 was revealed.

### Untouched 2025 confirmation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **66.42%** (180/271) | 0.2250 | 0.6416 | 0.0840 |
| EXP-010 QB | **66.42%** (180/271) | **0.2245** | **0.6405** | **0.0744** |

Result:

- accuracy delta: **0.00 points**
- Brier delta: **-0.0006**
- log-loss delta: **-0.0011**
- EXP-010-only correct flips: **2**
- control-only correct flips: **2**
- exact paired p-value: **1.0000**

So the locked QB signal improved probability quality without improving 2025 winner accuracy.

### 2025 split behavior

- Weeks 1–4: **73.02% → 73.02%**, Brier improved
- Weeks 5–9: **64.79% → 64.79%**, Brier improved
- Weeks 10–18: **64.23% → 64.23%**, essentially neutral
- starter-change games: **65.63% → 65.63%**, Brier improved
- stable-starter games: **66.67% → 66.67%**, Brier improved
- cold-start either QB: **76.19% → 76.19%**, Brier improved materially
- both QBs with at least 200 prior dropbacks: **66.36% → 66.82%**
- one-score games: **56.94% → 56.94%**
- blowouts: **77.08% → 77.08%**, Brier improved
- neutral-site games: **71.43% → 71.43%**

### Component ablation — diagnostic only

These results were observed only **after** the 2025 confirmation was opened. They are not allowed to retune EXP-010 retroactively.

- remove EPA: **66.79%**, Brier 0.2245, log loss 0.6404
- remove CPOE: **66.05%**, Brier 0.2245, log loss 0.6405
- remove protection: **66.05%**, Brier 0.2248, log loss 0.6412
- remove rushing: **67.16%**, Brier 0.2243, log loss 0.6401

The strongest post-confirmation clue is that the rushing component may be adding noise, while CPOE and protection appear more structurally useful. That becomes a **future hypothesis only**. We will not rewrite EXP-010 around this 2025 observation and pretend the new version is untouched.

### Neighboring-parameter robustness — diagnostic only

- weight 0.15: **66.79%**, Brier 0.2246, log loss 0.6407
- locked weight 0.20: **66.42%**, Brier 0.2245, log loss 0.6405
- 4-game window: **66.05%**, Brier 0.2239, log loss 0.6391
- 8-game window: **65.68%**, Brier 0.2241, log loss 0.6395
- prior 200: **66.42%**, Brier 0.2246, log loss 0.6408
- prior 400: **66.42%**, Brier 0.2247, log loss 0.6410

Probability quality is fairly robust around the chosen specification, but straight-up winner gains are not established.

### 2026 observational check

With parameters still frozen from the 2024 discovery:

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | 58.33% (28/48) | 0.2331 | 0.6602 | 0.1375 |
| EXP-010 QB | **60.42% (29/48)** | 0.2331 | 0.6602 | **0.1056** |

This is encouraging but far too small to count as proof. The 2026 sample is observational only and may not be used to retune EXP-010.

## Management conclusion

**KEEP FOR RESEARCH. Do not promote EXP-010 to production.**

The core QB idea remains useful because:

- untouched 2025 probability quality improved,
- calibration improved,
- the first frozen 2026 sample improved by one winner,
- established-QB games showed a small positive winner delta,
- later personnel work can add actual starter-vs-backup replacement value,
- later margin and Monte Carlo layers can use QB strength as an input.

But the exact four-component EXP-010 specification has **not yet earned a production role** because its untouched 2025 winner accuracy was identical to v2.2 and its paired winner evidence was neutral.

## Reproduce

```bash
bun run research:qb
```

Runtime outputs:

- `research/runtime/exp-010.json`
- `research/reports/exp-010.md`
