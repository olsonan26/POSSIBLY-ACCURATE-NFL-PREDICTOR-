/**
 * Special Teams EPA Service
 * ------------------------
 * Reads only point-in-time-safe team weekly rows. The current nflverse team
 * summary release does not expose special-teams EPA columns, so this service
 * fails closed unless those explicit source fields are present. Missing fields
 * are never converted into zero-valued fake evidence.
 */

import {
  getTeamStatsBeforeTarget,
  hasRequiredTeamStatsFields,
  TeamStatsRow,
} from './pointInTimeTeamStats.js';

export interface SpecialTeamsStats {
  /** EPA from field-goal and extra-point kicking */
  kickingEpa: number;
  /** EPA from punting */
  puntingEpa: number;
  /** EPA from kick/punt returns */
  returnEpa: number;
  /** Sum of all special-teams EPA */
  totalStEpa: number;
  /** Logit-space edge derived from total ST EPA */
  stLogitEdge: number;
}

export const ST_EPA_LOGIT_WEIGHT = 0.03;

const cache = new Map<string, Promise<SpecialTeamsStats | null>>();

function cacheKey(teamAbbr: string, targetIso: string, season: number): string {
  return `${teamAbbr}|${season}|${targetIso}`;
}

function numberFrom(row: TeamStatsRow, field: string): number {
  const value = Number.parseFloat(row[field] ?? '');
  return Number.isFinite(value) ? value : 0;
}

export async function getSpecialTeamsStats(
  teamAbbr: string,
  targetIso: string,
  currentSeason: number,
): Promise<SpecialTeamsStats | null> {
  const key = cacheKey(teamAbbr, targetIso, currentSeason);
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<SpecialTeamsStats | null> => {
    try {
      const pointInTime = await getTeamStatsBeforeTarget(teamAbbr, targetIso, currentSeason);
      if (!pointInTime || pointInTime.rows.length === 0) return null;

      const required = [
        'season',
        'week',
        'team',
        'field_goal_epa',
        'extra_point_epa',
        'punt_epa',
        'kick_return_epa',
        'punt_return_epa',
      ];
      if (!hasRequiredTeamStatsFields(pointInTime, required)) {
        console.warn(`[specialTeams] Explicit EPA columns are unavailable for ${teamAbbr}; feature disabled instead of imputing zeros.`);
        return null;
      }

      let fgEpa = 0;
      let xpEpa = 0;
      let puntEpa = 0;
      let kickReturnEpa = 0;
      let puntReturnEpa = 0;

      for (const row of pointInTime.rows) {
        fgEpa += numberFrom(row, 'field_goal_epa');
        xpEpa += numberFrom(row, 'extra_point_epa');
        puntEpa += numberFrom(row, 'punt_epa');
        kickReturnEpa += numberFrom(row, 'kick_return_epa');
        puntReturnEpa += numberFrom(row, 'punt_return_epa');
      }

      const games = pointInTime.rows.length;
      if (games === 0) return null;

      const kickingEpa = fgEpa + xpEpa;
      const puntingEpa = puntEpa;
      const returnEpa = kickReturnEpa + puntReturnEpa;
      const totalStEpa = kickingEpa + puntingEpa + returnEpa;
      const perGameTotal = totalStEpa / games;
      const stLogitEdge = Math.max(
        -ST_EPA_LOGIT_WEIGHT,
        Math.min(ST_EPA_LOGIT_WEIGHT, (perGameTotal * ST_EPA_LOGIT_WEIGHT) / 5),
      );

      return {
        kickingEpa: Math.round(kickingEpa * 100) / 100,
        puntingEpa: Math.round(puntingEpa * 100) / 100,
        returnEpa: Math.round(returnEpa * 100) / 100,
        totalStEpa: Math.round(totalStEpa * 100) / 100,
        stLogitEdge: Math.round(stLogitEdge * 10000) / 10000,
      };
    } catch (error) {
      console.warn(`[specialTeams] Error for ${teamAbbr}:`, error);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
