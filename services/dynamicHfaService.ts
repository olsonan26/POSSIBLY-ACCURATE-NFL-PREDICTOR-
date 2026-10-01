/**
 * Dynamic Home-Field Advantage Service
 * -----------------------------------
 * Replaces the static HOME_ELO_ADVANTAGE constant with a per-franchise,
 * rolling 3-season HFA estimate. Teams with historically strong home-field
 * advantages (e.g. Arrowhead, Lumen Field) get a multiplier > 1, while
 * teams with weak HFA get a multiplier < 1.
 *
 * The base Elo advantage remains 55 (matching the legacy constant), and
 * the team-specific multiplier scales it. International games get 0 HFA.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HfaContext {
  /** Base Elo advantage for home-field (typically 55) */
  eloAdvantage: number;
  /** Multiplier derived from rolling 3-season HFA (0.7 – 1.3) */
  teamSpecificMultiplier: number;
  /** True if the game is played internationally (London, Munich, etc.) */
  isInternational: boolean;
  /** Final HFA logit edge applied to the home team */
  hfaLogitEdge: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default Elo advantage for home-field, matching the legacy constant. */
export const HOME_ELO_ADVANTAGE = 55;

/** HFA multipliers by quartile of historical home win-rate differential. */
const TOP_QUARTILE_MULTIPLIER = 1.3;
const BOTTOM_QUARTILE_MULTIPLIER = 0.7;

/** Games known to be played at international neutral sites. */
const INTERNATIONAL_VENUE_KEYS = ['london', 'munich', 'frankfurt', 'mexico', 'toronto', 'sao_paulo'];

// ---------------------------------------------------------------------------
// In-memory cache: rolling HFA per franchise per 3-season window
// ---------------------------------------------------------------------------

const hfaCache = new Map<string, number>(); // teamAbbr → rolling HFA win% diff

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute rolling 3-season HFA for a franchise.
 *
 * HFA = (homeWinPct − awayWinPct) over the trailing 3 seasons.
 * If insufficient data, return 0.05 (a neutral default ~ league average).
 */
function computeRollingHfa(homeAbbr: string, games: any[], currentSeason: number): number {
  const cached = hfaCache.get(homeAbbr);
  if (cached !== undefined) return cached;

  const minSeason = currentSeason - 2; // trailing 3 seasons inclusive
  let homeWins = 0;
  let homeGames = 0;
  let awayWins = 0;
  let awayGames = 0;

  for (const g of games) {
    const season = g.season ?? currentSeason;
    if (season < minSeason || season > currentSeason) continue;

    const gHome = g.homeTeamAbbr ?? g.home_abbr ?? g.home;
    const gAway = g.awayTeamAbbr ?? g.away_abbr ?? g.away;
    const homeScore = g.homeScore ?? g.home_score ?? 0;
    const awayScore = g.awayScore ?? g.away_score ?? 0;

    if (gHome === homeAbbr) {
      homeGames++;
      if (homeScore > awayScore) homeWins++;
    } else if (gAway === homeAbbr) {
      awayGames++;
      if (awayScore > homeScore) awayWins++;
    }
  }

  const homeWinPct = homeGames > 0 ? homeWins / homeGames : 0.5;
  const awayWinPct = awayGames > 0 ? awayWins / awayGames : 0.5;
  const hfa = homeWinPct - awayWinPct;

  // Cache and return (default to a small positive HFA if no data)
  const value = homeGames + awayGames > 0 ? hfa : 0.05;
  hfaCache.set(homeAbbr, value);
  return value;
}

/**
 * Map a rolling HFA win% differential to a multiplier.
 *
 * Top quartile (HFA > 0.10) → 1.3x
 * Bottom quartile (HFA < 0.00) → 0.7x
 * Everything else → linear interpolation between 0.7 and 1.3
 */
function hfaToMultiplier(hfa: number): number {
  if (hfa > 0.10) return TOP_QUARTILE_MULTIPLIER;
  if (hfa < 0.00) return BOTTOM_QUARTILE_MULTIPLIER;
  // Linear interpolation: 0.00 → 0.7, 0.10 → 1.3
  const t = hfa / 0.10; // 0 → 1
  return BOTTOM_QUARTILE_MULTIPLIER + t * (TOP_QUARTILE_MULTIPLIER - BOTTOM_QUARTILE_MULTIPLIER);
}

/** Convert Elo advantage to logit space. */
function eloToLogit(elo: number): number {
  // Standard Elo → expected score conversion: E = 1 / (1 + 10^(-elo/400))
  // logit(E) = ln(E / (1-E)) = (elo / 400) * ln(10) ≈ elo * 0.005756
  return (elo / 400) * Math.log(10);
}

function detectInternational(neutralSite: boolean, games: any[], homeAbbr: string): boolean {
  if (!neutralSite) return false;
  // Heuristic: if the most recent game for this home team has an
  // international venue key, treat as international.
  for (const g of games) {
    const venue = (g.venue ?? g.venueName ?? '').toString().toLowerCase();
    if (INTERNATIONAL_VENUE_KEYS.some((k) => venue.includes(k))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the dynamic home-field advantage context for a game.
 *
 * @param homeAbbr    Home team abbreviation
 * @param awayAbbr    Away team abbreviation
 * @param neutralSite True if the game is at a neutral site
 * @param games       Array of prior games (for rolling HFA computation)
 */
export function getDynamicHfa(
  homeAbbr: string,
  awayAbbr: string,
  neutralSite: boolean,
  games: any[],
): HfaContext {
  const currentSeason = new Date().getFullYear();
  const isInternational = detectInternational(neutralSite, games, homeAbbr);

  if (isInternational) {
    return {
      eloAdvantage: 0,
      teamSpecificMultiplier: 0,
      isInternational: true,
      hfaLogitEdge: 0,
    };
  }

  const rollingHfa = computeRollingHfa(homeAbbr, games, currentSeason);
  const multiplier = hfaToMultiplier(rollingHfa);
  const adjustedElo = HOME_ELO_ADVANTAGE * multiplier;

  return {
    eloAdvantage: Math.round(adjustedElo),
    teamSpecificMultiplier: multiplier,
    isInternational: false,
    hfaLogitEdge: eloToLogit(adjustedElo),
  };
}
