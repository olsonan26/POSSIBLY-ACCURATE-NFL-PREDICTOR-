# Accuracy Audit Results — 2026-09-18

Audit branch only. No production prediction logic was changed.

## Out-of-sample-style full-season backtest

Source of completed game outcomes: nflverse `nfldata/data/games.csv`.
Prediction function: repository `predictWinner()` from `services/numerologyService.ts`.
Tied games are excluded because the app makes a binary winner choice.

### 2025 regular season

- Binary decisions tested: 271 (272 games minus one tie)
- Correct: 140
- Incorrect: 131
- Accuracy: 51.66%
- Correct:incorrect ratio: 1.069
- Actual home winners: 146
- Actual away winners: 125
- Accuracy when the actual winner was home: 52.74%
- Accuracy when the actual winner was away: 50.40%
- Predictor home picks: 139 (51.29%)
- Predictor away picks: 132 (48.71%)
- Accuracy when predictor picked home: 55.40%
- Accuracy when predictor picked away: 47.73%
- Always-home baseline: 53.87%
- Lift versus always-home baseline: -2.21 percentage points
- Mean claimed confidence: 65.1%
- Mean Brier score: 0.2719
- Neutral-site games in sample: 7

Confidence calibration:
- 52–59% claimed confidence: 81 picks, 50.62% accurate, 55.8% mean confidence
- 60–69% claimed confidence: 104 picks, 52.88% accurate, 64.1% mean confidence
- 70–78% claimed confidence: 86 picks, 51.16% accurate, 75.2% mean confidence

### 2026 completed regular season through 2026-09-17

- Games tested: 17
- Correct: 12
- Incorrect: 5
- Accuracy: 70.59%
- Correct:incorrect ratio: 2.4
- Actual home winners: 11
- Actual away winners: 6
- Accuracy when actual winner was home: 63.64%
- Accuracy when actual winner was away: 83.33%
- Predictor home picks: 8
- Predictor away picks: 9
- Accuracy when predictor picked home: 87.50%
- Accuracy when predictor picked away: 55.56%
- Always-home baseline: 64.71%
- Lift versus always-home baseline: +5.88 percentage points
- Mean claimed confidence: 65.1%
- Mean Brier score: 0.2349

This sample is too small to treat 70.59% as stable performance.

### Combined 2025 + completed 2026

- Games tested: 288
- Correct: 152
- Incorrect: 136
- Accuracy: 52.78%
- Correct:incorrect ratio: 1.118
- Actual home winners: 157
- Actual away winners: 131
- Accuracy when actual winner was home: 53.50%
- Accuracy when actual winner was away: 51.91%
- Predictor home picks: 147
- Predictor away picks: 141
- Accuracy when predictor picked home: 57.14%
- Accuracy when predictor picked away: 48.23%
- Always-home baseline: 54.51%
- Lift versus always-home baseline: -1.73 percentage points
- Mean claimed confidence: 65.1%
- Mean Brier score: 0.2697

Combined confidence calibration:
- 52–59%: 87 picks, 54.02% accurate, 55.8% mean confidence
- 60–69%: 110 picks, 52.73% accurate, 64.1% mean confidence
- 70–78%: 91 picks, 51.65% accurate, 75.3% mean confidence
- Incorrect predictions at >=70% claimed confidence: 44

## Historical database integrity audit

Repository file: `data/historicalGames.ts`.

- Records: 1,365
- First stored date: 9/1/2020
- Last stored date: 1/26/2025
- Declared outcomes: Home 509, Away 827, Tie 29
- Score-implied outcomes: Home 627, Away 693, Tie 45
- Winner name contradicts stored score: 120 rows (8.8%)
- Tied score but a winner/loser is declared: 45 rows (3.3%)
- Winner home/away label contradicts score: 136 rows (10.0%)
- Loser name contradicts stored score: 120 rows
- Pattern fields with malformed whitespace/newlines: 5 rows
- Weekday distribution: Sun 188, Mon 212, Tue 169, Wed 187, Thu 194, Fri 196, Sat 219
- Tuesday + Wednesday + Friday games: 552 rows (40.4%)
- Same-date duplicate team appearances: 26
- Team rest intervals under 3 days: 189
- Team rest intervals under 4 days: 328

The historical file is not reliable enough to call a verified NFL game-results database. Because DE/day/combo/precedent statistics are derived from these rows, label/data errors propagate into prediction scores.

## Important implementation findings

- Home field advantage is a flat +8 score for the designated home team.
- Neutral sites are not represented by the UI/API and therefore receive the home bonus when entered as home/away.
- There is no general team-specific home/away model.
- There is no general venue performance model.
- Direct head-to-head only influences precedent selection/relevance; it is not modeled as a calibrated, recency-weighted series statistic.
- Buffalo-vs-Detroit in Buffalo receives a one-off hard-coded +14 venue/series adjustment; no equivalent generic system exists for other matchups.
- Blindside tackle is calculated for the UI breakdown but is not included in the final scoring aggregate.
- Chaos/upset warnings are calculated/displayed but do not change the final score.
- No backup QB, kicker, full roster, injury/availability, recent-form, current-season strength, opponent-adjusted efficiency, weather, travel, rest, or dynamic depth-chart variables exist in the Team type/scoring model.
- Personnel are hard-coded and not date-versioned, so backtesting a historical date still uses the same static personnel table.
- The confidence value is a deterministic transformation of internal score margin, capped at 78%; it is not calibrated against observed prediction correctness.
- Many scoring channels reuse the same historical rows/pattern labels, creating correlated/double-counted evidence.

## Current-personnel findings (repo table vs 2026)

The hard-coded table is materially stale. Examples include:
- Seattle QB stored as Geno Smith; 2026 Week 1 starter list has Sam Darnold.
- Indianapolis QB stored as Anthony Richardson; 2026 Week 1 starter list has Daniel Jones.
- New Orleans QB stored as Derek Carr; 2026 Week 1 starter list has Tyler Shough.
- Giants QB stored as Daniel Jones; 2026 Week 1 starter list has Jaxson Dart.
- Minnesota QB stored as J.J. McCarthy; 2026 Week 1 starter list has Kyler Murray.
- Tennessee QB stored as Will Levis; 2026 Week 1 starter list has Cam Ward.
- Las Vegas QB stored as Gardner Minshew; 2026 Week 1 starter list has Kirk Cousins.
- Arizona QB stored as Kyler Murray; 2026 Week 1 starter list has Jacoby Brissett.
- Pittsburgh QB stored as Russell Wilson; 2026 Week 1 starter list has Aaron Rodgers.
- Miami QB stored as Tua Tagovailoa; 2026 Week 1 starter list has Malik Willis.
- Atlanta QB stored as Michael Penix Jr.; the 2026 Week 1 QB list has Tua Tagovailoa, while game-specific availability can differ, reinforcing the need for a game-level starter source rather than one static QB field.
- New York Jets QB stored as Aaron Rodgers; 2026 Week 1 starter list has Geno Smith.

The coaching table is also materially stale (including 2025 and 2026 hiring-cycle changes such as Ben Johnson/CHI, Brian Schottenheimer/DAL, Liam Coen/JAX, Mike Vrabel/NE, Kellen Moore/NO, Aaron Glenn/NYJ, Mike LaFleur/ARI, Kevin Stefanski/ATL, Jesse Minter/BAL, Joe Brady/BUF, Todd Monken/CLE, Klint Kubiak/LV, Jeff Hafley/MIA, John Harbaugh/NYG, Mike McCarthy/PIT and Robert Saleh/TEN).

Additional stale personnel examples:
- Miami still stores retired LT Terron Armstead.
- Houston still stores Laremy Tunsil after his 2025 trade to Washington.
- NY Jets still store retired LT Tyron Smith.
- Indianapolis still stores late owner Jim Irsay instead of the post-May-2025 ownership structure.
- Green Bay stores Mark Murphy in the Owner field even though the Packers are community-owned and Murphy retired as President/CEO in July 2025.
- Tampa Bay uses `Glazer family` with a synthetic-looking `1/1/1970` birthday; this placeholder is passed into numerology calculations.

## Interpretation

The combined 288-game result is the most useful current estimate from this audit: 52.78%, below the always-home baseline on the same games. The 17-game 2026 slice is encouraging but too small and too affected by stale game-state inputs to establish a new accuracy level.

The correct next step is not to tune weights around known misses. First rebuild the result/personnel data layer, freeze time-based training and validation windows, and only then fit/calibrate football and numerology features on training seasons and evaluate once on untouched future seasons.
