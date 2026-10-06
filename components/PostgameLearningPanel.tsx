import React, { useEffect, useRef, useState } from 'react';
import type { StoredPostgameReview } from '../services/postgameLearning';
interface Plan { season: number; total: number; completed: number; games: { gameId: string; homeTeam: string; awayTeam: string; gameday: string; cached: boolean }[]; }
export function PostgameReviewDisplay({ row }: { row: StoredPostgameReview }) {
  return <div className="mt-3 space-y-3 text-left">
    <p className="font-bold text-white">{row.away_team} {row.away_score} · {row.home_team} {row.home_score}</p>
    <p className="text-sm text-gray-200">{row.review.summary}</p>
    {row.review.factors.map((f, i) => <div key={i} className="rounded-lg border border-gray-700 bg-black/20 p-3">
      <p className="text-[10px] uppercase text-cyan-300">{f.category.replaceAll('_', ' ')} · {f.evidence} · {f.repeatability.replaceAll('_', ' ')}</p>
      <p className="mt-1 text-sm text-gray-300">{f.explanation}</p>
      <div className="mt-1 flex flex-wrap gap-3">{f.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 underline">{s.title}</a>)}</div>
    </div>)}
    {!!row.review.questionsForNextPregame.length && <div><p className="text-xs font-bold text-cyan-200">Check before the next game</p><ul className="mt-1 list-disc pl-5 text-xs text-gray-300">{row.review.questionsForNextPregame.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
    {!!row.review.uncertainties.length && <p className="text-xs text-amber-200">Uncertainties: {row.review.uncertainties.join(' ')}</p>}
    <p className="text-[10px] text-gray-500">Saved {new Date(row.reviewed_at).toLocaleString()}. Historical research memory; prediction accuracy uses forecasts saved before kickoff.</p>
  </div>;
}
export async function requestPostgame(gameId: string) {
  const r = await fetch('/api/postgame-intelligence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId }) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `Game review failed (HTTP ${r.status}).`);
  return body as { review: StoredPostgameReview; cached: boolean };
}
const PostgameLearningPanel: React.FC = () => {
  const [season, setSeason] = useState(new Date().getFullYear() - 1);
  const [postseason, setPostseason] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState('');
  const [last, setLast] = useState<StoredPostgameReview | null>(null);
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);
  const load = async () => {
    setChecking(true); setError(''); setPlan(null); setLast(null);
    try {
      const r = await fetch(`/api/postgame-intelligence?season=${season}&includePostseason=${postseason ? '1' : '0'}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Could not load completed games.');
      setPlan(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load season.'); }
    finally { setChecking(false); }
  };
  const run = async () => {
    if (!plan || busy) return;
    stop.current = false; setBusy(true); setError('');
    try {
      for (const game of plan.games.filter(g => !g.cached)) {
        if (stop.current) break;
        setCurrent(`${game.awayTeam} at ${game.homeTeam} · ${game.gameday}`);
        const result = await requestPostgame(game.gameId);
        setLast(result.review);
        setPlan(p => p ? { ...p, completed: p.completed + (p.games.find(g => g.gameId === game.gameId)?.cached ? 0 : 1), games: p.games.map(g => g.gameId === game.gameId ? { ...g, cached: true } : g) } : p);
      }
    } catch (e) { setError(`${e instanceof Error ? e.message : 'Review failed.'} Batch paused. Saved games will be reused when you resume.`); }
    finally { setBusy(false); setCurrent(''); }
  };
  return <section className="mb-7 rounded-2xl border border-cyan-500/30 bg-gray-900/80 p-5 sm:p-7">
    <p className="text-xs uppercase tracking-widest font-bold text-cyan-300">DeepSeek learning journal</p>
    <h2 className="mt-1 text-2xl font-black text-white">Learn from a completed NFL season</h2>
    <p className="mt-2 text-sm text-gray-400">Research what happened and what to check in future games. Individual past games use the same review from their DeepSeek button.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <input aria-label="Season to review" type="number" min="1999" max={new Date().getFullYear()} value={season} disabled={busy || checking} onChange={e => { setSeason(Number(e.target.value)); setPlan(null); }} className="w-24 rounded-lg border border-gray-700 bg-gray-950 p-2 text-white" />
      <label className="text-sm text-gray-300"><input type="checkbox" checked={postseason} disabled={busy || checking} onChange={e => { setPostseason(e.target.checked); setPlan(null); }} className="mr-2" />Include playoffs</label>
      <button onClick={load} disabled={busy || checking} className="rounded-lg border border-cyan-600 px-4 py-2 text-sm font-bold text-cyan-200 disabled:opacity-40">{checking ? 'Checking results…' : 'Load completed games'}</button>
    </div>
    {plan && <div className="mt-4">
      <p className="text-sm text-gray-200">{plan.completed} / {plan.total} games saved · {plan.total - plan.completed} remaining</p>
      <p className="mt-1 text-xs text-gray-400">Starting this batch allows up to {plan.total - plan.completed} paid research requests, one per unsaved game. Progress is saved after every game. Keep this page open; reload this season to resume later.</p>
      <progress aria-label="Season review progress" value={plan.completed} max={Math.max(1, plan.total)} className="mt-3 w-full accent-cyan-500" />
      <div className="mt-3 flex gap-3">
        <button onClick={run} disabled={busy || plan.completed === plan.total} className="rounded-lg bg-cyan-600 px-4 py-2 font-bold text-white disabled:opacity-40">{busy ? 'Researching…' : plan.completed ? 'Resume remaining games' : 'Start paid season review'}</button>
        {busy && <button onClick={() => { stop.current = true; setCurrent(c => `${c} · pausing after this game`); }} className="rounded-lg border border-gray-600 px-4 py-2 text-gray-200">Pause after current game</button>}
      </div>
      {current && <p role="status" className="mt-2 text-sm text-cyan-200">{current}</p>}
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {last && <PostgameReviewDisplay row={last} />}
  </section>;
};
export default PostgameLearningPanel;
