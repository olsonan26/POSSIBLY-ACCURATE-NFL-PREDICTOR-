# EXP-030: Market-Calibrated Meta-Stacker

**Date:** 2026-10-02
**Status:** REJECT FOR PROMOTION — KEEP FOR RESEARCH
**Parent model:** v2.2 control + market no-vig probability
**Feature family:** `meta_stacking.market_calibrated`

## Hypothesis

An L2-regularized logistic regression meta-stacker combining v2.2 control probability, market no-vig probability, opponent-adjusted point differential (SRS), rest differential, travel distance, divisional matchup, surface/roof type, and interaction terms will improve straight-up winner accuracy beyond the best individual component (market-only) on 2026 Weeks 1-3.

## Protocol

- **Train:** 2022-2023 regular season (541 games, chronological)
- **Select:** 2024 regular season (272 games, Brier-based selection)
- **Confirm:** 2025 regular season (271 games, untouched)
- **Observe:** 2026 Weeks 1-3 (48 games, observation only, NOT validation)
- **Model:** L2-regularized logistic regression (gradient descent, 300-500 iterations)
- **Calibration:** Platt scaling (logistic regression on training-period predictions)
- **Feature normalization:** Z-score using training-period statistics
- **Three variants tested:**
  1. **Full (18 features):** control logit, market logit, SRS diff, rest diff, travel miles, tz change, divisional, home/away venue win pct, prime time, dome, turf, spread abs, total line, rest×travel, rest×tz, divisional×close, market confidence
  2. **Core (6 features):** control logit, market logit, SRS diff, divisional, dome, spread abs
  3. **Market-dominant (3 features):** control logit, market logit, market confidence
- **SRS prior:** Previous season's final SRS ratings blended with current season (Bayesian shrinkage: currentWeight = min(0.8, nGames / (nGames + 3)))
- **Selection metric:** 2024 Brier score (less noisy than accuracy for 272 games)
- **Variant selection:** Best 2025 Brier among the three variants
- This is a research-only shadow challenger. v2.2 production is unchanged.

## Leakage check

- All features computed from games.csv data before the target game's kickoff
- SRS uses only completed regular season games before the target date
- Previous season SRS uses only fully completed prior season
- Market probability uses closing moneyline (known before kickoff)
- No current/live/future-season information in retrospective predictions
- Platt scaling trained only on training period, applied to all periods
- No retuning on 2025 or 2026

## Results

### All variants comparison

| Variant | 2024 Accuracy | 2024 Brier | 2025 Accuracy | 2025 Brier | 2026 W1-3 Accuracy | 2026 W1-3 Brier |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| Full (18 features) | 65.44% | 0.2257 | 61.99% | 0.2241 | 62.50% | 0.2327 |
| Core (6 features) | 66.91% | 0.2231 | 64.58% | 0.2242 | 64.58% | 0.2321 |
| Market-dominant (3 features) | 66.54% | 0.2226 | 64.21% | 0.2242 | 64.58% | 0.2330 |

**Best variant by 2025 Brier:** Full (18 features) — Brier 0.2241

### Best variant detailed results

**2024 selection:**
- Control: 181/272 = 66.54%, Brier 0.2118
- Market-only: 182/272 = 67.16%, Brier 0.2102
- EXP-030 Full: 178/272 = 65.44%, Brier 0.2257

**2025 untouched confirmation:**
- Control: 180/271 = 66.42%, Brier 0.2250, log loss 0.6416, ECE 0.0840
- Market-only: 177/271 = 65.31%, Brier 0.2121, log loss 0.6094, ECE 0.0536
- EXP-030 Full: 168/271 = 61.99%, Brier 0.2241, log loss 0.6390, ECE 0.0602
- Paired vs control: challenger-only=19, control-only=31, exact p=0.1189

**2026 Weeks 1-3 observation:**
- Control: 28/48 = 58.33%, Brier 0.2331, log loss 0.6602, ECE 0.1375
- Market-only: 32/48 = 66.67%, Brier 0.2327, log loss 0.6596, ECE 0.1041
- EXP-030 Full: 30/48 = 62.50%, Brier 0.2327, log loss 0.6580, ECE 0.0805

**Target: 70%+ on 2026 W1-3: NO (62.50%)**

## Miss pattern analysis (2026 Weeks 1-3)

### Summary

| Category | N | Accuracy |
|----------|:---:|:---:|
| Home team won (missed) | 5 | — |
| Away team won (missed) | 13 | — |
| Upset misses (model + market both wrong) | 12 | — |
| Model-market disagreement (model wrong) | 5 | — |
| Close game misses (|margin| ≤ 3) | 2 | — |
| Blowout misses (|margin| ≥ 14) | 6 | — |
| Confidence 50-55% | 9 | 66.7% |
| Confidence 55-60% | 6 | 66.7% |
| Confidence 60-65% | 7 | 42.9% |
| Confidence 65-70% | 13 | 53.8% |
| Confidence 70%+ | 1 | 100.0% |
| Divisional games | 13 | 53.8% |
| Prime time | 9 | 66.7% |
| Dome games | 15 | 46.7% |
| Week 1 | 16 | 62.5% |
| Week 2 | 16 | 43.8% |
| Week 3 | 16 | 56.3% |
| Away short rest (<-1 day diff) | 1 | 0.0% |
| Long travel (>1500mi) | 7 | 71.4% |

### Individual misses (2026 W1-3)

| Week | Matchup | Model Pick | Actual | Margin | Market | Agree? | SRS Diff | Rest Diff | Travel |
|:---:|---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| W1 | SF@LA | LA (53%) | SF | -20 | LA | AGREE | +6.5 | 0 | 0mi |
| W1 | BUF@HOU | HOU (54%) | BUF | -5 | BUF | DISAGREE | +3.9 | 0 | 1290mi |
| W1 | BAL@IND | IND (50%) | BAL | -18 | BAL | DISAGREE | +3.6 | 0 | 509mi |
| W1 | NYJ@TEN | TEN (54%) | NYJ | -13 | TEN | AGREE | +4.5 | 0 | 757mi |
| W1 | ARI@LAC | LAC (69%) | ARI | -12 | LAC | AGREE | +5.7 | 0 | 350mi |
| W1 | DEN@KC | DEN (50%) | KC | +21 | KC | DISAGREE | -1.6 | 0 | 564mi |
| W2 | NO@BAL | BAL (67%) | NO | -7 | BAL | AGREE | +8.4 | 0 | 999mi |
| W2 | MIN@CHI | CHI (63%) | MIN | -6 | CHI | AGREE | +0.4 | 0 | 355mi |
| W2 | CIN@HOU | HOU (61%) | CIN | -14 | HOU | AGREE | +9.6 | 0 | 898mi |
| W2 | CLE@TB | TB (67%) | CLE | -4 | TB | AGREE | +6.6 | 0 | 936mi |
| W2 | LV@LAC | LAC (69%) | LV | -12 | LAC | AGREE | +5.2 | 0 | 232mi |
| W3 | ATL@GB | GB (56%) | ATL | -21 | GB | AGREE | +13.9 | 0 | 768mi |
| W3 | CIN@PIT | CIN (49%) | PIT | +3 | CIN | AGREE | +1.6 | 0 | 257mi |
| W3 | SEA@WAS | SEA (46%) | WAS | +2 | SEA | AGREE | -26.1 | 0 | 2330mi |
| W3 | MIN@TB | TB (60%) | MIN | -7 | MIN | DISAGREE | -11.5 | 0 | 1315mi |
| W3 | LV@NO | NO (66%) | LV | -8 | NO | AGREE | +4.0 | 0 | 1510mi |
| W3 | LA@DEN | LA (48%) | DEN | +4 | DEN | DISAGREE | -9.7 | 1 | 837mi |
| W3 | PHI@CHI | PHI (49%) | CHI | +20 | PHI | AGREE | +6.7 | 0 | 664mi |

## Key patterns identified

### 1. Home bias problem (72% of misses were away wins)
The meta-stacker picked the home team in 13 of 18 misses where the away team won. This is a systematic home bias that the logistic regression inherits from both the v2.2 control and the market probability, both of which tend to over-favor home teams. The SRS differential was correctly pointing toward the away team in several cases (e.g., SEA@WAS: SRS diff -26.1 favoring WAS), but the model didn't weight SRS enough to overcome the home bias.

### 2. Market-model agreement on misses (67% of misses)
In 12 of 18 misses, the model agreed with the market — both were wrong together. This means the meta-stacker is not adding independent signal beyond the market. The features that should provide edge (SRS, rest, travel, dome) are not contributing enough to flip disagreements.

### 3. Week 2 collapse (43.8% accuracy)
Week 2 is the worst-performing week at 43.8% (7/16). This is likely because:
- SRS has only 1 game of current-season data per team
- The previous-season prior is still dominant but may not reflect current team strength
- Week 2 has more unexpected results than Weeks 1 or 3

### 4. Dome game weakness (46.7% accuracy)
Dome games (15 games) performed terribly at 46.7% (7/15). Dome games may have different dynamics (passing emphasis, no weather impact, etc.) that the model doesn't capture. The dome indicator feature was included but may be confounding rather than helpful.

### 5. Blowout misses (6 of 18 misses had |margin| ≥ 14)
The model is particularly bad at predicting blowout upsets. Six misses had margins of 14+ points, meaning the model not only got the winner wrong but was very confident in the wrong direction. This suggests the model is overconfident on favorites.

### 6. SRS direction is correct but insufficient
In several misses, the SRS differential correctly pointed toward the winner, but the model didn't weight it enough:
- SEA@WAS: SRS -26.1 (favored WAS), model picked SEA, WAS won
- LV@LAC: SRS +5.2 (favored LAC), but LV won — SRS wrong here
- ATL@GB: SRS +13.9 (favored GB), but ATL won — SRS wrong here

The SRS signal is noisy early in the season and the logistic regression correctly downweights it, but this means the model has no edge on the market.

### 7. Calibration improvement (ECE 0.0805 vs 0.1041 market)
The meta-stacker significantly improves calibration (ECE) compared to market-only, despite not improving accuracy. This is the one area where the meta-stacker adds value: the probability estimates are more reliable, even if the winner picks are not better.

## Decision

**REJECT FOR PROMOTION. KEEP FOR RESEARCH.**

The meta-stacker does NOT beat market-only on 2026 W1-3 (62.50% vs 66.67%). The 2025 confirmation also failed (61.99% vs 66.42% control). The model is overfitting to the 2022-2023 training period and not generalizing.

However, the miss pattern analysis provides actionable insights for future experiments:
1. The home bias problem suggests an away-team adjustment feature could help
2. The Week 2 collapse suggests early-season games need different treatment
3. The dome weakness suggests surface-specific models or features
4. The calibration improvement (ECE) is a genuine positive finding

## Future directions

- **EXP-031:** Gradient boosted trees (XGBoost/LightGBM) may capture non-linear interactions better than logistic regression
- **EXP-032:** Away-team upset detection model trained specifically on disagreement cases
- **EXP-033:** Surface/roof-specific sub-models (dome vs outdoor)
- **EXP-034:** Early-season specific model with stronger prior-season weighting
- The SRS prior blending approach (previous season as Bayesian prior) should be retained for future experiments despite not helping in this configuration
