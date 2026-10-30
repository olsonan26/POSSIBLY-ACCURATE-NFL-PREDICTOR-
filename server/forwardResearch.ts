import {predictWinner} from '../services/validatedPredictionService.js';
import {TEAM_BY_ABBR} from '../data/teamRegistry.js';
import {buildUnifiedSnapshot,captureHorizon,type CaptureHorizon} from '../services/researchSnapshot.js';
import {easternKickoffIso} from '../services/kickoff.js';
import {gameWeatherContext} from '../services/gameVenue.js';
import {getMarketAwarePrediction} from '../services/marketAwareService.js';
import type {ScheduledGame} from '../services/scheduleService.js';
import type {ResearchState} from '../scripts/research-state.js';
import {storage} from './learningStore.js';
import {recordSnapshot} from '../api/prediction-ledger.js';
import coachHandler from '../api/coach-analysis.js';
import {COACH_ANALYSIS_VERSION} from '../services/coachAnalysis.js';
import {advanceBackfill} from './historicalResearch.js';
import {ledgerRows,appendLedgerRows,DatabaseResearchState} from './researchStore.js';
import {digest} from '../scripts/research-cohorts.js';
export const CAPTURE_WINDOWS:Record<CaptureHorizon,[number,number]>={
 'T-72h':[60,84],'T-24h':[18,24],'T-3h':[1.5,3],'T-30m':[1/6,.5]
};
/** Windows stay within canonical buckets; delays never pretend a missed earlier capture occurred. */
export function dueHorizon(kickoffAt:string,now:string):{horizon:CaptureHorizon;hoursToKickoff:number}|null{
 const hours=(Date.parse(kickoffAt)-Date.parse(now))/3600000;if(!Number.isFinite(hours)||hours<=0)return null;
 const horizon=captureHorizon(kickoffAt,now),[min,max]=CAPTURE_WINDOWS[horizon];return hours>=min&&hours<=max?{horizon,hoursToKickoff:hours}:null;
}
export async function runCoachCapture(game:ScheduledGame,horizon:CaptureHorizon,state:ResearchState){
 if(horizon!=='T-24h'&&horizon!=='T-3h')return 'NOT_DUE';
 const model=process.env.OPENROUTER_PREGAME_MODEL||'deepseek/deepseek-v4.1-flash';
 const key=`${game.gameId}:${COACH_ANALYSIS_VERSION}:${model}:pregame:${horizon}`;
 const cached=await storage<any[]>(`nfl_coach_reports?report_key=eq.${encodeURIComponent(key)}&select=report_key&limit=1`);if(cached.length)return 'ALREADY_EXISTS';
 if(!process.env.OPENROUTER_API_KEY||!process.env.NFL_RESEARCH_ACCESS_KEY)return 'BLOCKED_PROVIDER';
 const events=await state.all(),day=new Date().toISOString().slice(0,10);
 const attempts=events.filter(e=>e.event_kind==='RUN'&&e.payload.recordType==='AUTOMATIC_COACH_ATTEMPT');
 if(attempts.some(e=>e.event_key===`AUTO_COACH:${key}`))return 'ATTEMPT_ALREADY_RECORDED';
 // At most 16 reports/day, two model calls/report, no automatic paid retries of a failed horizon.
 const token=crypto.randomUUID(),attempt=await state.append('RUN',`AUTO_COACH:${key}`,{recordType:'AUTOMATIC_COACH_ATTEMPT',gameId:game.gameId,horizon,token,maxModelCalls:2});
 if(attempt.payload.token!==token)return 'CLAIMED_BY_ANOTHER_WORKER';
 let budgetGranted=false;
 for(let slot=0;slot<16;slot++){
  const budgetKey=`AUTO_COACH_BUDGET:${day}:${slot}`;if(events.some(e=>e.event_key===budgetKey))continue;
  const claim=await state.append('RUN',budgetKey,{recordType:'AUTOMATIC_COACH_BUDGET',gameId:game.gameId,horizon,token});
  if(claim.payload.token===token){budgetGranted=true;break;}
 }
 if(!budgetGranted)return 'BLOCKED_DAILY_BUDGET';
 let status=0;await coachHandler({method:'POST',headers:{'x-research-key':process.env.NFL_RESEARCH_ACCESS_KEY},body:{gameId:game.gameId}},
  {setHeader(){},status(n:number){status=n;return this;},json(){return this;}});
 return status===200?'FROZEN':status===409?'LEASED':'FAILED_PAID_ATTEMPT';
}
export async function captureForwardGame(game:ScheduledGame,horizon:CaptureHorizon){
 const home=TEAM_BY_ABBR.get(game.homeTeam),away=TEAM_BY_ABBR.get(game.awayTeam);if(!home||!away)throw new Error('Unknown NFL team');
 const kickoffAt=easternKickoffIso(game.gameday,game.gametime||'');if(!kickoffAt||game.completed||Date.parse(kickoffAt)<=Date.now())throw new Error('Pregame game required');
 const result=await predictWinner(home,away,new Date(`${game.gameday}T12:00:00Z`),true,{neutralSite:game.neutralSite,weatherContext:gameWeatherContext(game)});
 if(!result.modelScores)throw new Error('Control scores missing');
 const market=await getMarketAwarePrediction(game,result).catch(()=>null),capturedAt=new Date().toISOString();
 if(dueHorizon(kickoffAt,capturedAt)?.horizon!==horizon)throw new Error('Capture window passed during source collection');
 const unified=buildUnifiedSnapshot({gameId:game.gameId,modelVersion:result.modelVersion,kickoffAt,capturedAt,cutoffAt:capturedAt,horizon,mode:'PROSPECTIVE',result,
  homeTeam:game.homeTeam,awayTeam:game.awayTeam,market:market?{probability:market.marketHomeProbability,observedAt:market.snapshotAt,source:market.source}:undefined});
 let status=0,body:any;
 await recordSnapshot({game,runId:`automatic-${crypto.randomUUID()}`,captureToken:unified.forecastId,prediction:{modelVersion:result.modelVersion,predictedWinner:result.winner.abbr,
  homeWinProbability:result.modelScores.finalHomeProbability/100,generatedAt:capturedAt,featureSnapshot:{...result.modelScores,unifiedSnapshot:unified},
  researchInput:{accuracyFeatures:result.accuracyFeatures,pureAstrology:result.pureAstrology,decisionFactors:result.decisionFactors,homePersonnel:result.homePersonnel,awayPersonnel:result.awayPersonnel}},
  market:market?{homeProbability:market.marketHomeProbability,snapshotAt:market.snapshotAt,source:market.source}:null},
  {setHeader(){},status(n:number){status=n;return this;},json(value:any){body=value;return this;}},game);
 if(status!==200&&status!==201)throw new Error('Immutable prediction capture failed');return body;
}
export async function runForwardCaptures(games:ScheduledGame[],state:ResearchState,options:{now?:string;limit?:number;capture?:typeof captureForwardGame;coach?:typeof runCoachCapture}={}){
 const now=options.now||new Date().toISOString(),events=await state.all();
 const existing=options.capture?[]:await ledgerRows<any>('nfl_prediction_snapshots');
 const due=games.filter(g=>!g.completed).flatMap(game=>{const kickoff=easternKickoffIso(game.gameday,game.gametime||'');const window=kickoff?dueHorizon(kickoff,now):null;return window?[{game,kickoff: kickoff!,...window}]:[];})
  .sort((a,b)=>a.hoursToKickoff-b.hoursToKickoff);
 const results:any[]=[];let attempted=0,coachAttempts=0;
 for(const row of due){
  const key=`AUTO_CAPTURE:${row.game.gameId}:v2.2-validated-current-season:${row.horizon}`;
  if(existing.some(s=>s.game_id===row.game.gameId&&s.model_version==='v2.2-validated-current-season'&&captureHorizon(s.kickoff_at,s.captured_at)===row.horizon)||events.some(e=>e.event_kind==='RUN'&&e.event_key===key&&e.payload.status==='FROZEN')){
   // A later sourced Coach report is separate evidence; it never changes the earlier primary forecast.
   let coachStatus='NOT_DUE';if((!options.capture||options.coach)&&coachAttempts<2&&['T-24h','T-3h'].includes(row.horizon)){
    try{coachStatus=await(options.coach||runCoachCapture)(row.game,row.horizon,state);}catch{coachStatus='BLOCKED_PROVIDER';}
    if(['FROZEN','FAILED_PAID_ATTEMPT'].includes(coachStatus))coachAttempts++;
   }
   results.push({gameId:row.game.gameId,horizon:row.horizon,status:'ALREADY_EXISTS',coachStatus});continue;
  }
  if(attempted>=(options.limit??4))break;attempted++;
  let coachStatus='NOT_DUE';if(['T-24h','T-3h'].includes(row.horizon)){
   if(coachAttempts>=2)coachStatus='DEFERRED_RUN_BUDGET';else{try{coachStatus=await(options.coach||runCoachCapture)(row.game,row.horizon,state);}catch{coachStatus='BLOCKED_PROVIDER';}if(['FROZEN','FAILED_PAID_ATTEMPT'].includes(coachStatus))coachAttempts++;}
  }
  try{
   const saved=await(options.capture||captureForwardGame)(row.game,row.horizon);
   const record={recordType:'AUTOMATIC_CAPTURE',gameId:row.game.gameId,horizon:row.horizon,hoursToKickoff:row.hoursToKickoff,status:'FROZEN',coachStatus,snapshotId:saved.snapshotId};
   await state.append('RUN',key,record);results.push(record);
  }catch{
   const record={recordType:'AUTOMATIC_CAPTURE',gameId:row.game.gameId,horizon:row.horizon,status:'FAILED_RETRYABLE',coachStatus};
   await state.append('RUN',`${key}:FAILED:${crypto.randomUUID()}`,record);results.push(record);
  }
 }
 return {due:due.length,attempted,results,paidCoachAttempts:coachAttempts,paidCoachMaxReportsPerRun:2,missingEarlierHorizonsAreNotBackfilled:true};
}
export async function syncResearchPredictionOutcomes(games:ScheduledGame[],asOf=Date.now()){
 const [predictions,outcomes]=await Promise.all([ledgerRows<any>('nfl_prediction_snapshots'),ledgerRows<any>('nfl_prediction_outcomes')]);
 const ids=new Set(predictions.map(s=>s.game_id)),known=new Set(outcomes.map(o=>o.outcome_key));
 const additions=games.filter(g=>ids.has(g.gameId)&&g.completed&&Number.isInteger(g.homeScore)&&Number.isInteger(g.awayScore)&&g.homeScore!>=0&&g.awayScore!>=0&&
  Boolean(easternKickoffIso(g.gameday,g.gametime||''))&&Date.parse(easternKickoffIso(g.gameday,g.gametime||'')!)<asOf).flatMap(g=>{
  const outcome_key=`${g.gameId}:${g.awayScore}-${g.homeScore}`;if(known.has(outcome_key))return [];
  const row={outcome_key,game_id:g.gameId,season:g.season,week:g.week,game_date:g.gameday,home_team:g.homeTeam,away_team:g.awayTeam,
   home_score:g.homeScore,away_score:g.awayScore,actual_winner:g.homeScore===g.awayScore?'TIE':g.homeScore!>g.awayScore!?g.homeTeam:g.awayTeam,
   source:'nflverse games.csv schedule result',source_metadata:{recorded_via:'automatic-research-worker',schedule_completed:true}};
  return [{...row,payload_sha256:digest(row)}];
 });
 let appended=0;for(let i=0;i<additions.length;i+=100)appended+=(await appendLedgerRows('nfl_prediction_outcomes','outcome_key',additions.slice(i,i+100))).length;
 return {prospectiveUniqueGames:ids.size,appended};
}
export async function resumeBackfillJobs(games:ScheduledGame[],state:ResearchState){
 const events=await state.all(),jobs=events.filter(e=>e.event_kind==='RUN'&&e.payload.recordType==='BACKFILL_JOB');
 for(const job of jobs){const done=new Set(events.filter(e=>e.payload.recordType==='BACKFILL_GAME'&&e.payload.jobId===job.event_key).map(e=>e.payload.gameId));
  if(job.payload.gameIds.some((id:string)=>!done.has(id)))return advanceBackfill(state instanceof DatabaseResearchState?new DatabaseResearchState(true):state,games,job.event_key,8);
 }return null;
}
