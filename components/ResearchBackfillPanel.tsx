import React,{useEffect,useState} from 'react';
import ResearchAccessField from './ResearchAccessField';
import {researchHeaders,resetResearchAccess} from '../services/researchAccess';
interface Progress {jobId?:string;eligible:number;processed?:number;created?:number;alreadyExisting:number;blocked?:number;failed?:number;status?:string;wouldCreate?:number;seasons?:{season:number;processed:number;eligible:number;status:string}[];coverage?:any;coverageBefore?:any}
export default function ResearchBackfillPanel({season,includePlayoffs}:{season:number;includePlayoffs:boolean}){
 const [through,setThrough]=useState(season),[progress,setProgress]=useState<Progress|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[running,setRunning]=useState(false),[research,setResearch]=useState('');
 useEffect(()=>{setThrough(season);},[season]);
 async function request(body:unknown){const response=await fetch('/api/research-backfill',{method:'POST',headers:{...researchHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await response.json();
  if(response.status===401)resetResearchAccess();if(!response.ok)throw new Error(value.error||'Research operation failed');return value;
 }
 async function start(dryRun:boolean){setBusy(true);setError('');setResearch('');try{const value=await request({action:dryRun?'dry-run':'start',from:season,through,includePlayoffs});setProgress({...value,jobId:dryRun?undefined:value.jobId});setRunning(!dryRun);}catch(e){setError(String(e));}finally{setBusy(false);}}
 useEffect(()=>{
  if(!running||!progress?.jobId)return;let cancelled=false;const timer=setTimeout(async()=>{
   try{const value=await request({action:'advance',jobId:progress.jobId});if(!cancelled){setProgress(value);setRunning(value.status==='RUNNING');}}
   catch(e){if(!cancelled){setError(String(e));setRunning(false);}}
  },8000);return()=>{cancelled=true;clearTimeout(timer);};
 },[running,progress?.jobId,progress?.processed]);
 async function runResearch(){setBusy(true);setError('');try{const value=await request({action:'research'});setResearch(`Research cycle: ${value.status}; ${value.counts?.hypotheses_tested??0} cumulative hypotheses tested.`);}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <details className="mt-5 rounded-xl border border-cyan-900 p-4 text-gray-200"><summary className="cursor-pointer font-semibold">Historical research library · explicit backfill</summary>
  <p className="my-3 text-sm">Save completed games as historical reconstructions. Normal season predictions above do not write to the library. Existing evidence is skipped; historical injury, Coach, market timestamps and forecast weather remain unavailable.</p>
  <ResearchAccessField label="Research library access key"/>
  <label className="mt-3 block text-sm">From {season} through season <input type="number" min={season} max={new Date().getFullYear()} value={through} onChange={e=>setThrough(Number(e.target.value))} className="ml-2 w-24 rounded bg-gray-800 p-2"/></label>
  <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={busy||running} onClick={()=>start(true)} className="rounded bg-gray-700 px-3 py-2 disabled:opacity-50">Preview backfill</button>
   <button type="button" disabled={busy||running} onClick={()=>start(false)} className="rounded bg-cyan-800 px-3 py-2 disabled:opacity-50">Backfill season range into research library</button>
   {progress?.jobId&&!running&&(!progress.status||progress.status==='RUNNING')?<button type="button" onClick={()=>setRunning(true)}>Resume progress</button>:null}</div>
  {error?<p role="alert" className="mt-3 text-rose-300">{error}</p>:null}
  {progress?<div className="mt-3 space-y-2" aria-live="polite"><p>{progress.status||'Preview'} · Eligible {progress.eligible} · Processed {progress.processed??0} · Created {progress.created??0} · Already existing {progress.alreadyExisting} · Blocked {progress.blocked??0} · Failed {progress.failed??0}{progress.wouldCreate!=null?` · Would create ${progress.wouldCreate}`:''}</p>
   <p className="text-xs">{progress.jobId}. Processing is server-side in resumable batches. Closing this panel never turns saved historical games into prospective evidence.</p>
   {progress.seasons?.map(s=><p key={s.season}>{s.season}: {s.status}, {s.processed}/{s.eligible}</p>)}
   {(progress.coverage||progress.coverageBefore)?<details><summary>Feature coverage before / after</summary><pre className="overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify({before:progress.coverageBefore,after:progress.coverage},null,2)}</pre></details>:null}
   {progress.status?.startsWith('COMPLETE')?<button type="button" disabled={busy} onClick={runResearch} className="rounded bg-cyan-800 px-3 py-2">Run autoresearch on stored evidence</button>:null}
  </div>:null}{research?<p className="mt-3">{research}</p>:null}
 </details>;
}
