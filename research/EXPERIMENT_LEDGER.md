# NFL Predictor Experiment Ledger

Failed experiments are retained. Results from live-forward games are never moved backward into untouched validation.

| ID | Hypothesis | Control | Challenger | Evaluation | Result | Decision |
|---|---|---|---|---|---|---|
| EXP-001 | Reset short-horizon recent form at season boundaries | v2.1 | v2.2 current-season reset | select on 2024; confirm on untouched 2025 | 2025 accuracy 65.31% -> 66.42%; Brier 0.2245 -> 0.2250; log loss 0.6400 -> 0.6415 | KEEP v2.2 control with documented calibration tradeoff |
| EXP-002 | Rest adjustment adds incremental value | v2.2 football context without rest | research variant with rest | 2025 validation | no incremental winner-accuracy value documented | REJECT for production; retain research only |
| EXP-003 | Legacy numerology adds incremental value | v2.2 football control | football + legacy numerology | historical research | insufficient / superseded formula path; production weight zero | REJECT for production |
| EXP-004 | PURE Astrology QB-only signal adds independent predictive value | v2.2 | PURE research layer | historical falsification workflow | still research-only; does not alter football winner | KEEP FOR RESEARCH |
| EXP-005 | NFL v3.2 multi-chart ecosystem + venue context generalizes prospectively | v2.2 remains separate control | v3.2 astrology ecosystem | frozen 2026 Week 1 forward slate | 6/15 = 40.00%; Sunday Sep 13 subset 4/13 = 30.77% | REJECT FOR PROMOTION; keep for research and error analysis |
| EXP-006 | Simple same-season opponent-adjusted point differential improves beyond v2.2 | v2.2 | iterative SRS-style opponent adjustment; 0.00–0.04 logit/point | choose weight on 2024 Brier; confirm once on untouched 2025 | 2024 chose 0.03; 2025 control 180/271, 66.42%, Brier 0.2250, log loss 0.6416; challenger 179/271, 66.05%, Brier 0.2259, log loss 0.6448 | REJECT FOR PROMOTION; simple OAE did not replicate |
| EXP-007 | Offense-vs-defense matchup efficiency adds value aggregate Elo/form misses | v2.2 | prior-week passing EPA/dropback + rushing efficiency + protection/pressure + ball security, frozen weight 0.15 | five weights on 2024 Brier; untouched 2025 confirmation; then post-confirmation robustness/ablation | 184/271 = 67.90%; Brier 0.2243; log loss 0.6412 vs control 180/271, 0.2250, 0.6416. McNemar exact p=0.4240 | KEEP FOR RESEARCH; promising but not statistically established or broad enough for production promotion |

## EXP-006 detail

Discovery was deliberately narrow: five predeclared weights (`0`, `0.01`, `0.02`, `0.03`, `0.04`) were tested on 2024 only. The best 2024 Brier selected `0.03`.

Untouched 2025 confirmation:

- Control accuracy: **180/271 = 66.42%**
- Challenger accuracy: **179/271 = 66.05%**
- Accuracy delta: **-0.37 percentage points**
- Control Brier: **0.2250**
- Challenger Brier: **0.2259**
- Brier delta: **+0.0009** (worse)
- Control log loss: **0.6416**
- Challenger log loss: **0.6448**
- Log-loss delta: **+0.0032** (worse)

The feature looked promising during 2024 discovery but failed the untouched 2025 confirmation. It therefore does not enter production and must not be rescued by retuning on 2025.

## EXP-007 detail

The matchup challenger used only prior-week nflverse team statistics. The four predeclared equal-weight components were:

1. passing EPA per dropback vs opponent passing EPA allowed,
2. rushing yards per carry vs opponent rushing efficiency allowed,
3. sacks/protection vs opponent sack generation,
4. offensive turnover rate vs opponent takeaway rate.

Five weights (`0`, `0.05`, `0.10`, `0.15`, `0.20`) were examined on 2024. Brier selected **0.15** before the 2025 confirmation was revealed.

Untouched 2025 confirmation at frozen 0.15:

- Control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**
- Challenger: **184/271 = 67.90%**, Brier **0.2243**, log loss **0.6412**
- Accuracy delta: **+1.48 points**
- Brier delta: **-0.0007**
- Log-loss delta: **-0.0004**

Post-confirmation robustness diagnostics (not allowed to reselect the frozen weight):

- weight 0.10: **183/271 = 67.53%**, Brier 0.2243, log loss 0.6405
- weight 0.15: **184/271 = 67.90%**, Brier 0.2243, log loss 0.6412
- weight 0.20: **182/271 = 67.16%**, Brier 0.2247, log loss 0.6428

Ablation at the frozen 0.15 weight:

- remove passing: **186/271 = 68.63%**, Brier 0.2245, log loss 0.6412
- remove rushing: **184/271 = 67.90%**, Brier 0.2240, log loss 0.6410
- remove protection: **184/271 = 67.90%**, Brier 0.2257, log loss 0.6448
- remove ball security: **180/271 = 66.42%**, Brier 0.2240, log loss 0.6399

These ablations are **diagnostic only** because 2025 has now been observed. They may generate future hypotheses but may not be used to retune EXP-007 and call the result untouched.

Split behavior:

- Weeks 1–4: accuracy unchanged at 73.02%; Brier slightly improved
- Weeks 5–9: 64.79% -> **69.01%**
- Weeks 10–18: 64.23% -> **64.96%**
- Control home picks: 66.27% -> **68.64%**
- Control away picks: **66.67% -> 66.67%**

Paired winner discordance was 9 games fixed by the challenger versus 5 games broken by it. Exact two-sided McNemar/binomial **p = 0.4240**, so the apparent +1.48-point accuracy gain is not statistically established on one season.

Therefore EXP-007 remains **KEEP FOR RESEARCH**, not a production replacement. Required next evidence is multi-season walk-forward replication and genuine prospective 2026 observations after enough prior-week data exist.

## Required template for every new experiment

- **Experiment ID**
- **Hypothesis**
- **Control model**
- **Challenger model**
- **Training period**
- **Validation period**
- **Locked test period**
- **Live-forward period**
- **Features added/removed**
- **Parameters tested**
- **Number of model/parameter variants tried**
- **Leakage check**
- **Control: games / correct / accuracy / Brier / log loss / calibration**
- **Challenger: games / correct / accuracy / Brier / log loss / calibration**
- **Splits: Weeks 1-4 / 5-9 / 10-18 / home / away / close / blowout / neutral**
- **Ablation result**
- **Neighboring-parameter robustness**
- **Decision: REJECT / INCONCLUSIVE / KEEP FOR RESEARCH / PROMOTION CANDIDATE**
- **Reason**

## Current firewall

The 2026 completed-game results are LIVE FORWARD RESULTS. They may be scored and analyzed, but repeated tuning against them cannot later be described as untouched validation.
