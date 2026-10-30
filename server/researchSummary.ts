import fallback from '../research/reports/v2-summary.js';
import {DatabaseResearchState,liveResearchInput} from './researchStore.js';
import {buildResearchScorecards} from '../scripts/research-scorecards.js';
import {upsetComparisons,horizonComparisons,horizonPerformance} from '../scripts/research-comparisons.js';
import {coverageReport} from './historicalResearch.js';
import {calibrationMetrics} from '../scripts/research-scorecards.js';
import {numericResearchFeatures} from '../services/researchSnapshot.js';
export async function liveResearchSummary(){
 const [input,events]=await Promise.all([liveResearchInput(),new DatabaseResearchState().all()]);
 const historical=input.snapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='HISTORICAL_RECONSTRUCTION'),prospective=input.snapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='PROSPECTIVE');
 const completed=prospective.filter(s=>s.actualWinner&&s.actualWinner!=='TIE');
 const latest=events.filter(e=>e.event_kind==='RUN'&&e.payload.version==='autoresearch-v2.1').at(-1)?.payload;
 const shadows=events.filter(e=>e.event_kind==='SHADOW_FORECAST').map(e=>({name:e.payload.experimentId,snapshotId:e.payload.snapshotId,probability:e.payload.challengerProbability}));
 const report=buildResearchScorecards(input.snapshots,shadows),coach=buildResearchScorecards(input.coachSnapshots);
 const correct=completed.filter(s=>s.predictedWinner===s.actualWinner).length;
 const historicalCompleted=historical.filter(s=>s.actualWinner&&s.actualWinner!=='TIE'),historicalCorrect=historicalCompleted.filter(s=>s.predictedWinner===s.actualWinner).length;
 const rawFields=[...new Set(input.snapshots.flatMap(s=>Object.keys(s.unifiedSnapshot?.features||{})))];
 const historicalKnown=[...new Set(historical.flatMap(s=>Object.entries(s.unifiedSnapshot!.features).filter(([,f])=>f.status==='known').map(([key])=>key)))];
 const clusterCount=(mode:string,key:string)=>(latest?.populations||[]).filter((p:any)=>p.plan.mode===mode).reduce((n:number,p:any)=>n+(p[key]||0),0);
 const fields=[...new Set(input.snapshots.flatMap(s=>Object.keys(numericResearchFeatures(s.unifiedSnapshot))))];
 return {...fallback,generatedAt:new Date().toISOString(),source:'LIVE_DATABASE',liveEngine:latest||{status:'AWAITING_FIRST_RUN'},
  historical:{evidence:'Historical reconstruction library',eligible:historicalCompleted.length,correct:historicalCorrect,misses:historicalCompleted.length-historicalCorrect,
   knownClusters:clusterCount('HISTORICAL_RECONSTRUCTION','known'),validatedDiscoveredClusters:clusterCount('HISTORICAL_RECONSTRUCTION','discovered')},
  snapshot:{...fallback.snapshot,fields:rawFields.length,families:new Set(rawFields.map(k=>k.split('.')[0])).size,fieldsEverKnown:historicalKnown.length,
   knownFields:historicalKnown,missingOrBlocked:rawFields.filter(k=>!historicalKnown.includes(k)),example:input.snapshots[0]?.unifiedSnapshot||null},
  library:{historical:coverageReport(historical),prospective:coverageReport(prospective),completedProspectiveUniqueGames:new Set(completed.map(s=>s.gameId)).size,completedProspectiveSnapshots:completed.length,
   forwardHorizons:['T-72h','T-24h','T-3h','T-30m'].map(horizon=>({horizon,snapshots:prospective.filter(s=>s.unifiedSnapshot?.captureHorizon===horizon).length,
    ...calibrationMetrics(completed.filter(s=>s.unifiedSnapshot?.captureHorizon===horizon).map(s=>({p:s.homeWinProbability,y:Number(s.actualWinner===s.homeTeam)})))})),
   horizonPerformance:horizonPerformance(prospective),captureRuns:events.filter(e=>e.payload.recordType==='AUTOMATIC_CAPTURE').slice(-40).map(e=>e.payload)},
  durable:{evidence:'Frozen prospective database forecasts',eligible:completed.length,correct,misses:completed.length-correct,
   knownClusters:clusterCount('PROSPECTIVE','known'),validatedDiscoveredClusters:clusterCount('PROSPECTIVE','discovered')},
  completedUniqueGames:new Set(completed.map(s=>s.gameId)).size,activeExperiment:latest?.experiment?{experiment_id:latest.experiment.experimentId}:null,
  coach:{sections:coach.scorecards.prospective,prospectiveReports:input.coachSnapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='PROSPECTIVE').length,
   historicalReports:input.coachSnapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='HISTORICAL_RECONSTRUCTION').length},
  shadowLeaderboard:report.leaderboard,redundancy:report.redundancy.slice(0,40),upsetComparisons:upsetComparisons(input.snapshots),horizonChanges:horizonComparisons(input.snapshots),
  dataQuality:{fields:fields.length,coverage:fields.map(key=>({key,known:input.snapshots.filter(s=>numericResearchFeatures(s.unifiedSnapshot)[key]!=null).length,total:input.snapshots.length}))},
  durableEvents:{total:events.length,manifests:events.filter(e=>e.event_kind==='MANIFEST').map(e=>e.payload),promotions:events.filter(e=>e.event_kind==='PROMOTION').map(e=>e.payload)}};
}
