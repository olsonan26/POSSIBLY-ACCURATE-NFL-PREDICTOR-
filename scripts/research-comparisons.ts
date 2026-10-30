import type {ResearchPredictionSnapshot as Snapshot} from './research-core.js';
import {numericResearchFeatures} from '../services/researchSnapshot.js';
import {calibrationMetrics} from './research-scorecards.js';

/** Descriptive reports only; outcomes never feed pregame features or discovery thresholds. */
export function upsetComparisons(snapshots:Snapshot[]) {
 return [...new Set(snapshots.map(s=>s.unifiedSnapshot?.captureHorizon))].flatMap(horizon=>['market','control'].map(reference=>{
  const rows=snapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='PROSPECTIVE'&&s.unifiedSnapshot.captureHorizon===horizon&&s.actualWinner&&s.actualWinner!=='TIE');
  const eligible=rows.flatMap(s=>{const p=reference==='control'?s.homeWinProbability:numericResearchFeatures(s.unifiedSnapshot)['football_market.homeProbability'];
   return p==null||p===.5?[]:[{s,upset:(p>=.5)!==(s.actualWinner===s.homeTeam)}];});
  const group=(upset:boolean)=>{
   const chosen=eligible.filter(r=>r.upset===upset),keys=[...new Set(chosen.flatMap(r=>Object.keys(numericResearchFeatures(r.s.unifiedSnapshot))))];
   return {n:chosen.length,features:Object.fromEntries(keys.map(key=>{const values=chosen.map(r=>numericResearchFeatures(r.s.unifiedSnapshot)[key]).filter(v=>v!=null) as number[];
    return [key,{known:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null}];}))};
  };
  return {horizon,reference,underdogWon:group(true),favoriteWon:group(false),purpose:'Descriptive comparison; discovery still requires independent validation'};
 }));
}
export function horizonComparisons(snapshots:Snapshot[]) {
 const pairs:any[]=[];
 const groups=new Map<string,Snapshot[]>();
 for(const s of snapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='PROSPECTIVE')){
  const key=`${s.gameId}:${s.sourceModelVersion}`;groups.set(key,[...(groups.get(key)||[]),s]);
 }
 for(const rows of groups.values()){
  const sorted=rows.slice().sort((a,b)=>Date.parse(a.predictionTimestamp)-Date.parse(b.predictionTimestamp));
  for(let i=1;i<sorted.length;i++){
   const a=sorted[i-1],b=sorted[i];if(a.unifiedSnapshot!.captureHorizon===b.unifiedSnapshot!.captureHorizon)continue;
   const before=numericResearchFeatures(a.unifiedSnapshot),after=numericResearchFeatures(b.unifiedSnapshot);
   pairs.push({gameId:a.gameId,model:a.sourceModelVersion,from:a.unifiedSnapshot!.captureHorizon,to:b.unifiedSnapshot!.captureHorizon,
    probabilityDelta:b.homeWinProbability-a.homeWinProbability,changes:Object.fromEntries(Object.keys(after).filter(k=>after[k]!=null&&before[k]!=null&&after[k]!==before[k]).map(k=>[k,{before:before[k],after:after[k],delta:after[k]!-before[k]!}])),
    controlBefore:a.actualWinner&&a.actualWinner!=='TIE'?calibrationMetrics([{p:a.homeWinProbability,y:Number(a.actualWinner===a.homeTeam)}]):null,
    controlAfter:b.actualWinner&&b.actualWinner!=='TIE'?calibrationMetrics([{p:b.homeWinProbability,y:Number(b.actualWinner===b.homeTeam)}]):null});
  }
 }
 return pairs;
}
