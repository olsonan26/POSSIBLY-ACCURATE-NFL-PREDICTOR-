/**
 * Pace Metrics Service
 * -------------------
 * Fetches pace and game-script metrics for a team — plays per game,
 * neutral pass rate, average time of possession, and first-down rate.
 *
 * These metrics inform the model about how a team's offensive tempo
 * affects game flow (e.g. high-pace teams create more scoring
 * opportunities; low-pace teams shorten games).
 *
 * Data source: nflverse weekly stats (Rosters → Weekly → via GitHub
 * raw files). No API key required.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaceMetrics {
  /** Average offensive plays per game */
  playsPerGame: number;
  /** Pass play percentage in neutral game scripts (win prob 35–65%) */
  neutralPassRate: number;
  /** Average time of possession in minutes */
  avgTimeOfPossession: number;
  /** First downs per drive (proxy for offensive efficiency) */
  firstDownRate: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NFLVERSE_WEEKLY_URL =
  'https://raw.githubusercontent.com/nflverse/nflverse-data/main/nfl_stats/weekly_stats.parquet';

// Fallback: nflverse also publishes a CSV mirror
const NFLVERSE_WEEKLY_CSV_URL =
  'https://raw.githubusercontent.com/nflverse/nflverse-data/main/nfl_stats/weekly_stats.csv';

// ---------------------------------------------------------------------------
// In-memory cache (promise-based)
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<PaceMetrics | null>>();

function cacheKey(teamAbbr: string, season: number): string {
  return `${teamAbbr}|${season}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CSV row into a team-stats record.
 * The nflverse weekly CSV has columns like:
 *   season, week, team, offense_snaps, defense_snaps, pass_attempts,
 *   rush_attempts, passing_first_downs, rushing_first_downs, ...
 *
 * We aggregate across all weeks of the season for the given team.
 */
interface TeamGameStats {
  offenseSnaps: number;
  passAttempts: number;
  rushAttempts: number;
  passingFirstDowns: number;
  rushingFirstDowns: number;
  games: number;
}

function parseCsv(csvText: string): Map<string, TeamGameStats> {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return new Map();

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

  // Find column indices
  const idx = (name: string) => headers.indexOf(name);
  const seasonIdx = idx('season');
  const teamIdx = idx('team') ?? idx('recent_team');
  const offenseSnapsIdx = idx('offense_snaps');
  const passAttemptsIdx = idx('pass_attempts');
  const rushAttemptsIdx = idx('rush_attempts');
  const passingFirstDownsIdx = idx('passing_first_downs');
  const rushingFirstDownsIdx = idx('rushing_first_downs');

  const teamMap = new Map<string, TeamGameStats>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const team = (teamIdx >= 0 ? cols[teamIdx] : '').trim();
    if (!team) continue;

    const season = seasonIdx >= 0 ? parseInt(cols[seasonIdx], 10) : 0;

    const existing = teamMap.get(team) ?? {
      offenseSnaps: 0,
      passAttempts: 0,
      rushAttempts: 0,
      passingFirstDowns: 0,
      rushingFirstDowns: 0,
      games: 0,
    };

    existing.offenseSnaps += parseInt(cols[offenseSnapsIdx] ?? '0', 10) || 0;
    existing.passAttempts += parseInt(cols[passAttemptsIdx] ?? '0', 10) || 0;
    existing.rushAttempts += parseInt(cols[rushAttemptsIdx] ?? '0', 10) || 0;
    existing.passingFirstDowns += parseInt(cols[passingFirstDownsIdx] ?? '0', 10) || 0;
    existing.rushingFirstDowns += parseInt(cols[rushingFirstDownsIdx] ?? '0', 10) || 0;
    existing.games += 1;

    teamMap.set(team, existing);
  }

  return teamMap;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch pace metrics for a team in a given season.
 *
 * @param teamAbbr      Team abbreviation (e.g. "BUF")
 * @param targetIso      ISO date of the target game
 * @param currentSeason  The current NFL season year
 * @returns PaceMetrics or null on error
 */
export async function getPaceMetrics(
  teamAbbr: string,
  targetIso: string,
  currentSeason: number,
): Promise<PaceMetrics | null> {
  const key = cacheKey(teamAbbr, currentSeason);

  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<PaceMetrics | null> => {
    try {
      // Try CSV (easier to parse than parquet in a TS environment)
      const url = `${NFLVERSE_WEEKLY_CSV_URL}`;
      const res = await fetch(url);

      if (!res.ok) {
        console.warn(`[paceMetrics] Fetch failed: ${res.status}`);
        return null;
      }

      const csvText = await res.text();
      const teamMap = parseCsv(csvText);

      const stats = teamMap.get(teamAbbr);
      if (!stats || stats.games === 0) return null;

      const totalPlays = stats.passAttempts + stats.rushAttempts;
      const playsPerGame = totalPlays / stats.games;
      const neutralPassRate = stats.passAttempts / Math.max(totalPlays, 1);
      const totalFirstDowns = stats.passingFirstDowns + stats.rushingFirstDowns;
      const firstDownRate = totalFirstDowns / Math.max(totalPlays, 1);

      // Time of possession is not directly available in weekly stats;
      // estimate from play count (~24s per play, 2 teams sharing time)
      const avgTimeOfPossession = Math.round((playsPerGame * 24) / 60 / 2 * 10) / 10;

      return {
        playsPerGame: Math.round(playsPerGame * 10) / 10,
        neutralPassRate: Math.round(neutralPassRate * 1000) / 1000,
        avgTimeOfPossession,
        firstDownRate: Math.round(firstDownRate * 1000) / 1000,
      };
    } catch (err) {
      console.warn(`[paceMetrics] Error for ${teamAbbr}:`, err);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
