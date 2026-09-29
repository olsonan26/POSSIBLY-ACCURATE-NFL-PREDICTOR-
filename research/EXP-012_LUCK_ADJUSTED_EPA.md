# EXP-012 — Luck-Adjusted / Variance-Weighted EPA

## Status

Research challenger only. Production `v2.2-validated-current-season` remains frozen and unchanged.

**Decision after untouched 2025 confirmation: KEEP FOR RESEARCH / NO PROMOTION.**

The experiment tested whether discounting high-variance play outcomes could isolate a more repeatable efficiency signal. The locked challenger tied v2.2 on 2025 winner accuracy and produced only tiny Brier/log-loss improvements. It did not improve ECE and its frozen 2026 probability quality was worse. The intended luck-adjustment mechanisms were not selected by 2024 discovery; the winning discovery configuration was essentially lightly capped raw EPA.

## Hypothesis

Observed EPA can be distorted by high-variance events that may not repeat reliably. Candidate transformations therefore tested:

- clipping extreme single-play EPA,
- down-weighting turnovers,
- down-weighting fumbles,
- down-weighting touchdowns,
- filtering extreme win-probability / garbage-time plays.

This is an auditable experimental **WEPA-style** family. It is not represented as a reproduction of any external proprietary or canonical WEPA formula.

## Data and leakage firewall

Source: nflverse play-by-play.

For each target game:

- only prior weeks from the same season are used;
- same-week and target-game plays are excluded;
- Week 1 receives zero challenger edge because no current-season prior-week PBP exists;
- no current roster or injury data are inserted retrospectively;
- no sportsbook market data are used;
- no astrology or Lettrology data are used;
- 2025 is not used to select the locked transformation;
- 2026 is observational only and cannot be used to retune EXP-012.

Coverage in the successful CI run:

- 2024: **272 games**, 43,934 eligible PBP plays
- 2025: **271 games**, 43,081 eligible PBP plays
- 2026 through three observed weeks: **48 games**, 7,721 eligible PBP plays

## Preregistered 2024 discovery

Seven transformation configurations were crossed with five logit weights (`0`, `0.05`, `0.10`, `0.15`, `0.20`) for **35 preregistered variants**.

Configurations:

1. `RAW_CAP6`
2. `CAP3`
3. `CAP3_TO75`
4. `CAP3_TO50`
5. `CAP3_TO50_F50_TD85`
6. `CAP3_TO50_F25_TD75`
7. `CAP3_TO50_F25_TD75_GF`

Selection rule: lowest 2024 Brier score, then log loss.

## Locked specification

2024 selected:

- configuration: **`RAW_CAP6`**
- EPA cap: **±6**
- turnover multiplier: **1.00**
- fumble multiplier: **1.00**
- touchdown multiplier: **1.00**
- garbage-time filter: **off**
- logit weight: **0.05**

This result is itself informative: the discovery period did **not** select the stronger proposed luck discounts. The selected challenger is close to raw prior-week EPA with a mild extreme-play cap and a very small model weight.

2024 control was **181/272 = 66.54%**, Brier **0.2118**, log loss **0.6122**, ECE **0.0602**.

## Untouched 2025 confirmation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **66.42% (180/271)** | 0.2250 | 0.6416 | **0.0840** |
| EXP-012 locked | **66.42% (180/271)** | **0.2249** | **0.6414** | 0.0841 |

Deltas:

- accuracy: **0.00 percentage points**
- Brier: **-0.0002** (slightly better)
- log loss: **-0.0002** (slightly better)
- ECE: approximately **+0.0001** (slightly worse)
- challenger-only correct flips: **0**
- control-only correct flips: **0**
- exact paired p-value: **1.0000**

The locked challenger did not change a single 2025 winner classification. Its only benefit was a very small probability adjustment.

## 2025 split behavior

- Weeks 1–4: accuracy unchanged at **73.02%**; Brier delta **+0.0007**
- Weeks 5–9: accuracy unchanged at **64.79%**; Brier delta **-0.0005**
- Weeks 10–18: accuracy unchanged at **64.23%**; Brier delta **-0.0004**
- actual home wins: accuracy unchanged at **76.71%**; Brier delta **+0.0012**
- actual away wins: accuracy unchanged at **54.40%**; Brier delta **-0.0017**
- one-score results <=8: accuracy unchanged at **56.94%**; Brier delta **+0.0005**
- blowouts >=14: accuracy unchanged at **77.08%**; Brier delta **-0.0009**
- neutral-site games: accuracy unchanged at **71.43%** on seven games; Brier delta **-0.0032**

## Post-confirmation robustness — hypothesis generation only

The following results were observed **after** opening 2025. They cannot be selected retroactively or described as untouched confirmation.

| Diagnostic variant | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| locked weight 0.05 | 66.42% | 0.2249 | 0.6414 | 0.0841 |
| weight 0.10 | 66.05% | 0.2249 | 0.6416 | 0.0775 |
| `CAP3` | 66.05% | 0.2249 | 0.6414 | 0.0832 |
| `CAP3_TO75` | 66.05% | 0.2249 | 0.6413 | 0.0832 |
| `CAP3_TO50` | 66.05% | 0.2249 | 0.6413 | 0.0831 |
| `CAP3_TO50_F50_TD85` | 66.42% | 0.2248 | 0.6411 | 0.0823 |
| `CAP3_TO50_F25_TD75` | 66.42% | 0.2247 | 0.6409 | 0.0822 |
| `CAP3_TO50_F25_TD75_GF` | **66.79% (181/271)** | 0.2248 | 0.6411 | 0.0873 |

The final garbage-filtered variant happened to flip one additional 2025 winner correctly, while the stronger non-garbage variant improved Brier/log loss/ECE without changing accuracy. These are **future hypotheses only**. Using them to replace the locked specification would contaminate 2025.

## Frozen 2026 observation

| Model | Accuracy | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|
| v2.2 control | **58.33% (28/48)** | **0.2331** | **0.6602** | **0.1375** |
| EXP-012 locked | **58.33% (28/48)** | 0.2343 | 0.6631 | 0.1381 |

EXP-012 tied winner accuracy but worsened every listed probability-quality metric in this small 2026 observation.

### 2026 weekly observation

| Week | Games | v2.2 | EXP-012 | v2.2 Brier | EXP-012 Brier |
|---|---:|---:|---:|---:|---:|
| 1 | 16 | **62.50%** | **62.50%** | 0.2199 | 0.2199 |
| 2 | 16 | **56.25%** | 50.00% | **0.2498** | 0.2526 |
| 3 | 16 | 56.25% | **62.50%** | **0.2294** | 0.2305 |

The week-to-week flip from hurting Week 2 to helping Week 3 is not stable evidence. Overall 2026 remains 28/48 for both models.

## Management conclusion

**KEEP FOR RESEARCH / NO PROMOTION.**

What survives:

1. small prior-week EPA adjustments may have modest probability information;
2. the specific 2024 discovery did not support aggressive luck-discounting;
3. the locked challenger added no 2025 winner accuracy and worsened 2026 probability quality;
4. the post-confirmation heavy-discount / garbage-filter variants are interesting but quarantined;
5. production v2.2 remains unchanged;
6. the weak 2026 Weeks 2–3 control performance (both **56.25%**) is now explicitly visible and should motivate future experiments without allowing retrospective 2026 tuning.

## Reproduce

```bash
bun run research:wepa
```

Runtime outputs:

- `research/runtime/exp-012.json`
- `research/reports/exp-012.md`
