import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COACH_SECTIONS } from '../services/coachAnalysis.js';
import type { ResearchPredictionSnapshot } from './research-core.js';
import { numericResearchFeatures } from '../services/researchSnapshot.js';

export function coachSectionScorecard(snapshots: ResearchPredictionSnapshot[], mode: 'PROSPECTIVE' | 'HISTORICAL_RECONSTRUCTION') {
 const eligible=snapshots.filter(s=>s.unifiedSnapshot?.evidenceMode===mode&&s.actualWinner&&s.actualWinner!=='TIE');
 const horizons=[...new Set(eligible.map(s=>s.unifiedSnapshot!.captureHorizon))];
 return (horizons.length?horizons:['UNAVAILABLE']).flatMap(horizon=>COACH_SECTIONS.map(([id])=>{
  const rows=eligible.filter(s=>s.unifiedSnapshot!.captureHorizon===horizon);
  const value=(s:ResearchPredictionSnapshot)=>numericResearchFeatures(s.unifiedSnapshot)['coach_'+id+'.direction'];
  const available=rows.filter(s=>value(s)!=null),directional=available.filter(s=>Math.abs(value(s)!)===1);
  const side=(s:ResearchPredictionSnapshot)=>value(s)===1;
  const hit=(s:ResearchPredictionSnapshot)=>side(s)===(s.actualWinner===s.homeTeam);
  const disagreed=directional.filter(s=>side(s)!==(s.homeWinProbability>=.5));
  const accuracy=(r:ResearchPredictionSnapshot[])=>r.length?r.filter(hit).length/r.length:null;
  const comparison=(r:ResearchPredictionSnapshot[])=>{
   const sectionCorrect=r.filter(hit).length,controlCorrect=r.filter(s=>(s.homeWinProbability>=.5)===(s.actualWinner===s.homeTeam)).length;
   const controlOnly=r.filter(s=>!hit(s)&&(s.homeWinProbability>=.5)===(s.actualWinner===s.homeTeam)).length;
   const sectionOnly=r.filter(s=>hit(s)&&(s.homeWinProbability>=.5)!==(s.actualWinner===s.homeTeam)).length;
   return {n:r.length,sectionCorrect,controlCorrect,accuracyDelta:r.length?(sectionCorrect-controlCorrect)/r.length:null,controlOnlyCorrect:controlOnly,sectionOnlyCorrect:sectionOnly};
  };
  const marketSide=(s:ResearchPredictionSnapshot)=>{const p=numericResearchFeatures(s.unifiedSnapshot)['football_market.homeProbability'];return p==null?null:(p>=.5)===side(s);};
  return {section:id,mode,horizon,eligible:rows.length,available:available.length,directional:directional.length,accuracy:accuracy(directional),
   controlAgreement:directional.length?1-disagreed.length/directional.length:null,disagreementN:disagreed.length,disagreementAccuracy:accuracy(disagreed),
   coverage:rows.length?directional.length/rows.length:null,homePickRate:directional.length?directional.filter(side).length/directional.length:null,
   incrementalVsControl:comparison(directional),favorite:comparison(directional.filter(s=>marketSide(s)===true)),underdog:comparison(directional.filter(s=>marketSide(s)===false)),
   seasonResults:[...new Set(directional.map(s=>s.season))].map(season=>({season,...comparison(directional.filter(s=>s.season===season)),accuracy:accuracy(directional.filter(s=>s.season===season))})),
   status:directional.length<50?'INSUFFICIENT_SAMPLE':mode==='PROSPECTIVE'?'RESEARCH_ONLY':'RECONSTRUCTION_ONLY'};
 }));
}
export function calibrationMetrics(rows: { p: number; y: number }[]) {
  if (!rows.length) return { n: 0, accuracy: null, brier: null, logLoss: null, ece: null };
  const bins = Array.from({length:10}, () => [] as { p:number; y:number }[]);
  rows.forEach(r => bins[Math.min(9, Math.floor(r.p * 10))].push(r));
  return { n: rows.length, accuracy: rows.filter(r => Number(r.p >= .5) === r.y).length / rows.length,
    brier: rows.reduce((a,r) => a + (r.p-r.y)**2,0) / rows.length,
    logLoss: rows.reduce((a,r) => a - (r.y ? Math.log(Math.max(.001,r.p)) : Math.log(Math.max(.001,1-r.p))),0) / rows.length,
    ece: bins.reduce((sum,bin) => sum + Math.abs(bin.reduce((a,r) => a+r.p-r.y,0)),0) / rows.length };
}
export function redundancyMap(snapshots: ResearchPredictionSnapshot[]) {
  const rows = snapshots.map(s => numericResearchFeatures(s.unifiedSnapshot));
  const names = [...new Set(rows.flatMap(Object.keys))].filter(k => !/Count|data_quality/.test(k));
  const pairs: {a:string; b:string; n:number; correlation:number}[] = [];
  for (let i=0;i<names.length;i++) for (let j=i+1;j<names.length;j++) {
    const a=names[i],b=names[j], values=rows.filter(r => r[a]!=null && r[b]!=null);
    if(values.length<30) continue;
    const am=values.reduce((s,r)=>s+r[a]!,0)/values.length,bm=values.reduce((s,r)=>s+r[b]!,0)/values.length;
    const cov=values.reduce((s,r)=>s+(r[a]!-am)*(r[b]!-bm),0);
    const denom=Math.sqrt(values.reduce((s,r)=>s+(r[a]!-am)**2,0)*values.reduce((s,r)=>s+(r[b]!-bm)**2,0));
    if(denom>0) pairs.push({a,b,n:values.length,correlation:cov/denom});
  }
  return pairs.sort((a,b)=>Math.abs(b.correlation)-Math.abs(a.correlation));
}
export function buildResearchScorecards(snapshots: ResearchPredictionSnapshot[], challengers: {name:string;snapshotId:string;probability:number}[]=[]) {
  const scorecards = { prospective: coachSectionScorecard(snapshots,'PROSPECTIVE'), historical: coachSectionScorecard(snapshots,'HISTORICAL_RECONSTRUCTION') };
  const signals = ['coach_summary.finalDirection',...new Set(challengers.map(c=>c.name)),'control','football_market.homeProbability','football_efficiency.logitEdge','experimental_astrology.direction',
    'experimental_lettrology.direction','deepseek_learning.homeProbability'];
  const horizons=[...new Set(snapshots.map(s=>s.unifiedSnapshot?.captureHorizon).filter(Boolean))];
  const leaderboard = ['PROSPECTIVE','HISTORICAL_RECONSTRUCTION'].flatMap(mode => horizons.flatMap(horizon=>signals.map(signal => {
    const rows = snapshots.filter(s => s.unifiedSnapshot?.evidenceMode === mode && s.unifiedSnapshot?.captureHorizon===horizon && s.actualWinner && s.actualWinner !== 'TIE');
    const forecasts = rows.flatMap(s => {
      const value = signal === 'control' ? s.homeWinProbability : challengers.find(c=>c.name===signal&&c.snapshotId===s.snapshotId)?.probability ?? numericResearchFeatures(s.unifiedSnapshot)[signal];
      return value == null ? [] : [{ p: value, y: Number(s.actualWinner === s.homeTeam) }];
    });
    const qualitative = /direction|Direction|logitEdge/.test(signal);
    const directional = qualitative ? forecasts.filter(r=>r.p!==0).map(r=>({...r,correct:Number(r.p>0)===r.y})) : [];
    const sample=rows.filter(s=>signal==='control'||challengers.some(c=>c.name===signal&&c.snapshotId===s.snapshotId)||(numericResearchFeatures(s.unifiedSnapshot)[signal]!=null&&(!qualitative||numericResearchFeatures(s.unifiedSnapshot)[signal]!==0)));
    const control=calibrationMetrics(sample.map(s=>({p:s.homeWinProbability,y:Number(s.actualWinner===s.homeTeam)})));
    const signalMetrics=qualitative?{accuracy:directional.length?directional.filter(r=>r.correct).length/directional.length:null,brier:null,logLoss:null,ece:null}:calibrationMetrics(forecasts);
    return { signal, mode, horizon, vsControl:{n:sample.length,accuracyDelta:signalMetrics.accuracy==null||control.accuracy==null?null:signalMetrics.accuracy-control.accuracy,
      brierDelta:signalMetrics.brier==null||control.brier==null?null:signalMetrics.brier-control.brier,logLossDelta:signalMetrics.logLoss==null||control.logLoss==null?null:signalMetrics.logLoss-control.logLoss}, ...(qualitative ? {n:directional.length, accuracy:directional.length?directional.filter(r=>r.correct).length/directional.length:null,
      brier:null,logLoss:null,ece:null} : calibrationMetrics(forecasts)), status:'RESEARCH_ONLY' };
  })));
  return {scorecards,leaderboard,redundancy:redundancyMap(snapshots)};
}

export function writeResearchScorecards(snapshots:ResearchPredictionSnapshot[],directory:string,challengers:{name:string;snapshotId:string;probability:number}[]=[]){
 const report=buildResearchScorecards(snapshots,challengers);
 for(const [name,value] of [['coach-section-scorecard',report.scorecards],['feature-redundancy',report.redundancy],['shadow-leaderboard',report.leaderboard]])
  writeFileSync(resolve(directory,name+'.json'),JSON.stringify(value,null,2));
}
