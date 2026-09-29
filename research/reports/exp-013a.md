# EXP-013A — Snap-Weighted Personnel Continuity

## Hypothesis

Trailing lineup continuity, measured only from completed prior-game snap distributions, may add leakage-safe signal beyond v2.2.

This experiment does **not** claim target-game injury knowledge. Target-game snap counts and same-week snap counts are excluded. True pregame injury/availability remains a separate data-gated EXP-013B.

## Data and protocol

- Data source: nflverse snap counts.
- Discovery season: 2024.
- Untouched confirmation: 2025.
- Frozen observational season: 2026 through Week 3 / 48 completed games.
- 60 preregistered variants.
- Candidate dimensions: 1 or 3 prior snap-share transitions; combined/offense/defense continuity; unweighted or core QB/OL-weighted roles; logit weights 0, 0.05, 0.10, 0.15, 0.20.
- Missing-data rule: if either team has fewer than two prior same-season games, continuity contributes zero.

## Locked after 2024 discovery

Brier selected:

- prior transitions: **3**
- position scheme: **core** (QB and OL receive higher role weight)
- unit: **combined offense + defense**
- logit weight: **0.20**

At the locked 2024 setting, EXP-013A reached **184/272 = 67.65%**, Brier **0.2071**, log loss **0.6012**, versus the 2024 control **181/272 = 66.54%**, Brier **0.2118**, log loss **0.6122**.

## Untouched 2025 confirmation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **180/271 = 66.42%** | 0.2250 | **0.6416** | 0.0840 |
| EXP-013A | **173/271 = 63.84%** | **0.2245** | 0.6418 | **0.0436** |

Delta versus control:

- accuracy: **-2.58 percentage points**
- Brier: **-0.0005** (better)
- log loss: **+0.0001** (slightly worse)
- challenger-only correct flips: **9**
- control-only correct flips: **16**
- exact paired p-value: **0.2295**
- usable continuity games: **239/271**

### 2025 splits

- Weeks 1–4: **73.02% → 73.02%**, Brier delta **-0.0094**
- Weeks 5–9: **64.79% → 54.93%**, Brier delta **+0.0045**
- Weeks 10–18: **64.23% → 64.23%**, Brier delta **+0.0010**
- usable-continuity games: **64.85% → 61.92%**
- one-score games: **56.94% → 57.64%**, Brier delta **-0.0007**
- blowouts: **77.08% → 70.83%**, Brier delta **+0.0024**
- neutral site: **71.43% → 85.71%**, but only seven games

The main failure concentration was Weeks 5–9 and blowouts.

## Post-confirmation diagnostics

These are hypothesis-generating only and cannot be used to reselect the 2025-tested model.

- locked weight 0.15: **175/271 = 64.58%**, Brier 0.2241, log loss 0.6403
- offense-only at the locked structural settings: **181/271 = 66.79%**, Brier 0.2248, log loss 0.6433
- defense-only: **179/271 = 66.05%**, Brier 0.2262, log loss 0.6438
- unweighted combined: **175/271 = 64.58%**, Brier 0.2248, log loss 0.6420

The offense-only result is a future hypothesis only. It was observed after opening 2025 and may not be promoted or retroactively substituted for the locked combined model.

## Frozen 2026 observation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **28/48 = 58.33%** | 0.2331 | 0.6602 | 0.1375 |
| EXP-013A | **32/48 = 66.67%** | **0.2282** | **0.6518** | **0.1268** |

Only **16/48** games had usable continuity because the feature requires at least two prior games for each team.

Weekly observation:

- Week 1: control **62.50%**, EXP-013A **62.50%**, usable 0
- Week 2: control **56.25%**, EXP-013A **56.25%**, usable 0
- Week 3: control **56.25% (9/16)**, EXP-013A **81.25% (13/16)**, usable 16

The Week 3 result is notable prospective-style evidence, but it is a single 16-game week and cannot rescue the failed untouched 2025 confirmation.

## Decision

**INCONCLUSIVE / NO PROMOTION.**

The locked combined continuity model lost seven winners on untouched 2025 despite better Brier and much better ECE. The 2026 Week 3 improvement is worth tracking prospectively, but production v2.2 remains unchanged. A future offense-only continuity experiment must be preregistered against a genuinely unused test period rather than selected from the 2025 post-confirmation diagnostics.
