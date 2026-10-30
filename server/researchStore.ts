import {storage,learningStorageConfigured,verifiedSchedule} from './learningStore.js';
import {digest} from '../scripts/research-cohorts.js';
import {adaptFrozenPredictions,coachReportSnapshots} from '../scripts/frozen-research-input.js';
import {runResearchEngine,freezeChallengerForecasts} from '../scripts/research-engine.js';
import type {ResearchState,ResearchEvent,EventKind} from '../scripts/research-state.js';
import {readFileSync} from 'node:fs';
import {historicalSnapshots} from './historicalResearch.js';
export class DatabaseResearchState implements ResearchState {
  durable=true;
  constructor(private includeHistoricalLibrary=false){}
  async all(){return readAll<ResearchEvent>('nfl_research_events','recorded_at.asc,event_id.asc',this.includeHistoricalLibrary?'':'&event_key=not.like.LIBRARY%3A*');}
  async append(kind:EventKind,key:string,payload:unknown){
    const record={event_id:digest({kind,key}),event_kind:kind,event_key:key,payload};
    const rows=await storage<ResearchEvent[]>('nfl_research_events?on_conflict=event_kind,event_key',{
      method:'POST',headers:{...(process.env.NFL_LEDGER_SECRET?{'x-ledger-secret':process.env.NFL_LEDGER_SECRET}:{}),Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(record)});
    if(rows.length)return rows[0];
    const previous=await storage<ResearchEvent[]>(`nfl_research_events?event_id=eq.${record.event_id}&select=*&limit=1`);
    if(!previous.length)throw new Error('Research event was not durably stored');return previous[0];
  }
}
async function readAll<T>(table:string,order:string,filter='') {
  const rows:T[]=[];
  for(let offset=0;offset<100000;offset+=250){const batch=await storage<T[]>(`${table}?select=*&order=${order}&limit=250&offset=${offset}${filter}`);rows.push(...batch);if(batch.length<250)return rows;}
  throw new Error('Research history exceeds configured pagination budget');
}
export async function ledgerRows<T>(table:string):Promise<T[]> {
  const url=process.env.NFL_LEDGER_SUPABASE_URL?.replace(/\/$/,'')||process.env.NFL_LEARNING_SUPABASE_URL?.replace(/\/$/,'');
  const key=process.env.NFL_LEDGER_SUPABASE_KEY||process.env.NFL_LEARNING_SUPABASE_KEY;
  if(!url||!key)throw new Error('Prediction storage unavailable');
  const result:T[]=[];
  for(let offset=0;offset<100000;offset+=500){
    const response=await fetch(`${url}/rest/v1/${table}?select=*&order=game_id.asc&limit=500&offset=${offset}`,{signal:AbortSignal.timeout(10000),headers:{apikey:key,
      ...(/^(sb_secret_|sb_publishable_)/.test(key)?{}:{Authorization:`Bearer ${key}`}),
      ...(process.env.NFL_LEDGER_SECRET?{'x-ledger-secret':process.env.NFL_LEDGER_SECRET}:{})}});
    if(!response.ok)throw new Error('Prediction research export failed');const page=await response.json();result.push(...page);if(page.length<500)return result;
  }
  throw new Error('Prediction export exceeds configured budget');
}
export async function appendLedgerRows(table:string,conflict:string,rows:unknown[]){
 const url=(process.env.NFL_LEDGER_SUPABASE_URL||process.env.NFL_LEARNING_SUPABASE_URL)?.replace(/\/$/,''),key=process.env.NFL_LEDGER_SUPABASE_KEY||process.env.NFL_LEARNING_SUPABASE_KEY;
 if(!url||!key)throw new Error('Prediction storage unavailable');
 const response=await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`,{method:'POST',signal:AbortSignal.timeout(10000),headers:{apikey:key,
  ...(/^(sb_secret_|sb_publishable_)/.test(key)?{}:{Authorization:`Bearer ${key}`}),...(process.env.NFL_LEDGER_SECRET?{'x-ledger-secret':process.env.NFL_LEDGER_SECRET}:{}),
  'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(rows)});
 if(!response.ok)throw new Error('Prediction append failed');return await response.json() as any[];
}
export async function liveResearchInput() {
  const [predictions,outcomes,coaches,games,events]=await Promise.all([ledgerRows<any>('nfl_prediction_snapshots'),ledgerRows<any>('nfl_prediction_outcomes'),
    readAll<any>('nfl_coach_reports','captured_at.asc'),verifiedSchedule(),new DatabaseResearchState(true).all()]);
  const verified=new Map(games.filter(g=>g.completed).map(g=>[g.gameId,g]));
  const rows=predictions.map(s=>{const g=verified.get(s.game_id);const winner=g?.homeScore==null||g.awayScore==null?undefined:g.homeScore===g.awayScore?'TIE':g.homeScore>g.awayScore?g.homeTeam:g.awayTeam;
    const recorded=outcomes.find(o=>o.game_id===s.game_id);if(recorded&&winner&&recorded.actual_winner!==winner)throw new Error('Outcome disagrees with verified schedule');
    return {...s,actual_winner:winner};});
  return {snapshots:[...historicalSnapshots(events),...adaptFrozenPredictions(rows,coaches)],coachSnapshots:coachReportSnapshots(coaches,games),rawPredictions:predictions.length,rawCoaches:coaches.length};
}
export async function runLiveResearch() {
  if(!learningStorageConfigured())throw new Error('Research storage is not configured');
  const input=await liveResearchInput(),state=new DatabaseResearchState();
  const manual=JSON.parse(readFileSync(new URL('../research/research-queue.json',import.meta.url),'utf8'));
  const summary=await runResearchEngine(input.snapshots,{state,manual,codeCommit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||'server-runtime'});
  return {...summary,rawPredictions:input.rawPredictions,rawCoaches:input.rawCoaches};
}
export async function captureResearchShadows(record:any) {
  if(!learningStorageConfigured())return;
  const snapshots=adaptFrozenPredictions([record]);
  await freezeChallengerForecasts(snapshots,new DatabaseResearchState());
}
