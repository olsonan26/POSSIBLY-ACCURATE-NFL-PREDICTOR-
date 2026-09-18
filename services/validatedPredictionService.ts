import { DecisionFactor, PredictionResult, Team } from '../types';
import {
  calculateAllPatterns,
  parseGamesCsv,
  parseTeamData,
  predictWinner as runResearchModel,
  PredictionOptions
} from './numerologyService';

export { calculateAllPatterns, parseGamesCsv, parseTeamData };
export type { PredictionOptions };

const MODEL_VERSION = 'v2.1-validated-core';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const logistic = (value: number) => 1 / (1 + Math.exp(-value));
const logit = (probability: number) => {
  const p = clamp(probability, 0.001, 0.999);
  return Math.log(p / (1 - p));
};

function advantageForHomeEdge(homeEdge: number, winnerIsHome: boolean): DecisionFactor['advantage'] {
  if (Math.abs(homeEdge) < 0.002) return 'neutral';
  return (homeEdge > 0) === winnerIsHome ? 'winner' : 'loser';
}

function normalizeDecisionFactors(result: PredictionResult, winnerIsHome: boolean): DecisionFactor[] {
  if (!result.modelScores) return result.decisionFactors;
  const s = result.modelScores;
  const edgeByTitle: Record<string, number> = {
    'Pregame Elo Team Strength': logit(s.baseHomeProbability / 100),
    'Recent & Current-Season Form': s.footballLogitAdjustment,
    'Home / Away Performance': s.venueLogitAdjustment,
    'Head-to-Head at This Home Venue': s.h2hLogitAdjustment,
    'Rest Differential': s.restLogitAdjustment,
    'Live Injury / Availability Impact': s.personnelLogitAdjustment,
    'Verified Numerology Layer': s.numerologyLogitAdjustment
  };

  return result.decisionFactors.map(factor => {
    const homeEdge = edgeByTitle[factor.title] ?? 0;
    const researchOnly = factor.title === 'Rest Differential' || factor.title === 'Verified Numerology Layer';
    return {
      ...factor,
      includedInScore: !researchOnly,
      advantage: advantageForHomeEdge(homeEdge, winnerIsHome),
      description: factor.title === 'Rest Differential'
        ? `${factor.description} Research-only: 2025 validation showed no incremental accuracy from this adjustment, so it does not affect the production pick.`
        : factor.title === 'Verified Numerology Layer'
          ? `${factor.description} Research-only: the locked 2025 validation test showed the numerology adjustment reduced accuracy by 1.11 percentage points at its tested weight. It remains visible for prospective validation but does not affect the production pick.`
          : factor.description
    };
  });
}

function swapWinnerLoser(result: PredictionResult): PredictionResult {
  return {
    ...result,
    winner: result.loser,
    loser: result.winner,
    winnerStats: result.loserStats,
    loserStats: result.winnerStats,
    winnerBreakdown: result.loserBreakdown,
    loserBreakdown: result.winnerBreakdown,
    winnerDE: result.loserDE,
    loserDE: result.winnerDE,
    winnerDay: result.loserDay,
    loserDay: result.winnerDay,
    winnerDEStats: result.loserDEStats,
    loserDEStats: result.winnerDEStats,
    winnerCoachDE: result.loserCoachDE,
    loserCoachDE: result.winnerCoachDE,
    winnerCoachDEStats: result.loserCoachDEStats,
    loserCoachDEStats: result.winnerCoachDEStats,
    winnerQbDE: result.loserQbDE,
    loserQbDE: result.winnerQbDE,
    winnerQbDEStats: result.loserQbDEStats,
    loserQbDEStats: result.winnerQbDEStats,
    winnerDayStats: result.loserDayStats,
    loserDayStats: result.winnerDayStats,
    winnerComboWins: result.loserComboWins,
    loserComboWins: result.winnerComboWins,
    winnerTotalPatternWins: result.loserTotalPatternWins,
    winnerTotalPatternLosses: result.loserTotalPatternLosses,
    winnerTotalPatternPct: result.loserTotalPatternPct,
    loserTotalPatternWins: result.winnerTotalPatternWins,
    loserTotalPatternLosses: result.winnerTotalPatternLosses,
    loserTotalPatternPct: result.winnerTotalPatternPct,
    winnerOwnerDE: result.loserOwnerDE,
    loserOwnerDE: result.winnerOwnerDE,
    winnerOwnerDEStats: result.loserOwnerDEStats,
    loserOwnerDEStats: result.winnerOwnerDEStats
  };
}

/**
 * Production predictor.
 *
 * 2025 is treated as a validation season. The locked production architecture uses:
 *   - pregame Elo
 *   - recent/current-season form
 *   - generic home/road refinement
 *   - generic recency-weighted venue H2H
 *   - current injury/availability context when live data is available
 *
 * Rest and numerology remain measured research features but are deliberately excluded
 * from the production pick until a later untouched prospective sample demonstrates
 * independent value. This prevents outcome-driven weight fitting.
 */
export async function predictWinner(
  homeTeam: Team,
  awayTeam: Team,
  gameDate: Date,
  isTeamAHome = true,
  options: PredictionOptions = {}
): Promise<PredictionResult> {
  const research = await runResearchModel(homeTeam, awayTeam, gameDate, isTeamAHome, options);
  if (!research.modelScores) return { ...research, modelVersion: MODEL_VERSION };

  const s = research.modelScores;
  const baseLogit = logit(s.baseHomeProbability / 100);
  const productionAdjustment =
    s.footballLogitAdjustment +
    s.venueLogitAdjustment +
    s.personnelLogitAdjustment +
    s.h2hLogitAdjustment;

  const finalHomeProbability = logistic(baseLogit + productionAdjustment);
  const winnerIsHome = finalHomeProbability >= 0.5;
  const rawWinnerIsHome = Boolean(research.isWinnerHome);
  const aligned = winnerIsHome === rawWinnerIsHome ? { ...research } : swapWinnerLoser(research);
  const selectedProbability = winnerIsHome ? finalHomeProbability : 1 - finalHomeProbability;

  const warnings = [
    ...(aligned.warnings || []),
    'Rest and numerology are measured but currently research-only because they did not add accuracy on the locked 2025 validation season.',
    'The production scoring architecture is now locked; future changes should be judged prospectively rather than tuned to 2025 outcomes.'
  ];

  return {
    ...aligned,
    confidence: Math.round(selectedProbability * 1000) / 10,
    isWinnerHome: winnerIsHome,
    modelVersion: MODEL_VERSION,
    reasoning: `${aligned.winner.name} projects at ${(selectedProbability * 100).toFixed(1)}% under ${MODEL_VERSION}. The production score uses leakage-safe Elo, recent/current-season form, generic venue/H2H context, and live availability when available. Rest and numerology are still calculated for research, but are not allowed to change the pick until prospective validation demonstrates incremental value.`,
    decisionFactors: normalizeDecisionFactors(aligned, winnerIsHome),
    modelScores: {
      ...s,
      finalHomeProbability: Math.round(finalHomeProbability * 1000) / 10
    },
    dataFreshness: aligned.dataFreshness ? {
      ...aligned.dataFreshness,
      notes: [
        ...aligned.dataFreshness.notes,
        'Validation gate: rest and numerology are research-only in v2.1 after failing to improve 2025 validation accuracy.'
      ]
    } : aligned.dataFreshness,
    warnings
  };
}
