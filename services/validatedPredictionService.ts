import { DecisionFactor, PredictionResult, Team } from '../types';
import {
  calculateAllPatterns,
  parseGamesCsv,
  parseTeamData,
  predictWinner as runResearchModel,
  PredictionOptions
} from './numerologyService';
import {
  applyProvisionalDailyFormula,
  buildLettrologyResearchFactor
} from './lettrologyResearchService';
import {
  getValidatedFootballContext,
  ValidatedFootballContext
} from './validatedFootballContext';
import {
  getPureAstrologyPrediction,
  resolveFootballAndPure
} from './pureAstrologyService';

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
    // The legacy numerology score used a different daily definition. It remains
    // visible only as historical research context and is forced neutral here.
    'Verified Numerology Layer': 0
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
      description = 'Legacy numerology experiment retained for audit history only. Its old Daily-Essence/calendar-Day combination is superseded for current research by the provisional Daily ESS over Daily Environment definition. This legacy factor is neutralized and has zero production weight.';
    }

    return {
      ...factor,
      includedInScore: !researchOnly,
      advantage: advantageForHomeEdge(homeEdge, winnerIsHome),
      edgeScore: factor.title === 'Verified Numerology Layer' ? 0 : factor.edgeScore,
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
 * Football control predictor v2.2 + independent PURE Astrology experiment.
 *
 * The football control remains locked so its validated historical record is not
 * overwritten. PURE Astrology is now requested independently from a private,
 * source-authoritative engine and returned beside the control. The matchup
 * resolver records agreement/conflict without inventing a 70/30-style blend.
 */
export async function predictWinner(
  homeTeam: Team,
  awayTeam: Team,
  gameDate: Date,
  isTeamAHome = true,
  options: PredictionOptions = {}
): Promise<PredictionResult> {
  const rawResearch = await runResearchModel(homeTeam, awayTeam, gameDate, isTeamAHome, options);
  if (!rawResearch.modelScores) {
    const provisional = applyProvisionalDailyFormula(rawResearch, gameDate);
    return { ...provisional, modelVersion: MODEL_VERSION };
  }

  const targetIso = gameDate.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const retrospective = targetIso < todayIso;
  const validatedContext = await getValidatedFootballContext(
    homeTeam.abbr,
    awayTeam.abbr,
    targetIso,
    Boolean(options.neutralSite)
  );

  const s = rawResearch.modelScores;
  const personnelAdjustment = retrospective ? 0 : s.personnelLogitAdjustment;
  const baseLogit = logit(s.baseHomeProbability / 100);
  const productionAdjustment =
    validatedContext.footballLogitAdjustment +
    validatedContext.venueLogitAdjustment +
    personnelAdjustment +
    s.h2hLogitAdjustment;

  const finalHomeProbability = logistic(baseLogit + productionAdjustment);
  const winnerIsHome = finalHomeProbability >= 0.5;
  const rawWinnerIsHome = Boolean(rawResearch.isWinnerHome);
  const selectedProbability = winnerIsHome ? finalHomeProbability : 1 - finalHomeProbability;
  const validatedScores = {
    ...s,
    footballLogitAdjustment: validatedContext.footballLogitAdjustment,
    venueLogitAdjustment: validatedContext.venueLogitAdjustment,
    personnelLogitAdjustment: personnelAdjustment,
    // The legacy research score is zeroed so the UI cannot imply it contributed
    // to v2.2. Lettrology and PURE Astrology are separate experimental outputs.
    numerologyLogitAdjustment: 0,
    finalHomeProbability: Math.round(finalHomeProbability * 1000) / 10
  };

  const alignedRawBase = winnerIsHome === rawWinnerIsHome ? { ...rawResearch } : swapWinnerLoser(rawResearch);
  const aligned = applyProvisionalDailyFormula(
    { ...alignedRawBase, modelScores: validatedScores },
    gameDate
  );

  let decisionFactors = normalizeDecisionFactors(aligned, winnerIsHome, validatedContext, homeTeam.name, awayTeam.name);
  const researchWarnings: string[] = [];
  try {
    const lettrologyFactor = await buildLettrologyResearchFactor(
      homeTeam,
      awayTeam,
      gameDate,
      winnerIsHome
    );
    decisionFactors.push(lettrologyFactor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    researchWarnings.push(`Provisional Lettrology matchup/Monte Carlo research could not be loaded: ${message}. Football control scoring was unaffected.`);
  }

  const pureAstrology = await getPureAstrologyPrediction(
    homeTeam,
    awayTeam,
    gameDate,
    rawResearch.homePersonnel,
    rawResearch.awayPersonnel,
    {
      neutralSite: Boolean(options.neutralSite),
      retrospective
    }
  );
  const matchupResolver = resolveFootballAndPure(aligned.winner, pureAstrology);

  const pureDescription = pureAstrology.status === 'available' || pureAstrology.status === 'limited'
    ? pureAstrology.winnerAbbr
      ? `Independent PURE Astrology: ${pureAstrology.winnerName || pureAstrology.winnerAbbr} (${pureAstrology.decisionStatus}). ${pureAstrology.pickStabilityPct != null ? `Scenario stability ${pureAstrology.pickStabilityPct.toFixed(1)}% — this is pick stability, not calibrated win probability. ` : ''}${matchupResolver.agreement === 'agree' ? 'PURE agrees with the football control.' : matchupResolver.agreement === 'conflict' ? 'PURE conflicts with the football control.' : ''}`
      : `Independent PURE Astrology returned ${pureAstrology.decisionStatus}; no directional winner was fabricated from incomplete or ambiguous source evidence.`
    : `Independent PURE Astrology status: ${pureAstrology.status}. ${pureAstrology.warnings[0] || 'Private source-authoritative analysis was not available.'}`;

  decisionFactors.push({
    title: 'PURE Astrology — Independent Engine',
    name: pureAstrology.winnerName || pureAstrology.winnerAbbr,
    description: pureDescription,
    explanation: matchupResolver.combinedReason,
    advantage: pureAstrology.winnerAbbr
      ? (pureAstrology.winnerAbbr === aligned.winner.abbr ? 'winner' : 'loser')
      : 'neutral',
    edgeScore: 0,
    category: 'astrology',
    includedInScore: false
  });

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
    ...researchWarnings,
    ...pureAstrology.warnings,
    'v2.2 remains the frozen football control: target-season form and home/road context reset at each NFL season. The zero prior-season carryover rule was selected on 2024; on untouched 2025 it improved winner accuracy from 65.31% to 66.42%, while Brier and log loss worsened slightly.',
    'PURE Astrology is now calculated independently by the private source-authoritative path and can disagree with the football control. Its scenario stability, when shown, is not a calibrated NFL win probability.',
    'The resolver does not use an invented football/astrology percentage weight. It records agreement, conflict, unresolved, or unavailable states and preserves the football control separately.',
    'The new Lettrology formula is provisional pending source-sheet confirmation: Daily Environment = PM + calendar day; Daily ESS = PME + Daily Environment; the displayed signature is Daily ESS over Daily Environment.',
    ...(retrospective ? ['Retrospective leakage guard active: current live personnel/injury data were forced to zero. PURE receives no present-day personnel snapshot for past games and must fail closed or use independently verified point-in-time data.'] : [])
  ];

  return {
    ...aligned,
    confidence: Math.round(selectedProbability * 1000) / 10,
    isWinnerHome: winnerIsHome,
    modelVersion: MODEL_VERSION,
    reasoning: retrospective
      ? `${aligned.winner.name} projects at ${(selectedProbability * 100).toFixed(1)}% under the frozen ${MODEL_VERSION} football control. The separate PURE Astrology engine is ${pureAstrology.status}/${pureAstrology.decisionStatus}${pureAstrology.winnerName ? ` and selects ${pureAstrology.winnerName}` : ''}. ${matchupResolver.combinedReason}`
      : `${aligned.winner.name} projects at ${(selectedProbability * 100).toFixed(1)}% under the frozen ${MODEL_VERSION} football control. The separate PURE Astrology engine is ${pureAstrology.status}/${pureAstrology.decisionStatus}${pureAstrology.winnerName ? ` and selects ${pureAstrology.winnerName}` : ''}. ${matchupResolver.combinedReason}`,
    winnerBreakdown: aligned.winnerBreakdown.map(item => ({ ...item, includedInScore: false })),
    loserBreakdown: aligned.loserBreakdown.map(item => ({ ...item, includedInScore: false })),
    decisionFactors,
    homePersonnel: retrospective ? undefined : aligned.homePersonnel,
    awayPersonnel: retrospective ? undefined : aligned.awayPersonnel,
    pureAstrology,
    matchupResolver,
    modelScores: validatedScores,
    dataFreshness: aligned.dataFreshness ? {
      ...aligned.dataFreshness,
      livePersonnelLoaded: retrospective ? false : aligned.dataFreshness.livePersonnelLoaded,
      injuryDataLoaded: retrospective ? false : aligned.dataFreshness.injuryDataLoaded,
      notes: [
        ...aligned.dataFreshness.notes,
        'v2.2 is retained as the frozen football control rather than silently changing its historical validation record.',
        'PURE Astrology is a separate private-engine result; the public client receives only a sanitized winner/status/coverage summary, not proprietary source rules or raw calculations.',
        'Unknown or approximate birth times are expected to fail closed for Moon, houses, angles and degree-sensitive claims in the private PURE engine.',
        'Monte Carlo/scenario stability is tracked separately from calibrated win probability.',
        ...(retrospective ? ['Retrospective leakage guard: present-day live personnel/injury context is excluded from both past-game football scoring and the PURE request.'] : [])
      ]
    } : aligned.dataFreshness,
    warnings
  };
}
