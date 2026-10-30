import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseGamesCsv,parseTeamData,predictWinner} from '../services/validatedPredictionService.js';
import {buildUnifiedSnapshot} from '../services/researchSnapshot.js';
import {easternKickoffIso} from '../services/kickoff.js';
import {loadResearchTeamEdges} from '../services/researchTeamStats.js';
import {logit,buildFailureFeatureRows,normalizeFailureRows,type ResearchPredictionSnapshot} from './research-core.js';
import {adaptFrozenPredictions} from './frozen-research-input.js';
import {cohortRows,researchPopulations} from './research-cohorts.js';
import {FileResearchState} from './research-state.js';
import {runResearchEngine} from './research-engine.js';
import {upsetComparisons,horizonComparisons} from './research-comparisons.js';
import {writeResearchScorecards} from './research-scorecards.js';
const GAMES_URL='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const CONTROL_VERSION='v2.2-validated-current-season';
const DISCOVERY_SEASONS=new Set([2022,2023]),VALIDATION_SEASON=2024,LEGACY_TEST_SEASON=2025;
type Game=ReturnType<typeof parseGamesCsv>[number];
function actualWinner(game: Game): string | undefined {
  if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore) || game.homeScore === game.awayScore) return undefined;
  return game.homeScore! > game.awayScore! ? game.homeTeam : game.awayTeam;
}

async function generateSnapshots(games: Game[]): Promise<ResearchPredictionSnapshot[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const selected = games.filter(game =>
    (DISCOVERY_SEASONS.has(game.season) || game.season === VALIDATION_SEASON || game.season === LEGACY_TEST_SEASON) &&
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );
  const snapshots: ResearchPredictionSnapshot[] = [];

  for (let i = 0; i < selected.length; i++) {
    const game = selected[i];
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;
    const result = await predictWinner(
      home,
      away,
      new Date(`${game.gameday}T12:00:00Z`),
      true,
      { neutralSite: game.location === 'Neutral' }
    );
    if (!result.modelScores) continue;
    const s = result.modelScores;
    const homeProbability = s.finalHomeProbability / 100;
    const winner = actualWinner(game);
    const predictedWinner = homeProbability >= 0.5 ? game.homeTeam : game.awayTeam;
    const kickoffAt = easternKickoffIso(game.gameday, game.gametime || '') || `${game.gameday}T23:59:59Z`;
    const capturedAt = new Date().toISOString();
    const cutoffAt = `${game.gameday}T00:00:00.000Z`;
    const extraFeatures = await loadResearchTeamEdges(game.homeTeam, game.awayTeam, game.gameday, game.season, game.week, cutoffAt, capturedAt);
    const unifiedSnapshot = buildUnifiedSnapshot({ gameId: game.gameId, modelVersion: CONTROL_VERSION, kickoffAt,
      capturedAt, cutoffAt, horizon: 'T-24h', mode: 'HISTORICAL_RECONSTRUCTION', result,
      homeTeam: game.homeTeam, awayTeam: game.awayTeam, extraFeatures });
    snapshots.push({
      unifiedSnapshot,
      snapshotId: `${CONTROL_VERSION}:${game.gameId || `${game.season}-${game.week}-${game.awayTeam}-${game.homeTeam}`}`,
      gameId: game.gameId || `${game.season}-${game.week}-${game.awayTeam}-${game.homeTeam}`,
      sourceModelVersion: CONTROL_VERSION,
      season: game.season,
      week: Number(game.week) || 0,
      gameday: game.gameday,
      predictionTimestamp: capturedAt,
      dataCutoffTimestamp: `${game.gameday}T00:00:00.000Z`,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      neutralSite: game.location === 'Neutral',
      homeWinProbability: homeProbability,
      awayWinProbability: 1 - homeProbability,
      predictedWinner,
      featureSnapshot: {
        baseLogit: logit(s.baseHomeProbability / 100),
        formLogit: s.footballLogitAdjustment,
        venueLogit: s.venueLogitAdjustment,
        h2hLogit: s.h2hLogitAdjustment,
        personnelLogit: s.personnelLogitAdjustment,
        restLogit: s.restLogitAdjustment
      },
      actualWinner: winner,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      correct: winner ? predictedWinner === winner : undefined
    });
    if ((i + 1) % 100 === 0) console.log(`snapshot progress ${i + 1}/${selected.length}`);
  }
  return snapshots;
}


const arg=(key:string)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3);
async function main(){
 const output=resolve(arg('output-dir')||'research/runtime');mkdirSync(output,{recursive:true});
 const write=(name:string,value:unknown)=>writeFileSync(resolve(output,name),typeof value==='string'?value:JSON.stringify(value,null,2));
 if(process.argv.includes('--live')){
  const {runLiveResearch}=await import('../server/researchStore.js');const summary=await runLiveResearch();write('engine-summary.json',summary);console.log(JSON.stringify(summary,null,2));return;
 }
 const read=(file:string,fallback:any)=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):fallback;
 let snapshots:ResearchPredictionSnapshot[];
 if(arg('input'))snapshots=adaptFrozenPredictions(read(arg('input')!,[]),arg('coaches')?read(arg('coaches')!,[]):[]);
 else{const response=await fetch(GAMES_URL);if(!response.ok)throw new Error('NFL data unavailable');snapshots=await generateSnapshots(parseGamesCsv(await response.text()));}
 const state=new FileResearchState(resolve(arg('state-dir')||'research/state'));
 const summary=await runResearchEngine(snapshots,{state,codeCommit:process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
   manual:read('research/research-queue.json',[]),plans:arg('cohorts')?read(arg('cohorts')!,[]):undefined});
 write('prediction-snapshots.json',snapshots);
 const rows=buildFailureFeatureRows(snapshots);write('failure-feature-matrix.raw.json',rows);
 const modelReady=researchPopulations(snapshots).flatMap(population=>{
   const plan=summary.populations.find(p=>p.plan.modelVersion===population[0].sourceModelVersion&&p.plan.horizon===population[0].unifiedSnapshot?.captureHorizon&&p.plan.mode===population[0].unifiedSnapshot?.evidenceMode&&p.plan.ranges.some(r=>r.season===population[0].season))?.plan;
   const raw=buildFailureFeatureRows(population),ids=new Set(plan?cohortRows(population,plan,'DISCOVERY').map(s=>s.snapshotId):[]);
   return normalizeFailureRows(raw,raw.filter(r=>ids.has(r.snapshotId)));
 });
 write('failure-feature-matrix.model-ready.json',modelReady);
 write('failure-feature-matrix.misses.json',rows.filter(r=>!r.correct));write('comparison-population.correct.json',rows.filter(r=>r.correct));
 const events=await state.all();
 writeResearchScorecards(snapshots,output,events.filter(e=>e.event_kind==='SHADOW_FORECAST').map(e=>({name:e.payload.experimentId,snapshotId:e.payload.snapshotId,probability:e.payload.challengerProbability})));
 write('upset-comparison.json',upsetComparisons(snapshots));write('horizon-comparison.json',horizonComparisons(snapshots));
 write('engine-summary.json',summary);write('cycle-summary.json',summary);
 write('failure-clusters.json',summary.populations.flatMap(p=>p.clusters||[]));
 write('research-queue.json',summary.queue);write('combined-research-queue.json',[...summary.queue,...summary.blockedManual]);
 write('experiment-ledger.json',(await state.all()).filter(e=>e.event_kind==='MANIFEST'||e.event_kind==='RESULT'||e.event_kind==='PROMOTION'));
 const discovered=summary.populations.reduce((n,p)=>n+(p.discovered||0),0),known=summary.populations.reduce((n,p)=>n+(p.known||0),0);
 write('discovery-summary.json',{evidence:arg('input')?'PROSPECTIVE_FROZEN_EXPORT':'HISTORICAL_RECONSTRUCTION',eligible:rows.length,misses:rows.filter(r=>!r.correct).length,correct:rows.filter(r=>r.correct).length,
   knownClusters:known,validatedDiscoveredClusters:discovered,search:summary.populations.find(p=>p.search)?.search||{},leakage:summary.leakage,status:summary.status});
 const result=discovered?'VALIDATED RESEARCH SUBGROUPS FOUND':'NO NEW VALIDATED DATA-DRIVEN FAILURE PATTERN FOUND';
 write('latest.md','# NFL Autoresearch latest\n\n'+result+'\n\n'+JSON.stringify({status:summary.status,counts:summary.counts,leakage:summary.leakage,populations:summary.populations.map(p=>({plan:p.plan.id,status:p.status,discovery:p.discovery,validation:p.validation}))},null,2));
 console.log(JSON.stringify({result,status:summary.status,snapshots:snapshots.length,eligible:rows.length,counts:summary.counts,leakage:summary.leakage},null,2));
}
main().catch(error=>{console.error(error);process.exit(1)});
