# NFL Predictor Experiment Ledger

Failed experiments are retained. Results from live-forward games are never moved backward into untouched validation.

| ID | Hypothesis | Control | Challenger | Evaluation | Result | Decision |
|---|---|---|---|---|---|---|
| EXP-001 | Reset short-horizon recent form at season boundaries | v2.1 | v2.2 current-season reset | select on 2024; confirm on untouched 2025 | 2025 accuracy 65.31% -> 66.42%; Brier 0.2245 -> 0.2250; log loss 0.6400 -> 0.6415 | KEEP v2.2 control with documented calibration tradeoff |
| EXP-002 | Rest adjustment adds incremental value | v2.2 football context without rest | research variant with rest | 2025 validation | no incremental winner-accuracy value documented | REJECT for production; retain research only |
| EXP-003 | Legacy numerology adds incremental value | v2.2 football control | football + legacy numerology | historical research | insufficient / superseded formula path; production weight zero | REJECT for production |
| EXP-004 | PURE Astrology QB-only signal adds independent predictive value | v2.2 | PURE research layer | historical falsification workflow | still research-only; does not alter football winner | KEEP FOR RESEARCH |
| EXP-005 | NFL v3.2 multi-chart ecosystem + venue context generalizes prospectively | v2.2 remains separate control | v3.2 astrology ecosystem | frozen 2026 Week 1 forward slate | 6/15 = 40.00%; Sunday Sep 13 subset 4/13 = 30.77% | REJECT FOR PROMOTION; keep for research and error analysis |
| EXP-006 | Simple same-season opponent-adjusted point differential improves beyond v2.2 | v2.2 | iterative SRS-style opponent adjustment; 0.00–0.04 logit/point | choose weight on 2024 Brier; confirm once on untouched 2025 | 2024 chose 0.03; 2025 control 180/271, 66.42%, Brier 0.2250, log loss 0.6416; challenger 179/271, 66.05%, Brier 0.2259, log loss 0.6448 | REJECT FOR PROMOTION; simple OAE did not replicate. Keep result and move to matchup-efficiency research |
| EXP-007 | Offense-vs-defense matchup efficiency adds value that aggregate Elo/form misses | v2.2 | point-in-time pregame matchup challenger | not yet run | pending | NEXT PRIORITY |

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
