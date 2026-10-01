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

import { PRESEASON_WIN_TOTALS, SEASON } from '../data/preseasonWinTotals';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriorContext {
  /** Expected win percentage derived from win total / 17 */
  expectedWinPct: number;
  /** Weight (0–1) applied to the prior, decreasing as season progresses */
  priorWeight: number;
  /** Logit-space edge: logit(expectedWinPct) * priorWeight, clamped */
  priorLogitEdge: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAMES_IN_SEASON = 17;

/** Prior weights by season phase. */
const PRIOR_WEIGHT_EARLY = 0.30;   // Weeks 1–3 (0–2 games played)
const PRIOR_WEIGHT_MID = 0.15;     // Weeks 4–8 (3–7 games played)
const PRIOR_WEIGHT_LATE = 0.05;    // Weeks 9+ (8+ games played)

/** Clamp for the prior logit edge. */
const PRIOR_LOGIT_CLAMP = 0.3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard logistic function: logit(p) = ln(p / (1 - p)) */
function logit(p: number): number {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Determine the prior weight based on how many games have been played.
 *
 * 0–2 games  → 0.30 (early season, strong prior)
 * 3–7 games  → 0.15 (mid season, moderate prior)
 * 8+ games   → 0.05 (late season, weak prior)
 */
function getPriorWeight(gamesPlayed: number): number {
  if (gamesPlayed <= 2) return PRIOR_WEIGHT_EARLY;
  if (gamesPlayed <= 7) return PRIOR_WEIGHT_MID;
  return PRIOR_WEIGHT_LATE;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the preseason prior for a team.
 *
 * @param teamAbbr       Team abbreviation (e.g. "KC")
 * @param currentSeason  The current NFL season year
 * @param targetIso       ISO date of the target game (unused for now but
 *                        available for future week-based weighting)
 * @param gamesPlayed     Number of games the team has already played
 */
export function getPreseasonPrior(
  teamAbbr: string,
  currentSeason: number,
  targetIso: string,
  gamesPlayed: number,
): PriorContext {
  const winTotal = PRESEASON_WIN_TOTALS[teamAbbr];

  // Neutral default if team not found
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
