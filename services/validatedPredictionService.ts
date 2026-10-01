import { DecisionFactor, PredictionResult, Team, AccuracyFeatures } from '../types';
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
// EXP-025 accuracy improvement imports
import { getMatchupEpaContext } from './epaService';
import { getWeatherForGame } from './weatherService';
import { getTravelContext } from './travelService';
import { getDivisionalContext } from './divisionalService';
import { getDynamicHfa } from './dynamicHfaService';
import { getPreseasonPrior } from './preseasonPriorsService';
import { getPaceMetrics } from './paceMetricsService';
import { getSpecialTeamsStats } from './specialTeamsService';
import { getTurnoverExpectation } from './turnoverExpectationService';
import { ensemblePredict } from './ensembleService';

export { calculateAllPatterns, parseGamesCsv, parseTeamData };
export type { PredictionOptions };

const MODEL_VERSION = 'v2.2-validated-current-season';
const ENHANCED_VERSION = 'v2.2-EXP025-enhanced';

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

  // EXP-025: Compute accuracy improvement features in parallel.
  // All services return null on failure and default to 0 logit edge.
  // v2.2 control is preserved — these features are additive on top.
  const currentSeason = validatedContext.currentSeason;
  const [
    epaContext,
    weatherData,
    travelData,
    dynamicHfa,
    divisional,
    homePrior,
    awayPrior,
    homePace,
    awayPace,
    homeSpecialTeams,
    awaySpecialTeams,
    homeTurnover,
    awayTurnover
  ] = await Promise.all([
    getMatchupEpaContext(homeTeam.abbr, awayTeam.abbr, targetIso, currentSeason).catch(() => null),
    getWeatherForGame(homeTeam.abbr, targetIso, Boolean(options.neutralSite)).catch(() => null),
    Promise.resolve(getTravelContext(awayTeam.abbr, homeTeam.abbr, Boolean(options.neutralSite))).catch(() => null),
    Promise.resolve(getDynamicHfa(homeTeam.abbr, awayTeam.abbr, Boolean(options.neutralSite), [])).catch(() => null),
    Promise.resolve(getDivisionalContext(homeTeam.abbr, awayTeam.abbr, targetIso, [])).catch(() => null),
    getPreseasonPrior(homeTeam.abbr, currentSeason, targetIso, validatedContext.recentHome.games).catch(() => null),
    getPreseasonPrior(awayTeam.abbr, currentSeason, targetIso, validatedContext.recentAway.games).catch(() => null),
    getPaceMetrics(homeTeam.abbr, targetIso, currentSeason).catch(() => null),
    getPaceMetrics(awayTeam.abbr, targetIso, currentSeason).catch(() => null),
    getSpecialTeamsStats(homeTeam.abbr, targetIso, currentSeason).catch(() => null),
    getSpecialTeamsStats(awayTeam.abbr, targetIso, currentSeason).catch(() => null),
    getTurnoverExpectation(homeTeam.abbr, targetIso, currentSeason).catch(() => null),
    getTurnoverExpectation(awayTeam.abbr, targetIso, currentSeason).catch(() => null)
  ]);

  // Sum all EXP-025 logit edges. Each defaults to 0 when data is unavailable.
  const epaLogit = epaContext?.homeLogitEdge ?? 0;
  const weatherLogit = weatherData?.weatherImpact ?? 0;
  const travelLogit = (travelData ? (travelData.logTravel * 0.02 + Math.abs(travelData.tzChange) * 0.02) : 0);
  const dynamicHfaLogit = dynamicHfa?.hfaLogitEdge ?? 0;
  const divisionalLogit = divisional?.divisionalLogitEdge ?? 0;
  const preseasonPriorLogit = (homePrior && awayPrior) ? (homePrior.priorLogitEdge - awayPrior.priorLogitEdge) : 0;
  const paceLogit = (homePace && awayPace) ? clamp((homePace.playsPerGame - awayPace.playsPerGame) * 0.002, -0.02, 0.02) : 0;
  const specialTeamsLogit = (homeSpecialTeams && awaySpecialTeams) ? clamp((homeSpecialTeams.totalStEpa - awaySpecialTeams.totalStEpa) * 0.01, -0.03, 0.03) : 0;
  const turnoverLogit = (homeTurnover && awayTurnover) ? clamp((homeTurnover.expectedNetTurnovers - awayTurnover.expectedNetTurnovers) * 0.01, -0.02, 0.02) : 0;

  const accuracyLogitTotal =
    epaLogit + weatherLogit + travelLogit + dynamicHfaLogit +
    divisionalLogit + preseasonPriorLogit + paceLogit +
    specialTeamsLogit + turnoverLogit;

  const s = rawResearch.modelScores;
  const personnelAdjustment = retrospective ? 0 : s.personnelLogitAdjustment;
  const baseLogit = logit(s.baseHomeProbability / 100);
  const productionAdjustment =
    validatedContext.footballLogitAdjustment +
    validatedContext.venueLogitAdjustment +
    personnelAdjustment +
    s.h2hLogitAdjustment;

  // EXP-025: Add accuracy improvement logit edges on top of v2.2 control.
  // The v2.2 base (Elo + football + venue + personnel + H2H) is preserved.
  // These features are additive and default to 0 when data is unavailable.
  const enhancedAdjustment = productionAdjustment + accuracyLogitTotal;

  const finalHomeProbability = logistic(baseLogit + enhancedAdjustment);
  const v22Probability = logistic(baseLogit + productionAdjustment);
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
    // EXP-025 accuracy improvement fields
    epaLogitAdjustment: epaLogit,
    weatherLogitAdjustment: weatherLogit,
    travelLogitAdjustment: travelLogit,
    dynamicHfaLogitAdjustment: dynamicHfaLogit,
    divisionalLogitAdjustment: divisionalLogit,
    preseasonPriorLogitAdjustment: preseasonPriorLogit,
    paceLogitAdjustment: paceLogit,
    specialTeamsLogitAdjustment: specialTeamsLogit,
    turnoverExpectationLogitAdjustment: turnoverLogit,
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

  // EXP-025: Add accuracy improvement DecisionFactors
  // Each factor shows the logit edge and whether it favors the winner or loser.
  const exp025Factors: DecisionFactor[] = [
    {
      title: 'EPA Matchup Efficiency',
      description: epaContext
        ? `Opponent-adjusted EPA per play. ${homeTeam.abbr}: ${epaContext.home?.adjNetEpa.toFixed(3) ?? 'N/A'}, ${awayTeam.abbr}: ${epaContext.away?.adjNetEpa.toFixed(3) ?? 'N/A'}. Locked 0.15 logit weight from EXP-007 (67.90% on 2025). Garbage-time filtered (0.10–0.90 WP).`
        : 'EPA data unavailable for this matchup. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(epaLogit, winnerIsHome),
      edgeScore: epaLogit,
      category: 'epa',
      includedInScore: true
    },
    {
      title: 'Weather Impact',
      description: weatherData
        ? weatherData.isDome
          ? `Dome game — no weather impact.`
          : `Wind: ${weatherData.windSpeedMph.toFixed(1)} mph, Temp: ${weatherData.temperatureF.toFixed(0)}°F, Precip: ${weatherData.precipitation.toFixed(2)} in. Impact: ${weatherData.weatherImpact.toFixed(3)} logit.`
        : 'Weather data unavailable. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(weatherLogit, winnerIsHome),
      edgeScore: weatherLogit,
      category: 'weather',
      includedInScore: true
    },
    {
      title: 'Travel & Time Zone',
      description: travelData
        ? `${awayTeam.abbr} travels ${travelData.travelMiles.toFixed(0)} miles (${travelData.tzChange > 0 ? '+' : ''}${travelData.tzChange}h TZ). Logit edge: ${travelLogit.toFixed(3)}.`
        : 'Travel data unavailable. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(travelLogit, winnerIsHome),
      edgeScore: travelLogit,
      category: 'travel',
      includedInScore: true
    },
    {
      title: 'Dynamic Home-Field Advantage',
      description: dynamicHfa
        ? `HFA: ${dynamicHfa.eloAdvantage.toFixed(0)} Elo (multiplier ${dynamicHfa.teamMultiplier.toFixed(2)}x). Base: 55, adjusted by 3-season rolling HFA.`
        : 'Dynamic HFA unavailable. Using static 55 Elo points.',
      advantage: advantageForHomeEdge(dynamicHfaLogit, winnerIsHome),
      edgeScore: dynamicHfaLogit,
      category: 'hfa',
      includedInScore: true
    },
    {
      title: 'Divisional Matchup',
      description: divisional
        ? divisional.isDivisional
          ? `Divisional game (meeting #${divisional.divisionalGameNumber}). ${divisional.homeIsUnderdog ? 'Home underdog edge +0.03.' : 'No underdog edge.'}`
          : 'Non-divisional game. No divisional adjustment.'
        : 'Divisional data unavailable. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(divisionalLogit, winnerIsHome),
      edgeScore: divisionalLogit,
      category: 'divisional',
      includedInScore: true
    },
    {
      title: 'Preseason Win Total Prior',
      description: (homePrior && awayPrior)
        ? `${homeTeam.abbr}: ${homePrior.expectedWinPct.toFixed(1)}% expected (weight ${(homePrior.priorWeight * 100).toFixed(0)}%), ${awayTeam.abbr}: ${awayPrior.expectedWinPct.toFixed(1)}% expected (weight ${(awayPrior.priorWeight * 100).toFixed(0)}%).`
        : 'Preseason win total priors unavailable. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(preseasonPriorLogit, winnerIsHome),
      edgeScore: preseasonPriorLogit,
      category: 'prior',
      includedInScore: true
    },
    {
      title: 'Pace & Game Script',
      description: (homePace && awayPace)
        ? `${homeTeam.abbr}: ${homePace.playsPerGame.toFixed(1)} plays/game, ${awayTeam.abbr}: ${awayPace.playsPerGame.toFixed(1)} plays/game. Neutral pass rate: ${(homePace.neutralPassRate * 100).toFixed(1)}% / ${(awayPace.neutralPassRate * 100).toFixed(1)}%.`
        : 'Pace metrics unavailable. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(paceLogit, winnerIsHome),
      edgeScore: paceLogit,
      category: 'pace',
      includedInScore: true
    },
    {
      title: 'Special Teams EPA',
      description: (homeSpecialTeams && awaySpecialTeams)
        ? `${homeTeam.abbr}: ${homeSpecialTeams.totalStEpa.toFixed(2)} ST EPA, ${awayTeam.abbr}: ${awaySpecialTeams.totalStEpa.toFixed(2)} ST EPA.`
        : 'Special teams data unavailable. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(specialTeamsLogit, winnerIsHome),
      edgeScore: specialTeamsLogit,
      category: 'special-teams',
      includedInScore: true
    },
    {
      title: 'Turnover Expectation',
      description: (homeTurnover && awayTurnover)
        ? `${homeTeam.abbr}: ${homeTurnover.expectedNetTurnovers.toFixed(1)} expected net TO, ${awayTeam.abbr}: ${awayTurnover.expectedNetTurnovers.toFixed(1)} expected net TO.`
        : 'Turnover expectation unavailable. Defaulting to 0 logit edge.',
      advantage: advantageForHomeEdge(turnoverLogit, winnerIsHome),
      edgeScore: turnoverLogit,
      category: 'turnover',
      includedInScore: true
    }
  ];
  decisionFactors.push(...exp025Factors);

  // Build AccuracyFeatures object for the result
  const accuracyFeatures: AccuracyFeatures = {
    epa: epaContext ? {
      homeOffEpaPerPlay: epaContext.home?.offEpaPerPlay ?? 0,
      homeDefEpaPerPlay: epaContext.home?.defEpaPerPlay ?? 0,
      awayOffEpaPerPlay: epaContext.away?.offEpaPerPlay ?? 0,
      awayDefEpaPerPlay: epaContext.away?.defEpaPerPlay ?? 0,
      homeAdjNetEpa: epaContext.home?.adjNetEpa ?? 0,
      awayAdjNetEpa: epaContext.away?.adjNetEpa ?? 0,
      logitEdge: epaLogit
    } : undefined,
    weather: weatherData ? {
      temperatureF: weatherData.temperatureF,
      windSpeedMph: weatherData.windSpeedMph,
      precipitation: weatherData.precipitation,
      isDome: weatherData.isDome,
      logitEdge: weatherLogit
    } : undefined,
    travel: travelData ? {
      awayTravelMiles: travelData.travelMiles,
      awayTzChange: travelData.tzChange,
      isShortRest: travelData.isShortRest,
      logitEdge: travelLogit
    } : undefined,
    dynamicHfa: dynamicHfa ? {
      eloAdvantage: dynamicHfa.eloAdvantage,
      teamMultiplier: dynamicHfa.teamMultiplier,
      logitEdge: dynamicHfaLogit
    } : undefined,
    divisional: divisional ? {
      isDivisional: divisional.isDivisional,
      divisionalGameNumber: divisional.divisionalGameNumber,
      logitEdge: divisionalLogit
    } : undefined,
    preseasonPrior: (homePrior && awayPrior) ? {
      homeExpectedWinPct: homePrior.expectedWinPct,
      awayExpectedWinPct: awayPrior.expectedWinPct,
      priorWeight: homePrior.priorWeight,
      logitEdge: preseasonPriorLogit
    } : undefined,
    pace: (homePace && awayPace) ? {
      homePlaysPerGame: homePace.playsPerGame,
      awayPlaysPerGame: awayPace.playsPerGame,
      logitEdge: paceLogit
    } : undefined,
    specialTeams: (homeSpecialTeams && awaySpecialTeams) ? {
      homeTotalStEpa: homeSpecialTeams.totalStEpa,
      awayTotalStEpa: awaySpecialTeams.totalStEpa,
      logitEdge: specialTeamsLogit
    } : undefined,
    turnoverExpectation: (homeTurnover && awayTurnover) ? {
      homeExpectedNet: homeTurnover.expectedNetTurnovers,
      awayExpectedNet: awayTurnover.expectedNetTurnovers,
      logitEdge: turnoverLogit
    } : undefined
  };

  const warnings = [
    ...(aligned.warnings || []),
    ...researchWarnings,
    ...pureAstrology.warnings,
    'v2.2 remains the frozen football control: target-season form and home/road context reset at each NFL season. The zero prior-season carryover rule was selected on 2024; on untouched 2025 it improved winner accuracy from 65.31% to 66.42%, while Brier and log loss worsened slightly.',
    'PURE Astrology is now calculated independently by the private source-authoritative path and can disagree with the football control. Its scenario stability, when shown, is not a calibrated NFL win probability.',
    'The resolver does not use an invented football/astrology percentage weight. It records agreement, conflict, unresolved, or unavailable states and preserves the football control separately.',
    'The new Lettrology formula is provisional pending source-sheet confirmation: Daily Environment = PM + calendar day; Daily ESS = PME + Daily Environment; the displayed signature is Daily ESS over Daily Environment.',
    ...(retrospective ? ['Retrospective leakage guard active: current live personnel/injury data were forced to zero. PURE receives no present-day personnel snapshot for past games and must fail closed or use independently verified point-in-time data.'] : []),
    'EXP-025: Enhanced model adds EPA per play, weather, travel, dynamic HFA, divisional adjustments, preseason priors, pace, special teams, and turnover expectation on top of v2.2 control. All features are additive with pre-declared logit weights. v2.2 base probability is preserved separately as v22Probability.',
    'EXP-025 features fail closed: any unavailable service defaults to 0 logit edge, preserving v2.2 behavior exactly.'
  ];

  return {
    ...aligned,
    confidence: Math.round(selectedProbability * 1000) / 10,
    isWinnerHome: winnerIsHome,
    modelVersion: ENHANCED_VERSION,
    reasoning: retrospective
      ? `${aligned.winner.name} projects at ${(selectedProbability * 100).toFixed(1)}% under ${ENHANCED_VERSION} (v2.2 base: ${(v22Probability * 100).toFixed(1)}%). EXP-025 logit delta: ${accuracyLogitTotal >= 0 ? '+' : ''}${accuracyLogitTotal.toFixed(4)}. The separate PURE Astrology engine is ${pureAstrology.status}/${pureAstrology.decisionStatus}${pureAstrology.winnerName ? ` and selects ${pureAstrology.winnerName}` : ''}. ${matchupResolver.combinedReason}`
      : `${aligned.winner.name} projects at ${(selectedProbability * 100).toFixed(1)}% under ${ENHANCED_VERSION} (v2.2 base: ${(v22Probability * 100).toFixed(1)}%). EXP-025 logit delta: ${accuracyLogitTotal >= 0 ? '+' : ''}${accuracyLogitTotal.toFixed(4)}. The separate PURE Astrology engine is ${pureAstrology.status}/${pureAstrology.decisionStatus}${pureAstrology.winnerName ? ` and selects ${pureAstrology.winnerName}` : ''}. ${matchupResolver.combinedReason}`,
    winnerBreakdown: aligned.winnerBreakdown.map(item => ({ ...item, includedInScore: false })),
    loserBreakdown: aligned.loserBreakdown.map(item => ({ ...item, includedInScore: false })),
    decisionFactors,
    homePersonnel: retrospective ? undefined : aligned.homePersonnel,
    awayPersonnel: retrospective ? undefined : aligned.awayPersonnel,
    pureAstrology,
    matchupResolver,
    modelScores: validatedScores,
    accuracyFeatures,
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
