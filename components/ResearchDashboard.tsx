import React,{useState} from 'react';
import ResearchAccessField from './ResearchAccessField';
import { researchHeaders,resetResearchAccess } from '../services/researchAccess';
import type summary from '../research/reports/v2-summary';
type Summary=typeof summary & {source?:string;liveUnavailable?:boolean;liveStatus?:string;liveEngine?:any;upsetComparisons?:any[];horizonChanges?:any[];dataQuality?:any;durableEvents?:any;redundancy?:any[]};
const percent=(value:number|null)=>value==null?'Insufficient sample':`${(value*100).toFixed(1)}%`;
export default function ResearchDashboard() {
  const [data,setData]=useState<Summary|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load() {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/research-summary',{headers:researchHeaders()});
      const body=await response.json();
      if(response.status===401) resetResearchAccess();
      if(!response.ok) throw new Error(body.error||'Research summary unavailable.');
      setData(body);
    } catch(e) {setError(e instanceof Error?e.message:'Research summary unavailable.');}
    finally {setBusy(false);}
  }
  return <details className="mt-7 rounded-2xl border border-gray-700 bg-gray-900/70 p-6 text-gray-200">
    <summary className="cursor-pointer text-lg font-bold">Autoresearch · failure discovery and evidence</summary>
    <p className="mt-3 text-sm text-gray-400">Recorded research runs. Production remains the frozen v2.2 control.</p>
    <ResearchAccessField label="Research dashboard access key" />
    <button type="button" onClick={load} disabled={busy} className="mt-3 rounded-lg bg-cyan-800 px-4 py-2 disabled:opacity-50">{busy?'Loading…':'Load recorded research results'}</button>
    {error?<p role="alert" className="mt-3 text-rose-300">{error}</p>:null}
    {data?<div className="mt-5 space-y-5">
      <p className="text-sm">{data.liveStatus||`Source: ${data.source||'ARCHIVED_REPORT'}`}</p>
      <p className="text-xs text-gray-400">Recorded {new Date(data.generatedAt).toLocaleString()} · {data.controlModel}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-bold">Eligible completed predictions by evidence source</caption>
        <thead><tr><th scope="col">Evidence</th><th scope="col">N</th><th scope="col">Correct</th><th scope="col">Misses</th><th scope="col">Known groups</th><th scope="col">Validated discoveries</th></tr></thead>
        <tbody>{[data.historical,data.durable].filter(Boolean).map(row=><tr key={row.evidence}><th scope="row" className="py-2 font-normal">{row.evidence}</th><td>{row.eligible}</td><td>{row.correct}</td><td>{row.misses}</td><td>{row.knownClusters}</td><td>{row.validatedDiscoveredClusters}</td></tr>)}</tbody>
      </table></div>
      <p className="text-sm">{data.snapshot.fields} frozen fields across {data.snapshot.families} families; {data.snapshot.fieldsEverKnown} fields available in at least one historical reconstruction. Forward forecasts cover {data.completedUniqueGames} completed games across separate horizons.</p>
      <p className="text-sm">Active experiment: {data.activeExperiment?.experiment_id||'None selected: no eligible validated failure pattern.'}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-bold">Prospective Coach section scorecard</caption>
        <thead><tr><th scope="col">Section</th><th scope="col">Available</th><th scope="col">Directional</th><th scope="col">Accuracy</th><th scope="col">Disagreement accuracy</th></tr></thead>
        <tbody>{data.coach?.sections.map(row=><tr key={`${row.section}:${(row as any).horizon}`}><th scope="row" className="py-1 font-normal">{row.section}</th><td>{(row as any).horizon} · {row.available}</td><td>{row.directional}</td><td>{percent(row.accuracy)}</td><td>{percent(row.disagreementAccuracy)}</td></tr>)}</tbody>
      </table></div>
      <p className="text-xs text-gray-400">Coach reports: {data.coach?.prospectiveReports??0} prospective; {data.coach?.historicalReports??0} historical reconstructions. Qualitative sections have no invented Brier scores or probabilities.</p>
      {data.liveEngine?<><p>Engine: {data.liveEngine.status} · Tested {data.liveEngine.counts?.hypotheses_tested??0} · Killed {data.liveEngine.counts?.experiments_killed??0} · Survived {data.liveEngine.counts?.experiments_survived??0}</p>
      <details><summary>Chronological populations, queue and promotion evidence</summary><pre className="overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(data.liveEngine,null,2)}</pre></details></>:null}
      {data.liveEngine?.populations?.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption>Chronological research populations</caption><thead><tr><th>Model / horizon</th><th>Discovery N</th><th>Validation N</th><th>New groups</th><th>Status</th></tr></thead><tbody>{data.liveEngine.populations.map((p:any)=><tr key={p.plan.id}><td>{p.plan.modelVersion} / {p.plan.horizon}</td><td>{p.discovery}</td><td>{p.validation}</td><td>{p.discovered??0}</td><td>{p.status}</td></tr>)}</tbody></table></div>:null}
      {data.liveEngine?.queue?.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption>Executable research queue</caption><thead><tr><th>Hypothesis</th><th>Origin</th><th>Priority</th><th>Status</th></tr></thead><tbody>{data.liveEngine.queue.map((h:any)=><tr key={h.hypothesisId}><td>{h.hypothesisId}</td><td>{h.origin}</td><td>{h.priority.toFixed(1)}</td><td>{h.status}</td></tr>)}</tbody></table></div>:null}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption>Shadow signals versus the same eligible control forecasts</caption><thead><tr><th>Signal</th><th>Mode / horizon</th><th>N</th><th>Accuracy</th><th>Brier</th></tr></thead><tbody>{data.shadowLeaderboard.map((s:any)=><tr key={s.signal+':'+s.mode+':'+s.horizon}><td>{s.signal}</td><td>{s.mode} / {s.horizon}</td><td>{s.n}</td><td>{percent(s.accuracy)}</td><td>{s.brier==null?'Unavailable':s.brier.toFixed(4)}</td></tr>)}</tbody></table></div>
      {data.upsetComparisons?<details><summary>Underdogs that won versus favorites that won</summary><pre className="overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(data.upsetComparisons,null,2)}</pre></details>:null}
      {data.horizonChanges?<details><summary>Paired changes between capture horizons</summary><pre className="overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(data.horizonChanges,null,2)}</pre></details>:null}
      {data.dataQuality?<details><summary>Live field coverage and redundancy</summary><pre className="overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify({coverage:data.dataQuality,redundancy:data.redundancy},null,2)}</pre></details>:null}
      <details><summary className="cursor-pointer">Search budget, shadows, horizons and data quality</summary><pre className="mt-2 overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify({search:data.historical?.search,horizons:data.horizons,shadows:data.shadowLeaderboard,blocked:data.snapshot.missingOrBlocked,verification:data.verification},null,2)}</pre></details>
    </div>:null}
  </details>;
}
