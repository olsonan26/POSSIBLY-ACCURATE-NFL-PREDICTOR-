import assert from 'node:assert/strict';
import handler from '../api/coach-analysis';
import { verifyCoachExcerpt, allowedCoachUrl } from '../server/coachEvidence';
import { buildCoachReport, COACH_ANALYSIS_VERSION } from '../services/coachAnalysis';
const env={...process.env}, originalFetch=globalThis.fetch;
const quote='The offensive line has struggled against interior pressure on passing downs.';
const html=`<title>Archived preview</title><script type="application/ld+json">{"datePublished":"2020-09-09T12:00:00Z"}</script><p>${quote}</p>`;
const candidate={url:'https://www.espn.com/nfl/preview',quote};
assert.equal(allowedCoachUrl('https://espn.com.evil.test/'),false);
assert.equal(allowedCoachUrl('http://127.0.0.1/'),false);
assert.equal(verifyCoachExcerpt(html,candidate,'2020-09-10T17:00:00Z','E1')?.id,'E1');
assert.equal(verifyCoachExcerpt(html.replace('2020-09-09','2020-09-11'),candidate,'2020-09-10T17:00:00Z','E1'),null);
assert.equal(verifyCoachExcerpt(html.replace('</script>',',"dateModified":"2020-09-12T12:00:00Z"</script>'),candidate,'2020-09-10T17:00:00Z','E1'),null);
assert.equal(verifyCoachExcerpt(html,{...candidate,quote:'Invented quotation that is never found in the actual source page.'},'2020-09-10T17:00:00Z','E1'),null);
let paid=0, saved:any=null, claimed=false, outage=false, missing=false, live=false;
const liveDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const csv=()=>['game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location',
 ...Array.from({length:1000},(_,i)=>`h-${i},2019,REG,1,2019-09-01,13:00,DEN,10,KC,20,Home`),
 live?`target,${liveDate.slice(0,4)},REG,1,${liveDate},13:00,HOU,,KC,,Home`:'target,2020,REG,1,2020-09-10,13:00,HOU,987,KC,986,Home'].join('\n');
const raw={sections:[{id:'protection',observation:'Interior pressure is reported.',mechanism:'Pressure may disrupt longer routes.',counter:'Use quick throws.',advantage:'away',evidenceIds:['E1'],missing:['Individual assignments not verified.']}],prediction:{winner:'away',rationale:'The documented protection problem favors the away defense.',decisiveSections:['protection']}};
globalThis.fetch=async(input:any,init?:RequestInit)=>{
 const url=String(input);
 if(url.includes('games.csv')||url.startsWith('/api/nfl-data?dataset=games')) return new Response(csv());
 if(url===candidate.url) return new Response(missing?html.replace('datePublished','unknownDate'):live?html.replace('2020-09-09T12:00:00Z',new Date(Date.now()-3600000).toISOString()):html);
 if(url.startsWith('https://coach.test/rest/v1/')) {
  if(outage) return Response.json({}, {status:503});
  if(url.includes('nfl_claim_coach')) {if(claimed)return Response.json(false);claimed=true;return Response.json(true);}
  if(url.includes('nfl_release_coach')) {claimed=false;return Response.json(true);}
  if(init?.method==='POST') {saved=JSON.parse(String(init.body));return Response.json([saved],{status:201});}
  return Response.json(saved?[saved]:[]);
 }
 if(url==='https://openrouter.ai/api/v1/chat/completions') {
  paid++;const body=JSON.parse(String(init?.body));
  assert.doesNotMatch(JSON.stringify(body.messages),/987|986|"completed"|homeScore|awayScore/,'Target finals must never reach research.');
  assert.doesNotMatch(JSON.stringify(body.messages),/Current live personnel|2026.*roster/);
  const result=body.tools?{candidates:[candidate]}:raw;
  return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
 }
 throw new Error(`Unexpected fetch ${url}`);
};
async function request(headers:any={'x-research-key':'coach-key'},body:any={gameId:'target',baseHomeProbability:.99}){
 let status=200,result:any;const res={setHeader(){},status(n:number){status=n;return this;},json(x:any){result=x;return this;}};
 await handler({method:'POST',headers,body},res);return{status,body:result};
}
try{
 process.env.NFL_RESEARCH_ACCESS_KEY='coach-key';process.env.OPENROUTER_API_KEY='offline';process.env.NFL_LEARNING_SUPABASE_URL='https://coach.test';process.env.NFL_LEARNING_SUPABASE_KEY='sb_secret_test';
 assert.equal((await request({})).status,401);assert.equal(paid,0);
 const first=await request();assert.equal(first.status,200);assert.equal(paid,2);
 assert.equal(first.body.historicalComparison.actualWinner,'HOU');assert.equal(first.body.historicalComparison.correct,true);assert.equal(first.body.mode,'historical-reconstruction');assert.equal(first.body.sections.length,10);
 assert.equal(first.body.prediction.winner,'HOU');assert.equal(first.body.prediction.method,'matchup-analysis');
 assert.equal(first.body.sections.find((s:any)=>s.id==='run_game').advantage,'unknown');
 assert.ok(first.body.prediction.controlHomeProbability<.99,'Browser baseline must be ignored.');
 await request();assert.equal(paid,2,'Cached rerun uses no paid requests.');
 saved=null;outage=true;assert.equal((await request()).status,502);assert.equal(paid,2,'Storage failure blocks payment.');outage=false;
 claimed=true;assert.equal((await request()).status,409);assert.equal(paid,2,'Concurrent request cannot pay.');claimed=false;
 missing=true;const empty=await request();assert.equal(empty.status,200);assert.equal(paid,3,'No valid evidence means no second model request.');assert.equal(empty.body.prediction.method,'football-control-fallback');
 saved=null;missing=false;live=true;const upcoming=await request();assert.equal(upcoming.status,200);assert.equal(upcoming.body.mode,'pregame');assert.equal(upcoming.body.historicalComparison,undefined);assert.equal(upcoming.body.capture,'Saved before kickoff');assert.equal(paid,5);
 const unsupported=buildCoachReport({sections:[],prediction:{winner:'away',rationale:'I know the result.',decisiveSections:['protection']}},[],{version:COACH_ANALYSIS_VERSION,gameId:'x',homeTeam:'KC',awayTeam:'HOU',gameday:'2020-09-10',cutoff:'2020-09-10T16:00:00Z',mode:'historical-reconstruction',generatedAt:new Date().toISOString(),capture:'historical',controlHomeProbability:.6});
 assert.equal(unsupported.prediction.winner,'KC');assert.equal(unsupported.prediction.method,'football-control-fallback');
}finally{globalThis.fetch=originalFetch;for(const key of ['NFL_RESEARCH_ACCESS_KEY','OPENROUTER_API_KEY','NFL_LEARNING_SUPABASE_URL','NFL_LEARNING_SUPABASE_KEY']){if(env[key]==null)delete process.env[key];else process.env[key]=env[key];}}
console.log('Coach analysis: historical source gates, no target-score inputs, sourced pick, missing-evidence fallback, caching, concurrency and outage checks passed.');
