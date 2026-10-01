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

import { PredictionResult } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnsembleMember {
  name: string;
  homeProbability: number;   // 0–100
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
async function epaAdjustedProbability(
  homeAbbr: string,
  awayAbbr: string,
  currentSeason: number,
): Promise<number> {
  try {
    const url =
      'https://raw.githubusercontent.com/nflverse/nflverse-data/main/nfl_stats/weekly_stats.csv';
    const res = await fetch(url);
    if (!res.ok) return 50;

    const csvText = await res.text();
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return 50;

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = (name: string) => headers.indexOf(name);
    const teamIdx = idx('team') ?? idx('recent_team');
    const passingEpaIdx = idx('passing_epa');
    const rushingEpaIdx = idx('rushing_epa');

    if (teamIdx < 0) return 50;

    function getTeamEpa(team: string): number {
      let totalEpa = 0;
      let games = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if ((cols[teamIdx] ?? '').trim() !== team) continue;
        const passEpa = parseFloat(cols[passingEpaIdx] ?? '0') || 0;
        const rushEpa = parseFloat(cols[rushingEpaIdx] ?? '0') || 0;
        totalEpa += passEpa + rushEpa;
        games += 1;
      }
      return games > 0 ? totalEpa / games : 0;
    }

    const homeEpa = getTeamEpa(homeAbbr);
    const awayEpa = getTeamEpa(awayAbbr);
    const epaDiff = homeEpa - awayEpa;

    // Logistic: P(home win) = 1 / (1 + exp(-k * epaDiff))
    // k ≈ 0.12 (EPA per play differential → win prob)
    const prob = logitToProb(epaDiff * 0.12);
    return prob * 100;
  } catch {
    return 50;
  }
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
  weights?: [number, number, number],
): Promise<EnsemblePrediction> {
  const w = weights ?? DEFAULT_WEIGHTS;

  // Compute EPA-adjusted probability
  const currentSeason = new Date(targetIso).getFullYear();
  const epaProb = await epaAdjustedProbability(homeAbbr, awayAbbr, currentSeason);

  // Build ensemble members
  const members: EnsembleMember[] = [
    { name: 'v2.2 Elo', homeProbability: v22Probability, weight: w[0] },
    { name: 'Market', homeProbability: marketProbability ?? 50, weight: marketProbability !== null ? w[1] : 0 },
    { name: 'EPA-Adjusted', homeProbability: epaProb, weight: w[2] },
  ];

  // Renormalize weights (in case market was null → weight 0)
  const totalWeight = members.reduce((sum, m) => sum + m.weight, 0);
  const normalizedMembers = members.map((m) => ({
    ...m,
    weight: totalWeight > 0 ? m.weight / totalWeight : 1 / members.length,
  }));

  // Blend in logit space
  const blendedLogit = normalizedMembers.reduce(
    (sum, m) => sum + probToLogit(m.homeProbability / 100) * m.weight,
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
