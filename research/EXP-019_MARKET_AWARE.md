# EXP-019 — Market-Aware Residual / Disagreement Layer

## Status

**SURVIVES AS A MARKET-AWARE SHADOW CANDIDATE. DO NOT REPLACE PURE-FOOTBALL v2.2.**

The protocol below was locked before 2025 was evaluated. Production `v2.2-validated-current-season` remains unchanged.

## Why this experiment exists

The pure-football control has shown a weak first three weeks in the small 2026 observational sample. A sportsbook market is an unusually information-dense pregame sensor: it aggregates roster news, quarterback status, injuries, matchup opinion, and trading pressure that our current control may not represent explicitly.

The goal is not to pretend that the market is our football model. The goal is to test whether a separately labeled market-aware lane can improve winner classification and probability quality without contaminating the pure-football control.

## Data and timestamp rule

Source: nflverse `games.csv` pregame moneylines.

Historical evaluation uses the recorded closing moneyline. Closing prices are pre-kickoff information, but they represent a late pregame cutoff. Therefore this surviving model is labeled `market-aware` and must remain separate from an earlier pure-football forecast.

Two-sided American moneylines are converted to implied probabilities and normalized to remove the bookmaker overround:

`p_home_novig = p_home_raw / (p_home_raw + p_away_raw)`

Games missing either side of the moneyline are excluded rather than imputed.

## Candidate family — frozen before 2025

The 2024 discovery season was allowed to choose only among these predeclared rules:

1. Logit blends of v2.2 and no-vig market probability with market weights `0, .25, .50, .75, 1.00`.
2. Market guardrails that override v2.2 only when the two disagree on the winner and market confidence is at least `55%, 60%, 65%, 70%`.
3. Disagreement-only logit blending at `50%` market weight.
4. Disagreement-only full market override.

Primary selection objective was straight-up accuracy on 2024, followed by Brier score and log loss.

## 2024 discovery

All 272 regular-season games had usable two-sided moneylines.

| Model | Correct | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|---:|
| v2.2 control | 181/272 | 66.54% | 0.2118 | 0.6122 | 0.0602 |
| Market only | 195/272 | 71.69% | 0.2002 | 0.5875 | 0.0737 |
| Blend 25% market | 186/272 | 68.38% | 0.2066 | 0.6007 | 0.0668 |
| Blend 50% market | 194/272 | 71.32% | 0.2027 | 0.5927 | 0.0928 |
| **Blend 75% market** | **196/272** | **72.06%** | **0.2006** | **0.5883** | 0.1003 |
| Blend 100% market | 195/272 | 71.69% | 0.2002 | 0.5875 | 0.0752 |
| Guardrail 55% | 194/272 | 71.32% | 0.2027 | 0.5931 | 0.0561 |
| Guardrail 60% | 192/272 | 70.59% | 0.2029 | 0.5934 | 0.0546 |
| Guardrail 65% | 187/272 | 68.75% | 0.2060 | 0.5998 | 0.0512 |
| Guardrail 70% | 186/272 | 68.38% | 0.2067 | 0.6012 | 0.0520 |
| Disagreement blend 50% | 194/272 | 71.32% | 0.2044 | 0.5969 | 0.0768 |
| Disagreement market override | 195/272 | 71.69% | 0.2007 | 0.5890 | 0.0637 |

**Locked before 2025: `BLEND_0.75`.** No later season is allowed to reselect this weight.

The challenger probability is a logit-space blend:

`logit(p_shadow) = 0.25 * logit(p_v2.2) + 0.75 * logit(p_market_novig)`

## Locked 2025 confirmation

| Model | Correct | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|---:|
| v2.2 control | 180/271 | 66.42% | 0.2250 | 0.6416 | 0.0840 |
| Market only | 177/271 | 65.31% | 0.2121 | 0.6094 | 0.0521 |
| **EXP-019 BLEND_0.75** | **182/271** | **67.16%** | **0.2137** | **0.6137** | **0.0640** |

Paired winner flips versus v2.2:

- challenger correct / control wrong: **13**
- control correct / challenger wrong: **11**
- exact two-sided paired p-value: **0.8388**

The winner improvement is therefore not statistically established on one season, but the locked challenger passed the predeclared survival gate: higher accuracy with lower Brier and lower log loss.

### 2025 splits

- Weeks 1–4: control **73.02%**, market **73.02%**, challenger **73.02%**.
- Weeks 5–9: control **64.79%**, market **66.20%**, challenger **69.01%**.
- Weeks 10+: control **64.23%**, market **61.31%**, challenger **63.50%**.
- Control/market disagreement games (`n=29`): control **55.17%**, market **44.83%**, challenger **62.07%**.
- Market confidence >=60% (`n=181`): control **67.96%**, market **69.06%**, challenger **69.06%**.
- Market confidence >=70% (`n=103`): control **79.61%**, market **80.58%**, challenger **80.58%**.

The market alone had substantially better probability quality but lower 2025 straight-up accuracy than v2.2. The locked blend beat both on 2025 winner accuracy, which is evidence that the control and market contain complementary information rather than one simply replacing the other.

## 2026 observation only

First 48 completed regular-season games:

| Model | Correct | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|---:|
| v2.2 control | 28/48 | 58.33% | 0.2331 | 0.6602 | 0.1375 |
| Market only | **32/48** | **66.67%** | 0.2327 | 0.6596 | **0.1041** |
| EXP-019 BLEND_0.75 | 31/48 | 64.58% | **0.2314** | **0.6564** | 0.1044 |

Observational subsets:

- All Weeks 1–3: control **58.33%**, market **66.67%**, challenger **64.58%**.
- Control/market disagreement (`n=4`): control **0%**, market **100%**, challenger **75%**.
- Market confidence >=60% (`n=31`): control **58.06%**, market **64.52%**, challenger **64.52%**.
- Market confidence >=70% (`n=15`): all three **66.67%**.

This 2026 sample is small and observational. It cannot be used to change the locked 75% weight. It does, however, directly address the early-season weakness that motivated the test: the market-aware lane materially outperformed the frozen pure-football control in the first 48 games.

## Decision

**SURVIVES AS MARKET-AWARE SHADOW CANDIDATE.**

This is the first challenger in this research sequence to satisfy the locked 2025 survival gate while also showing a substantial positive early-2026 observation.

It is not promoted over `v2.2` as the pure-football model. The next implementation step is a timestamped live market feed and a visibly separate `Market-Aware Shadow` prediction so prospective games can be frozen before kickoff and audited later.

## Leakage and deployment rule

Final score, target-game play-by-play, postgame information, and any line not available before kickoff are forbidden. Historical closing odds are accepted because they are pregame prices. A live implementation must store the exact source, odds, timestamp, no-vig conversion, v2.2 probability, blended probability, and final frozen prediction used for each game.
