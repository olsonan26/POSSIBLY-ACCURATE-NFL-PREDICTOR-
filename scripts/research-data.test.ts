import assert from 'node:assert/strict';
import {MemoryResearchState} from './research-state.js';
import {buildUnifiedSnapshot,validateUnifiedSnapshot} from '../services/researchSnapshot.js';
import {startBackfill,advanceBackfill,historicalSnapshots,coverageReport} from '../server/historicalResearch.js';
import {dueHorizon,runForwardCaptures,syncResearchPredictionOutcomes} from '../server/forwardResearch.js';
import {coachSectionScorecard} from './research-scorecards.js';
import {buildCoachReport,COACH_SECTIONS} from '../services/coachAnalysis.js';
import {cohortRows,defaultCohortPlan} from './research-cohorts.js';
import {filterTeamStatsBeforeWeek,parseTeamStatsCsv} from '../services/pointInTimeTeamStats.js';
import type {ScheduledGame} from '../services/scheduleService.js';
import type {ResearchPredictionSnapshot as Snapshot} from './research-core.js';
const games:ScheduledGame[]=[2024,2025].flatMap(season=>Array.from({length:3},(_,i)=>({gameId:`${season}-${i}`,season,gameType:'REG',week:i+1,gameday:`${season}-09-${String(8+i*7).padStart(2,'0')}`,gametime:'13:00',homeTeam:'BUF',awayTeam:'TEN',neutralSite:false,completed:true,homeScore:24,awayScore:10})));
const state=new MemoryResearchState();let reconstructions=0;
const reconstruct=async(game:ScheduledGame):Promise<Snapshot>=>{
 reconstructions++;const p=.6,cutoff=`${game.gameday}T00:00:00Z`,capturedAt=new Date().toISOString();
 const unified=buildUnifiedSnapshot({gameId:game.gameId,modelVersion:'v2.2-validated-current-season',kickoffAt:`${game.gameday}T17:00:00Z`,capturedAt,cutoffAt:cutoff,horizon:'T-24h',mode:'HISTORICAL_RECONSTRUCTION',result:{},controlProbability:p,homeTeam:'BUF',awayTeam:'TEN'});
 return {snapshotId:unified.forecastId,gameId:game.gameId,sourceModelVersion:unified.modelVersion,season:game.season,week:game.week,gameday:game.gameday,predictionTimestamp:capturedAt,dataCutoffTimestamp:cutoff,homeTeam:'BUF',awayTeam:'TEN',neutralSite:false,homeWinProbability:p,awayWinProbability:1-p,predictedWinner:'BUF',actualWinner:'BUF',unifiedSnapshot:unified,featureSnapshot:{baseLogit:Math.log(1.5),formLogit:0,venueLogit:0,h2hLogit:0,personnelLogit:0,restLogit:0}};
};
const options={from:2024,through:2025,includePlayoffs:false};
const dry=await startBackfill(state,games,options,true);assert.equal(dry.wouldCreate,6);assert.equal(state.events.length,0);
const job=await startBackfill(state,games,options),first=await advanceBackfill(state,games,job.jobId,2,reconstruct);
assert.equal(first.processed,2);assert.equal(first.status,'RUNNING');assert.equal(first.seasons[1].status,'queued');
const restart=new MemoryResearchState();restart.events=structuredClone(state.events);
const resumed=await advanceBackfill(restart,games,job.jobId,50,reconstruct);assert.equal(resumed.created,6);assert.equal(resumed.status,'COMPLETE');
assert.equal(resumed.coverageBefore.uniqueGames,0);assert.equal(resumed.coverage.bySeason.length,2);assert.ok(resumed.coverage.bySeason.every(s=>s.families.length>0));
const before=JSON.stringify(historicalSnapshots(await restart.all()));
const repeat=await startBackfill(restart,games,options),again=await advanceBackfill(restart,games,repeat.jobId,50,reconstruct);
assert.equal(again.created,0);assert.equal(again.alreadyExisting,6);assert.equal(reconstructions,6);assert.equal(historicalSnapshots(await restart.all()).length,6);assert.equal(again.independentProspectiveGamesAdded,0);assert.equal(JSON.stringify(historicalSnapshots(await restart.all())),before);
const rows=historicalSnapshots(await restart.all());assert.equal(cohortRows(rows,{...defaultCohortPlan(rows,new Date().toISOString()),mode:'PROSPECTIVE'},'FUTURE_LOCKBOX').length,0);
const forged=new MemoryResearchState();forged.events=structuredClone(restart.events);forged.events.find(e=>e.event_key.startsWith('LIBRARY:'))!.payload.snapshot.unifiedSnapshot.evidenceMode='PROSPECTIVE';assert.throws(()=>historicalSnapshots(forged.events),/firewall/);
const coverage=coverageReport(rows);assert.equal(coverage.uniqueGames,6);assert.equal(coverage.snapshots,6);assert.equal(coverage.fieldCoverage.find(f=>f.key==='football_qb.edge')!.known,0);
const data=parseTeamStatsCsv('season,week,team,passing_epa\n2024,1,BUF,2\n2024,2,BUF,999\n2025,1,BUF,999\n2024,1,TEN,9');assert.equal(filterTeamStatsBeforeWeek(data,'BUF',2024,2).length,1);assert.equal(filterTeamStatsBeforeWeek(data,'BUF',2024,2)[0].passing_epa,'2');
console.log('PASS historical dry run, resumable adjacent seasons, immutable dedupe, coverage, no extra prospective evidence, target/future-stat exclusion');
const upcoming:ScheduledGame={...games[0],gameId:'future',gameday:'2028-09-10',completed:false,homeScore:undefined,awayScore:undefined};
const kickoff='2028-09-10T17:00:00Z',forward=new MemoryResearchState(),captured:Snapshot[]=[],reports:any[]=[];
let clock='';
const capture=async(game:ScheduledGame,horizon:any)=>{
 const snapshot={...structuredClone(rows[0]),gameId:game.gameId};snapshot.unifiedSnapshot=buildUnifiedSnapshot({gameId:game.gameId,modelVersion:snapshot.sourceModelVersion,kickoffAt:kickoff,capturedAt:clock,cutoffAt:clock,horizon,mode:'PROSPECTIVE',result:{},controlProbability:.6,homeTeam:'BUF',awayTeam:'TEN'});
 snapshot.actualWinner=undefined;snapshot.predictionTimestamp=clock;captured.push(snapshot);return {snapshotId:snapshot.unifiedSnapshot.forecastId};
};
const coach=async(game:ScheduledGame,horizon:any)=>{
 if(horizon!=='T-24h'&&horizon!=='T-3h')return 'NOT_DUE';
 const evidence=[{id:'source',url:'https://nfl.com/news/pregame',title:'Pregame',publishedAt:new Date(Date.parse(clock)-3600000).toISOString(),quote:'The offensive line is healthy and prepared for the upcoming matchup.'}];
 const report=buildCoachReport({sections:COACH_SECTIONS.map(([id])=>({id,evidenceIds:['source'],advantage:'home',observation:'Current availability',mechanism:'Sourced preparation',counter:'Defense can adjust',missing:[]})),prediction:{winner:'home',decisiveSections:['protection'],rationale:'Pregame evidence'}},evidence,{version:'test',gameId:game.gameId,homeTeam:'BUF',awayTeam:'TEN',gameday:game.gameday,cutoff:clock,mode:'pregame',generatedAt:clock,capture:'pregame',controlHomeProbability:.6});reports.push(structuredClone(report));return 'FROZEN';
};
for(const [hours,horizon] of [[70,'T-72h'],[23,'T-24h'],[2.5,'T-3h'],[25/60,'T-30m']] as const){
 clock=new Date(Date.parse(kickoff)-hours*3600000).toISOString();assert.equal(dueHorizon(kickoff,clock)?.horizon,horizon);
 await runForwardCaptures([upcoming],forward,{now:clock,capture,coach});assert.equal(captured.at(-1)!.unifiedSnapshot!.hoursToKickoff,hours);
 validateUnifiedSnapshot(captured.at(-1)!.unifiedSnapshot!);const n=captured.length;await runForwardCaptures([upcoming],forward,{now:clock,capture,coach});assert.equal(captured.length,n);
}
assert.equal(captured.length,4);assert.equal(new Set(captured.map(s=>s.gameId)).size,1);assert.equal(dueHorizon(kickoff,kickoff),null);
assert.equal(dueHorizon(kickoff,new Date(Date.parse(kickoff)-26*3600000).toISOString()),null);
const slate=Array.from({length:4},(_,i)=>({...upcoming,gameId:`slate-${i}`})),slateState=new MemoryResearchState();let paid=0;
for(const g of slate.slice(0,2))await slateState.append('RUN',`AUTO_CAPTURE:${g.gameId}:v2.2-validated-current-season:T-24h`,{status:'FROZEN'});
const slateResult=await runForwardCaptures(slate,slateState,{now:new Date(Date.parse(kickoff)-23*3600000).toISOString(),capture:async()=>({snapshotId:'test'}),coach:async g=>{
 if(g.gameId==='slate-0'||g.gameId==='slate-1')return 'ALREADY_EXISTS';paid++;return 'FROZEN';
}});
assert.equal(paid,2);assert.equal(slateResult.paidCoachAttempts,2);assert.equal(slateResult.results.filter(r=>r.coachStatus==='FROZEN').length,2);
const noProvider=await runForwardCaptures([{...upcoming,gameId:'provider-outage'}],new MemoryResearchState(),{now:clock,capture:async()=>({snapshotId:'still-frozen'}),coach:async()=>{throw new Error('Unavailable');}});
assert.equal(noProvider.results[0].status,'FROZEN');
const frozenBytes=JSON.stringify(captured.map(s=>s.unifiedSnapshot)),firstReport=JSON.stringify(reports[0]);
captured.forEach(s=>s.actualWinner='BUF');assert.equal(JSON.stringify(captured.map(s=>s.unifiedSnapshot)),frozenBytes);assert.equal(JSON.stringify(reports[0]),firstReport);assert.equal(reports[0].sections.length,10);
const coachSnapshots=captured.filter(s=>s.unifiedSnapshot?.captureHorizon==='T-24h').map(s=>({...s,unifiedSnapshot:buildUnifiedSnapshot({gameId:s.gameId,modelVersion:s.sourceModelVersion,kickoffAt:kickoff,capturedAt:reports[0].generatedAt,cutoffAt:reports[0].cutoff,horizon:'T-24h',mode:'PROSPECTIVE',result:{},controlProbability:.6,homeTeam:'BUF',awayTeam:'TEN',coach:reports[0]})}));
assert.equal(coachSectionScorecard(coachSnapshots,'PROSPECTIVE').find(s=>s.section==='protection')!.accuracy,1);
const originalFetch=globalThis.fetch,env={...process.env};let outcomeRows:any[]=[];
try{
 process.env.NFL_LEDGER_SUPABASE_URL='https://ledger.test';process.env.NFL_LEDGER_SUPABASE_KEY='sb_secret_test';
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.includes('nfl_prediction_snapshots'))return Response.json(captured.map((s,i)=>({game_id:s.gameId,id:i})));
  if(init?.method==='POST'){outcomeRows.push(...JSON.parse(String(init.body)));return Response.json(outcomeRows);}return Response.json(outcomeRows);};
 assert.equal((await syncResearchPredictionOutcomes([{...upcoming,completed:true,homeScore:24,awayScore:10}],Date.parse(kickoff)+3600000)).appended,1);
 assert.equal((await syncResearchPredictionOutcomes([{...upcoming,completed:true,homeScore:24,awayScore:10}],Date.parse(kickoff)+3600000)).appended,0);assert.equal(outcomeRows.length,1);
}finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
console.log('PASS four exact-hour immutable horizons, one unique game, sourced Coach freeze/score, late-window rejection, append-only automatic outcome grading');
