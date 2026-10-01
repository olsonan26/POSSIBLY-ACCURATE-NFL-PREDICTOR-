/**
 * Special Teams EPA Service
 * ------------------------
 * Fetches special-teams EPA (expected points added) for a team —
 * kicking, punting, and return units. Special teams can swing field
 * position significantly, so we convert EPA to a small logit edge.
 *
 * Data source: nflverse weekly stats (GitHub raw, no API key).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecialTeamsStats {
  /** EPA from field-goal and extra-point kicking */
  kickingEpa: number;
  /** EPA from punting (net field position) */
  puntingEpa: number;
  /** EPA from kick/punt returns */
  returnEpa: number;
  /** Sum of all special-teams EPA */
  totalStEpa: number;
  /** Logit-space edge derived from total ST EPA */
  stLogitEdge: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Weight applied to total ST EPA to convert to logit space. */
export const ST_EPA_LOGIT_WEIGHT = 0.03;

const NFLVERSE_WEEKLY_CSV_URL =
  'https://raw.githubusercontent.com/nflverse/nflverse-data/main/nfl_stats/weekly_stats.csv';

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<SpecialTeamsStats | null>>();

function cacheKey(teamAbbr: string, season: number): string {
  return `${teamAbbr}|${season}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StAggregates {
  fgEpa: number;
  xpEpa: number;
  puntEpa: number;
  kickReturnEpa: number;
  puntReturnEpa: number;
  games: number;
}

function parseStCsv(csvText: string, teamAbbr: string): StAggregates | null {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const teamIdx = idx('team') ?? idx('recent_team');
  const fgEpaIdx = idx('field_goal_epa');
  const xpEpaIdx = idx('extra_point_epa');
  const puntEpaIdx = idx('punt_epa');
  const kickReturnEpaIdx = idx('kick_return_epa');
  const puntReturnEpaIdx = idx('punt_return_epa');

  if (teamIdx < 0) return null;

  const agg: StAggregates = {
    fgEpa: 0,
    xpEpa: 0,
    puntEpa: 0,
    kickReturnEpa: 0,
    puntReturnEpa: 0,
    games: 0,
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const team = (cols[teamIdx] ?? '').trim();
    if (team !== teamAbbr) continue;

    agg.fgEpa += parseFloat(cols[fgEpaIdx] ?? '0') || 0;
    agg.xpEpa += parseFloat(cols[xpEpaIdx] ?? '0') || 0;
    agg.puntEpa += parseFloat(cols[puntEpaIdx] ?? '0') || 0;
    agg.kickReturnEpa += parseFloat(cols[kickReturnEpaIdx] ?? '0') || 0;
    agg.puntReturnEpa += parseFloat(cols[puntReturnEpaIdx] ?? '0') || 0;
    agg.games += 1;
  }

  return agg.games > 0 ? agg : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch special-teams EPA stats for a team in a given season.
 *
 * @param teamAbbr       Team abbreviation (e.g. "BAL")
 * @param targetIso       ISO date of the target game
 * @param currentSeason   The current NFL season year
 * @returns SpecialTeamsStats or null on error
 */
export async function getSpecialTeamsStats(
  teamAbbr: string,
  targetIso: string,
  currentSeason: number,
): Promise<SpecialTeamsStats | null> {
  const key = cacheKey(teamAbbr, currentSeason);

  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<SpecialTeamsStats | null> => {
    try {
      const res = await fetch(NFLVERSE_WEEKLY_CSV_URL);
      if (!res.ok) {
        console.warn(`[specialTeams] Fetch failed: ${res.status}`);
        return null;
      }

      const csvText = await res.text();
      const agg = parseStCsv(csvText, teamAbbr);
      if (!agg) return null;

      const kickingEpa = agg.fgEpa + agg.xpEpa;
      const puntingEpa = agg.puntEpa;
      const returnEpa = agg.kickReturnEpa + agg.puntReturnEpa;
      const totalStEpa = kickingEpa + puntingEpa + returnEpa;

      // Normalize to per-game average, then apply logit weight
      const perGameTotal = totalStEpa / agg.games;
      const stLogitEdge = Math.max(
        -ST_EPA_LOGIT_WEIGHT,
        Math.min(ST_EPA_LOGIT_WEIGHT, perGameTotal * ST_EPA_LOGIT_WEIGHT / 5),
      );

      return {
        kickingEpa: Math.round(kickingEpa * 100) / 100,
        puntingEpa: Math.round(puntingEpa * 100) / 100,
        returnEpa: Math.round(returnEpa * 100) / 100,
        totalStEpa: Math.round(totalStEpa * 100) / 100,
        stLogitEdge: Math.round(stLogitEdge * 10000) / 10000,
      };
    } catch (err) {
      console.warn(`[specialTeams] Error for ${teamAbbr}:`, err);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
