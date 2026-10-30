import {predictWinner,parseTeamData} from '../services/validatedPredictionService.js';
import {buildUnifiedSnapshot,validateUnifiedSnapshot,type ResearchFeature} from '../services/researchSnapshot.js';
import {loadResearchTeamEdges} from '../services/researchTeamStats.js';
import {easternKickoffIso} from '../services/kickoff.js';
import {gameWeatherContext} from '../services/gameVenue.js';
import type {ScheduledGame} from '../services/scheduleService.js';
import type {ResearchPredictionSnapshot as Snapshot} from '../scripts/research-core.js';
import type {ResearchState} from '../scripts/research-state.js';
import {digest} from '../scripts/research-cohorts.js';
export const CONTROL_VERSION='v2.2-validated-current-season';
export interface BackfillOptions {from:number;through:number;includePlayoffs:boolean}
export function backfillOptions(value:any):BackfillOptions {
 const from=Number(value.season??value.from),through=Number(value.season??value.through);
 if(!Number.isInteger(from)||!Number.isInteger(through)||from<1999||through>new Date().getUTCFullYear()||through<from||through-from>30)throw new Error('Choose a valid NFL season range from 1999 through the current year (maximum 31 seasons).');
 return {from,through,includePlayoffs:value.includePlayoffs===true};
}
export function eligibleHistoricalGames(games:ScheduledGame[],options:BackfillOptions,now=Date.now()){
 return games.filter(g=>g.season>=options.from&&g.season<=options.through&&g.completed&&g.homeScore!=null&&g.awayScore!=null&&
  (options.includePlayoffs||g.gameType==='REG')&&Boolean(easternKickoffIso(g.gameday,g.gametime||''))&&Date.parse(easternKickoffIso(g.gameday,g.gametime||'')!)<now)
  .sort((a,b)=>a.gameday.localeCompare(b.gameday)||a.gameId.localeCompare(b.gameId));
}
export const historicalKey=(gameId:string)=>`LIBRARY:HISTORICAL_RECONSTRUCTION:${gameId}:${CONTROL_VERSION}:T-24h:unified-pregame-v1`;
function validateHistoricalRecord(s:Snapshot){
 if(s?.unifiedSnapshot?.evidenceMode!=='HISTORICAL_RECONSTRUCTION'||s.gameId!==s.unifiedSnapshot.gameId||s.sourceModelVersion!==s.unifiedSnapshot.modelVersion||
  Date.parse(s.predictionTimestamp)<Date.parse(s.unifiedSnapshot.kickoffAt)||Date.parse(s.unifiedSnapshot.capturedAt)<Date.parse(s.unifiedSnapshot.kickoffAt)||
  ![s.homeTeam,s.awayTeam,'TIE'].includes(s.actualWinner||''))throw new Error('Historical library evidence firewall violated');
 validateUnifiedSnapshot(s.unifiedSnapshot);
}
export function historicalSnapshots(events:Awaited<ReturnType<ResearchState['all']>>):Snapshot[]{
 return events.filter(e=>e.event_kind==='INPUTS'&&e.event_key.startsWith('LIBRARY:')).map(e=>{
  const s:Snapshot=e.payload.snapshot;
  if(e.payload.recordType!=='HISTORICAL_RECONSTRUCTION'||s?.unifiedSnapshot?.evidenceMode!=='HISTORICAL_RECONSTRUCTION')throw new Error('Historical library evidence firewall violated');
  validateHistoricalRecord(s);return s;
 });
}
export async function reconstructHistoricalGame(game:ScheduledGame,games:ScheduledGame[]):Promise<Snapshot>{
 if(!game.completed)throw new Error('Historical ingestion requires a verified completed game');
 const teams=parseTeamData(),home=teams.find(t=>t.abbr===game.homeTeam),away=teams.find(t=>t.abbr===game.awayTeam);
 if(!home||!away)throw new Error('Team registry unavailable');
 const kickoffAt=easternKickoffIso(game.gameday,game.gametime||'');if(!kickoffAt||Date.parse(kickoffAt)>=Date.now())throw new Error('Verified historical kickoff required');
 const result=await predictWinner(home,away,new Date(`${game.gameday}T12:00:00Z`),true,{neutralSite:game.neutralSite});
 const scores=result.modelScores;if(!scores)throw new Error('Control scores unavailable');
 const capturedAt=new Date().toISOString(),cutoffAt=`${game.gameday}T00:00:00.000Z`,observedAt=new Date(Date.parse(cutoffAt)-1).toISOString();
 const extra=await loadResearchTeamEdges(game.homeTeam,game.awayTeam,game.gameday,game.season,game.week,observedAt,capturedAt);
 const field=(value:ResearchFeature['value'],source:string):ResearchFeature=>({value,status:value==null?'BLOCKED_DATA':'known',source,observedAt:value==null?null:observedAt,capturedAt,version:'historical-context-v1',includedInProduction:false,timestampKind:'derived_cutoff',sourceObservedAt:null});
 const prior=games.filter(g=>g.completed&&g.gameday<game.gameday);
 for(const [side,team] of [['home',game.homeTeam],['away',game.awayTeam]]){
  const last=prior.filter(g=>g.homeTeam===team||g.awayTeam===team).sort((a,b)=>b.gameday.localeCompare(a.gameday))[0];
  extra[`football_schedule.${side}RestDays`]=field(last?(Date.parse(game.gameday)-Date.parse(last.gameday))/86400000:null,'Verified prior game schedule; dates before target');
 }
 // Future roof decisions cannot be reconstructed from the final schedule's actual roof field.
 const venue=gameWeatherContext({...game,completed:false})?.venue;
 extra['football_weather.roof']=field(venue?.roof==='unknown'?null:venue?.roof??null,'Verified actual historical stadium/roof; no weather forecast reconstructed');
 extra['football_weather.surface']=field(game.surface||null,'Historical schedule surface; descriptive reconstruction');
 extra['football_weather.isDome']=field(venue&&venue.roof!=='unknown'?['dome','closed'].includes(venue.roof):null,'Verified actual historical venue');
 const unified=buildUnifiedSnapshot({gameId:game.gameId,modelVersion:CONTROL_VERSION,kickoffAt,capturedAt,cutoffAt,horizon:'T-24h',mode:'HISTORICAL_RECONSTRUCTION',result,
  homeTeam:game.homeTeam,awayTeam:game.awayTeam,extraFeatures:extra});
 // Every historical cutoff is derived, not an assertion about archived provider publication bytes.
 const frozen=structuredClone(unified);for(const f of Object.values(frozen.features))if(f.status==='known'&&f.observedAt===cutoffAt)f.observedAt=observedAt;
 validateUnifiedSnapshot(frozen);
 const p=scores.finalHomeProbability/100,actual=game.homeScore===game.awayScore?'TIE':game.homeScore!>game.awayScore!?game.homeTeam:game.awayTeam;
 return {snapshotId:historicalKey(game.gameId),gameId:game.gameId,sourceModelVersion:CONTROL_VERSION,season:game.season,week:game.week,gameday:game.gameday,
  predictionTimestamp:capturedAt,dataCutoffTimestamp:cutoffAt,homeTeam:game.homeTeam,awayTeam:game.awayTeam,neutralSite:game.neutralSite,
  homeWinProbability:p,awayWinProbability:1-p,predictedWinner:p>=.5?game.homeTeam:game.awayTeam,actualWinner:actual,homeScore:game.homeScore,awayScore:game.awayScore,unifiedSnapshot:frozen,
  featureSnapshot:{baseLogit:Math.log(scores.baseHomeProbability/(100-scores.baseHomeProbability)),formLogit:scores.footballLogitAdjustment,venueLogit:scores.venueLogitAdjustment,
   h2hLogit:scores.h2hLogitAdjustment,personnelLogit:scores.personnelLogitAdjustment,restLogit:scores.restLogitAdjustment}};
}
export function coverageReport(rows:Snapshot[]){
 const fields=[...new Set(rows.flatMap(s=>Object.keys(s.unifiedSnapshot?.features||{})))];
 const fieldCoverage=fields.map(key=>{
  const counts={known:0,blocked:0,missing:0};for(const s of rows){const f=s.unifiedSnapshot?.features[key];if(f?.status==='known')counts.known++;else if(f?.status==='BLOCKED_DATA')counts.blocked++;else counts.missing++;}
  return {key,...counts,total:rows.length,availablePercent:rows.length?100*counts.known/rows.length:null};
 });
 const families=[...new Set(fields.map(k=>k.split('.')[0]))].map(family=>{
  const cells=fieldCoverage.filter(f=>f.key.split('.')[0]===family),total=cells.reduce((n,f)=>n+f.total,0),sum=(key:'known'|'blocked'|'missing')=>cells.reduce((n,f)=>n+f[key],0);
  return {family,totalCells:total,availablePercent:total?100*sum('known')/total:null,blockedPercent:total?100*sum('blocked')/total:null,missingPercent:total?100*sum('missing')/total:null};
 });
 return {uniqueGames:new Set(rows.map(s=>s.gameId)).size,snapshots:rows.length,seasons:[...new Set(rows.map(s=>s.season))].sort(),fieldsNamed:fields.length,fieldsEverKnown:fieldCoverage.filter(f=>f.known>0).length,families,fieldCoverage,
  bySeason:[...new Set(rows.map(s=>s.season))].sort().map(season=>{
   const selected=rows.filter(s=>s.season===season);
   return {season,games:new Set(selected.map(s=>s.gameId)).size,snapshots:selected.length,families:families.map(({family})=>{
    const values=selected.flatMap(s=>Object.entries(s.unifiedSnapshot!.features).filter(([key])=>key.split('.')[0]===family).map(([,f])=>f)),total=values.length;
    return {family,totalCells:total,availablePercent:total?100*values.filter(f=>f.status==='known').length/total:null,blockedPercent:total?100*values.filter(f=>f.status==='BLOCKED_DATA').length/total:null,missingPercent:total?100*values.filter(f=>f.status!=='known'&&f.status!=='BLOCKED_DATA').length/total:null};
   })};
  })};
}
export async function startBackfill(state:ResearchState,games:ScheduledGame[],options:BackfillOptions,dryRun=false){
 const rows=eligibleHistoricalGames(games,options),events=await state.all(),existing=new Set(events.filter(e=>e.event_kind==='INPUTS').map(e=>e.event_key));
 const alreadyExisting=rows.filter(g=>existing.has(historicalKey(g.gameId))).length;
 const coverageBefore=coverageReport(historicalSnapshots(events));
 const jobId=`BACKFILL:${crypto.randomUUID()}`,definition={recordType:'BACKFILL_JOB',jobId,options,gameIds:rows.map(g=>g.gameId),createdAt:new Date().toISOString(),coverageBefore};
 if(!dryRun)await state.append('RUN',jobId,definition);
 return {...definition,dryRun,eligible:rows.length,alreadyExisting,wouldCreate:rows.length-alreadyExisting,estimatedWrites:rows.length-alreadyExisting,
  historicalEvidenceOnly:true,blockedFields:['historical live injury/depth chart','timestamped historical market','historical forecast weather','prospective Coach/DeepSeek'],coverageBefore};
}
export async function advanceBackfill(state:ResearchState,games:ScheduledGame[],jobId:string,limit=8,reconstruct=reconstructHistoricalGame,deadlineMs=Date.now()+45000){
 const events=await state.all(),definition=events.find(e=>e.event_kind==='RUN'&&e.event_key===jobId)?.payload;
 if(definition?.recordType!=='BACKFILL_JOB')throw new Error('Backfill job not found');
 const available=new Set(eligibleHistoricalGames(games,definition.options).map(g=>g.gameId));
 const ids:string[]=definition.gameIds,existing=new Map(events.filter(e=>e.event_kind==='INPUTS'&&e.event_key.startsWith('LIBRARY:')).map(e=>[e.event_key,e]));
 const outcomes=events.filter(e=>e.event_kind==='RUN'&&e.payload.recordType==='BACKFILL_GAME'&&e.payload.jobId===jobId);
 const done=new Map(outcomes.map(e=>[e.payload.gameId,e.payload]));
 for(const id of ids.filter(id=>!done.has(id)).slice(0,Math.min(50,Math.max(1,limit)))){
  if(Date.now()>deadlineMs)break;
  const key=historicalKey(id),game=games.find(g=>g.gameId===id);let status:string='failed',reason:string|undefined;
  try{
   if(existing.has(key)){
    const saved=existing.get(key)!.payload.snapshot as Snapshot;
    if(saved.gameId!==id||saved.unifiedSnapshot?.evidenceMode!=='HISTORICAL_RECONSTRUCTION')throw new Error('Existing immutable identity mismatch');
    status='alreadyExisting';
   }
   else if(!game||!available.has(id)){status='blocked';reason='Game no longer verifies as an eligible completed game';}
   else{
    const snapshot=await reconstruct(game,games);if(snapshot.unifiedSnapshot?.evidenceMode!=='HISTORICAL_RECONSTRUCTION'||snapshot.gameId!==id)throw new Error('Historical evidence firewall');
    validateHistoricalRecord(snapshot);
    const event=await state.append('INPUTS',key,{recordType:'HISTORICAL_RECONSTRUCTION',snapshot,createdByJobId:jobId,outcomeSource:'nflverse verified completed schedule'});
    existing.set(key,event);status=event.payload.createdByJobId===jobId?'created':'alreadyExisting';
   }
  }catch{reason='Reconstruction or durable write failed; retry in a new resumable job';}
  const result={recordType:'BACKFILL_GAME',jobId,gameId:id,season:game?.season,status,reason};
  done.set(id,(await state.append('RUN',`${jobId}:GAME:${id}`,result)).payload);
 }
 const counts={created:0,alreadyExisting:0,blocked:0,failed:0};for(const row of done.values())counts[row.status as keyof typeof counts]++;
 const complete=done.size===ids.length;
 const snapshots=historicalSnapshots(await state.all());
 return {jobId,options:definition.options,status:complete?(counts.failed||counts.blocked?'COMPLETED_WITH_ERRORS':'COMPLETE'):'RUNNING',eligible:ids.length,processed:done.size,...counts,updatedMetadataIfAllowed:0,
  seasons:[...new Set(games.filter(g=>ids.includes(g.gameId)).map(g=>g.season))].sort().map(season=>{const these=games.filter(g=>g.season===season&&ids.includes(g.gameId));return {season,eligible:these.length,processed:these.filter(g=>done.has(g.gameId)).length,status:these.every(g=>done.has(g.gameId))?'complete':these.some(g=>done.has(g.gameId))?'running':'queued'};}),
  coverageBefore:definition.coverageBefore,coverage:coverageReport(snapshots),evidenceMode:'HISTORICAL_RECONSTRUCTION',independentProspectiveGamesAdded:0};
}
