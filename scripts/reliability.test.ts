import assert from 'node:assert/strict';
import ledger from '../api/prediction-ledger';
import { authorizeResearch } from '../server/researchAccess';
import { getValidatedFootballContext } from '../services/validatedFootballContext';
import { isRetrospectiveMatchup } from '../services/validatedPredictionService';

const originalFetch = globalThis.fetch, originalNow = Date.now, env = { ...process.env };
const today = new Date().toISOString().slice(0, 10);
let now = Date.parse(`${today}T23:59:00Z`), completed = false, writes: any[] = [], historyCalls = 0;
Date.now = () => now;
const header = 'game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location';
const csv = () => [header,
  ...Array.from({length:1000}, (_, i) => `old-${i},2000,REG,1,2000-09-01,13:00,DEN,10,KC,20,Home`),
  `past,2020,REG,1,2020-09-10,13:00,HOU,20,KC,34,Home`,
  `today,${today.slice(0,4)},REG,1,${today},00:00,DEN,${completed ? 0 : ''},KC,${completed ? 40 : ''},Home`
].join('\n');
globalThis.fetch = async (input: any, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('games.csv') || url.startsWith('/api/nfl-data?dataset=games')) { historyCalls++; return new Response(csv()); }
  if (url.startsWith('/api/cbs-order')) return new Response('{}');
  if (url.includes('ledger.test')) {
    if (init?.method === 'POST') { const row = JSON.parse(String(init.body)); writes.push(row); return Response.json([{...row, id: 'saved'}], {status:201}); }
    return Response.json([{id:'snapshot'}]);
  }
  throw new Error(`Unexpected fetch ${url}`);
};
const response = () => { const result = {status:200, body:null as any}; return {result, setHeader() {}, status(n:number) { result.status=n; return this; }, json(body:any) {result.body=body;return this;} }; };
async function request(body:any) { const res=response(); await ledger({method:'POST',body},res); return res.result; }
try {
  process.env.NFL_LEDGER_SUPABASE_URL='https://ledger.test'; process.env.NFL_LEDGER_SUPABASE_KEY='test'; process.env.NFL_LEDGER_SECRET='test';
  const game={gameId:'past',season:2020,week:1,gameday:'2020-09-10',gametime:'13:00',homeTeam:'KC',awayTeam:'HOU'};
  assert.equal((await request({action:'snapshot',game:{...game,gameday:'2099-01-01'}})).status,400);
  assert.equal((await request({action:'snapshot',game:{...game,gametime:'23:59'}})).status,409);
  assert.equal(writes.length,0,'No forged freeze may reach storage.');
  const outcome=await request({action:'outcome',game:{...game,completed:true,homeScore:99,awayScore:0}});
  assert.equal(outcome.status,201); assert.equal(writes[0].home_score,34); assert.equal(writes[0].away_score,20);
  const future = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0,10);
  const before=await getValidatedFootballContext('KC','DEN',future,false);
  const calls=historyCalls; completed=true;
  const cached=await getValidatedFootballContext('KC','DEN',future,false);
  assert.equal(historyCalls,calls); assert.equal(cached.recentHome.games,before.recentHome.games);
  now+=61_000;
  const refreshed=await getValidatedFootballContext('KC','DEN',future,false);
  assert.equal(refreshed.recentHome.games,before.recentHome.games+1);
  assert.ok(historyCalls>calls);
  assert.equal(await isRetrospectiveMatchup('KC','DEN',today),true,'Same-day final is historical.');
  completed=false; now+=61_000;
  assert.equal(await isRetrospectiveMatchup('KC','DEN',today),true,'Kickoff passed even before final scores arrive.');
  delete process.env.NFL_RESEARCH_ACCESS_KEY;
  let res=response(); assert.equal(authorizeResearch({headers:{}},res),false); assert.equal(res.result.status,503);
  process.env.NFL_RESEARCH_ACCESS_KEY='review-access';
  res=response(); assert.equal(authorizeResearch({headers:{'x-research-key':'bad'}},res),false); assert.equal(res.result.status,401);
  for(let i=0;i<10;i++) assert.equal(authorizeResearch({headers:{'x-research-key':'review-access'}},response()),true);
  res=response(); assert.equal(authorizeResearch({headers:{'x-research-key':'review-access'}},res),false); assert.equal(res.result.status,429);
} finally {
  globalThis.fetch=originalFetch; Date.now=originalNow;
  for(const key of ['NFL_LEDGER_SUPABASE_URL','NFL_LEDGER_SUPABASE_KEY','NFL_LEDGER_SECRET','NFL_RESEARCH_ACCESS_KEY']) { if(env[key] == null) delete process.env[key]; else process.env[key]=env[key]; }
}
console.log('Reliability: official ledger data, cache expiry, same-day cutoff, research access and throttling passed.');
