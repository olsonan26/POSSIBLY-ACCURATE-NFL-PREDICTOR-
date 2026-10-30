import type { PredictionResult } from '../types.js';
import { COACH_SECTIONS, type CoachReport } from './coachAnalysis.js';

export type CaptureHorizon = 'T-72h' | 'T-24h' | 'T-3h' | 'T-30m';
export type EvidenceMode = 'PROSPECTIVE' | 'HISTORICAL_RECONSTRUCTION';
export interface ResearchFeature {
  value: number | string | boolean | null;
  status: 'known' | 'missing' | 'unknown' | 'not-applicable' | 'BLOCKED_DATA';
  source: string;
  observedAt: string | null;
  capturedAt: string;
  version: string;
  includedInProduction: boolean;
}
export interface UnifiedPregameSnapshot {
  schemaVersion: 'unified-pregame-v1';
  forecastId: string;
  gameId: string;
  modelVersion: string;
  captureHorizon: CaptureHorizon;
  evidenceMode: EvidenceMode;
  capturedAt: string;
  cutoffAt: string;
  kickoffAt: string;
  features: Record<string, ResearchFeature>;
}
export function captureHorizon(kickoffAt: string, capturedAt: string): CaptureHorizon {
  const hours = (Date.parse(kickoffAt) - Date.parse(capturedAt)) / 3600000;
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('Capture must precede kickoff.');
  return hours > 24 ? 'T-72h' : hours > 3 ? 'T-24h' : hours > .5 ? 'T-3h' : 'T-30m';
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const families: Record<string, string> = {
  epa: 'football_efficiency', weather: 'football_weather', travel: 'football_travel',
  dynamicHfa: 'football_hfa', divisional: 'football_schedule', preseasonPrior: 'football_prior',
  pace: 'football_pace', specialTeams: 'football_special_teams', turnoverExpectation: 'football_turnover'
};
const familyFields:Record<string,string[]>={
  epa:['homeOffEpaPerPlay','homeDefEpaPerPlay','awayOffEpaPerPlay','awayDefEpaPerPlay','homeAdjNetEpa','awayAdjNetEpa','logitEdge'],
  weather:['temperatureF','windSpeedMph','windGustMph','precipitation','snowfall','humidity','isDome','venueId','latitude','longitude','roof','surface','kickoffAt','capturedAt','evidenceMode','logitEdge'],
  travel:['awayTravelMiles','awayTzChange','isShortRest','logitEdge'],dynamicHfa:['eloAdvantage','teamMultiplier','logitEdge'],
  divisional:['isDivisional','divisionalGameNumber','logitEdge'],preseasonPrior:['homeExpectedWinPct','awayExpectedWinPct','priorWeight','logitEdge'],
  pace:['homePlaysPerGame','awayPlaysPerGame','logitEdge'],specialTeams:['homeTotalStEpa','awayTotalStEpa','logitEdge'],
  turnoverExpectation:['homeExpectedNet','awayExpectedNet','logitEdge']
};
export function buildUnifiedSnapshot(input: {
  gameId: string; modelVersion: string; kickoffAt: string; capturedAt: string; cutoffAt: string;
  horizon: CaptureHorizon; mode: EvidenceMode; result: Pick<PredictionResult, 'modelScores' | 'accuracyFeatures' | 'pureAstrology'> & Partial<Pick<PredictionResult,'decisionFactors'|'homePersonnel'|'awayPersonnel'>>;
  homeTeam: string; awayTeam: string; coach?: CoachReport; market?: { probability: number; observedAt: string; source: string };
  controlProbability?: number;
  extraFeatures?: Record<string, ResearchFeature>;
}): UnifiedPregameSnapshot {
  const { capturedAt, cutoffAt, kickoffAt } = input;
  const capture = Date.parse(capturedAt), cutoff = Date.parse(cutoffAt), kickoff = Date.parse(kickoffAt);
  if (![capture, cutoff, kickoff].every(Number.isFinite) || cutoff >= kickoff || cutoff > capture ||
      (input.mode === 'PROSPECTIVE' && capture >= kickoff)) throw new Error('Invalid research chronology.');
  const features: Record<string, ResearchFeature> = {};
  const put = (name: string, value: ResearchFeature['value'] | undefined, source: string, production = false,
    observedAt: string | null = cutoffAt, status?: ResearchFeature['status']) => {
    const available = value != null && !(typeof value === 'number' && !Number.isFinite(value));
    const safe = observedAt != null && Number.isFinite(Date.parse(observedAt)) && Date.parse(observedAt) <= cutoff;
    features[name] = { value: available && safe ? value! : null,
      status: status || (available && safe ? 'known' : 'BLOCKED_DATA'), source, observedAt: safe ? observedAt : null,
      capturedAt, version: '1', includedInProduction: production };
  };
  const s = input.result.modelScores;
  const control: Record<string, number | undefined> = {
    baseLogit: s ? Math.log(s.baseHomeProbability / (100 - s.baseHomeProbability)) : undefined,
    formLogit: s?.footballLogitAdjustment, venueLogit: s?.venueLogitAdjustment,
    h2hLogit: s?.h2hLogitAdjustment, personnelLogit: s?.personnelLogitAdjustment,
    restLogit: s?.restLogitAdjustment, homeProbability: s ? s.finalHomeProbability / 100 : input.controlProbability,
    eloEdge: s ? s.eloHome - s.eloAway : undefined
  };
  Object.entries(control).forEach(([key, value]) => put(`football_core.${key}`, value, input.modelVersion, key !== 'restLogit'));
  for(const [side,personnel] of Object.entries({home:input.result.homePersonnel,away:input.result.awayPersonnel})) {
    // Current personnel are unavailable for historical reconstructions, even if accidentally passed by a caller.
    const live=input.mode==='PROSPECTIVE'&&personnel&&personnel.sourceStatus!=='fallback'?personnel:undefined;
    put(`football_personnel.${side}InjuryCount`,live?.injuries?.length,'Analyzer live personnel');
    put(`football_personnel.${side}StartingQbKnown`,live?Boolean(live.startingQb):null,'Analyzer live personnel');
    put(`football_personnel.${side}SourceStatus`,live?.sourceStatus,'Analyzer live personnel');
  }
  for (const [key, namespace] of Object.entries(families)) {
    let group = input.result.accuracyFeatures?.[key];
    if(key==='weather'&&input.mode==='PROSPECTIVE'&&group?.evidenceMode==='ARCHIVED_REANALYSIS') group=undefined;
    for (const field of familyFields[key]) {
      const value=group?.[field];
      const indoor=key==='weather'&&group?.isDome&&['temperatureF','windSpeedMph','windGustMph','precipitation','snowfall','humidity'].includes(field);
      put(`${namespace}.${field}`,value,`Analyzer:${key}`,false,key==='weather'?(group?.capturedAt || cutoffAt):cutoffAt,indoor?'not-applicable':undefined);
    }
  }
  // Named blocked fields expose unavailable data without zero-imputation.
  for (const key of ['football_qb.edge', 'football_pressure.edge', 'football_ol.edge', 'football_matchup.edge',
    'football_explosive.edge', 'football_success_rate.edge', 'experimental_lettrology.direction', 'experimental_patterns.direction']) {
    put(key, null, 'No verified point-in-time source');
  }
  for (const [key, feature] of Object.entries(input.extraFeatures || {})) {
    if (!/^(football_|experimental_|deepseek_learning\.)/.test(key) || /actual|final|postgame|winner|score/i.test(key)) throw new Error('Forbidden research field.');
    const observed = feature.observedAt ? Date.parse(feature.observedAt) : NaN;
    if (feature.status === 'known' && (!Number.isFinite(observed) || observed > cutoff || observed >= kickoff || feature.includedInProduction))
      throw new Error('Invalid shadow feature provenance.');
    features[key] = structuredClone(feature);
    features[key].capturedAt = capturedAt;
  }
  const pure = input.result.pureAstrology;
  const pureDirection = pure?.sourceSafe && ['available', 'limited'].includes(pure.status)
    ? pure.winnerAbbr === input.homeTeam ? 1 : pure.winnerAbbr === input.awayTeam ? -1 : null : null;
  put('experimental_astrology.direction', pureDirection, pure?.methodVersion || 'PURE unavailable');
  const lettrology=input.result.decisionFactors?.find(f=>f.title==='Provisional Lettrology Matchup + Monte Carlo');
  const controlPick=control.homeProbability!=null ? (control.homeProbability>=.5?1:-1) : null;
  const lettrologyDirection=lettrology && lettrology.edgeScore>0 && controlPick && ['winner','loser'].includes(lettrology.advantage)
    ? controlPick*(lettrology.advantage==='winner'?1:-1) : null;
  put('experimental_lettrology.direction',lettrologyDirection,'Provisional Lettrology; directional research only');
  const coach = input.coach;
  const coachSafe = coach && coach.gameId === input.gameId && Date.parse(coach.cutoff) <= cutoff &&
    Date.parse(coach.generatedAt) <= capture && (input.mode !== 'PROSPECTIVE' ||
      (coach.mode === 'pregame' && Date.parse(coach.generatedAt) < kickoff));
  const votes: number[] = [];
  for (const [id] of COACH_SECTIONS) {
    const section = coachSafe ? coach.sections.find(row => row.id === id) : undefined;
    const evidence = section ? coach!.evidence.filter(e => section.evidenceIds.includes(e.id)) : [];
    const valid = evidence.length > 0 && evidence.every(e => Number.isFinite(Date.parse(e.publishedAt)) && Date.parse(e.publishedAt) < cutoff);
    const direction = valid ? section!.advantage === 'home' ? 1 : section!.advantage === 'away' ? -1 : section!.advantage === 'even' ? 0 : null : null;
    put(`coach_${id}.direction`, direction, coach?.version || 'Coach unavailable', false, cutoffAt, direction === null ? 'unknown' : 'known');
    put(`coach_${id}.evidenceCount`, section ? evidence.length : null, coach?.version || 'Coach unavailable');
    put(`coach_${id}.sourceCount`, section ? new Set(evidence.map(e => e.url)).size : null, coach?.version || 'Coach unavailable');
    put(`coach_${id}.missingCount`, section?.missing.length, coach?.version || 'Coach unavailable');
    for(const suffix of ['direction','evidenceCount','sourceCount','missingCount']) features[`coach_${id}.${suffix}`].version=coach?.version || 'unavailable';
    if (direction) votes.push(direction);
  }
  const p = control.homeProbability;
  put('meta_disagreement.coachDirectionalSections',votes.length,'deterministic');
  put('meta_disagreement.coachUnknownSections',COACH_SECTIONS.filter(([id])=>features[`coach_${id}.direction`].value===null).length,'deterministic');
  for(const [label,ids] of Object.entries({qbProtection:['quarterback','protection'],qbReceivers:['quarterback','receivers'],protectionAvailability:['protection','availability']})) {
    const directions=ids.map(id=>features[`coach_${id}.direction`].value);
    put(`meta_disagreement.${label}Agreement`,directions.every(v=>v===1||v===-1)?Number(directions[0]===directions[1]):null,'deterministic');
  }
  const pickedHome = p != null && p >= .5;
  const coachVotes = votes.slice();
  if (p != null && p !== .5) votes.push(pickedHome ? 1 : -1);
  if (pureDirection) votes.push(pureDirection);
  if (lettrologyDirection) votes.push(lettrologyDirection);
  const learningProbability=features['deepseek_learning.homeProbability']?.value;
  if(typeof learningProbability==='number'&&learningProbability!==.5) votes.push(learningProbability>.5?1:-1);
  const market = input.market;
  const marketSafe = market && market.probability > 0 && market.probability < 1 && Date.parse(market.observedAt) <= cutoff;
  put('football_market.homeProbability', marketSafe ? market.probability : null, market?.source || 'Market unavailable', false, marketSafe ? market.observedAt : null);
  if (marketSafe && market.probability !== .5) votes.push(market.probability > .5 ? 1 : -1);
  put('meta_disagreement.controlMarketGap', marketSafe && p != null ? Math.abs(p - market.probability) : null, 'deterministic');
  put('meta_disagreement.controlCoachDisagreement', coachVotes.length && p != null
    ? coachVotes.filter(v => (v > 0) !== pickedHome).length / coachVotes.length : null, 'deterministic');
  put('meta_disagreement.controlExperimentalDisagreement', pureDirection && p != null ? Number((pureDirection > 0) !== pickedHome) : null, 'deterministic');
  put('meta_disagreement.availableSignalCount', votes.length, 'deterministic');
  const fraction = votes.length ? votes.filter(v => v > 0).length / votes.length : null;
  put('meta_disagreement.directionalEntropy', fraction === null ? null : fraction === 0 || fraction === 1 ? 0 :
    -fraction * Math.log2(fraction) - (1 - fraction) * Math.log2(1 - fraction), 'deterministic');
  put('meta_disagreement.sectionDisagreement', coachVotes.length ? 1 - Math.abs(coachVotes.reduce((a,b) => a+b,0)) / coachVotes.length : null, 'deterministic');
  const measured = Object.values(features);
  put('data_quality.missingFeatureCount', measured.filter(f => f.value === null).length, 'deterministic');
  put('data_quality.coverage', measured.filter(f => f.status === 'known').length / measured.length, 'deterministic');
  return deepFreeze({ schemaVersion: 'unified-pregame-v1', forecastId: `${input.gameId}:${input.modelVersion}:${input.horizon}:${input.mode}`,
    gameId: input.gameId, modelVersion: input.modelVersion, captureHorizon: input.horizon, evidenceMode: input.mode,
    capturedAt, cutoffAt, kickoffAt, features });
}
export function numericResearchFeatures(snapshot?: UnifiedPregameSnapshot): Record<string, number | null> {
  return Object.fromEntries(Object.entries(snapshot?.features || {}).map(([key, f]) =>
    [key, f.status === 'known' && typeof f.value === 'number' && Number.isFinite(f.value) ? f.value : null]));
}
export function validateUnifiedSnapshot(snapshot: UnifiedPregameSnapshot, expected?: {gameId:string;modelVersion:string;kickoffAt:string;now:string}): void {
  if (!snapshot || snapshot.schemaVersion!=='unified-pregame-v1' || !snapshot.features || Array.isArray(snapshot.features)) throw new Error('Invalid unified snapshot.');
  const cutoff=Date.parse(snapshot.cutoffAt),capture=Date.parse(snapshot.capturedAt),kickoff=Date.parse(snapshot.kickoffAt);
  if(![cutoff,capture,kickoff].every(Number.isFinite)||cutoff>capture||cutoff>=kickoff) throw new Error('Invalid snapshot chronology.');
  if(snapshot.evidenceMode==='PROSPECTIVE' && capture>=kickoff) throw new Error('Late prospective snapshot.');
  if(!['PROSPECTIVE','HISTORICAL_RECONSTRUCTION'].includes(snapshot.evidenceMode)) throw new Error('Unknown evidence mode.');
  if(!['T-72h','T-24h','T-3h','T-30m'].includes(snapshot.captureHorizon)) throw new Error('Invalid horizon.');
  if(expected && (snapshot.gameId!==expected.gameId||snapshot.modelVersion!==expected.modelVersion||kickoff!==Date.parse(expected.kickoffAt)||capture>Date.parse(expected.now)||
    snapshot.evidenceMode!=='PROSPECTIVE'||snapshot.captureHorizon!==captureHorizon(snapshot.kickoffAt,snapshot.capturedAt))) throw new Error('Snapshot provenance mismatch.');
  for(const [key,f] of Object.entries(snapshot.features)) {
    if(!/^(football_|coach_|experimental_|meta_disagreement\.|data_quality\.|deepseek_learning\.)/.test(key)||/(^|\.)(actual|winner|postgame|final.?score|game.?id|season|team.?id)(\.|$)/i.test(key)) throw new Error('Forbidden research feature.');
    if(!f || typeof f!=='object'||!['known','missing','unknown','not-applicable','BLOCKED_DATA'].includes(f.status)||!f.source||!f.version||f.capturedAt!==snapshot.capturedAt) throw new Error('Invalid feature metadata.');
    if(f.status==='known' && (f.value==null||!f.observedAt||!Number.isFinite(Date.parse(f.observedAt))||Date.parse(f.observedAt)>cutoff||
      (typeof f.value==='number'&&!Number.isFinite(f.value)))) throw new Error('Invalid known feature.');
    if(f.status!=='known'&&f.value!==null) throw new Error('Unavailable feature must remain null.');
    if(f.includedInProduction && (!key.startsWith('football_core.')||key.endsWith('restLogit'))) throw new Error('Research signal cannot claim production influence.');
  }
}
export function horizonDelta(earlier: UnifiedPregameSnapshot, later: UnifiedPregameSnapshot) {
  if (earlier.gameId !== later.gameId || earlier.modelVersion !== later.modelVersion || earlier.evidenceMode !== later.evidenceMode ||
    Date.parse(earlier.capturedAt) >= Date.parse(later.capturedAt)) throw new Error('Incompatible horizon comparison.');
  const a = numericResearchFeatures(earlier), b = numericResearchFeatures(later);
  return Object.fromEntries(Object.keys(b).map(key => [key, a[key] != null && b[key] != null ? b[key]! - a[key]! : null]));
}
