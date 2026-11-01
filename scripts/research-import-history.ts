import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {FileResearchState} from './research-state.js';
import {digest} from './research-cohorts.js';
import {historicalSnapshots,historicalKey,coverageReport,verifyHistoricalSources} from '../server/historicalResearch.js';
import {verifiedSchedule} from '../server/learningStore.js';

// Imports reconstructed history only. Never imports local experiment decisions,
// promotions, synthetic fixtures, or backdated prospective predictions.
const arg=(name:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const directory=arg('local-state');
if(!directory)throw new Error('Specify --local-state=<completed historical backfill directory>. Default is dry-run; add --apply to import.');
const events=(await new FileResearchState(resolve(directory)).all()).filter(e=>e.event_kind==='INPUTS'&&e.event_key.startsWith('LIBRARY:'));
const snapshots=historicalSnapshots(events);
verifyHistoricalSources(snapshots,await verifiedSchedule());
for(let i=0;i<events.length;i++){
 const e=events[i];
 if(e.event_key!==historicalKey(snapshots[i].gameId)||e.event_id!==digest({kind:e.event_kind,key:e.event_key}))throw new Error('Noncanonical historical record');
}
const report:any={mode:process.argv.includes('--apply')?'IMPORT':'DRY_RUN',snapshots:snapshots.length,
 coverage:coverageReport(snapshots),prospectiveRecordsImported:0,experimentDecisionsImported:0};
if(report.mode==='IMPORT'){
 const base=process.env.NFL_LEARNING_SUPABASE_URL?.replace(/\/$/,''),key=process.env.NFL_LEARNING_SUPABASE_KEY?.trim();
 if(!base||!key)throw new Error('Server storage credentials required');
 const headers={apikey:key,...(/^(sb_secret_|sb_publishable_)/.test(key)?{}:{Authorization:`Bearer ${key}`}),
  ...(process.env.NFL_LEARNING_SECRET?{'x-learning-secret':process.env.NFL_LEARNING_SECRET}:{}),'Content-Type':'application/json'};
 async function request(url:string,init:RequestInit={}){
  for(let attempt=1;attempt<=3;attempt++){
   try{
    const response=await fetch(url,{...init,signal:AbortSignal.timeout(60000)});
    if(response.status!==429&&response.status<500)return response;
   }catch{}
   if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1000));
  }
  throw new Error('Historical storage unavailable after three attempts; rerun safely to resume');
 }
 async function existingKeys(){
  const keys=new Set<string>();
  for(let offset=0;;offset+=1000){
   const response=await request(`${base}/rest/v1/nfl_research_events?select=event_key&event_kind=eq.INPUTS&event_key=like.LIBRARY%3A*&order=event_key.asc&limit=1000&offset=${offset}`,{headers});
   if(!response.ok)throw new Error(`History verification failed (HTTP ${response.status})`);
   const rows=await response.json() as {event_key:string}[];rows.forEach(r=>keys.add(r.event_key));if(rows.length<1000)return keys;
  }
 }
 const before=await existingKeys(),pending=events.filter(e=>!before.has(e.event_key));
 report.alreadyPresent=events.length-pending.length;
 for(let i=0;i<pending.length;i+=25){
  const batch=pending.slice(i,i+25).map(({event_id,event_kind,event_key,payload})=>({event_id,event_kind,event_key,payload}));
  const response=await request(`${base}/rest/v1/nfl_research_events?on_conflict=event_kind,event_key`,{
   method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(batch)});
  if(!response.ok)throw new Error(`Historical import failed (HTTP ${response.status}); rerun safely to resume`);
  console.log(JSON.stringify({submitted:Math.min(i+25,pending.length),pending:pending.length}));
 }
 const after=await existingKeys();
 const missing=events.filter(e=>!after.has(e.event_key));
 if(missing.length)throw new Error(`${missing.length} expected historical records absent after import`);
 report.newlyPresent=after.size-before.size;report.verifiedHistoricalSnapshots=after.size;report.allExpectedRecordsPresent=true;
}
const output=resolve(arg('output')||'research/runtime/history-import.json');mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,coverage:{uniqueGames:report.coverage.uniqueGames,seasons:report.coverage.seasons}},null,2));
