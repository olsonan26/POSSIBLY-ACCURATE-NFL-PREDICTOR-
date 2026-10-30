/**
 * Ensemble Service
 * ----------------
 * Combines multiple prediction models into a single blended probability
 * using logit-space averaging. Members include:
 *
 * 1. v2.2 model — the primary Elo-based model
 * 2. Market — closing spread/moneyline implied probability (if available)
 * 3. EPA-adjusted model — a simple EPA-based estimator
 *
 * Equal weights are used by default but can be overridden via the
 * `weights` parameter.
 */

import { filterTeamStatsBeforeWeek, getTeamStatsBeforeTarget, type TeamStatsDataset } from './pointInTimeTeamStats.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnsembleMember {
  name: string;
  homeProbability: number | null;   // 0–100; null means unavailable
  weight: number;            // 0–1, normalized internally
}

export interface EnsemblePrediction {
  models: EnsembleMember[];
  /** Blended home win probability (0–100) */
  blendedHomeProbability: number;
  /** Abbreviation of the predicted winner */
  winnerAbbr: string;
  /** Confidence: 50–100, derived from how far the blend is from 50% */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default equal weights for [v2.2, market, EPA] */
const DEFAULT_WEIGHTS = [1 / 3, 1 / 3, 1 / 3];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp probability to [0.01, 0.99] to avoid infinite logits. */
function clampProb(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

/** Convert probability (0–1) to logit space. */
function probToLogit(p: number): number {
  const c = clampProb(p);
  return Math.log(c / (1 - c));
}

/** Convert logit back to probability (0–1). */
function logitToProb(l: number): number {
  return 1 / (1 + Math.exp(-l));
}

/**
 * Simple EPA-based model.
 *
 * Fetches team EPA from nflverse weekly stats and converts to a win
 * probability using a logistic function with EPA differential.
 */
export function epaProbabilityFromDataset(dataset: TeamStatsDataset, home: string, away: string, season: number, week: number): number | null {
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) throw new Error('Exact NFL season and target week required.');
  if (!['season','week','team','passing_epa','rushing_epa','attempts','carries'].every(k => dataset.headers.has(k))) return null;
  const efficiency = (team: string) => {
    const rows = filterTeamStatsBeforeWeek(dataset, team, season, week);
    if (!rows.length || rows.some(r => ['passing_epa','rushing_epa','attempts','carries'].some(k => r[k] === '' || !Number.isFinite(Number(r[k]))))) return null;
    const plays = rows.reduce((n,r) => n + Number(r.attempts) + Number(r.carries),0);
    return plays > 0 ? rows.reduce((n,r) => n + Number(r.passing_epa) + Number(r.rushing_epa),0) / plays : null;
  };
  const h = efficiency(home), a = efficiency(away);
  // Research estimator only; per-play units, no calibrated-probability claim.
  return h === null || a === null ? null : logitToProb((h-a)*.12)*100;
}
async function epaAdjustedProbability(home: string, away: string, targetIso: string, context: {season:number;week:number}): Promise<number | null> {
  try {
    const [h,a] = await Promise.all([getTeamStatsBeforeTarget(home,targetIso,context.season),getTeamStatsBeforeTarget(away,targetIso,context.season)]);
    if (!h || !a || h.targetWeek !== context.week || a.targetWeek !== context.week) return null;
    return epaProbabilityFromDataset({headers:h.headers,rows:[...h.rows,...a.rows]},home,away,context.season,context.week);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce an ensemble prediction by blending multiple models in logit space.
 *
 * @param homeAbbr         Home team abbreviation
 * @param awayAbbr          Away team abbreviation
 * @param targetIso         ISO date of the target game
 * @param v22Probability     Home win probability from the v2.2 model (0–100)
 * @param marketProbability  Home win probability from market (0–100), or null
 * @param weights            Optional weights [v2.2, market, EPA]; defaults to equal
 * @returns EnsemblePrediction
 */
export async function ensemblePredict(
  homeAbbr: string,
  awayAbbr: string,
  targetIso: string,
  v22Probability: number,
  marketProbability: number | null,
  context: { season: number; week: number },
  weights?: [number, number, number],
): Promise<EnsemblePrediction> {
  const w = weights ?? DEFAULT_WEIGHTS;
  if(w.some(value=>!Number.isFinite(value)||value<0)) throw new Error('Ensemble weights must be finite and nonnegative.');

  // Compute EPA-adjusted probability
  if (!context || !Number.isInteger(context.season) || !Number.isInteger(context.week) || context.week < 1) throw new Error('Exact NFL season and week required.');
  const epaProb = await epaAdjustedProbability(homeAbbr, awayAbbr, targetIso, context);

  // Build ensemble members
  const members: EnsembleMember[] = [
    { name: 'v2.2 Elo', homeProbability: v22Probability, weight: w[0] },
    { name: 'Market', homeProbability: marketProbability, weight: marketProbability !== null ? w[1] : 0 },
    { name: 'EPA-Adjusted', homeProbability: epaProb, weight: epaProb === null ? 0 : w[2] },
  ];

  // Renormalize weights (in case market was null → weight 0)
  const totalWeight = members.reduce((sum, m) => sum + m.weight, 0);
  const normalizedMembers = members.map((m,index) => ({
    ...m,
    weight: totalWeight > 0 ? m.weight / totalWeight : index===0?1:0,
  }));

  // Blend in logit space
  const blendedLogit = normalizedMembers.reduce(
    (sum, m) => sum + (m.homeProbability===null?0:probToLogit(m.homeProbability / 100) * m.weight),
    0,
  );

  const blendedProb = logitToProb(blendedLogit) * 100;

  const winnerAbbr = blendedProb >= 50 ? homeAbbr : awayAbbr;

  // Confidence: distance from 50%, scaled to [50, 100]
  const confidence = Math.round(Math.min(100, 50 + Math.abs(blendedProb - 50)));

  return {
    models: normalizedMembers,
    blendedHomeProbability: Math.round(blendedProb * 10) / 10,
    winnerAbbr,
    confidence,
  };
}
