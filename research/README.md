# Professional football challenger research

Production remains `v2.2-validated-current-season`. None of the experiments in this branch affect production scoring.

## Frozen validation design

- nflverse is the primary free schedule / play-by-play source.
- Build advanced-stat feature model: 2022–2023.
- Tune advanced-stat regularization/calibration: 2024 only.
- Final untouched advanced-stat test: 2025 Weeks 16–18.
- Market blend experiment is evaluated separately from the football-stat model.
- Selective market correction is designed without using 2025 outcomes:
  - market strength beta: 2022–2023
  - correction gate: 2024
  - untouched correction test: 2025 Weeks 16–18
- Baseline-error meta-model is also chronological and leakage-safe:
  - fit coefficients: 2022
  - choose regularization/calibration: 2023
  - refit on 2022–2023
  - choose vulnerability threshold: 2024
  - untouched vulnerability test: 2025 Weeks 16–18

## Results: 2025 Weeks 16–18, 48 games

| Variant | Correct | Accuracy | Brier | Log loss | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| v2.2 baseline | 28/48 | 58.33% | 0.2541 | 0.7048 | Protected production reference |
| Advanced-stat challenger | 23/48 | 47.92% | 0.2939 | 0.8056 | Reject |
| Full market-assisted blend | 29/48 | 60.42% | 0.2701 | 0.7558 | Reject: accuracy +1, probability quality worse |
| Selective market correction | 27/48 | 56.25% | 0.2551 | 0.7067 | Reject |

The advanced-stat challenger changed 17 picks, fixing 6 baseline misses but breaking 11 baseline hits.

The original market blend changed 3 picks, fixing 2 and breaking 1. The two helpful flips were GB @ CHI and NYG @ LV; the harmful flip was TB @ MIA.

The leakage-safe selective correction experiment then tried to learn *when* market disagreement should override v2.2 without looking at the 2025 test outcomes. It selected the following gate from 2024:

- v2.2 confidence <= 55%
- market-cross confidence <= 60%
- absolute closing spread >= 3 points

On 2024, that gate improved 181/272 (66.54%) to 189/272 (69.49%) across 14 flips while slightly improving Brier and log loss.

On untouched 2025 Weeks 16–18, however, the frozen gate triggered only once: TB @ MIA. v2.2 correctly picked Miami and the correction changed the pick to Tampa Bay, making it wrong. The two helpful market flips from the broader market blend were not selected by the frozen gate. Result: 27/48 instead of 28/48.

This is useful evidence against promoting a market-veto rule from this design. The production model stays unchanged.

## Baseline-error vulnerability meta-model

Instead of trying to predict a different winner, this experiment predicts whether the locked v2.2 pick is likely to be wrong. It is advisory only and is not allowed to flip the production winner.

Pregame features:

- v2.2 confidence
- closing-spread support/disagreement and spread magnitude
- overall/pass/rush EPA matchup support
- success-rate and explosive-play support
- turnover-margin support
- sack-rate support
- special-teams EPA/play support

The model uses an 8-game exponentially decayed prior-game window and requires at least four prior games for each team. The selected L2 penalty was 0.3, calibration scale 0.75, and the vulnerability threshold was frozen at 0.425 before examining the held-out 2025 outcomes.

### 2024 threshold-tuning season

- 208 eligible games
- v2.2 errors: 63/208 = 30.29%
- flagged vulnerable: 53 games
- actual v2.2 errors inside flagged set: 33/53 = 62.26%
- recall of all v2.2 errors: 52.38%
- error-concentration lift: 2.06x
- unflagged error rate: 19.35%
- AUC: 0.7419

### Untouched 2025 Weeks 16–18

- 48 games
- v2.2 errors: 20/48 = 41.67%
- flagged vulnerable: 8/48 = 16.67%
- actual errors inside flagged set: 4/8 = 50.00%
- recall of all v2.2 errors: 4/20 = 20.00%
- error-concentration lift: 1.20x
- unflagged error rate: 16/40 = 40.00%
- AUC: 0.6696
- error-probability Brier: 0.2304
- error-probability log loss: 0.6509

Flagged games were LA @ SEA, GB @ CHI, CIN @ MIA, LAC @ DAL, HOU @ LAC, NYG @ LV, TB @ MIA, and SEA @ SF. Four were genuine v2.2 misses (GB @ CHI, CIN @ MIA, HOU @ LAC, NYG @ LV) and four were false alarms.

The frozen test technically meets the predeclared research gate, but only at the boundary: 1.20x lift and 20% recall. That is a weak positive signal, not evidence for a production override. The result supports a larger walk-forward validation of the vulnerability concept while keeping v2.2 winner logic untouched.

## Interpretation

The professional-stat and market experiments do not justify globally changing v2.2. The vulnerability experiment is more promising because it asks a narrower question: *when should we distrust our own prediction?* On the held-out sample it concentrated misses modestly, but not strongly enough to change production behavior.

Next research steps, still isolated from production:

1. Run the frozen vulnerability architecture across substantially larger rolling/walk-forward season blocks and report lift, recall, precision, AUC, Brier, and calibration by season.
2. Test whether vulnerability signal persists when market variables are removed, so we can separate football-stat signal from market signal.
3. Test regime-specific models for low-confidence games, market disagreement, QB changes, and large injury/personnel disruptions without choosing regimes from held-out outcomes.
4. Add verified historical QB/starter availability only when timestamp provenance is available.
5. Do not allow any vulnerability model to alter a production winner unless repeated untouched tests show stable incremental value.
