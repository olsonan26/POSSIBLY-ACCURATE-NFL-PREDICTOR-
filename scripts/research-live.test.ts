import assert from 'node:assert/strict';
import sync from '../api/learning-sync.js';
import summary from '../api/research-summary.js';
import {DatabaseResearchState} from '../server/researchStore.js';
const originalFetch=globalThis.fetch,originalEnv={...process.env},events:any[]=[];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const schedule=['game_id,season,game_type,week,gameday,gametime,away_team,home_team,away_score,home_score,location',
 ...Array.from({length:1001},(_,i)=>`fixture-${i},2024,REG,7,2024-10-20,13:00,TEN,BUF,10,20,Home`)].join('\n');
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
 if(path.pathname.endsWith('nfl_prediction_snapshots'))return json([{id:'frozen-fixture',game_id:'fixture-0',season:2024,week:7,game_date:'2024-10-20',
  kickoff_at:'2024-10-20T17:00:00Z',captured_at:'2024-10-20T12:00:00Z',home_team:'BUF',away_team:'TEN',model_version:'test-control',home_win_probability:.6,predicted_winner:'BUF',feature_snapshot:{}}]);
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
 const dashboard=await request(summary,{'x-research-key':'test-access'});assert.equal(dashboard.status,200);assert.equal(dashboard.body.source,'LIVE_DATABASE');assert.equal(dashboard.body.durable.eligible,1);assert.equal(dashboard.body.durable.correct,1);
 assert.ok(dashboard.body.horizonChanges);assert.ok(dashboard.body.upsetComparisons);assert.ok(dashboard.body.shadowLeaderboard);
 unavailable=true;
 const fallback=await request(summary,{'x-research-key':'test-access'});assert.equal(fallback.body.source,'ARCHIVED_REPORT');assert.equal(fallback.body.liveUnavailable,true);
 assert.equal((await request(sync,{authorization:'Bearer test-cron'})).status,503);
 console.log('Live research API: authenticated daily run, durable store, duplicate recovery, verified outcomes, live dashboard and explicit outage fallback passed.');
}finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);}
