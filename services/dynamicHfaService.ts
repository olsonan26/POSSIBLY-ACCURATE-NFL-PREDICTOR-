/**
 * Dynamic Home-Field Advantage Service
 * -----------------------------------
 * Computes a per-franchise rolling 3-season HFA estimate for research.
 * The production v2.2 static HFA remains the control until this signal is
 * independently validated.
 */

export interface HfaContext {
  eloAdvantage: number;
  teamSpecificMultiplier: number;
  /** Backward-compatible alias used by EXP-025 integration/UI. */
  teamMultiplier: number;
  isInternational: boolean;
  hfaLogitEdge: number;
}

export const HOME_ELO_ADVANTAGE = 55;
const TOP_QUARTILE_MULTIPLIER = 1.3;
const BOTTOM_QUARTILE_MULTIPLIER = 0.7;
const INTERNATIONAL_VENUE_KEYS = ['london', 'munich', 'frankfurt', 'mexico', 'toronto', 'sao_paulo'];
const hfaCache = new Map<string, number>();

function computeRollingHfa(homeAbbr: string, games: any[], currentSeason: number): number {
  const cacheKey = `${homeAbbr}:${currentSeason}`;
  const cached = hfaCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const minSeason = currentSeason - 2;
  let homeWins = 0;
  let homeGames = 0;
  let awayWins = 0;
  let awayGames = 0;

  for (const g of games) {
    const season = g.season ?? currentSeason;
    if (season < minSeason || season > currentSeason) continue;

    const gHome = g.homeTeamAbbr ?? g.home_abbr ?? g.homeTeam ?? g.home;
    const gAway = g.awayTeamAbbr ?? g.away_abbr ?? g.awayTeam ?? g.away;
    const homeScore = g.homeScore ?? g.home_score;
    const awayScore = g.awayScore ?? g.away_score;
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

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
  const value = homeGames + awayGames > 0 ? hfa : 0.05;
  hfaCache.set(cacheKey, value);
  return value;
}

function hfaToMultiplier(hfa: number): number {
  if (hfa > 0.10) return TOP_QUARTILE_MULTIPLIER;
  if (hfa < 0.00) return BOTTOM_QUARTILE_MULTIPLIER;
  const t = hfa / 0.10;
  return BOTTOM_QUARTILE_MULTIPLIER + t * (TOP_QUARTILE_MULTIPLIER - BOTTOM_QUARTILE_MULTIPLIER);
}

function eloToLogit(elo: number): number {
  return (elo / 400) * Math.log(10);
}

function detectInternational(neutralSite: boolean, games: any[]): boolean {
  if (!neutralSite) return false;
  for (const g of games) {
    const venue = (g.venue ?? g.venueName ?? g.stadium ?? '').toString().toLowerCase();
    if (INTERNATIONAL_VENUE_KEYS.some((k) => venue.includes(k))) return true;
  }
  return false;
}

export function getDynamicHfa(
  homeAbbr: string,
  awayAbbr: string,
  neutralSite: boolean,
  games: any[],
  currentSeason = new Date().getFullYear(),
): HfaContext {
  void awayAbbr;
  const isInternational = detectInternational(neutralSite, games);

  if (neutralSite || isInternational) {
    return {
      eloAdvantage: 0,
      teamSpecificMultiplier: 0,
      teamMultiplier: 0,
      isInternational,
      hfaLogitEdge: 0,
    };
  }

  const rollingHfa = computeRollingHfa(homeAbbr, games, currentSeason);
  const multiplier = hfaToMultiplier(rollingHfa);
  const adjustedElo = HOME_ELO_ADVANTAGE * multiplier;

  return {
    eloAdvantage: Math.round(adjustedElo),
    teamSpecificMultiplier: multiplier,
    teamMultiplier: multiplier,
    isInternational: false,
    hfaLogitEdge: eloToLogit(adjustedElo),
  };
}
