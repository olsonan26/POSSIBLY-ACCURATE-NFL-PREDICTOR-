# EXP-027: Officiating Crew Tendencies

## Hypothesis

Officiating crew tendencies — computed only from games before the target game and heavily shrunk toward league average — may add small but measurable pregame predictive value beyond v2.2.

**Control:** v2.2-validated-current-season  
**Challenger:** v2.2 + officiating crew tendency logit edge  
**Evaluation:** Select on 2024; confirm on untouched 2025; observe 2026  
**Primary metrics:** Brier score, log loss, ECE  
**Secondary metrics:** Winner accuracy, paired flips, exact paired p-value  
**Status:** PROPOSED  

---

## Background

The v2.2 control model uses Elo, current-season form, venue context, H2H, live personnel, and the EXP-025 Tier 1-3 features (EPA, weather, travel, dynamic HFA, divisional, preseason priors, pace, special teams, turnover expectation). It does not account for officiating crew tendencies.

Galekwa et al. (2024) noted that feature engineering in sports prediction has evolved beyond basic statistics to include contextual variables like venue effects, referee tendencies, and team chemistry indicators ([Galekwa et al., arXiv:2410.21484, 2024](https://arxiv.org/abs/2410.21484)). Published referee betting trend analysis using nflverse data across 1,918 games and 17 active officials found that most crew-level effects are not statistically significant after correcting for multiple comparisons, but penalty rate differences between crews appear to be the most defensible finding ([Rotowire, 2026](https://www.rotowire.com/football/article/nfl-referee-assignments-betting-trends-by-crew-133202)).

The key insight from the user's research: the relevant metric is not "Referee Smith's home teams win 62%" — it is "After controlling for pregame team strength, Smith's home teams historically outperform expectation by X, with Y games of evidence." Small samples must be heavily shrunk toward zero to avoid creating noise-driven edges.

---

## Data Sources

### Officials data (full crew)

- **URL:** `https://github.com/nflverse/nflverse-data/releases/download/officials/officials.csv`
- **Source:** nflverse/nflverse-data GitHub releases
- **Available seasons:** 2015 onwards
- **Columns:** `game_id`, `game_key`, `official_name`, `position`, `jersey_number`, `official_id`, `season`, `season_type`, `week`
- **One row per game per official** — a typical game has 7 officials (Referee, Umpire, Down Judge, Line Judge, Field Judge, Side Judge, Back Judge)
- **Position `Referee`** is the head official

### Games data (head referee + surface + stadium)

- **URL:** `http://www.habitatring.com/games.csv`
- **Available seasons:** 2006 onwards
- **Relevant fields:** `game_id`, `season`, `week`, `gameday`, `home_team`, `away_team`, `home_score`, `away_score`, `result`, `total`, `referee` (head official name, available from 2020 data addition), `surface`, `stadium`, `roof`, `temp`, `wind`, `spread_line`, `total_line`

### Play-by-play data (penalty details)

- **URL:** nflverse PBP data (via `nflreadr`/`nflreadpy` or direct CSV from releases)
- **Available seasons:** 1999 onwards
- **Relevant fields:**
  - `penalty` — binary indicator for whether a penalty occurred on the play
  - `penalty_team` — string abbreviation of the team with the penalty
  - `penalty_type` — string indicating the penalty type (e.g., "Defensive Pass Interference", "Offensive Holding", "Roughing the Passer")
  - `penalty_yards` — yards gained or lost by the posteam from the penalty
  - `penalty_player_id`, `penalty_player_name` — player who committed the penalty
  - `drive_yards_penalized` — total offensive penalty yards on the drive

### Crew identification

NFL crews are stable within a season but can change across seasons due to retirements, promotions, and NFL officiating development program rotations. Three approaches to crew identification should be tested:

1. **`head_ref_id`**: Use only the head referee's `official_id`. Simplest, most sample, but may not capture crew-level effects beyond the referee's individual tendencies.

2. **`crew_signature`**: Hash the sorted list of all official IDs assigned to a game. Captures full crew composition. However, exact crew signatures may be sparse (crews change across seasons), so this variant is diagnostic/research-only unless it accumulates enough sample.

3. **`member_average`**: Compute each assigned official's prior tendencies individually (optionally weighted by position — Referee, Umpire, Down Judge may have different influence on different penalty types), then average across the crew. This avoids the sparsity problem of `crew_signature` while still using full crew data.

The `head_ref_id` approach uses the methodology described by the nflverse community ([Brad Congelio, nflverse analytics guide](https://bradcongelio.com/nfl-analytics-with-r-book/03-nfl-analytics-functions.html)):

1. Filter officials data to `position == "Referee"` to identify each game's head official
2. Assign a `crew_id` based on the referee's `official_id`
3. Join back to full officials data to get all crew members per game
4. Group penalty data by `game_id` and join to officials data

**Note:** games data starts in 2006 and includes a `referee` field; verify non-null coverage before using pre-2015 head-ref data. Full crew data is only available from 2015 onwards via the officials dataset.

---

## Feature Design

### Crew tendency metrics

All metrics are computed only from games with `gameday < targetIso` (strictly before the target game's kickoff). Same-week and target-game plays are excluded.

#### Penalty-based metrics

| Metric | Description | Shrinkage K | Rationale |
|---|---|---|---|
| `crew_flags_per_game` | Average total penalties per game called by this crew | 16, 32 | Penalty frequency varies by crew; moderate sample needed |
| `crew_home_penalty_diff` | (Home penalties - Away penalties) per game, averaged | 32, 64 | Home/away penalty split; needs larger sample due to noise |
| `crew_home_yard_diff` | (Home penalty yards - Away penalty yards) per game | 32, 64 | Yardage differential; noisier than counts |
| `crew_dpi_rate` | Defensive Pass Interference calls per game | 64, 128 | Rare subjective call; needs large sample |
| `crew_def_holding_rate` | Defensive Holding calls per game | 64, 128 | Rare subjective call |
| `crew_roughing_rate` | Roughing the Passer calls per game | 64, 128 | Rare subjective call |
| `crew_off_holding_rate` | Offensive Holding calls per game | 32, 64 | More common but still needs shrinkage |

#### Outcome-based metrics

| Metric | Description | Shrinkage K | Rationale |
|---|---|---|---|
| `crew_home_residual` | Average (actual_home_win - control_p_home) across games officiated by this crew | 32, 64 | Residual over/underperformance vs. pregame Elo; the key metric |
| `crew_home_margin_residual` | Average (actual_margin - expected_margin) where expected_margin is from v2.2 | 32, 64 | Point-based residual; may capture penalty-driven margin effects |
| `crew_total_residual` | Average (actual_total - expected_total) where expected_total is from v2.2 or market total_line | 32, 64 | Total points residual; penalties may inflate scoring |
| `crew_favorite_cover_rate` | Fraction of games where the favorite covered the spread | 32, 64 | Spread-specific; research only |

### Shrinkage formula

Empirical-Bayes shrinkage toward league average:

```
shrunk_value = league_avg + (n / (n + K)) * (crew_rate - league_avg)
```

Where:
- `league_avg` = league-wide average for that metric in the same season
- `n` = number of prior games officiated by this crew (career-to-date, not just current season)
- `K` = shrinkage constant (pre-declared per metric above)
- When `n = 0`, shrunk_value = league_avg (neutral)
- When `n → ∞`, shrunk_value → crew_rate (full trust in crew data)

### Penalty yard normalization

**Important:** The nflverse `penalty_yards` field is recorded from the posteam (possessing team) perspective — positive means yards gained by the posteam from the penalty, negative means yards lost. This is NOT the same as "yards against the penalized team."

To correctly compute home/away penalty yard differentials, normalize as follows:

```typescript
// For each penalty play:
// penalty_team = the team that committed the penalty
// penalty_yards = yards from posteam perspective (positive = posteam gained yards)
//
// To get yards penalized against a specific team:
// if penalty_team === home_team: homePenaltyYards += abs(penalty_yards)
// if penalty_team === away_team: awayPenaltyYards += abs(penalty_yards)
//
// This ensures penalty yards are always attributed to the penalized team,
// regardless of possession direction.

const homePenaltyYards = penaltyPlays
  .filter(p => p.penalty_team === homeTeam)
  .reduce((sum, p) => sum + Math.abs(p.penalty_yards), 0);

const awayPenaltyYards = penaltyPlays
  .filter(p => p.penalty_team === awayTeam)
  .reduce((sum, p) => sum + Math.abs(p.penalty_yards), 0);
```

### Standardization

Each shrunk metric is converted to a z-score relative to the league-wide distribution of crew rates:

```
z = (shrunk_value - league_mean) / league_std
z_capped = clamp(z, -2, 2)
```

### Logit edge

The final logit adjustment is:

```
crew_logit_edge = weight * z_capped
```

Where `weight` is pre-declared (see below).

---

## Pre-declared Parameters

### Shrinkage profiles

To prevent overfitting from a large grid, only two K profiles are tested:

| Profile | flags K | yards K | subjective K | residual K | Description |
|---|---|---|---|---|---|
| `LIGHT` | 16 | 32 | 64 | 32 | Less shrinkage; trusts crew data sooner |
| `HEAVY` | 32 | 64 | 128 | 64 | More shrinkage; requires more evidence |

### Logit weights

All weights are pre-declared before evaluating on 2024. These cannot be reselected after evaluating on 2025.

| Candidate Weight | Description |
|---|---|
| `0.00` | Control (no officiating adjustment) |
| `0.01` | Minimal — barely above noise floor |
| `0.02` | Conservative — small edge from crew tendencies |
| `0.03` | Moderate — if signal is strong |
| `0.05` | Aggressive — only if backtest shows clear separation |

### Feature families

To further prevent overfitting, only three feature families are tested:

| Family | Description |
|---|---|
| `penalty_only` | Penalty-based metrics only (flags, yard diff, subjective call rates) |
| `residual_only` | Outcome residuals only (home win residual, margin residual, total residual) |
| `combined` | All metrics combined |

### Crew identification variants

| Variant | Description |
|---|---|
| `head_ref_id` | Head referee only (games.csv `referee` field, 2006+; officials.csv `position == "Referee"`, 2015+) |
| `crew_signature` | Hash of sorted all-official-IDs per game (2015+); diagnostic/research-only if sparse |
| `member_average` | Average of each assigned official's prior tendencies, optionally position-weighted (2015+) |
| `career_to_date` | All prior games for this crew across seasons (time window: career) |
| `recent_20` | Last 20 games for this crew (time window: recent, with higher implicit shrinkage) |

### Tie-break rule

When multiple candidates are within a Brier tolerance of 0.0005, select the simplest candidate (lowest weight, `LIGHT` profile, `penalty_only` or `residual_only` family, `head_ref_id` variant). This prevents chasing noise.

**Brier-selected weight, K profile, feature family, and crew variant from 2024 discovery will be locked for 2025 confirmation.**

---

## Timestamp Rules

### Critical concern: Pregame availability of crew assignments

NFL officiating crew assignments are typically announced by the NFL the Tuesday or Wednesday before each game week. However, the nflverse `officials.csv` data is a historical record — it records which officials were assigned after the game was played.

**Production rule:** Production use requires a pregame-captured assignment source with timestamp proof that the crew assignment was known before kickoff. The nflverse `officials.csv` data is a historical record — it records which officials were assigned after the game was played. Historical officials data is valid for research backtests only, since in reality the NFL publishes assignments before the game is played. Until a live pregame assignment capture pipeline exists, this feature is research-only.

**Research/backtest rule:** For walk-forward backtesting, using historical crew assignments is valid because the crew was known before the game in reality — the NFL publishes assignments midweek. The backtest is testing whether the crew information, if known pregame, adds value.

### Specific timestamp rules

| Feature | Timestamp Rule |
|---|---|
| `crew_flags_per_game` | Computed from all games with `gameday < targetIso` officiated by this crew |
| `crew_home_penalty_diff` | Same — prior games only |
| `crew_dpi_rate` | Same — prior games only |
| `crew_home_residual` | Computed from prior games where `control_p_home` was available (v2.2 prediction existed) |
| `crew_home_margin_residual` | Same — prior games only |
| Any feature | If crew assignment for target game is not confirmed pregame, feature = 0 (neutral) |

### Missing-data rules

| Condition | Rule |
|---|---|
| Crew has 0 prior games | All features = 0 (neutral) |
| Crew has < 5 prior games | Shrinkage handles this — shrunk toward league average |
| `officials.csv` does not cover target season | Fall back to `referee` field from games.csv (head referee only) |
| `games.csv` referee field is missing | Feature = 0 (neutral) |
| Play-by-play penalty data is missing for a prior game | Exclude that game from crew tendency computation |
| Target game is preseason | Crew tendencies not computed ( preseason officiating assignments are inconsistent) |

---

## Implementation

### Data extraction script

```typescript
// scripts/official-tendency-extract.ts

import { mkdir, writeFile } from 'node:fs/promises';

const OFFICIALS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/officials/officials.csv';
const GAMES_URL = 'http://www.habitatring.com/games.csv';

// Penalty types to track as "subjective calls"
const SUBJECTIVE_PENALTY_TYPES = [
  'Defensive Pass Interference',
  'Defensive Holding',
  'Roughing the Passer',
  'Offensive Holding',
  'Illegal Contact',
  'Unnecessary Roughness',
  'Face Mask',
  'Tripping',
  'Illegal Use of Hands',
] as const;

interface OfficialRow {
  gameId: string;
  gameKey: string;
  officialName: string;
  position: string;
  jerseyNumber: number;
  officialId: string;
  season: number;
  seasonType: string;
  week: number;
}

interface GameRow {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  result: number;
  total: number;
  referee: string;
  surface: string;
  stadium: string;
  roof: string;
  temp: number | null;
  wind: number | null;
  spreadLine: number | null;
  totalLine: number | null;
}

interface CrewTendency {
  crewId: string;
  refereeName: string;
  games: number;
  // Penalty-based
  flagsPerGame: number;
  homePenaltyDiff: number;
  homeYardDiff: number;
  dpiRate: number;
  defHoldingRate: number;
  roughingRate: number;
  offHoldingRate: number;
  // Outcome-based
  homeResidual: number;
  homeMarginResidual: number;
  totalResidual: number;
  favoriteCoverRate: number;
  // Shrunk versions
  shrunkFlagsPerGame: number;
  shrunkHomePenaltyDiff: number;
  shrunkHomeYardDiff: number;
  shrunkDpiRate: number;
  shrunkDefHoldingRate: number;
  shrunkRoughingRate: number;
  shrunkOffHoldingRate: number;
  shrunkHomeResidual: number;
  shrunkHomeMarginResidual: number;
  shrunkTotalResidual: number;
  shrunkFavoriteCoverRate: number;
}
```

### Crew tendency computation

```typescript
// scripts/official-tendency-extract.ts (continued)

/**
 * Compute empirical-Bayes shrunk crew tendency.
 *
 * shrunk = leagueAvg + (n / (n + K)) * (crewRate - leagueAvg)
 *
 * @param crewRate  The crew's observed rate
 * @param leagueAvg League-wide average rate
 * @param n         Number of prior games for this crew
 * @param K         Shrinkage constant
 */
function shrink(
  crewRate: number,
  leagueAvg: number,
  n: number,
  K: number
): number {
  if (n === 0) return leagueAvg;
  return leagueAvg + (n / (n + K)) * (crewRate - leagueAvg);
}

/**
 * Convert a raw value to a capped z-score.
 */
function zScore(
  value: number,
  leagueMean: number,
  leagueStd: number
): number {
  if (leagueStd === 0) return 0;
  const z = (value - leagueMean) / leagueStd;
  return Math.max(-2, Math.min(2, z));
}

/**
 * Compute the logit edge from crew tendencies.
 *
 * This function is called for each target game. It:
 * 1. Looks up the crew assigned to the target game
 * 2. Computes crew tendencies from all prior games
 * 3. Applies shrinkage
 * 4. Converts to z-scores
 * 5. Applies the pre-declared logit weight
 */
async function computeCrewTendencyEdge(
  targetGameId: string,
  targetKickoffIso: string,
  weight: number,
  shrinkageK: { flags: number; yards: number; subjective: number; residual: number }
): Promise<{ logitEdge: number; source: string; n: number } | null> {
  // 1. Look up crew for target game
  const crew = await getCrewForGame(targetGameId);
  if (!crew || crew.refereeName === '') return null;

  // 2. Compute prior games for this crew
  const priorGames = await getPriorGamesForCrew(crew.crewId, targetKickoffIso);
  if (priorGames.length === 0) return null;

  // 3. Compute league averages for the same season
  const leagueAvgs = await getLeagueAveragesForSeason(crew.season);

  // 4. Compute crew rates
  const flagsPerGame = priorGames.reduce((s, g) => s + g.totalFlags, 0) / priorGames.length;
  const homePenDiff = priorGames.reduce((s, g) => s + (g.homeFlags - g.awayFlags), 0) / priorGames.length;
  const homeYardDiff = priorGames.reduce((s, g) => s + (g.homePenYards - g.awayPenYards), 0) / priorGames.length;
  const dpiRate = priorGames.reduce((s, g) => s + g.dpiCount, 0) / priorGames.length;
  const defHoldingRate = priorGames.reduce((s, g) => s + g.defHoldingCount, 0) / priorGames.length;
  const roughingRate = priorGames.reduce((s, g) => s + g.roughingCount, 0) / priorGames.length;
  const offHoldingRate = priorGames.reduce((s, g) => s + g.offHoldingCount, 0) / priorGames.length;

  // Outcome-based (requires v2.2 predictions for prior games)
  const homeResidual = priorGames.reduce((s, g) => s + (g.actualHomeWin ? 1 : 0) - g.controlPHome, 0) / priorGames.length;
  const homeMarginResidual = priorGames.reduce((s, g) => s + g.actualMargin - g.expectedMargin, 0) / priorGames.length;
  const totalResidual = priorGames.reduce((s, g) => s + g.actualTotal - g.expectedTotal, 0) / priorGames.length;

  // 5. Apply shrinkage
  const n = priorGames.length;
  const shrunkFlags = shrink(flagsPerGame, leagueAvgs.flagsPerGame, n, shrinkageK.flags);
  const shrunkHomePenDiff = shrink(homePenDiff, leagueAvgs.homePenDiff, n, shrinkageK.yards);
  const shrunkHomeYardDiff = shrink(homeYardDiff, leagueAvgs.homeYardDiff, n, shrinkageK.yards);
  const shrunkDpi = shrink(dpiRate, leagueAvgs.dpiRate, n, shrinkageK.subjective);
  const shrunkDefHolding = shrink(defHoldingRate, leagueAvgs.defHoldingRate, n, shrinkageK.subjective);
  const shrunkRoughing = shrink(roughingRate, leagueAvgs.roughingRate, n, shrinkageK.subjective);
  const shrunkOffHolding = shrink(offHoldingRate, leagueAvgs.offHoldingRate, n, shrinkageK.subjective);
  const shrunkHomeResidual = shrink(homeResidual, 0, n, shrinkageK.residual);
  const shrunkHomeMarginResidual = shrink(homeMarginResidual, 0, n, shrinkageK.residual);
  const shrunkTotalResidual = shrink(totalResidual, 0, n, shrinkageK.residual);

  // 6. Convert to z-scores
  const zFlags = zScore(shrunkFlags, leagueAvgs.flagsPerGame, leagueAvgs.flagsStd);
  const zHomePenDiff = zScore(shrunkHomePenDiff, leagueAvgs.homePenDiff, leagueAvgs.homePenDiffStd);
  const zHomeResidual = zScore(shrunkHomeResidual, 0, leagueAvgs.homeResidualStd);
  const zHomeMarginResidual = zScore(shrunkHomeMarginResidual, 0, leagueAvgs.homeMarginResidualStd);

  // 7. Combine into single logit edge
  // Primary signal: home residual (outcome-based, controlling for team strength)
  // Secondary signal: penalty differential (may affect game flow)
  // Weight is pre-declared; z-scores are capped to [-2, 2]
  const combinedZ = (zHomeResidual + zHomeMarginResidual + zHomePenDiff) / 3;
  const logitEdge = weight * combinedZ;

  return {
    logitEdge,
    source: `${crew.refereeName} (n=${n})`,
    n,
  };
}
```

### Integration into v2.2

The crew tendency edge is added to the existing logit aggregation:

```
logit(p_final) = logit(p_elo)
  + football_adj + venue_adj + personnel_adj + h2h_adj
  + epa_adj + weather_adj + travel_adj + dynamic_hfa_adj
  + divisional_adj + preseason_prior_adj + pace_adj
  + special_teams_adj + turnover_adj
  + crew_tendency_adj    // NEW: from EXP-027
```

The `crew_tendency_adj` defaults to 0 when:
- Crew assignment is not confirmed pregame
- Crew has 0 prior games
- Officials data does not cover the target season
- The feature is in research-only mode

---

## Evaluation Protocol

### Discovery: 2024 season

1. Compute crew tendencies for all 2024 regular season games using only prior games
2. Test the pre-declared weight grid: [0.00, 0.01, 0.02, 0.03, 0.05]
3. Test two shrinkage profiles: `LIGHT` and `HEAVY`
4. Test three feature families: `penalty_only`, `residual_only`, `combined`
5. Test crew identification variants: `head_ref_id`, `member_average` (skip `crew_signature` if sparse)
6. Test time windows: `career_to_date`, `recent_20`
7. Apply tie-break rule when candidates are within Brier tolerance of 0.0005
8. Select by Brier score on 2024
9. Lock the selected weight, K profile, feature family, crew variant, and time window

### Confirmation: 2025 season (untouched)

1. Apply the locked weight, K profile, feature family, crew variant, and time window to 2025
2. Do not retune any parameter
3. Compare against v2.2 control:
   - Winner accuracy: challenger vs. 180/271 = 66.42%
   - Brier: challenger vs. 0.2250
   - Log loss: challenger vs. 0.6416
   - ECE: challenger vs. 0.0840
4. Compute paired flips and exact paired p-value
5. Record results in the experiment ledger

### Observation: 2026 season

1. Apply the locked configuration to 2026 games
2. Record accuracy, Brier, log loss, ECE
3. Do not promote or reject based on 2026 alone

### Decision criteria

- **PROMOTE** if: 2025 Brier < control AND 2025 winner accuracy ≥ control AND paired p < 0.10
- **KEEP FOR RESEARCH** if: 2025 Brier < control but winner accuracy does not improve, or p ≥ 0.10
- **REJECT** if: 2025 Brier ≥ control AND 2025 winner accuracy < control

### Post-confirmation ablation (diagnostic only)

After confirmation, the following ablations may be run as diagnostics but cannot be used to retune the locked model:

- Penalty-based only (drop outcome residuals)
- Outcome-based only (drop penalty metrics)
- Head referee only vs. full crew
- Career-to-date vs. recent 20 games
- Individual penalty type ablation (DPI only, holding only, roughing only)

---

## Leakage Guards

1. Crew tendencies use only games with `gameday < targetIso`
2. Same-week and target-game plays are excluded from penalty computation
3. Outcome residuals use only prior games where a v2.2 prediction was available
4. League averages are computed only from games with `gameday < targetIso`; if same-season sample is insufficient, fall back to prior complete seasons
5. Crew assignments must be confirmed pregame for production use
6. Preseason games are excluded from crew tendency computation
7. Playoff games are included in crew tendency computation (crews are assigned to playoffs based on regular-season performance, which is known before playoff games)
8. Neutral-site games (`location !== "Home"`): home/away penalty differentials and outcome residuals are set to 0 (no home advantage to measure)
9. Promotion to production is blocked until a pregame-captured official assignment source with timestamps exists

---

## Relationship to EXP-026

If EXP-027 is promoted to production, the crew tendency edge feeds into the EXP-026 architecture at two points:

1. **Layer 1 (Pure Football Baseline):** `crew_tendency_adj` is added to the logit stack as another feature edge, subject to the double-counting guard (the crew tendency is computed from penalty and outcome data, not from the same EPA/pace features already in the logit stack)

2. **Layer 5 (Coach Tendency & Contextual Signal Layer):** Crew tendencies can be stored as a structured contextual signal in `expertSignalRegistry.ts` with:
   - `category: 'matchup_specific'`
   - `author: 'official-tendency-extract.ts'`
   - `productionAllowed: true` (if promoted)
   - `expirationRule: 'crew assignment must be confirmed pregame'`

The Monte Carlo simulator (Layer 3) could also incorporate crew penalty rates into drive simulation — e.g., higher DPI rate increases expected passing yards, higher holding rate increases expected sack/penalty yardage. This integration is deferred until EXP-027 is confirmed.

---

## Academic Sources

### Primary

1. **Galekwa, R. M., Tshimula, J. M., Tajeuna, E., & Kyamakya, K. (2024).** "A Systematic Review of Machine Learning in Sports Betting: Techniques, Challenges, and Future Directions." *arXiv preprint arXiv:2410.21484*.  
   DOI: [10.48550/arXiv.2410.21484](https://doi.org/10.48550/arXiv.2410.21484)  
   URL: [https://arxiv.org/abs/2410.21484](https://arxiv.org/abs/2410.21484)  
   *Notes that feature engineering in sports prediction has evolved to include contextual variables like referee tendencies alongside venue effects and team chemistry indicators.*

### Supporting

2. **Rotowire (2026).** "NFL Week 4 Referee Assignments: Betting Trends by Crew."  
   URL: [https://www.rotowire.com/football/article/nfl-referee-assignments-betting-trends-by-crew-133202](https://www.rotowire.com/football/article/nfl-referee-assignments-betting-trends-by-crew-133202)  
   *Analysis of 1,918 games across 17 active NFL officials. Tested home ATS, favorite ATS, over/under performance, and penalty rate. Most crew-level effects are not significant after correcting for multiple comparisons, but penalty rate differences appear to be the most defensible finding. Alan Eck's crews average 10.8 penalties/game vs. league average near 12.4.*

3. **Congelio, B. (2026).** "NFL Analytics with the nflverse Family of Packages."  
   URL: [https://bradcongelio.com/nfl-analytics-with-r-book/03-nfl-analytics-functions.html](https://bradcongelio.com/nfl-analytics-with-r-book/03-nfl-analytics-functions.html)  
   *Documents the `load_officials()` function, crew identification methodology using `official_id` of the Referee position to create `crew_id`, and penalty aggregation by crew using play-by-play data joined to officials data.*

4. **nflverse (2026).** "Load Officials — load_officials." *nflreadr documentation*.  
   URL: [https://nflreadr.nflverse.com/reference/load_officials.html](https://nflreadr.nflverse.com/reference/load_officials.html)  
   *Official data dictionary for the officials dataset. One row per game per official. Available from 2015 onwards. Columns: game_id, game_key, official_name, position, jersey_number, official_id, season, season_type, week.*

5. **nflverse (2026).** "Field Descriptions — Play by Play." *nflfastR / DeepWiki*.  
   URL: [https://deepwiki.com/nflverse/nflfastR/9.5-field-descriptions](https://deepwiki.com/nflverse/nflfastR/9.5-field-descriptions)  
   *Documents penalty fields in play-by-play data: `penalty` (binary), `penalty_team` (string abbreviation), `penalty_type` (string — e.g., "Defensive Pass Interference", "Offensive Holding", "Roughing the Passer"), `penalty_yards` (yards gained/lost by posteam), `penalty_player_id`, `penalty_player_name`, `drive_yards_penalized`.*

6. **nflverse (2026).** "DATASETS.md — Games dataset." *nflverse/nfldata GitHub*.  
   URL: [https://github.com/nflverse/nfldata/blob/master/DATASETS.md](https://github.com/nflverse/nfldata/blob/master/DATASETS.md)  
   *Documents the `referee` field (head official name), `surface`, `stadium`, `roof`, `temp`, `wind` fields in the games dataset. Available from 2006 onwards. Import URL: http://www.habitatring.com/games.csv*

---

## Future Experiments (Research Queue)

The following experiments are noted as future research targets. They are not drafted as full experiment documents yet.

### EXP-028: Surface / Stadium Effects

**Hypothesis:** Certain teams perform materially differently on grass vs. turf, dome vs. outdoor, after controlling for pregame team strength.

**Data:** `games.csv` has `surface`, `stadium`, `roof` fields from 2006+. `temp` and `wind` already used in EXP-025.

**Design:** Team-level surface performance residual with heavy shrinkage (K = 32-64). Test grass/turf split, dome/outdoor split. Small samples expected — most teams play >50% of games on their home surface, creating collinearity with HFA.

**Priority:** Low. Likely confounded with home-field advantage and travel effects already in the model.

### EXP-029: Opponent-Adjusted Recent Form

**Hypothesis:** Opponent-adjusting the current-season form component (W/L + point differential) improves prediction beyond raw form.

**Data:** `games.csv` for results; v2.2 Elo for opponent strength.

**Design:** Replace raw current-season form with SRS-style opponent-adjusted form. Note: EXP-006 tested opponent-adjusted point differential as a standalone feature and was rejected (66.05% vs. 66.42%). EXP-029 would test opponent-adjusting the *form component itself* (which also includes W/L and venue context), not just adding a standalone SRS adjustment.

**Priority:** Medium. The distinction from EXP-006 is subtle but meaningful — the question is whether the form component's signal improves when it knows who the wins came against, not whether a standalone strength-of-schedule adjustment adds value.

---

## Experiment Ledger Entry

| ID | Hypothesis | Control | Challenger | Evaluation | Result | Decision |
|---|---|---|---|---|---|---|
| EXP-027 | Officiating crew tendencies, computed from prior games and shrunk toward league average, add predictive value beyond v2.2 | v2.2 | v2.2 + crew tendency logit edge (weight, K, variant selected on 2024) | 2024 select; untouched 2025 confirm; 2026 observe | PENDING | PROPOSED |

---

*This experiment follows the repo's governance: all weights and shrinkage constants are pre-declared before 2024 evaluation. No post-confirmation ablation can be used to retune the same test season and call it untouched. Market-assisted and non-market models must remain separately labeled.*
