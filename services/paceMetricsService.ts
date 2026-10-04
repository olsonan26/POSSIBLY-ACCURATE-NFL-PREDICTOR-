/**
 * Pace Metrics Service
 * -------------------
 * Point-in-time-safe pace/game-flow proxies from nflverse team weekly stats.
 * Only weeks completed before the target game's NFL week are eligible.
 */

import {
  getTeamStatsBeforeTarget,
  hasRequiredTeamStatsFields,
  TeamStatsRow,
} from './pointInTimeTeamStats';

export interface PaceMetrics {
  /** Average offensive plays per game */
  playsPerGame: number;
  /** Overall pass-play share proxy */
  neutralPassRate: number;
  /** Estimated average time of possession in minutes */
  avgTimeOfPossession: number;
  /** Offensive first downs per play */
  firstDownRate: number;
}

const cache = new Map<string, Promise<PaceMetrics | null>>();

function cacheKey(teamAbbr: string, targetIso: string, season: number): string {
  return `${teamAbbr}|${season}|${targetIso}`;
}

function numberFrom(row: TeamStatsRow, field: string): number {
  const value = Number.parseFloat(row[field] ?? '');
  return Number.isFinite(value) ? value : 0;
}

export async function getPaceMetrics(
  teamAbbr: string,
  targetIso: string,
  currentSeason: number,
): Promise<PaceMetrics | null> {
  const key = cacheKey(teamAbbr, targetIso, currentSeason);
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<PaceMetrics | null> => {
    try {
      const pointInTime = await getTeamStatsBeforeTarget(teamAbbr, targetIso, currentSeason);
      if (!pointInTime || pointInTime.rows.length === 0) return null;

      const required = [
        'season',
        'week',
        'team',
        'attempts',
        'carries',
        'passing_first_downs',
        'rushing_first_downs',
      ];
      if (!hasRequiredTeamStatsFields(pointInTime, required)) {
        console.warn(`[paceMetrics] Required nflverse columns are unavailable for ${teamAbbr}; feature disabled.`);
        return null;
      }

      let passAttempts = 0;
      let rushAttempts = 0;
      let passingFirstDowns = 0;
      let rushingFirstDowns = 0;

      for (const row of pointInTime.rows) {
        passAttempts += numberFrom(row, 'attempts');
        rushAttempts += numberFrom(row, 'carries');
        passingFirstDowns += numberFrom(row, 'passing_first_downs');
        rushingFirstDowns += numberFrom(row, 'rushing_first_downs');
      }

      const games = pointInTime.rows.length;
      const totalPlays = passAttempts + rushAttempts;
      if (games === 0 || totalPlays <= 0) return null;

      const playsPerGame = totalPlays / games;
      const neutralPassRate = passAttempts / totalPlays;
      const firstDownRate = (passingFirstDowns + rushingFirstDowns) / totalPlays;

      // Team weekly summary data does not expose time of possession. Retain the
      // existing conservative play-count proxy rather than fabricate a source field.
      const avgTimeOfPossession = Math.round(((playsPerGame * 24) / 60 / 2) * 10) / 10;

      return {
        playsPerGame: Math.round(playsPerGame * 10) / 10,
        neutralPassRate: Math.round(neutralPassRate * 1000) / 1000,
        avgTimeOfPossession,
        firstDownRate: Math.round(firstDownRate * 1000) / 1000,
      };
    } catch (error) {
      console.warn(`[paceMetrics] Error for ${teamAbbr}:`, error);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
