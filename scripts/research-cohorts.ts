import {createHash} from 'node:crypto';
import type {ResearchPredictionSnapshot as Snapshot} from './research-core.js';
export type DatasetRole='DISCOVERY'|'VALIDATION'|'LEGACY_TEST'|'FORWARD_SHADOW'|'FUTURE_LOCKBOX';
export interface CohortRange {season:number;fromWeek:number;throughWeek:number;role:DatasetRole}
export interface CohortPlan {id:string;modelVersion:string;horizon:string;mode:string;createdAt:string;ranges:CohortRange[];minimum:{discovery:number;validation:number;confirmation:number};version:'cohorts-v2'}
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function defaultCohortPlan(rows:Snapshot[],createdAt:string):CohortPlan {
  if(!rows.length)throw new Error('Cannot plan an empty population');
  const first=rows[0],mode=first.unifiedSnapshot?.evidenceMode||'HISTORICAL_RECONSTRUCTION';
  const season=Math.min(...rows.map(r=>r.season));
  const forward=mode==='PROSPECTIVE';
  const ranges:CohortRange[]=forward?[
    {season,fromWeek:1,throughWeek:8,role:'DISCOVERY'},
    {season,fromWeek:9,throughWeek:12,role:'VALIDATION'},
    {season,fromWeek:13,throughWeek:18,role:'FUTURE_LOCKBOX'},
    {season:season+1,fromWeek:1,throughWeek:18,role:'FUTURE_LOCKBOX'}
  ]:[2022,2023,2024,2025].map(s=>({season:s,fromWeek:1,throughWeek:18,role:s<2024?'DISCOVERY':s===2024?'VALIDATION':'LEGACY_TEST'}));
  if(!forward)ranges.push({season:2026,fromWeek:1,throughWeek:18,role:'FUTURE_LOCKBOX'},{season:2027,fromWeek:1,throughWeek:18,role:'FUTURE_LOCKBOX'});
  const identity={modelVersion:first.sourceModelVersion,horizon:first.unifiedSnapshot?.captureHorizon||'legacy',mode,ranges,version:'cohorts-v2' as const};
  return {...identity,id:`COHORT-${digest(identity).slice(0,20)}`,createdAt,minimum:{discovery:80,validation:40,confirmation:50}};
}
export function cohortRows(rows:Snapshot[],plan:CohortPlan,role:DatasetRole,completed=true) {
  return rows.filter(s=>s.sourceModelVersion===plan.modelVersion&&s.unifiedSnapshot?.captureHorizon===plan.horizon&&s.unifiedSnapshot?.evidenceMode===plan.mode&&
    (!completed||(s.actualWinner&&s.actualWinner!=='TIE'))&&plan.ranges.some(r=>r.role===role&&s.season===r.season&&s.week>=r.fromWeek&&s.week<=r.throughWeek));
}
export function researchPopulations(rows:Snapshot[]):Snapshot[][] {
  const groups=new Map<string,Snapshot[]>();
  for(const s of rows) {
    const mode=s.unifiedSnapshot?.evidenceMode||'HISTORICAL_RECONSTRUCTION';
    const key=`${s.sourceModelVersion}:${s.unifiedSnapshot?.captureHorizon||'legacy'}:${mode}:${mode==='PROSPECTIVE'?s.season:'history'}`;
    groups.set(key,[...(groups.get(key)||[]),s]);
  }
  return [...groups.values()];
}
