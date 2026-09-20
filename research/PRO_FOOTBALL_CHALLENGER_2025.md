# Professional Football Challenger — 2025 Held-Out Test

Status: **research-only; do not promote to production**

Production model remains `v2.2-validated-current-season`.

## Free data source

Primary research feed: **nflverse**.

Inputs used:

- `nfldata/data/games.csv` for schedule, outcomes, and closing spread benchmark
- `nflverse-data` play-by-play releases for 2022–2025

Why this source was selected for the experiment:

- free/open access
- machine-readable play-by-play
- stable game IDs
- EPA field at play level
- enough history to build strictly pregame rolling features
- reproducible automated downloads

## Advanced football features tested

All advanced features for a game were built from **completed games before that game only**. No future game statistics were allowed into a prediction.

1. Overall EPA matchup edge
2. Pass EPA matchup edge
3. Rush EPA matchup edge
4. Success-rate matchup edge
5. Explosive-play matchup edge
6. Turnover margin-rate edge
7. Sack-rate matchup edge
8. Special-teams EPA/play edge

Feature history used an 8-game current-season rolling window with exponential decay `0.85` and required at least four prior games for each team.

## Validation protocol

- Model-building sample: 2022–2023
- Tuning season: 2024 only
- Frozen final test: 2025 regular-season Weeks 16–18
- Test games: 48
- Production v2.2 was scored on the exact same 48 games
- Winner accuracy, Brier score, log loss, and changed-pick audit were recorded

No 2025 Week 16–18 result was used to choose a weight, feature, threshold, or calibration constant.

## Result 1 — advanced-stat-only challenger

| Model | Correct | Accuracy | Brier | Log loss |
|---|---:|---:|---:|---:|
| Production v2.2 | 28 / 48 | 58.33% | 0.2541 | 0.7048 |
| Advanced-stat challenger | 23 / 48 | 47.92% | 0.2939 | 0.8056 |
| Closing-spread favorite benchmark | 29 / 48 | 60.42% | — | — |

The advanced-stat challenger changed 17 production picks. It fixed 6 v2.2 misses but broke 11 v2.2 hits.

**Promotion gate: FAIL.**

The result does not show that EPA or efficiency data are useless. It shows that this standalone advanced-stat formulation did not beat the validated production model on the untouched three-week test and should not replace it.

## Result 2 — market-assisted production model

A second experiment kept v2.2 as the base and applied a pregame closing-spread logit adjustment. The market weight was chosen using 2024 only, then frozen for the 2025 Week 16–18 test.

| Model | Correct | Accuracy | Brier | Log loss |
|---|---:|---:|---:|---:|
| Production v2.2 | 28 / 48 | 58.33% | 0.2541 | 0.7048 |
| v2.2 + market adjustment | 29 / 48 | 60.42% | 0.2701 | 0.7558 |
| Closing-spread favorite | 29 / 48 | 60.42% | — | — |

The market-assisted model changed 3 picks, fixing 2 misses and breaking 1 correct production pick. Accuracy improved by one game, but Brier and log loss both worsened.

**Strict promotion gate: FAIL.**

The closing spread is also timing-dependent: a true closing line is only known near kickoff. It cannot be treated as available days earlier.

## Decision

Do **not** modify the production winner logic from these experiments.

The production model stays locked. The professional-stat and market layers remain research tools until a future challenger shows stable incremental value across a larger untouched sample without sacrificing probability quality.

## Reproducibility

Run:

```bash
bun run football-challenger
bun scripts/market-challenger-2025.mjs
```

Machine-readable reports:

- `research/pro-football-challenger-2025-w16-18.json`
- `research/market-challenger-2025-w16-18.json`
