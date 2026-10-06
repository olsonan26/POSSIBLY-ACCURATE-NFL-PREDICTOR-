/**
 * Preseason Priors Service
 * -----------------------
 * Uses preseason win-total over/under lines as Bayesian priors for team
 * strength. Early in the season these priors carry significant weight;
 * as actual game results accumulate, the prior is down-weighted.
 *
 * The prior is expressed as a logit adjustment that can be blended into
 * the model's final prediction.
 */

import { preseasonWinTotals } from '../data/preseasonWinTotals.js';

export interface PriorContext {
  expectedWinPct: number;
  priorWeight: number;
  priorLogitEdge: number;
}

const GAMES_IN_SEASON = 17;
const PRIOR_WEIGHT_EARLY = 0.30;
const PRIOR_WEIGHT_MID = 0.15;
const PRIOR_WEIGHT_LATE = 0.05;
const PRIOR_LOGIT_CLAMP = 0.3;

function logit(p: number): number {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clamped / (1 - clamped));
}

function getPriorWeight(gamesPlayed: number): number {
  if (gamesPlayed <= 2) return PRIOR_WEIGHT_EARLY;
  if (gamesPlayed <= 7) return PRIOR_WEIGHT_MID;
  return PRIOR_WEIGHT_LATE;
}

export async function getPreseasonPrior(
  teamAbbr: string,
  currentSeason: number,
  targetIso: string,
  gamesPlayed: number,
): Promise<PriorContext> {
  void currentSeason;
  void targetIso;

  const winTotal = preseasonWinTotals[teamAbbr];
  if (winTotal === undefined) {
    return {
      expectedWinPct: 0.5,
      priorWeight: 0,
      priorLogitEdge: 0,
    };
  }

  const expectedWinPct = winTotal / GAMES_IN_SEASON;
  const priorWeight = getPriorWeight(gamesPlayed);
  const rawEdge = logit(expectedWinPct) * priorWeight;
  const priorLogitEdge = Math.max(-PRIOR_LOGIT_CLAMP, Math.min(PRIOR_LOGIT_CLAMP, rawEdge));

  return {
    expectedWinPct,
    priorWeight,
    priorLogitEdge,
  };
}
