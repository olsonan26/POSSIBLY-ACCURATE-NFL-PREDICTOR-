import assert from 'node:assert/strict';
import sync from '../api/learning-sync.js';
import summary from '../api/research-summary.js';
import {DatabaseResearchState} from '../server/researchStore.js';
import {buildUnifiedSnapshot} from '../services/researchSnapshot.js';
const originalFetch=globalThis.fetch,originalEnv={...process.env},events:any[]=[];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const schedule=['game_id,season,game_type,week,gameday,gametime,away_team,home_team,away_score,home_score,location',
 ...Array.from({length:1001},(_,i)=>`fixture-${i},2026,REG,7,2026-10-20,13:00,TEN,BUF,10,20,Home`)].join('\n');
let unavailable=false;
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 if(url.includes('raw.githubusercontent.com'))return new Response(schedule);
 assert.ok(url.startsWith('https://research.test/rest/v1/'),'No paid or unexpected network calls');
 if(unavailable)return json({},503);
 const path=new URL(url);
 if(path.pathname.endsWith('nfl_research_events')){
  if(init?.method==='POST'){
   const row=JSON.parse(String(init.body));const old=events.find(e=>e.event_id===row.event_id);if(old)return json([]);
   const saved={...row,recorded_at:new Date().toISOString()};events.push(saved);return json([saved],201);
  }
  const id=path.searchParams.get('event_id')?.slice(3);return json(events.filter(e=>!id||e.event_id===id));
 }
 if(path.pathname.endsWith('nfl_prediction_snapshots'))return json([{id:'frozen-fixture',game_id:'fixture-0',season:2026,week:7,game_date:'2026-10-20',
  kickoff_at:'2026-10-20T17:00:00Z',captured_at:'2026-10-20T12:00:00Z',home_team:'BUF',away_team:'TEN',model_version:'test-control',home_win_probability:.6,predicted_winner:'BUF',feature_snapshot:{}}]);
 return json([]);
};
async function request(handler:any,headers:any){let status=200,body:any;await handler({method:'GET',headers},{setHeader(){},status(n:number){status=n;return this;},json(value:any){body=value;return this;}});return {status,body};}
try{
 Object.assign(process.env,{NFL_LEARNING_SUPABASE_URL:'https://research.test',NFL_LEARNING_SUPABASE_KEY:'sb_secret_test',NFL_LEDGER_SUPABASE_URL:'https://research.test',NFL_LEDGER_SUPABASE_KEY:'sb_secret_test',CRON_SECRET:'test-cron',NFL_RESEARCH_ACCESS_KEY:'test-access'});
 assert.equal((await request(sync,{})).status,401);
 const run=await request(sync,{authorization:'Bearer test-cron'});assert.equal(run.status,200);assert.equal(run.body.paidModelCalls,0);
 assert.equal(run.body.research.durableState,true);assert.equal(run.body.research.status,'BLOCKED_DATA');assert.ok(events.some(e=>e.event_kind==='COHORT'));assert.ok(events.some(e=>e.event_kind==='RUN'));
 const state=new DatabaseResearchState(),prior=events.find(e=>e.event_kind==='RUN');
 const duplicate=await state.append('RUN',prior.event_key,{forged:true});assert.deepEqual(duplicate.payload,prior.payload);
 const capturedAt=new Date().toISOString(),unified=buildUnifiedSnapshot({gameId:'historical-fixture',modelVersion:'test-control',kickoffAt:'2024-10-20T17:00:00Z',capturedAt,cutoffAt:'2024-10-20T00:00:00Z',horizon:'T-24h',mode:'HISTORICAL_RECONSTRUCTION',result:{},controlProbability:.6,homeTeam:'BUF',awayTeam:'TEN'});
 await state.append('INPUTS','LIBRARY:historical-fixture',{recordType:'HISTORICAL_RECONSTRUCTION',snapshot:{snapshotId:'historical-fixture',gameId:'historical-fixture',sourceModelVersion:'test-control',season:2024,week:7,gameday:'2024-10-20',predictionTimestamp:capturedAt,dataCutoffTimestamp:unified.cutoffAt,homeTeam:'BUF',awayTeam:'TEN',neutralSite:false,homeWinProbability:.6,awayWinProbability:.4,predictedWinner:'BUF',actualWinner:'BUF',unifiedSnapshot:unified,featureSnapshot:{baseLogit:Math.log(1.5),formLogit:0,venueLogit:0,h2hLogit:0,personnelLogit:0,restLogit:0}}});
 const dashboard=await request(summary,{'x-research-key':'test-access'});assert.equal(dashboard.status,200);assert.equal(dashboard.body.source,'LIVE_DATABASE');assert.equal(dashboard.body.durable.eligible,1);assert.equal(dashboard.body.durable.correct,1);
 assert.ok(dashboard.body.horizonChanges);assert.ok(dashboard.body.upsetComparisons);assert.ok(dashboard.body.shadowLeaderboard);
 assert.equal(dashboard.body.historical.eligible,1);assert.equal(dashboard.body.library.historical.uniqueGames,1);assert.equal(dashboard.body.library.prospective.uniqueGames,1);assert.equal(dashboard.body.completedUniqueGames,1);
 unavailable=true;
 const fallback=await request(summary,{'x-research-key':'test-access'});assert.equal(fallback.body.source,'ARCHIVED_REPORT');assert.equal(fallback.body.liveUnavailable,true);
 assert.equal((await request(sync,{authorization:'Bearer test-cron'})).status,503);
 console.log('Live research API: authenticated daily run, durable store, duplicate recovery, verified outcomes, live dashboard and explicit outage fallback passed.');
}finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);}
