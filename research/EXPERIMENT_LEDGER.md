# NFL Predictor Experiment Ledger

Failed experiments are retained. Results from live-forward games are never moved backward into untouched validation.

| ID | Hypothesis | Control | Challenger | Evaluation | Result | Decision |
|---|---|---|---|---|---|---|
| EXP-001 | Reset short-horizon recent form at season boundaries | v2.1 | v2.2 current-season reset | select on 2024; confirm on untouched 2025 | 2025 accuracy 65.31% -> 66.42%; Brier 0.2245 -> 0.2250; log loss 0.6400 -> 0.6415 | KEEP v2.2 control with documented calibration tradeoff |
| EXP-002 | Rest adjustment adds incremental value | v2.2 without rest | research variant with rest | 2025 validation | no incremental winner-accuracy value documented | REJECT for production |
| EXP-003 | Legacy numerology adds incremental value | v2.2 football control | football + legacy numerology | historical research | insufficient / superseded formula path; production weight zero | REJECT for production |
| EXP-004 | PURE Astrology QB-only signal adds independent predictive value | v2.2 | PURE research layer | historical falsification workflow | research-only; does not alter football winner | KEEP FOR RESEARCH |
| EXP-005 | NFL v3.2 multi-chart ecosystem + venue context generalizes prospectively | separate v2.2 control | v3.2 astrology ecosystem | frozen 2026 Week 1 forward slate | 6/15 = 40.00%; Sunday Sep 13 subset 4/13 = 30.77% | REJECT FOR PROMOTION |
| EXP-006 | Simple same-season opponent-adjusted point differential improves beyond v2.2 | v2.2 | iterative SRS-style point-differential adjustment | 2024 select; untouched 2025 | 179/271 = 66.05%, Brier 0.2259, log loss 0.6448 vs control 66.42%, 0.2250, 0.6416 | REJECT FOR PROMOTION |
| EXP-007 | Offense-vs-defense matchup efficiency adds value aggregate Elo/form misses | v2.2 | passing EPA/dropback + rushing efficiency + protection + ball security | 2024 select; untouched 2025; robustness/ablation | 184/271 = 67.90%; Brier 0.2243; log loss 0.6412; paired p=0.4240 | KEEP FOR RESEARCH |
| EXP-008 | Predicting expected scoring margin first improves forecasting quality | v2.2 | ridge expected-margin model + discovery-only residual probability map | 2024 select; untouched 2025; 2026 observation | 176/271 = 64.94%; Brier 0.2240; log loss 0.6384; ECE 0.0396 | KEEP AS SECONDARY RESEARCH ARCHITECTURE; not a winner promotion candidate |
| EXP-009 | Play-level ridge opponent-adjusted pass/rush EPA adds independent predictive value | v2.2 | simultaneous offense/defense ridge EPA, early-season ramp, locked 0.20 logit weight | 60 preregistered 2024 variants; untouched 2025; 2026 observation; ablation/robustness | 2025 179/271 = 66.05%; Brier 0.2276; log loss 0.6523; ECE 0.0707 vs control 66.42%, 0.2250, 0.6416, 0.0840; 2026 tied 28/48 but worse probability quality | REJECT FOR PROMOTION |
| EXP-010 | Rolling QB EPA/CPOE/protection/rushing value adds information beyond team-level v2.2 | v2.2 | 16-game QB window, 100-DB shrinkage, 0.20 logit weight | 45 preregistered 2024 variants; untouched 2025; 2026 observation | 2025 accuracy tied 66.42%; Brier 0.2245; log loss 0.6405; ECE 0.0744; 2026 29/48 vs 28/48 | KEEP FOR RESEARCH |
| EXP-011 | Regressed prior-season offense/defense efficiency stabilizes early-season estimates without harming later weeks | v2.2 | dynamic pass/rush EPA carryover with separate offense/defense K and prior retention | 135 preregistered 2024 variants; untouched 2025; 2026 observation; ablation/robustness | 2025 179/271 = 66.05%; Brier 0.2267; log loss 0.6500; ECE 0.0786 vs control 66.42%, 0.2250, 0.6416; 2026 tied 28/48 but Brier/log loss materially worse | REJECT FOR PROMOTION |
| EXP-014 | Success and explosive-play matchup rates add repeatable signal beyond v2.2 | v2.2 | prior-week pass/rush success + explosive rates | 40 preregistered 2024 variants; untouched 2025; 2026 observation | 2025 178/271 = 65.68%; Brier 0.2253; log loss 0.6440; ECE 0.0885; 2026 27/48 | REJECT FOR PROMOTION |

## EXP-006 detail

2024 selected weight **0.03** from five predeclared opponent-adjusted point-differential weights. Untouched 2025:

- control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**
- EXP-006: **179/271 = 66.05%**, Brier **0.2259**, log loss **0.6448**

The challenger failed confirmation and was not rescued by retuning.

## EXP-007 detail

2024 selected weight **0.15** for the four-component matchup layer:

1. passing EPA/dropback,
2. rushing efficiency,
3. protection/sack rate,
4. ball security/turnover interaction.

Untouched 2025:

- control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**
- EXP-007: **184/271 = 67.90%**, Brier **0.2243**, log loss **0.6412**
- challenger-only correct flips: **9**
- control-only correct flips: **5**
- exact paired p-value: **0.4240**

The gain is promising but not statistically established. Post-confirmation ablations remain diagnostic only.

## EXP-008 detail

EXP-008 predicted continuous home-minus-away scoring margin with ridge regression and converted margin to probability with a discovery-only residual distribution.

2024 selected `lambda=100` and residual sigma **13.342 points**. Untouched 2025:

- control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**, ECE **0.0840**
- EXP-008: **176/271 = 64.94%**, Brier **0.2240**, log loss **0.6384**, ECE **0.0396**
- margin MAE: **10.283 points**

It remains useful for calibration / future Monte Carlo architecture, but not as a straight-up winner replacement.

## EXP-009 detail

EXP-009 tested opponent adjustment in a stronger form than EXP-006. It used nflverse play-by-play and fit separate ridge regressions for pass EPA and rush EPA with simultaneous offensive and defensive team effects.

The 2024 discovery tested **60 preregistered variants**:

- ridge penalties: `25`, `100`, `400`
- early-season ramps: `NONE`, `FAST`, `MODERATE`, `CONSERVATIVE`
- logit weights: `0`, `0.05`, `0.10`, `0.15`, `0.20`

Brier selected:

- ridge penalty **25**
- **CONSERVATIVE** early-season ramp
- weight **0.20**

2024 discovery at the locked setting:

- control: **181/272 = 66.54%**, Brier **0.2118**, log loss **0.6122**
- EXP-009: **183/272 = 67.28%**, Brier **0.2066**, log loss **0.6016**

Untouched 2025 confirmation:

- control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**, ECE **0.0840**
- EXP-009: **179/271 = 66.05%**, Brier **0.2276**, log loss **0.6523**, ECE **0.0707**
- challenger-only correct flips: **4**
- control-only correct flips: **5**
- exact paired p-value: **1.0000**

Post-confirmation ablation:

- pass-only: **179/271 = 66.05%**, Brier **0.2273**, log loss **0.6516**
- rush-only: **175/271 = 64.58%**, Brier **0.2305**, log loss **0.6596**

Neighboring ridge penalties could tie winner accuracy but remained worse on probability quality. Frozen 2026 observation:

- control: **28/48 = 58.33%**, Brier **0.2331**, log loss **0.6602**, ECE **0.1375**
- EXP-009: **28/48 = 58.33%**, Brier **0.2342**, log loss **0.6631**, ECE **0.1528**

Decision: **REJECT FOR PROMOTION**. Future opponent-adjusted work must be a new preregistered hypothesis, not a post-hoc rewrite of EXP-009.

## EXP-010 detail

EXP-010 used prior-game QB statistics only: EPA/dropback, CPOE, sack avoidance, and QB rushing EPA. 2024 Brier selected a **16-game** window, **100-dropback** shrinkage prior, and **0.20** weight.

Untouched 2025:

- control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**, ECE **0.0840**
- EXP-010: **180/271 = 66.42%**, Brier **0.2245**, log loss **0.6405**, ECE **0.0744**

Frozen 2026 observation: **29/48** for EXP-010 vs **28/48** control. This remains research-only.

## EXP-011 detail

EXP-011 tested whether previous-season team efficiency should fade out gradually rather than disappear at the season boundary. It used nflverse weekly team statistics and blended previous-season pass/rush EPA with current-season pass/rush EPA separately for offense and defense.

The 2024 discovery predeclared **135 variants**:

- offense shrinkage K: `2`, `4`, `6`
- defense shrinkage K: `3`, `6`, `9`
- prior-season retention: `0.50`, `0.75`, `1.00`
- logit weights: `0`, `0.05`, `0.10`, `0.15`, `0.20`

Brier selected and locked before 2025:

- offense K **2**
- defense K **3**
- prior retention **0.50**
- logit weight **0.20**

Untouched 2025 confirmation:

- control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**, ECE **0.0840**
- EXP-011: **179/271 = 66.05%**, Brier **0.2267**, log loss **0.6500**, ECE **0.0786**
- challenger-only correct flips: **7**
- control-only correct flips: **8**
- exact paired p-value: **1.0000**

The experiment did not achieve its specific early-season objective. Weeks 1–2 tied winner accuracy and improved Brier, but Weeks 3–4 lost two additional winners:

- Week 1: **75.00% → 75.00%**, Brier delta **-0.0226**
- Week 2: **81.25% → 81.25%**, Brier delta **-0.0022**
- Week 3: **68.75% → 62.50%**, Brier delta **+0.0169**
- Week 4: **66.67% → 60.00%**, Brier delta **+0.0080**
- Weeks 1–4 overall: **73.02% → 69.84%**
- Weeks 5–9: **64.79% → 67.61%**
- Weeks 10–18: **64.23% → 63.50%**

Post-confirmation ablation was diagnostic only:

- offense-only: **175/271 = 64.58%**, Brier **0.2291**, log loss **0.6525**
- defense-only: **180/271 = 66.42%**, Brier **0.2235**, log loss **0.6403**, ECE **0.0646**
- pass-only: **180/271 = 66.42%**, Brier **0.2256**, log loss **0.6484**
- rush-only: **174/271 = 64.21%**, Brier **0.2313**, log loss **0.6602**

The defense-only result is a useful **future hypothesis only**. It cannot be used to rewrite EXP-011 after observing 2025.

Neighboring settings did not provide a robust rescue. A post-confirmation weight of 0.15 happened to score **181/271 = 66.79%**, but because 2025 had already been opened this cannot be treated as untouched evidence or selected retroactively.

Frozen 2026 observation at the original locked parameters:

- control: **28/48 = 58.33%**, Brier **0.2331**, log loss **0.6602**, ECE **0.1375**
- EXP-011: **28/48 = 58.33%**, Brier **0.2464**, log loss **0.6911**, ECE **0.1123**

Decision: **REJECT FOR PROMOTION**. The combined offense+defense prior-carryover specification failed untouched confirmation and materially worsened 2026 probability quality. The defense-only clue is quarantined as a possible future preregistered hypothesis.

## EXP-014 detail

EXP-014 used prior-week pass/rush success and explosive-play rates. 2024 selected pass **20+ yards**, rush **15+ yards**, no garbage-time filter, and **0.20** weight.

The discovery result was strong (**187/272 = 68.75%**) but failed untouched 2025:

- control: **180/271 = 66.42%**, Brier **0.2250**, log loss **0.6416**, ECE **0.0840**
- EXP-014: **178/271 = 65.68%**, Brier **0.2253**, log loss **0.6440**, ECE **0.0885**

Frozen 2026 observation was also worse at **27/48**. Decision: **REJECT FOR PROMOTION**.

## Required template for every new experiment

- **Experiment ID**
- **Hypothesis**
- **Control model**
- **Challenger model**
- **Training/discovery period**
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
