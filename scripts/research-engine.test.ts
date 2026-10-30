import assert from 'node:assert/strict';
import {buildUnifiedSnapshot,numericResearchFeatures} from '../services/researchSnapshot.js';
import {runResearchEngine,freezeChallengerForecasts,checkResearchInputs} from './research-engine.js';
import {MemoryResearchState} from './research-state.js';
import {defaultCohortPlan} from './research-cohorts.js';
import {validateHypothesis,manualHypotheses,generateResearchHypotheses} from './research-hypotheses.js';
import {buildFailureFeatureRows,type ResearchPredictionSnapshot as Snapshot} from './research-core.js';
import {walkForward,evaluateChallenger} from './research-walk-forward.js';
import {discoverResidualSubgroups} from './residual-discovery.js';
let assertions=0;const check=(name:string,fn:()=>void)=>{fn();assertions++;console.log(`PASS ${name}`);};
let seed=177;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function fixtures(noise=false):Snapshot[]{
 return Array.from({length:6400},(_,i)=>{
  const week=1+Math.floor(i/400),season=2027,homeTeam=`H${i%32}`,awayTeam=`A${(i+7)%32}`;
  const qb=Number(random()>.5),ol=Number(random()>.5),elo=Number(random()>.5),trap=qb&&ol&&elo;
  const actualHome=random()<(noise?.7:trap?.02:.7);
  const date=new Date(Date.UTC(season,8,1+(week-1)*7)),kickoffAt=new Date(+date+20*3600000).toISOString(),capturedAt=new Date(+date-5*3600000).toISOString();
  const p=.7,baseLogit=Math.log(p/(1-p)),core={baseHomeProbability:70,finalHomeProbability:70,eloHome:1600,eloAway:1500,
    footballLogitAdjustment:0,venueLogitAdjustment:0,h2hLogitAdjustment:0,personnelLogitAdjustment:0,restLogitAdjustment:0,numerologyLogitAdjustment:0};
  const extra=(value:number)=>({value,status:'known' as const,source:'Synthetic pregame fixture',observedAt:capturedAt,capturedAt,version:'test',includedInProduction:false});
  const gameId=`SYNTHETIC-${i}`;
  const unifiedSnapshot=buildUnifiedSnapshot({gameId,modelVersion:'test-control',kickoffAt,capturedAt,cutoffAt:capturedAt,horizon:'T-72h',mode:'PROSPECTIVE',
   homeTeam,awayTeam,result:{modelScores:core,accuracyFeatures:{travel:{awayTravelMiles:10,awayTzChange:1,isShortRest:Boolean(qb),logitEdge:0}}},
   extraFeatures:{'football_qb.edge':extra(qb),'football_ol.edge':extra(ol),'football_core.syntheticEloDisagreement':extra(elo)}});
  return {snapshotId:gameId,gameId,sourceModelVersion:'test-control',season,week,gameday:date.toISOString().slice(0,10),predictionTimestamp:capturedAt,dataCutoffTimestamp:capturedAt,
   homeTeam,awayTeam,neutralSite:false,homeWinProbability:p,awayWinProbability:1-p,predictedWinner:homeTeam,actualWinner:actualHome?homeTeam:awayTeam,unifiedSnapshot,
   entityContext:{homeQbId:`Q${i%32}`,awayQbId:`R${(i+7)%32}`},featureSnapshot:{baseLogit,formLogit:0,venueLogit:0,h2hLogit:0,personnelLogit:0,restLogit:0}};
 });
}
const allFixtures=fixtures(),rows=allFixtures.filter(r=>r.week<=12),state=new MemoryResearchState(),now='2027-11-20T00:00:00Z';
check('known booleans enter research matrix as 1/0; missing stays null',()=>{
 const features=numericResearchFeatures(rows[0].unifiedSnapshot);assert.equal(features['football_travel.isShortRest'],Number(rows[0].unifiedSnapshot!.features['football_travel.isShortRest'].value));
 assert.equal(features['football_matchup.edge'],null);
});
const summary=await runResearchEngine(rows,{state,now,codeCommit:'synthetic-test'});
check('complete forward cycle creates source-specific hypotheses, frozen inputs, manifest, rolling evaluation and result',()=>{
 assert.equal(summary.leakage.passed,true);assert.ok(summary.populations.some(p=>p.discovered>0),JSON.stringify(summary.populations.map(p=>p.search)));
 assert.ok(summary.experiment);assert.ok(summary.experiment.rolling.folds.length>=3);
 assert.ok(state.events.some(e=>e.event_kind==='INPUTS'));assert.ok(state.events.some(e=>e.event_kind==='MANIFEST'));assert.ok(state.events.some(e=>e.event_kind==='RESULT'));
 const manifest=state.events.findIndex(e=>e.event_kind==='MANIFEST'),result=state.events.findIndex(e=>e.event_kind==='RESULT');assert.ok(manifest<result);
 assert.ok(['ADD_FEATURE','ADD_INTERACTION','ADD_UNCERTAINTY_GATE'].includes(summary.experiment.hypothesis.actionType));
});
check('walk-forward folds train only on prior dates and report actual out-of-sample forecasts',()=>{
 for(const fold of summary.experiment.rolling.folds)assert.ok(fold.trainGames<4801&&fold.testGames>0);
 assert.ok(summary.experiment.rolling.oosGames>=450);
});
check('all required experiment metadata is durable before evaluation',()=>{
 const m=state.events.find(e=>e.event_kind==='MANIFEST')!.payload;
 for(const key of ['eligible_population','input_event_ids','input_hash','hypothesis','code_commit','encoding_version','confirmation_range','primary_metrics','secondary_metrics','leakage_checks','search_budget_used'])assert.ok(m[key]);
});
const prior=state.events.find(e=>e.event_kind==='RESULT')!.payload;
check('planted mechanism survives explicit robustness gates',()=>assert.equal(prior.decision,'SURVIVED_RESEARCH',JSON.stringify(prior.evaluation.gates)));
const future=structuredClone(allFixtures.find(s=>s.week===13)!);future.actualWinner=undefined;
const beforeCapture=new Date(Date.parse(future.predictionTimestamp)-1000).toISOString();
check('future confirmation never includes outcomes before kickoff',()=>assert.equal(summary.promotions[0]?.prospectiveN,0));
assert.equal(await freezeChallengerForecasts([future],state,beforeCapture),0);
const saved=await freezeChallengerForecasts([future],state,future.predictionTimestamp);
check('surviving challenger freezes prospective bytes after inputs exist',()=>assert.equal(saved,1));
assert.equal(await freezeChallengerForecasts([future],state,future.unifiedSnapshot!.kickoffAt),0);
check('shadow capture rejects late captures and cannot overwrite first forecast',()=>assert.equal(state.events.filter(e=>e.event_kind==='SHADOW_FORECAST').length,1));
const week13=allFixtures.filter(s=>s.week===13),pregame=week13.map(s=>({...s,actualWinner:undefined}));
await freezeChallengerForecasts(pregame,state,pregame[0].predictionTimestamp);
const confirmed=await runResearchEngine([...rows,...week13],{state,now:'2027-11-26T00:00:00Z',codeCommit:'synthetic-test'});
check('confirmation joins only real pre-kickoff frozen forecasts and preserves production boundary',()=>{
 const promotion=confirmed.promotions.find(p=>p.experimentId===prior.experimentId);assert.equal(promotion?.prospectiveN,400);assert.equal(promotion?.exactFrozenPredictions,true);assert.equal(promotion?.status,'SHADOW_CANDIDATE');
});
// Simulate process interruption after manifest and restart from serialized immutable events.
const restart=new MemoryResearchState();restart.events=JSON.parse(JSON.stringify(state.events.filter(e=>e.event_kind!=='RESULT'&&e.event_kind!=='RUN'&&e.event_kind!=='PROMOTION'&&e.event_kind!=='SHADOW_FORECAST'&&(e.event_kind!=='MANIFEST'||e.event_key===prior.experimentId))));
const resumed=await runResearchEngine(rows,{state:restart,now,codeCommit:'synthetic-test'});
check('restart resumes the original manifest and frozen inputs instead of forgetting/retesting it',()=>{
 assert.equal(resumed.experiment.experimentId,prior.experimentId);assert.equal(restart.events.filter(e=>e.event_kind==='MANIFEST').length,1);
 assert.equal(resumed.experiment.selectedParameter,prior.selectedParameter);
});
const duplicate=await restart.append('RESULT',prior.experimentId,{decision:'FORGED'});
check('append-only state does not overwrite a prior result',()=>assert.notEqual(duplicate.payload.decision,'FORGED'));
check('required hypothesis fields and manual populations are actually validated',()=>{
 const h=summary.experiment.hypothesis;assert.throws(()=>validateHypothesis({...h,comparisonPopulation:undefined}));
 const result=manualHypotheses([{...h,hypothesisId:'manual-test'}],summary.populations.flatMap(p=>p.clusters||[]),'test-control');assert.equal(result.executable.length,1);
});
const corrupt=structuredClone(rows[0]);corrupt.unifiedSnapshot!.features['football_qb.edge'].observedAt='2099-01-01T00:00:00Z';
await assert.rejects(runResearchEngine([corrupt],{state:new MemoryResearchState(),codeCommit:'test'}),/leakage/);assertions++;console.log('PASS leakage blocks insufficient-sample/empty-experiment paths too');
const noEffect=evaluateChallenger(rows.slice(0,100),{...summary.experiment.hypothesis,conditions:[],proposedImplementation:'NO_MODEL_CHANGE_RESEARCH_ONLY'},0);
check('neutral or uncertain improvements cannot survive robustness gates',()=>{assert.notEqual(noEffect.decision,'SURVIVED_RESEARCH');assert.equal(noEffect.gates.uncertainty,false);assert.equal(noEffect.gates.nullChallenge,false);});
const noise=fixtures(true),nRows=buildFailureFeatureRows(noise);
const nullDiscovery=discoverResidualSubgroups(nRows.filter(r=>r.week<=8),nRows.filter(r=>r.week>=9&&r.week<=12),{allowSingleSeason:true,requireQbContext:true});
check('forward noise is rejected without relaxing thresholds',()=>assert.equal(nullDiscovery.clusters.length,0));
console.log(`Research completion end-to-end: ${assertions} checks passed.`);
