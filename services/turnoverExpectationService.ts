/**
 * Turnover Expectation Service
 * ---------------------------
 * Point-in-time-safe turnover tendency estimates from nflverse team weekly
 * stats. The target game's week is never included.
 */

import {
  getTeamStatsBeforeTarget,
  hasRequiredTeamStatsFields,
  TeamStatsRow,
} from './pointInTimeTeamStats';

export interface TurnoverExpectation {
  /** Expected interceptions thrown per game */
  expectedInts: number;
  /** Expected fumbles lost per game */
  expectedFumbles: number;
  /** Net turnovers: takeaways minus giveaways */
  expectedNetTurnovers: number;
  /** Logit-space edge derived from net turnover expectation */
  turnoverLogitEdge: number;
}

export const TURNOVER_LOGIT_WEIGHT = 0.02;

const cache = new Map<string, Promise<TurnoverExpectation | null>>();

function cacheKey(teamAbbr: string, targetIso: string, season: number): string {
  return `${teamAbbr}|${season}|${targetIso}`;
}

function numberFrom(row: TeamStatsRow, field: string): number {
  const value = Number.parseFloat(row[field] ?? '');
  return Number.isFinite(value) ? value : 0;
}

export async function getTurnoverExpectation(
  teamAbbr: string,
  targetIso: string,
  currentSeason: number,
): Promise<TurnoverExpectation | null> {
  const key = cacheKey(teamAbbr, targetIso, currentSeason);
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<TurnoverExpectation | null> => {
    try {
      const pointInTime = await getTeamStatsBeforeTarget(teamAbbr, targetIso, currentSeason);
      if (!pointInTime || pointInTime.rows.length === 0) return null;

      const required = [
        'season',
        'week',
        'team',
        'passing_interceptions',
        'sack_fumbles_lost',
        'rushing_fumbles_lost',
        'receiving_fumbles_lost',
        'def_interceptions',
        'fumble_recovery_opp',
      ];
      if (!hasRequiredTeamStatsFields(pointInTime, required)) {
        console.warn(`[turnoverExpectation] Required nflverse columns are unavailable for ${teamAbbr}; feature disabled.`);
        return null;
      }

      let interceptions = 0;
      let fumblesLost = 0;
      let defensiveInterceptions = 0;
      let opponentFumblesRecovered = 0;

      for (const row of pointInTime.rows) {
        interceptions += numberFrom(row, 'passing_interceptions');
        fumblesLost +=
          numberFrom(row, 'sack_fumbles_lost') +
          numberFrom(row, 'rushing_fumbles_lost') +
          numberFrom(row, 'receiving_fumbles_lost');
        defensiveInterceptions += numberFrom(row, 'def_interceptions');
        opponentFumblesRecovered += numberFrom(row, 'fumble_recovery_opp');
      }

      const games = pointInTime.rows.length;
      if (games === 0) return null;

      const expectedInts = interceptions / games;
      const expectedFumbles = fumblesLost / games;
      const expectedTakeaways = (defensiveInterceptions + opponentFumblesRecovered) / games;
      const expectedGiveaways = expectedInts + expectedFumbles;
      const expectedNetTurnovers = expectedTakeaways - expectedGiveaways;

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
    } catch (error) {
      console.warn(`[turnoverExpectation] Error for ${teamAbbr}:`, error);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
