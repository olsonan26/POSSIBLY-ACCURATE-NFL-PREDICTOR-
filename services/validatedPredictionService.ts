import { DecisionFactor, PredictionResult, Team } from '../types';
import {
  calculateAllPatterns,
  parseGamesCsv,
  parseTeamData,
  predictWinner as runResearchModel,
  PredictionOptions
} from './numerologyService';
import {
  getValidatedFootballContext,
  ValidatedFootballContext
} from './validatedFootballContext';

export { calculateAllPatterns, parseGamesCsv, parseTeamData };
export type { PredictionOptions };

const MODEL_VERSION = 'v2.2-validated-current-season';

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

function normalizeDecisionFactors(
  result: PredictionResult,
  winnerIsHome: boolean,
  validatedContext: ValidatedFootballContext,
  homeName: string,
  awayName: string
): DecisionFactor[] {
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
    let description = factor.description;

    if (factor.title === 'Recent & Current-Season Form') {
      const h = validatedContext.recentHome;
      const a = validatedContext.recentAway;
      description = `${homeName}: ${h.wins}-${h.losses}-${h.ties}, ${h.avgPointDiff >= 0 ? '+' : ''}${h.avgPointDiff.toFixed(1)} current-season recent point differential/game; ${awayName}: ${a.wins}-${a.losses}-${a.ties}, ${a.avgPointDiff >= 0 ? '+' : ''}${a.avgPointDiff.toFixed(1)}. v2.2 deliberately gives prior-season recent form zero weight. The rule was selected on 2024; on untouched 2025 it improved winner accuracy from 65.31% to 66.42%, while Brier and log loss worsened slightly.`;
    } else if (factor.title === 'Home / Away Performance') {
      const h = validatedContext.homeVenue;
      const a = validatedContext.awayVenue;
      description = `Target-season venue context only: ${homeName} home win rate ${(h.winPct * 100).toFixed(1)}% across ${h.games} current-season home games; ${awayName} road win rate ${(a.winPct * 100).toFixed(1)}% across ${a.games} current-season road games. Long-horizon venue history remains separately represented by the H2H factor.`;
    } else if (factor.title === 'Rest Differential') {
      description = `${factor.description} Research-only: 2025 validation showed no incremental accuracy from this adjustment, so it does not affect the production pick.`;
    } else if (factor.title === 'Verified Numerology Layer') {
      description = `${factor.description} Research-only: the locked validation tests have not demonstrated stable incremental winner accuracy. PURE/numerology research remains visible but cannot change the production pick.`;
    }

    return {
      ...factor,
      includedInScore: !researchOnly,
      advantage: advantageForHomeEdge(homeEdge, winnerIsHome),
      description
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
 * Production predictor v2.2.
 *
 * Locked production architecture:
 *   - pregame Elo with season regression
 *   - target-season recent/current-season form only
 *   - target-season home/road refinement only
 *   - generic recency-weighted same-venue H2H
 *   - current injury/availability context when live data is available
 *
 * The prior-season recent-form carryover was set to zero using 2024 as the
 * tuning season. On untouched 2025, that fixed rule improved winner accuracy
 * from 177/271 (65.31%) to 180/271 (66.42%), while Brier and log loss worsened
 * slightly. v2.2 therefore records an accuracy/calibration tradeoff rather than
 * claiming universal improvement across every validation metric.
 *
 * Rest, numerology and PURE Astrology remain measured research features but
 * are deliberately excluded from the production winner until later untouched
 * prospective samples demonstrate stable incremental value.
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

  const targetIso = gameDate.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const retrospective = targetIso < todayIso;
  const validatedContext = await getValidatedFootballContext(
    homeTeam.abbr,
    awayTeam.abbr,
    targetIso,
    Boolean(options.neutralSite)
  );

  const s = research.modelScores;
  const personnelAdjustment = retrospective ? 0 : s.personnelLogitAdjustment;
  const baseLogit = logit(s.baseHomeProbability / 100);
  const productionAdjustment =
    validatedContext.footballLogitAdjustment +
    validatedContext.venueLogitAdjustment +
    personnelAdjustment +
    s.h2hLogitAdjustment;

  const finalHomeProbability = logistic(baseLogit + productionAdjustment);
  const winnerIsHome = finalHomeProbability >= 0.5;
  const rawWinnerIsHome = Boolean(research.isWinnerHome);
  const selectedProbability = winnerIsHome ? finalHomeProbability : 1 - finalHomeProbability;
  const validatedScores = {
    ...s,
    footballLogitAdjustment: validatedContext.footballLogitAdjustment,
    venueLogitAdjustment: validatedContext.venueLogitAdjustment,
    personnelLogitAdjustment: personnelAdjustment,
    finalHomeProbability: Math.round(finalHomeProbability * 1000) / 10
  };

  const alignedBase = winnerIsHome === rawWinnerIsHome ? { ...research } : swapWinnerLoser(research);
  const aligned: PredictionResult = { ...alignedBase, modelScores: validatedScores };

  let decisionFactors = normalizeDecisionFactors(aligned, winnerIsHome, validatedContext, homeTeam.name, awayTeam.name);
  if (retrospective) {
    decisionFactors = decisionFactors.map(factor => factor.title === 'Live Injury / Availability Impact'
      ? {
          ...factor,
          includedInScore: false,
          advantage: 'neutral',
          edgeScore: 0,
          description: 'Retrospective calculation: current live depth-chart and injury data are excluded from scoring because they are not a trustworthy point-in-time record of what was known before this completed game.'
        }
      : factor);
  }

  const warnings = [
    ...(aligned.warnings || []),
    'v2.2 resets recent-form and home/road context at the start of each NFL season. The zero prior-season carryover rule was selected on 2024; on untouched 2025 it improved winner accuracy from 65.31% to 66.42%, while Brier and log loss worsened slightly.',
    'Rest, numerology and PURE Astrology remain research-only and cannot change the production winner until prospective validation demonstrates stable incremental value.',
    ...(retrospective ? ['Retrospective leakage guard active: current live personnel/injury data were forced to zero and cannot affect this past-game production pick.'] : [])
  ];

  return {
    ...aligned,
    confidence: Math.round(selectedProbability * 1000) / 10,
    isWinnerHome: winnerIsHome,
    modelVersion: MODEL_VERSION,
    reasoning: retrospective
      ? `${aligned.winner.name} projects at ${(selectedProbability * 100).toFixed(1)}% under ${MODEL_VERSION}. This retrospective score uses leakage-safe Elo, target-season form and home/road context, and generic venue/H2H history. Current live personnel/injury data are explicitly excluded from past-game scoring. Rest, numerology and PURE Astrology remain research-only.`
      : `${aligned.winner.name} projects at ${(selectedProbability * 100).toFixed(1)}% under ${MODEL_VERSION}. The production score uses leakage-safe Elo, target-season form and home/road context, generic venue/H2H history, and live availability when available. Prior-season recent form is intentionally reset to zero. Rest, numerology and PURE Astrology are still calculated for research but are not allowed to change the pick.`,
    winnerBreakdown: aligned.winnerBreakdown.map(item => ({ ...item, includedInScore: false })),
    loserBreakdown: aligned.loserBreakdown.map(item => ({ ...item, includedInScore: false })),
    decisionFactors,
    homePersonnel: retrospective ? undefined : aligned.homePersonnel,
    awayPersonnel: retrospective ? undefined : aligned.awayPersonnel,
    modelScores: validatedScores,
    dataFreshness: aligned.dataFreshness ? {
      ...aligned.dataFreshness,
      livePersonnelLoaded: retrospective ? false : aligned.dataFreshness.livePersonnelLoaded,
      injuryDataLoaded: retrospective ? false : aligned.dataFreshness.injuryDataLoaded,
      notes: [
        ...aligned.dataFreshness.notes,
        'v2.2 validation gate: prior-season recent form/home-road carryover is zero. It was selected on 2024; 2025 winner accuracy improved, with a small Brier/log-loss tradeoff.',
        'Rest, numerology and PURE Astrology remain research-only after failing stable incremental validation.',
        ...(retrospective ? ['Retrospective leakage guard: present-day live personnel/injury context is excluded from past-game scoring and display.'] : [])
      ]
    } : aligned.dataFreshness,
    warnings
  };
}