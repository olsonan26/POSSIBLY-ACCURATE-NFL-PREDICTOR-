import type { ResearchPredictionSnapshot } from './research-core.js';
import { calibrationMetrics } from './research-scorecards.js';
const logistic=(x:number)=>1/(1+Math.exp(-x));
const logit=(p:number)=>Math.log(Math.max(.001,Math.min(.999,p))/(1-Math.max(.001,Math.min(.999,p))));
/** Week-block resampling respects shared weekly conditions. Nulls shuffle adjustments within comparable predictions. */
export function researchAttacks(snapshots:ResearchPredictionSnapshot[], challenger:(s:ResearchPredictionSnapshot)=>number, repetitions=500) {
  const values=snapshots.filter(s=>s.actualWinner&&s.actualWinner!=='TIE').map(s=>({p:s.homeWinProbability,q:challenger(s),
    y:Number(s.actualWinner===s.homeTeam),week:`${s.season}:${s.week}`,season:s.season,home:s.predictedWinner===s.homeTeam}));
  const difference=(v:typeof values)=>v.length?v.reduce((a,r)=>a+(r.q-r.y)**2-(r.p-r.y)**2,0)/v.length:0;
  const observed=difference(values),groups=[...new Set(values.map(v=>v.week))].map(key=>values.filter(v=>v.week===key));
  let seed=7919;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const bootstrap:number[]=[],nullDeltas:number[]=[];
  const keys=[...new Set(values.map(v=>`${v.home}:${Math.floor(Math.max(v.p,1-v.p)*10)}`))];
  const strata=keys.map(key=>values.flatMap((v,j)=>`${v.home}:${Math.floor(Math.max(v.p,1-v.p)*10)}`===key?[j]:[]));
  for(let i=0;i<repetitions&&values.length;i++) {
    bootstrap.push(difference(groups.flatMap(()=>groups[Math.floor(rand()*groups.length)])));
    const shuffled=values.map(v=>({...v}));
    for(const indices of strata) {
      const deltas=indices.map(j=>logit(values[j].q)-logit(values[j].p));
      for(let j=deltas.length-1;j>0;j--) {const k=Math.floor(rand()*(j+1));[deltas[j],deltas[k]]=[deltas[k],deltas[j]];}
      indices.forEach((index,j)=>{shuffled[index].q=logistic(logit(values[index].p)+deltas[j]);});
    }
    nullDeltas.push(difference(shuffled));
  }
  bootstrap.sort((a,b)=>a-b);
  const quantile=(q:number)=>bootstrap.length?bootstrap[Math.floor((bootstrap.length-1)*q)]:null;
  const metrics=(subset:typeof values)=>({control:calibrationMetrics(subset.map(r=>({p:r.p,y:r.y}))),challenger:calibrationMetrics(subset.map(r=>({p:r.q,y:r.y})))});
  return {seed:7919,repetitions,observedBrierDelta:observed,bootstrapWeekBlocks:groups.length,
    bootstrap95:[quantile(.025),quantile(.975)],nullPValue:values.length?(1+nullDeltas.filter(d=>d<=observed).length)/(repetitions+1):null,
    global:metrics(values),seasons:[...new Set(values.map(v=>v.season))].map(season=>({season,...metrics(values.filter(v=>v.season===season))})),
    selectedSide:[true,false].map(home=>({home,...metrics(values.filter(v=>v.home===home))})),prospectiveConfirmationEligible:false};
}
