import fallback from '../research/reports/v2-summary.js';
import {DatabaseResearchState,liveResearchInput} from './researchStore.js';
import {buildResearchScorecards} from '../scripts/research-scorecards.js';
import {upsetComparisons,horizonComparisons} from '../scripts/research-comparisons.js';
import {numericResearchFeatures} from '../services/researchSnapshot.js';
export async function liveResearchSummary(){
 const [input,events]=await Promise.all([liveResearchInput(),new DatabaseResearchState().all()]);
 const completed=input.snapshots.filter(s=>s.actualWinner&&s.actualWinner!=='TIE');
 const latest=events.filter(e=>e.event_kind==='RUN').at(-1)?.payload;
 const shadows=events.filter(e=>e.event_kind==='SHADOW_FORECAST').map(e=>({name:e.payload.experimentId,snapshotId:e.payload.snapshotId,probability:e.payload.challengerProbability}));
 const report=buildResearchScorecards(input.snapshots,shadows),coach=buildResearchScorecards(input.coachSnapshots);
 const correct=completed.filter(s=>s.predictedWinner===s.actualWinner).length;
 const fields=[...new Set(input.snapshots.flatMap(s=>Object.keys(numericResearchFeatures(s.unifiedSnapshot))))];
 return {...fallback,generatedAt:new Date().toISOString(),source:'LIVE_DATABASE',liveEngine:latest||{status:'AWAITING_FIRST_RUN'},
  durable:{evidence:'Frozen prospective database forecasts',eligible:completed.length,correct,misses:completed.length-correct,
   knownClusters:latest?.populations.reduce((n:number,p:any)=>n+(p.known||0),0)||0,validatedDiscoveredClusters:latest?.populations.reduce((n:number,p:any)=>n+(p.discovered||0),0)||0},
  completedUniqueGames:new Set(completed.map(s=>s.gameId)).size,activeExperiment:latest?.experiment?{experiment_id:latest.experiment.experimentId}:null,
  coach:{sections:coach.scorecards.prospective,prospectiveReports:input.coachSnapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='PROSPECTIVE').length,
   historicalReports:input.coachSnapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='HISTORICAL_RECONSTRUCTION').length},
  shadowLeaderboard:report.leaderboard,redundancy:report.redundancy.slice(0,40),upsetComparisons:upsetComparisons(input.snapshots),horizonChanges:horizonComparisons(input.snapshots),
  dataQuality:{fields:fields.length,coverage:fields.map(key=>({key,known:input.snapshots.filter(s=>numericResearchFeatures(s.unifiedSnapshot)[key]!=null).length,total:input.snapshots.length}))},
  durableEvents:{total:events.length,manifests:events.filter(e=>e.event_kind==='MANIFEST').map(e=>e.payload),promotions:events.filter(e=>e.event_kind==='PROMOTION').map(e=>e.payload)}};
}
