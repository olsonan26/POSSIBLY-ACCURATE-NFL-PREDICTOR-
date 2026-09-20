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

## Interpretation

The important result is not that EPA or betting markets are useless. It is that these naive additions do not demonstrate stable incremental value over the existing v2.2 model under a leakage-safe chronological test. A future challenger should target identifiable v2.2 error regimes rather than globally adding more signal.

Potential next research directions, still isolated from production:

1. Baseline-error meta-model: predict whether v2.2 is likely wrong using only pregame disagreement and uncertainty features.
2. Regime-specific EPA: test pass EPA, pressure/sack rate, and turnover indicators only in low-confidence v2.2 games rather than as universal weights.
3. QB-change / starter-value layer with verified historical starter identity and pregame availability timestamps.
4. Larger walk-forward tests before any feature is eligible for promotion.
