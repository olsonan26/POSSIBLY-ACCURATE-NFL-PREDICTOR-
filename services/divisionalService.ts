/**
 * Divisional Matchup Service
 * -------------------------
 * Determines whether a game is a divisional matchup and computes a
 * small logit edge for divisional home underdogs — a well-documented
 * market inefficiency in the NFL.
 *
 * The service also tracks whether this is the first or second divisional
 * meeting of the season between the two teams (relevant for familiarity
 * adjustments).
 */

import { isDivisionalGame } from '../data/divisionMap';
import { TEAM_BY_ABBR, normalizeTeamAbbr } from '../data/teamRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DivisionalContext {
  /** True if both teams are in the same NFL division */
  isDivisional: boolean;
  /** 1 for first meeting, 2 for second meeting (regular season) */
  divisionalGameNumber: number;
  /** True if the home team is the underdog (weaker prior record) */
  homeIsUnderdog: boolean;
  /** Logit edge applied to the home team (divisional home-dog bonus) */
  divisionalLogitEdge: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Logit bonus for divisional home underdogs (market inefficiency). */
const DIVISIONAL_HOME_DOG_LOGIT_EDGE = 0.03;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count how many times these two teams have already played each other
 * this season (within the provided `games` array).
 */
function countPriorMeetings(
  homeAbbr: string,
  awayAbbr: string,
  targetIso: string,
  games: any[],
): number {
  const targetDate = new Date(targetIso).getTime();
  let count = 0;

  for (const g of games) {
    const gDate = new Date(g.gameday ?? g.date ?? g.targetDate ?? g.isoDate ?? '').getTime();
    if (isNaN(gDate) || gDate >= targetDate) continue;

    const gHome = normalizeTeamAbbr(g.homeTeamAbbr ?? g.home_abbr ?? g.home);
    const gAway = normalizeTeamAbbr(g.awayTeamAbbr ?? g.away_abbr ?? g.away);

    // Match either direction: home/away or away/home
    if (
      (gHome === homeAbbr && gAway === awayAbbr) ||
      (gHome === awayAbbr && gAway === homeAbbr)
    ) {
      count++;
    }
  }

  return count;
}

/**
 * Roughly determine if the home team is the underdog based on prior
 * season games. We compare win percentages of both teams using the
 * games provided (all from the current season).
 */
function isHomeUnderdog(homeAbbr: string, awayAbbr: string, games: any[]): boolean {
  function winPct(team: string): number {
    let wins = 0;
    let played = 0;
    for (const g of games) {
      const gHome = normalizeTeamAbbr(g.homeTeamAbbr ?? g.home_abbr ?? g.home);
      const gAway = normalizeTeamAbbr(g.awayTeamAbbr ?? g.away_abbr ?? g.away);
      if (gHome !== team && gAway !== team) continue;

      played++;
      const homeScore = g.homeScore ?? g.home_score ?? 0;
      const awayScore = g.awayScore ?? g.away_score ?? 0;
      const isHome = gHome === team;
      const myScore = isHome ? homeScore : awayScore;
      const oppScore = isHome ? awayScore : homeScore;

      if (myScore > oppScore) wins++;
    }
    if (played === 0) return false; // no data → treat home as non-underdog
    return wins / played;
  }

  return winPct(homeAbbr) < winPct(awayAbbr);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the divisional context for a given game.
 *
 * @param homeAbbr  Home team abbreviation
 * @param awayAbbr  Away team abbreviation
 * @param targetIso ISO date string of the target game
 * @param games     Array of prior regular-season games (same season)
 */
export function getDivisionalContext(
  homeAbbr: string,
  awayAbbr: string,
  targetIso: string,
  games: any[],
): DivisionalContext {
  const divisional = isDivisionalGame(homeAbbr, awayAbbr);

  if (!divisional) {
    return {
      isDivisional: false,
      divisionalGameNumber: 0,
      homeIsUnderdog: false,
      divisionalLogitEdge: 0,
    };
  }

  const priorMeetings = countPriorMeetings(homeAbbr, awayAbbr, targetIso, games);
  const gameNumber = priorMeetings + 1; // this game is the Nth meeting
  const homeIsUnderdog = isHomeUnderdog(homeAbbr, awayAbbr, games);

  const edge = homeIsUnderdog ? DIVISIONAL_HOME_DOG_LOGIT_EDGE : 0;

  return {
    isDivisional: true,
    divisionalGameNumber: gameNumber,
    homeIsUnderdog,
    divisionalLogitEdge: edge,
  };
}
