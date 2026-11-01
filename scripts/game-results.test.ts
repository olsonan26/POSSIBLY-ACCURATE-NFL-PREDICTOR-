import assert from 'node:assert/strict';
import {completedGameResults,syncGameResults} from '../server/gameResults.js';
import type {ScheduledGame} from '../services/scheduleService.js';
const fixture:ScheduledGame={gameId:'1999_fixture',season:1999,gameType:'REG',week:1,gameday:'1999-09-12',
 homeTeam:'BUF',awayTeam:'TEN',homeScore:10,awayScore:20,neutralSite:false,completed:true};
const rows=completedGameResults([fixture,{...fixture,gameId:'playoff',gameType:'WC'},
 {...fixture,gameId:'upcoming',gameday:'2099-01-01'},
 {...fixture,gameId:'no-result',completed:false},
 {...fixture,gameId:'fraction',homeScore:1.5},
 {...fixture,gameId:'invalid-time',gametime:'nonsense'}]);
assert.equal(rows.length,2,'Keep completed regular/playoff results even without old kickoff times; reject unverified/future results');
assert.equal(rows[0].payload.homeScore,10);
assert.notEqual(completedGameResults([{...fixture,homeScore:21}])[0].result_key,rows[0].result_key,'Corrected results append a new version');
assert.equal(completedGameResults([fixture])[0].result_key,rows[0].result_key,'Stable key for the same verified source');
const oldFetch=globalThis.fetch,oldUrl=process.env.NFL_LEARNING_SUPABASE_URL,oldKey=process.env.NFL_LEARNING_SUPABASE_KEY;
const saved=new Map<string,any>();
try{
 process.env.NFL_LEARNING_SUPABASE_URL='https://archive.test';process.env.NFL_LEARNING_SUPABASE_KEY='sb_secret_test';
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://archive.test');assert.ok(url.pathname.endsWith('nfl_game_results'));
  if(init?.method==='POST'){
   assert.equal(new Headers(init.headers).get('Prefer'),'resolution=ignore-duplicates,return=representation');
   const added=JSON.parse(String(init.body)).filter((r:any)=>!saved.has(r.result_key));added.forEach((r:any)=>saved.set(r.result_key,r));
   return new Response(JSON.stringify(added),{status:201});
  }
  const offset=Number(url.searchParams.get('offset'));return new Response(JSON.stringify([...saved.values()].slice(offset,offset+1000)));
 };
 assert.equal((await syncGameResults([fixture])).appended,1);
 assert.equal((await syncGameResults([fixture])).appended,0,'A repeated sync creates no duplicates');
 assert.equal((await syncGameResults([{...fixture,homeScore:21}])).appended,1);
 assert.equal(saved.size,2);assert.equal([...saved.values()][0].payload.homeScore,10,'A correction preserves the original result');
 console.log('Game archive: verified completion, missing kickoff, playoffs, stable keys, idempotent sync and append-only corrections passed.');
}finally{
 globalThis.fetch=oldFetch;
 if(oldUrl==null)delete process.env.NFL_LEARNING_SUPABASE_URL;else process.env.NFL_LEARNING_SUPABASE_URL=oldUrl;
 if(oldKey==null)delete process.env.NFL_LEARNING_SUPABASE_KEY;else process.env.NFL_LEARNING_SUPABASE_KEY=oldKey;
}
