import React, { useState } from 'react';
import { TEAM_REGISTRY } from '../data/teamRegistry';
import { getGamesForDate, getRegularSeasonWeek, type ScheduledGame } from '../services/scheduleService';
import { fetchZodiacReport, relationshipLabel, zodiacForDate, zodiacCompatibilityMatrix, ZODIAC_SIGNS, type ZodiacReport, type ZodiacSubject, type ZodiacTeamReport } from '../services/chineseZodiacService';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const teams = [...TEAM_REGISTRY].sort((a,b) => a.name.localeCompare(b.name));
const name = (abbr: string) => TEAM_REGISTRY.find(t => t.abbr === abbr)?.name || abbr;
const matrix = zodiacCompatibilityMatrix();
const matrixLabel = { same_sign:'Same', direct_enemy:'Enemy', same_friend_trine:'Trine', rat_ox_special_pair:'Rat–Ox', other_or_unclassified:'—' };
function download(record: Record<string, any>, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function yearBadge(subject: ZodiacSubject) {
  const enemy = subject.relationshipToYear === 'direct_enemy';
  const own = subject.relationshipToYear === 'same_sign';
  return <span className={`inline-block rounded-full px-2 py-1 text-xs ${enemy ? 'bg-rose-950 text-rose-300' : own ? 'bg-emerald-950 text-emerald-300' : 'bg-gray-800 text-gray-300'}`}>{relationshipLabel(subject.relationshipToYear)}</span>;
}
function TeamDetails({ team }: { team: ZodiacTeamReport }) {
  const known = team.players.filter(p => p.zodiac);
  const own = known.filter(p => p.relationshipToYear === 'same_sign').length;
  const enemy = known.filter(p => p.relationshipToYear === 'direct_enemy').length;
  return <section className="min-w-0 rounded-xl border border-gray-700 bg-gray-950/60 p-4">
    <h3 className="text-xl font-bold text-white">{team.name}</h3>
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
      <p className="text-sm text-amber-200">Team date preview: <strong>{team.franchise.zodiac ? `${team.franchise.zodiac.element} ${team.franchise.zodiac.sign}` : 'Unavailable'}</strong></p>
      <p className="mt-1 text-xs text-gray-400">Existing app date: {team.franchise.birthDate} · {team.franchise.zodiac?.ganZhi}</p>
      <div className="mt-2">{yearBadge(team.franchise)}</div>
      <p className="mt-2 text-xs text-amber-200/80">{team.franchise.warning}</p>
    </div>
    <p className="mt-3 text-sm text-gray-300">Players: {known.length}/{team.players.length} birthdays available · <span className="text-emerald-300">{own} own-year</span> · <span className="text-rose-300">{enemy} enemy-year</span></p>
    <p className="mt-2 text-xs text-gray-400">{team.warning}</p>
    <p className="mt-2 text-xs text-gray-500">Coach: unavailable without verified personnel and birthday for this game.</p>
    <div className="mt-4 max-h-[32rem] overflow-auto rounded-lg border border-gray-800" tabIndex={0} aria-label={`${team.name} roster`}>
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-gray-900 text-gray-400"><tr><th className="p-3">Player / birth date</th><th className="p-3">Sign / element</th><th className="p-3">Year relationship</th><th className="p-3">Numbers</th></tr></thead>
        <tbody>{team.players.map(player => <tr key={player.id} className="border-t border-gray-800">
          <td className="p-3"><span className="font-semibold text-gray-200">{player.name}</span><br/><span className="text-gray-500">{player.role} · {player.birthDate || 'Birthday unavailable'}</span></td>
          <td className="p-3 text-gray-300">{player.zodiac ? <>{player.zodiac.sign}<br/>{player.zodiac.element} · {player.zodiac.ganZhi}</> : 'Unavailable'}</td>
          <td className="p-3">{yearBadge(player)}</td>
          <td className="p-3 text-gray-400">{player.numerology ? <>Life path {player.numerology.lifePath}<br/>Birth day {player.numerology.birthDay} → {player.numerology.birthDayReduced}<br/>Personal year {player.numerology.personalYear}</> : 'Unavailable'}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
function ReportDetails({ report }: { report: ZodiacReport }) {
  return <div className="mt-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-4">
      <div><p className="text-xs uppercase tracking-wider text-indigo-300">Lunar New Year convention · Research only</p>
        <h3 className="mt-1 text-xl font-bold">{name(report.game.away)} @ {name(report.game.home)}</h3>
        <p className="mt-1 text-sm text-gray-300">{report.game.date} · {report.gameYear.polarity} {report.gameYear.element} {report.gameYear.sign} · {report.gameYear.ganZhi}</p>
        {report.game.completed && <p className="mt-2 text-sm text-gray-400">Final: {report.game.away} {report.game.awayScore} · {report.game.home} {report.game.homeScore}. Retrospective audit; no original Zodiac prediction exists.</p>}
      </div>
      <button disabled={!report.record} onClick={() => report.record && download(report.record, `zodiac-${report.game.id}.json`)} className="rounded-lg border border-indigo-400/40 px-4 py-2 text-sm font-bold text-indigo-200 disabled:opacity-40">Download schema JSON</button>
    </div>
    {report.recordUnavailableReason && <p role="status" className="text-sm text-amber-300">Structured export unavailable: {report.recordUnavailableReason}</p>}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4"><TeamDetails team={report.away}/><TeamDetails team={report.home}/></div>
    <p className="text-xs text-gray-400">Team-to-team preview: {report.franchiseRelationship ? report.franchiseRelationship.replaceAll('_',' ') : 'Unavailable'}. Opposition is reciprocal and does not identify a winning side.</p>
    <details className="rounded-xl border border-gray-800 p-4 text-sm text-gray-400"><summary className="cursor-pointer font-bold text-gray-300">Sources and limitations</summary>
      <ul className="mt-3 list-disc pl-5 space-y-2">{report.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="mt-3 text-xs">Personal year uses an experimental January 1 boundary. Life paths preserve 11/22/33; no automatic number bonuses. No hour pillars, hidden enemies, draft-sign resets or unverified jersey-number formula.</p>
      {report.record?.sources.map((source: any) => <p key={source.source_id} className="mt-2 text-xs break-words">{source.title}: {source.locator.startsWith('https://') ? <a className="text-indigo-300 underline" href={source.locator} target="_blank" rel="noreferrer">source</a> : source.locator}</p>)}
    </details>
  </div>;
}

export default function ChineseZodiacPanel() {
  const [evaluation, setEvaluation] = useState<any>(null);
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [evaluationError, setEvaluationError] = useState('');
  const [date, setDate] = useState(today());
  const [home, setHome] = useState(''); const [away, setAway] = useState('');
  const [season, setSeason] = useState(new Date().getFullYear()); const [week, setWeek] = useState(1);
  const [games, setGames] = useState<ScheduledGame[]>([]);
  const [reports, setReports] = useState<ZodiacReport[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const gameYear = zodiacForDate(date);
  const inputClass = 'min-w-0 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white';
  const buttonClass = 'rounded-lg border border-indigo-500/40 bg-indigo-950/50 px-4 py-2.5 text-sm font-bold text-indigo-200 hover:bg-indigo-900/60 disabled:opacity-40';
  async function load(mode: 'date' | 'week') {
    setBusy(true); setError(''); setReports([]); setActive(null); setGames([]);
    try {
      const found = mode === 'date' ? await getGamesForDate(date) : await getRegularSeasonWeek(season, week);
      setGames(found); if (!found.length) setError('No NFL games matched that date or week.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Schedule unavailable.'); }
    finally { setBusy(false); }
  }
  async function check(matchups: Array<{ home: string; away: string; date: string }>) {
    setBusy(true); setError(''); setReports([]); setActive(null);
    const collected: ZodiacReport[] = []; const failures: string[] = [];
    for (let i = 0; i < matchups.length; i++) {
      setProgress(`Checking ${i+1}/${matchups.length}…`);
      try {
        const m = matchups[i]; const report = await fetchZodiacReport(m.home,m.away,m.date);
        collected.push(report); setReports([...collected]); if (collected.length === 1) setActive(report.game.id);
      } catch (e) { failures.push(`${matchups[i].away} @ ${matchups[i].home}: ${e instanceof Error ? e.message : 'Unavailable'}`); }
    }
    setError(failures.join(' ')); setBusy(false); setProgress('');
  }
  const selected = reports.find(r => r.game.id === active);
  return <section id="chinese-zodiac-panel" role="tabpanel" aria-labelledby="zodiac-tab" className="rounded-2xl border border-indigo-500/25 bg-gray-900/80 p-5 sm:p-7">
    <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Chinese Zodiac Lab</p>
    <h2 className="mt-1 text-2xl font-black">Check any scheduled NFL game</h2>
    <p className="mt-2 text-sm text-gray-400">Compare team-date previews and historical player signs with the game’s Chinese year. This separate experiment leaves the football predictions unchanged.</p>
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">Experimental observations · No Zodiac win probability is approved. Check signs and completed results without treating an enemy year as a guaranteed loss.</div>
    <details className="mt-4 rounded-xl border border-gray-700 p-4"><summary className="cursor-pointer text-sm font-bold text-gray-300">Measured historical results · Zodiac vs sports baseline</summary>
      <p className="mt-3 text-xs text-gray-400">Saved exploratory evaluation: train on earlier seasons, test on 2023–2025, with prior-week rosters and a separate Elo baseline. Historical data publication times remain unverified.</p>
      <button className={`${buttonClass} mt-3`} disabled={evaluationBusy} onClick={async()=>{
        setEvaluationBusy(true); setEvaluationError('');
        try { const response=await fetch('/api/zodiac-research?view=evaluation'); if(!response.ok) throw new Error('Saved evaluation unavailable.'); setEvaluation(await response.json()); }
        catch(e){setEvaluationError(e instanceof Error ? e.message : 'Saved evaluation unavailable.');}
        finally{setEvaluationBusy(false);}
      }}>{evaluationBusy ? 'Loading results…' : 'Show saved backtest'}</button>
      {evaluationError && <p className="mt-2 text-sm text-rose-300" role="alert">{evaluationError}</p>}
      {evaluation && <div className="mt-3 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-gray-400"><tr><th className="p-2">Test season / games</th><th className="p-2">Sports accuracy</th><th className="p-2">Sports + Zodiac accuracy</th><th className="p-2">Brier: sports / + Zodiac</th></tr></thead><tbody>{evaluation.folds.map((fold:any)=><tr key={fold.test_season} className="border-t border-gray-800"><td className="p-2">{fold.test_season} / {fold.models.sports_only.sample_size}</td><td className="p-2">{(fold.models.sports_only.accuracy*100).toFixed(1)}%</td><td className="p-2">{(fold.models.sports_plus_zodiac.accuracy*100).toFixed(1)}%</td><td className="p-2">{fold.models.sports_only.brier_score.toFixed(4)} / {fold.models.sports_plus_zodiac.brier_score.toFixed(4)}</td></tr>)}</tbody></table>
        <p className="mt-3 text-xs text-amber-200">{evaluation.conclusion} Lower Brier scores indicate better probability accuracy. No calibrated Zodiac probability is approved.</p>
        <button onClick={()=>download(evaluation,'zodiac-retrospective-evaluation.json')} className={`${buttonClass} mt-3`}>Download all seven model comparisons</button>
      </div>}
    </details>
    <details className="mt-4 rounded-xl border border-gray-700 p-4"><summary className="cursor-pointer text-sm font-bold text-gray-300">Twelve-sign relationship matrix</summary>
      <p className="mt-3 text-xs text-gray-400">Same-sign, six reciprocal enemy pairs, four friend trines, and the Rat–Ox special pair stay separate. A dash means unclassified. This table assigns no winning side or probability.</p>
      <div className="mt-3 overflow-auto" tabIndex={0} aria-label="Zodiac relationship matrix"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Sign</th>{ZODIAC_SIGNS.map(sign=><th className="p-2 text-gray-400" key={sign}>{sign}</th>)}</tr></thead><tbody>{ZODIAC_SIGNS.map(a=><tr key={a} className="border-t border-gray-800"><th className="p-2 text-gray-300">{a}</th>{ZODIAC_SIGNS.map(b=><td key={b} title={matrix[a][b].replaceAll('_',' ')} className={`p-2 ${matrix[a][b]==='direct_enemy' ? 'text-rose-300' : matrix[a][b]==='other_or_unclassified' ? 'text-gray-600' : 'text-emerald-300'}`}>{matrixLabel[matrix[a][b]]}</td>)}</tr>)}</tbody></table></div>
    </details>
    <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-xl border border-gray-700 p-4"><label htmlFor="zodiac-date" className="mb-2 block text-sm text-gray-300">Game date</label>
        <div className="flex flex-wrap gap-2"><input id="zodiac-date" type="date" min="1999-01-01" max="2100-12-31" value={date} disabled={busy} onChange={e=>setDate(e.target.value)} className={inputClass}/><button disabled={busy || !date} onClick={()=>load('date')} className={buttonClass}>Load date</button></div>
        <p className="mt-2 text-xs text-gray-400">{gameYear ? `${gameYear.lunarYear}: ${gameYear.element} ${gameYear.sign} (${gameYear.ganZhi})` : 'Select a valid supported date.'}</p>
      </div>
      <div className="rounded-xl border border-gray-700 p-4"><label className="mb-2 block text-sm text-gray-300">Regular-season week</label>
        <div className="flex flex-wrap gap-2"><input aria-label="Zodiac NFL season" type="number" min="1999" max="2100" value={season} disabled={busy} onChange={e=>setSeason(Number(e.target.value))} className={`${inputClass} w-24`}/>
          <select aria-label="Zodiac NFL week" value={week} disabled={busy} onChange={e=>setWeek(Number(e.target.value))} className={inputClass}>{Array.from({length:18},(_,i)=><option key={i+1} value={i+1}>Week {i+1}</option>)}</select>
          <button disabled={busy || season<1999 || season>2100} onClick={()=>load('week')} className={buttonClass}>Load week</button></div>
      </div>
    </div>
    {games.length>0 && <div className="mt-5 space-y-2">
      <button disabled={busy} onClick={()=>check(games.map(g=>({home:g.homeTeam,away:g.awayTeam,date:g.gameday})))} className={buttonClass}>Check all {games.length} games</button>
      {games.map(game=><div key={game.gameId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-800 p-3"><span className="text-sm text-gray-300">{name(game.awayTeam)} @ {name(game.homeTeam)} · {game.gameday}{game.completed ? ` · Final ${game.awayScore}–${game.homeScore}` : ''}</span><button disabled={busy} onClick={()=>check([{home:game.homeTeam,away:game.awayTeam,date:game.gameday}])} className={buttonClass}>Check Zodiac</button></div>)}
    </div>}
    <details className="mt-5 rounded-xl border border-gray-700 p-4" open={!games.length}><summary className="cursor-pointer text-sm font-bold text-gray-300">One game by official home / away teams</summary>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">{[['home',home,setHome,'Home team'],['away',away,setAway,'Away team']].map(([id,value,setter,label]: any)=><label key={id} className="text-xs text-gray-400">{label}<select aria-label={`Zodiac ${label}`} value={value} disabled={busy} onChange={e=>setter(e.target.value)} className={`${inputClass} mt-1 w-full`}><option value="">Select team</option>{teams.map(t=><option key={t.abbr} value={t.abbr}>{t.name}</option>)}</select></label>)}</div>
      <button disabled={busy || !home || !away || home===away || !gameYear} onClick={()=>check([{home,away,date}])} className={`${buttonClass} mt-3`}>Check matchup</button>
    </details>
    {busy && <p className="mt-4 text-sm text-indigo-300" role="status" aria-live="polite">{progress || 'Loading schedule…'}</p>}
    {error && <p className="mt-4 rounded-lg bg-rose-950/30 p-3 text-sm text-rose-300" role="alert">{error}</p>}
    {reports.length>1 && <div className="mt-5 flex flex-wrap gap-2">{reports.map(r=><button key={r.game.id} onClick={()=>setActive(r.game.id)} className={`${buttonClass} ${active===r.game.id ? 'border-indigo-300' : ''}`}>{r.game.away} @ {r.game.home}</button>)}</div>}
    {selected && <ReportDetails report={selected}/>}
  </section>;
}
