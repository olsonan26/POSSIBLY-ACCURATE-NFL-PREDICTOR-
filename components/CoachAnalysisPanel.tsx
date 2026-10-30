import ResearchAccessField from './ResearchAccessField';
import React, { useState } from 'react';
import type { CoachReport } from '../services/coachAnalysis';
import { researchHeaders, resetResearchAccess } from '../services/researchAccess';
interface Props { homeTeam:string; awayTeam:string; gameDate:string; compact?:boolean; }
const CoachAnalysisPanel: React.FC<Props> = ({homeTeam,awayTeam,gameDate,compact=false}) => {
  const [report,setReport]=useState<CoachReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function run() {
    setBusy(true);setError('');
    try {
      const r=await fetch('/api/coach-analysis',{method:'POST',headers:researchHeaders(),body:JSON.stringify({homeTeam,awayTeam,gameDate})});
      const body=await r.json(); if(r.status===401) resetResearchAccess();
      if(!r.ok) throw new Error(body.error||'Matchup analysis failed.'); setReport(body);
    } catch(e) {setError(e instanceof Error?e.message:'Matchup analysis failed.');}
    finally {setBusy(false);}
  }
  return <section className={`${compact?'mt-3':'mt-6 p-5 sm:p-7'} rounded-2xl border border-cyan-500/30 bg-cyan-950/15 text-left`}>
    <h3 className="text-lg font-black text-cyan-200">Coach's matchup analysis and prediction</h3>
    <p className="mt-2 text-xs text-gray-300">Examine schemes, player matchups, replacements and counters, then make a sourced pick. Past games use pregame reconstruction; postgame reviews remain separate.</p>
    <ResearchAccessField label="Matchup research access key" />
    <button type="button" onClick={run} disabled={busy} className="mt-3 rounded-lg bg-cyan-700 px-4 py-2 font-bold text-white disabled:opacity-50">{busy?'Researching matchups and building the pick...':report?'Load saved analysis':'Analyze matchup & predict'}</button>
    <p className="mt-2 text-[11px] text-gray-400">Up to two paid research calls for a new report. Saved reports are reused. No film viewing is claimed.</p>
    {error&&<p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {report&&<div className="mt-4 space-y-4">
      <p className="text-sm text-amber-200">{report.mode==='historical-reconstruction'?'Historical pregame reconstruction':'Pregame analysis'} - evidence cutoff {new Date(report.cutoff).toLocaleString()}</p>
      <p className="text-xs text-gray-400">{report.capture} - {report.evidence.length} verified dated excerpts</p>
      {report.sections.map(s=><details key={s.id} open={!compact} className="rounded-xl border border-gray-700 bg-gray-950/60 p-3">
        <summary className="cursor-pointer font-bold text-sm text-white">{s.title} - {s.advantage==='home'?report.homeTeam:s.advantage==='away'?report.awayTeam:s.advantage==='even'?'Even':'Evidence missing'}</summary>
        <p className="mt-2 text-sm text-gray-300"><strong>Observed:</strong> {s.observation}</p>
        {s.mechanism&&<p className="mt-2 text-sm text-gray-300"><strong>Matchup implication (inference):</strong> {s.mechanism}</p>}
        {s.counter&&<p className="mt-2 text-sm text-gray-300"><strong>Opponent's answer (inference):</strong> {s.counter}</p>}
        {s.missing.length>0&&<p className="mt-2 text-xs text-amber-200">Missing: {s.missing.join(' ')}</p>}
        <div className="mt-2 flex flex-wrap gap-3">{s.evidenceIds.map(id=>{const e=report.evidence.find(x=>x.id===id);return e?<a key={id} href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 underline">{id}: {e.title}</a>:null;})}</div>
      </details>)}
      <div className="grid gap-3 sm:grid-cols-2">{[{team:report.homeTeam,keys:report.homeKeys},{team:report.awayTeam,keys:report.awayKeys}].map(({team,keys})=><div key={team} className="rounded-xl border border-gray-700 p-3"><h4 className="font-bold text-white">{team} keys to victory</h4><ul className="mt-2 list-disc pl-5 text-xs text-gray-300">{keys.map((k,i)=><li key={i}>{k}</li>)}</ul>{!keys.length&&<p className="text-xs text-amber-200">No sourced advantage established.</p>}</div>)}</div>
      <div className="rounded-xl border border-emerald-400/40 bg-emerald-950/30 p-4"><p className="text-xs uppercase text-emerald-300">After the analysis: predicted winner</p><h4 className="mt-1 text-2xl font-black text-white">{report.prediction.winner}</h4><p className="mt-2 text-sm text-gray-200">{report.prediction.rationale}</p><p className="mt-2 text-xs text-gray-400">{report.prediction.method==='matchup-analysis'?'Experimental matchup pick; no calibrated confidence percentage':'Football-control fallback because matchup evidence is insufficient'} - comparison control: {report.homeTeam} {(report.prediction.controlHomeProbability*100).toFixed(1)}%</p></div>
      {report.historicalComparison&&<div className="rounded-xl border border-amber-600/40 p-3 text-sm text-amber-200"><strong>Compare after the pick:</strong> {report.awayTeam} {report.historicalComparison.awayScore} - {report.homeTeam} {report.historicalComparison.homeScore}. {report.historicalComparison.correct===null?'Game ended tied.':report.historicalComparison.correct?'Reconstructed pick matched the result.':'Reconstructed pick did not match the result.'} Historical reconstruction accuracy is not prospective validation.</div>}
      {report.sensitivityConditions?.length?<details className="text-sm text-cyan-200"><summary className="cursor-pointer">Sensitivity conditions</summary><ul className="mt-2 list-disc pl-5">{report.sensitivityConditions.map(condition=><li key={condition}>{condition}</li>)}</ul></details>:null}
      <details className="text-xs text-gray-400"><summary className="cursor-pointer">Evidence excerpts and limitations</summary>{report.evidence.map(e=><p key={e.id} className="mt-2">{e.id} - published {new Date(e.publishedAt).toLocaleString()} - {e.quote}</p>)}<ul className="mt-3 list-disc pl-5">{report.limitations.map((l,i)=><li key={i}>{l}</li>)}</ul></details>
    </div>}
  </section>;
}

export default CoachAnalysisPanel;
