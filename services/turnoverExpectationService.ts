/**
 * Turnover Expectation Service
 * ---------------------------
 * Estimates expected interceptions and fumbles for a team based on
 * historical rates and current-season tendencies. Turnover differential
 * is one of the strongest predictors of NFL game outcomes, so we convert
 * the net expectation to a small logit edge.
 *
 * Data source: nflverse weekly stats (GitHub raw, no API key).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TurnoverExpectation {
  /** Expected interceptions thrown per game */
  expectedInts: number;
  /** Expected fumbles lost per game */
  expectedFumbles: number;
  /** Net turnovers: (forced takeaways) − (expected giveaways) */
  expectedNetTurnovers: number;
  /** Logit-space edge derived from net turnover expectation */
  turnoverLogitEdge: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Weight applied to net turnover expectation in logit space. */
export const TURNOVER_LOGIT_WEIGHT = 0.02;

const NFLVERSE_WEEKLY_CSV_URL =
  'https://raw.githubusercontent.com/nflverse/nflverse-data/main/nfl_stats/weekly_stats.csv';

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<TurnoverExpectation | null>>();

function cacheKey(teamAbbr: string, season: number): string {
  return `${teamAbbr}|${season}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TurnoverAggregates {
  interceptions: number;    // INTs thrown by this team's offense
  fumblesLost: number;      // Fumbles lost by this team's offense
  defInterceptions: number; // INTs by this team's defense
  defFumblesRecovered: number;
  games: number;
}

function parseTurnoverCsv(csvText: string, teamAbbr: string): TurnoverAggregates | null {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const teamIdx = idx('team') ?? idx('recent_team');
  const intIdx = idx('interceptions');
  const fumblesLostIdx = idx('fumbles_lost');
  const defIntIdx = idx('def_interceptions');
  const defFumblesRecIdx = idx('def_fumbles_recovered');

  if (teamIdx < 0) return null;

  const agg: TurnoverAggregates = {
    interceptions: 0,
    fumblesLost: 0,
    defInterceptions: 0,
    defFumblesRecovered: 0,
    games: 0,
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const team = (cols[teamIdx] ?? '').trim();
    if (team !== teamAbbr) continue;

    agg.interceptions += parseInt(cols[intIdx] ?? '0', 10) || 0;
    agg.fumblesLost += parseInt(cols[fumblesLostIdx] ?? '0', 10) || 0;
    agg.defInterceptions += parseInt(cols[defIntIdx] ?? '0', 10) || 0;
    agg.defFumblesRecovered += parseInt(cols[defFumblesRecIdx] ?? '0', 10) || 0;
    agg.games += 1;
  }

  return agg.games > 0 ? agg : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the turnover expectation for a team in a given season.
 *
 * @param teamAbbr       Team abbreviation (e.g. "PIT")
 * @param targetIso       ISO date of the target game
 * @param currentSeason   The current NFL season year
 * @returns TurnoverExpectation or null on error
 */
export async function getTurnoverExpectation(
  teamAbbr: string,
  targetIso: string,
  currentSeason: number,
): Promise<TurnoverExpectation | null> {
  const key = cacheKey(teamAbbr, currentSeason);

  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<TurnoverExpectation | null> => {
    try {
      const res = await fetch(NFLVERSE_WEEKLY_CSV_URL);
      if (!res.ok) {
        console.warn(`[turnoverExpectation] Fetch failed: ${res.status}`);
        return null;
      }

      const csvText = await res.text();
      const agg = parseTurnoverCsv(csvText, teamAbbr);
      if (!agg) return null;

      // Per-game averages
  const expectedInts = agg.interceptions / agg.games;
  const expectedFumbles = agg.fumblesLost / agg.games;
  const expectedTakeaways =
    (agg.defInterceptions + agg.defFumblesRecovered) / agg.games;
  const expectedGiveaways = expectedInts + expectedFumbles;
  const expectedNetTurnovers = expectedTakeaways - expectedGiveaways;

  // Convert to logit edge: each net turnover per game is worth ~0.02 logit
  // (a full turnover swing ≈ 4-5 points ≈ ~0.1 logit, so 0.02/turnover
  //  per game is a conservative estimate)
  const turnoverLogitEdge = Math.max(
    -TURNOVER_LOGIT_WEIGHT * 3,
    Math.min(TURNOVER_LOGIT_WEIGHT * 3, expectedNetTurnovers * TURNOVER_LOGIT_WEIGHT),
  );

  return {
    expectedInts: Math.round(expectedInts * 1000) / 1000,
    expectedFumbles: Math.round(expectedFumbles * 1000) / 1000,
    expectedNetTurnovers: Math.round(expectedNetTurnovers * 1000) / 1000,
    turnoverLogitEdge: Math.round(turnoverLogitEdge * 10000) / 10000,
  };
    } catch (err) {
      console.warn(`[turnoverExpectation] Error for ${teamAbbr}:`, err);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
