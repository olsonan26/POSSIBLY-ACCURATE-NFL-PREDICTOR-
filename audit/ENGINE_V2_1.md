# NFL Predictor v2.1 — Validated Core

Date locked: 2026-09-18

## Why this rebuild exists

The original predictor audit found that the production engine was being undermined by two separate problems:

1. the football/result/personnel data layer was not trustworthy enough for a fair test; and
2. several displayed or heavily weighted variables had never demonstrated independent predictive value on a temporal validation set.

The goal of v2.1 is therefore not to manufacture a high historical accuracy number. It is to create a reproducible, pregame-only prediction process that can be tested prospectively without hindsight fitting.

## Original measured baseline

On the complete 2025 regular season, excluding the one tie because the app makes a binary winner decision:

- Games tested: 271
- Correct: 140
- Incorrect: 131
- Accuracy: 51.66%
- Always-home baseline on the same games: 53.87%
- Lift over always-home: -2.21 percentage points

The original model therefore failed to beat a trivial home-team baseline on the 2025 season.

## Historical data repair

Production scoring no longer uses `data/historicalGames.ts` or the legacy winning/losing-pattern archives as an NFL result source.

Verified football history is loaded from the maintained nflverse `nfldata/data/games.csv` feed. Every historical feature is filtered with a strict rule:

`historical_game_date < selected_game_date`

The selected game and all later games are excluded before any Elo, recent-form, venue, H2H, rest, or numerology statistics are calculated.

This is the core leakage guard.

## Production v2.1 architecture

The production winner probability uses:

1. **Pregame Elo team strength**
   - 1500 starting rating
   - season-to-season regression toward 1500
   - a modest home-field Elo offset outside neutral sites
   - score-margin-sensitive update size
   - only completed games before the prediction date

2. **Recent and current-season football form**
   - recent win/loss performance
   - recency-weighted point differential
   - current-season performance only after enough games exist
   - bounded influence so a short streak cannot overwhelm long-run strength

3. **Home/road performance refinement**
   - team-specific recent home performance
   - opponent-specific recent road performance
   - neutral sites receive no home/road refinement
   - capped influence

4. **Generic venue/head-to-head history**
   - applies to every matchup; there are no special hard-coded franchise pairs
   - same-home-team/same-away-team venue history
   - five-year half-life so old meetings decay substantially
   - Bayesian shrinkage toward neutral
   - reliability increases with sample size
   - hard cap prevents decades-old streaks from overwhelming current team evidence

5. **Current availability context when live data is available**
   - ESPN public NFL roster/depth-chart/injury endpoints
   - current starting QB and backup QB discovery
   - blindside tackle, kicker, key offensive/defensive personnel discovery
   - injuries weighted conservatively by designation and position value
   - total injury adjustment capped
   - current injury data is never backfilled into old historical predictions

## Research-only variables in v2.1

The following variables are still calculated and displayed but do **not** affect the production pick:

- numerology team Daily Essence
- game-day number
- DE/day combinations
- coach numerology
- starting-QB numerology
- backup-QB numerology
- blindside-tackle numerology
- kicker numerology
- legacy 4/7 volatility/chaos marker
- rest differential

Owner numerology and the old exact/subset pattern archives are excluded from production scoring entirely.

This is deliberate. A variable must demonstrate incremental value on a later untouched sample before it can be promoted into production scoring.

## 2025 validation result

2025 is a **validation season**, not a pristine final holdout, because the component-ablation study below was used to choose which v2 components were allowed into production.

All 271 non-tied 2025 regular-season decisions were tested.

### Predeclared component ablation

| Variant | Correct | Accuracy | Brier |
| --- | ---: | ---: | ---: |
| Elo only | 168/271 | 61.99% | 0.2282 |
| Elo + recent/current form | 176/271 | 64.94% | 0.2234 |
| **Core + venue/H2H** | **177/271** | **65.31%** | **0.2243** |
| Football context including rest, no numerology | 175/271 | 64.58% | 0.2245 |
| Football context, no numerology/rest | 177/271 | 65.31% | 0.2243 |
| No numerology/venue/H2H | 174/271 | 64.21% | 0.2236 |
| No numerology/rest/venue/H2H | 176/271 | 64.94% | 0.2234 |
| Research model with numerology + rest | 172/271 | 63.47% | 0.2251 |

At the fixed research weight selected before this ablation was inspected, the numerology layer reduced validation accuracy by 1.11 percentage points relative to the comparable football-context model without numerology. Rest also reduced validation accuracy in this season.

Therefore v2.1 does not allow either factor to change the production winner.

### Locked production validation score

The v2.1 historical production core corresponds to the `Core + venue/H2H` architecture on 2025:

- Games tested: 271
- Correct: 177
- Incorrect: 94
- Accuracy: **65.31%**
- Correct:incorrect ratio: **1.883:1**
- Always-home baseline: **53.87%**
- Lift over always-home: **+11.44 percentage points**

Again: this is a validation result, not a claim that future accuracy will be 65.31%.

## Personnel policy

The old one-row-per-team hard-coded personnel model has been replaced by a current 2026 fallback registry plus live lookup for current/future games.

The fallback registry is intentionally only a backup. Where live roster/depth data is available, the engine attempts to use the current QB1/QB2 and other personnel rather than a permanently hard-coded starter.

For historical games, current live personnel is not substituted backward in time. The game feed's date-specific starting QB and coach names are used when available; if a historical person's verified DOB is unavailable, that person's numerology is omitted rather than invented.

Synthetic birthdays for ownership groups are not permitted in the production model.

## Extreme venue patterns

Extreme historical patterns are no longer ignored, but they are not treated as magical constants either.

A venue series can move the prediction only through the same generic formula used for every team pair. Influence depends on:

- number of same-venue meetings
- recency of each meeting
- decayed weight using a five-year half-life
- Bayesian shrinkage
- a fixed maximum adjustment

This means a recent, repeated venue pattern can matter more than a four-game streak spread across several decades, while still allowing unusual history to contribute evidence.

## UI truthfulness rules

The interface now distinguishes:

- **Scoring input** — actually contributes to the production probability
- **Research only** — calculated/displayed but cannot change the pick

The old artificial 52–78% confidence transformation has been removed. The displayed percentage is the model's computed winner probability from the production scoring path.

Research numerology is explicitly labeled `Not scored in v2.1`.

## Continuous verification

Every pull request to `main` must pass:

1. TypeScript typecheck
2. production Vite build
3. the full 2025 regular-season backtest

The backtest is intentionally season-scale, not a hand-selected list of favorable games.

## Forward-testing policy

The architecture is locked after the 2025 validation pass.

2026 and later completed games should be treated as prospective/forward evidence. Their outcomes must not be used to tweak a coefficient or add a matchup exception and then immediately counted as proof of the revised model.

Numerology, rest, live injury weighting, and any future feature should be promoted or reweighted only after an explicitly defined prospective sample is large enough to evaluate.

The central rule is simple:

> A feature earns production influence by improving future or otherwise untouched predictions consistently—not by explaining games after the final score is already known.
