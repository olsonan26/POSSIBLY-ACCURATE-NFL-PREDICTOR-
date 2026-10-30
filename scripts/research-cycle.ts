import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseGamesCsv} from '../services/validatedPredictionService.js';
import {reconstructHistoricalGame} from '../server/historicalResearch.js';
import {easternKickoffIso} from '../services/kickoff.js';
import {loadResearchTeamEdges} from '../services/researchTeamStats.js';
import {buildFailureFeatureRows,normalizeFailureRows,type ResearchPredictionSnapshot} from './research-core.js';
import {adaptFrozenPredictions} from './frozen-research-input.js';
import {cohortRows,researchPopulations} from './research-cohorts.js';
import {FileResearchState} from './research-state.js';
import {runResearchEngine} from './research-engine.js';
import {upsetComparisons,horizonComparisons} from './research-comparisons.js';
import {writeResearchScorecards} from './research-scorecards.js';
const GAMES_URL='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const CONTROL_VERSION='v2.2-validated-current-season';
const DISCOVERY_SEASONS=new Set([2022,2023]),VALIDATION_SEASON=2024,LEGACY_TEST_SEASON=2025;
async function generateSnapshots(games:ReturnType<typeof parseGamesCsv>) {
 const schedule=games.map(g=>({...g,neutralSite:g.location==='Neutral',completed:Number.isFinite(g.homeScore)&&Number.isFinite(g.awayScore)}));
 const selected=schedule.filter(g=>(DISCOVERY_SEASONS.has(g.season)||g.season===VALIDATION_SEASON||g.season===LEGACY_TEST_SEASON)&&g.gameType==='REG'&&g.completed&&g.homeScore!==g.awayScore);
 const snapshots:ResearchPredictionSnapshot[]=[];
 for(const [i,game] of selected.entries()){
  snapshots.push(await reconstructHistoricalGame(game,schedule));
  if((i+1)%100===0)console.log('snapshot progress '+(i+1)+'/'+selected.length);
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
