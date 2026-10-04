import React, { useState } from 'react';
import { getGamesForDate } from '../services/scheduleService';

interface DeepSeekPregamePanelProps {
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  gameDate: string;
  baseHomeProbability: number;
}

interface DeepSeekFact {
  id: string;
  category: string;
  team: string;
  summary: string;
  effect: string;
  accepted: boolean;
  rejectReason?: string;
  sourceDomains?: string[];
}

interface DeepSeekShadowResponse {
  experiment: string;
  mode: string;
  researchModel: string;
  generatedAt: string;
  shadow: {
    homeTeam: string;
    awayTeam: string;
    kickoffUtc: string;
    baseHomeProbability: number;
    shadowHomeProbability: number;
    totalLogitAdjustment: number;
    acceptedFactCount: number;
    rejectedFactCount: number;
    facts: DeepSeekFact[];
  };
}

function easternOffsetHours(dateIso: string): number {
  const probe = new Date(`${dateIso}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit'
  }).formatToParts(probe);
  const hour = Number(parts.find(part => part.type === 'hour')?.value || '12');
  const normalizedHour = hour === 24 ? 0 : hour;
  return 12 - normalizedHour;
}

function kickoffEasternToUtc(dateIso: string, gametime: string): string {
  const [hoursText, minutesText] = gametime.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) throw new Error('NFL schedule kickoff time is invalid.');
  const offsetHours = easternOffsetHours(dateIso);
  return new Date(`${dateIso}T00:00:00Z`).getTime() || 0,
    new Date(Date.UTC(
      Number(dateIso.slice(0, 4)),
      Number(dateIso.slice(5, 7)) - 1,
      Number(dateIso.slice(8, 10)),
      hours + offsetHours,
      minutes,
      0
    )).toISOString();
}

const DeepSeekPregamePanel: React.FC<DeepSeekPregamePanelProps> = ({
  homeTeamAbbr,
  awayTeamAbbr,
  gameDate,
  baseHomeProbability
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<DeepSeekShadowResponse | null>(null);

  const runDeepSeek = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setResponse(null);

    try {
      const games = await getGamesForDate(gameDate);
      const game = games.find(item => item.homeTeam === homeTeamAbbr && item.awayTeam === awayTeamAbbr);
      if (!game) throw new Error('DeepSeek is only available when this exact matchup exists in the verified NFL schedule.');
      if (!game.gametime) throw new Error('Verified kickoff time is unavailable, so paid pregame research was not started.');

      const kickoffUtc = kickoffEasternToUtc(game.gameday, game.gametime);
      if (Date.parse(kickoffUtc) <= Date.now()) {
        throw new Error('Kickoff has already passed. DeepSeek was not called, protecting the prospective-only experiment.');
      }

      const apiResponse = await fetch('/api/pregame-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeTeam: homeTeamAbbr,
          awayTeam: awayTeamAbbr,
          kickoffUtc,
          baseHomeProbability: Math.max(0.001, Math.min(0.999, baseHomeProbability))
        })
      });

      const body = await apiResponse.json().catch(() => null);
      if (!apiResponse.ok) {
        const detail = body?.detail || body?.error || `DeepSeek request failed with HTTP ${apiResponse.status}.`;
        throw new Error(detail);
      }

      setResponse(body as DeepSeekShadowResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DeepSeek pregame analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  const shadow = response?.shadow;
  const homePct = shadow ? shadow.shadowHomeProbability * 100 : null;
  const awayPct = homePct == null ? null : 100 - homePct;
  const acceptedFacts = shadow?.facts.filter(fact => fact.accepted) || [];

  return (
    <section className="mt-5 rounded-2xl border border-cyan-500/30 bg-cyan-950/15 p-5 sm:p-6 shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] font-bold text-cyan-300">Optional AI Pregame Research · EXP-031</p>
          <h3 className="mt-1 text-xl font-black text-white">DeepSeek is OFF until you press the button</h3>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">Normal predictions do not call OpenRouter. Pressing the button below is the only action on this screen that starts the paid DeepSeek research request.</p>
        </div>
        <button
          type="button"
          onClick={runDeepSeek}
          disabled={loading}
          className="shrink-0 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-900/60 disabled:cursor-not-allowed px-5 py-3 text-sm font-black text-white transition-colors"
        >
          {loading ? 'Running DeepSeek…' : response ? 'Run DeepSeek Again' : 'Run DeepSeek Pregame Analysis'}
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-cyan-500/20 bg-black/20 px-3 py-2 text-[11px] text-cyan-100/70">
        COST CONTROL: no OpenRouter/DeepSeek request is made automatically on page load, Predict Winner, Predict All Games, or Full Breakdown.
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {shadow && homePct != null && awayPct != null && (
        <div className="mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-700 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">v2.2 home baseline</p>
              <p className="mt-1 text-2xl font-black text-white">{(shadow.baseHomeProbability * 100).toFixed(1)}%</p>
            </div>
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4">
              <p className="text-[10px] uppercase tracking-wider text-cyan-300">DeepSeek shadow</p>
              <p className="mt-1 text-lg font-black text-white">{shadow.homeTeam} {homePct.toFixed(1)}% · {shadow.awayTeam} {awayPct.toFixed(1)}%</p>
              <p className="mt-1 text-[10px] text-gray-500">Research-only. Production pick unchanged.</p>
            </div>
            <div className="rounded-xl border border-gray-700 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Evidence accepted</p>
              <p className="mt-1 text-2xl font-black text-white">{shadow.acceptedFactCount}</p>
              <p className="text-[10px] text-gray-500">{shadow.rejectedFactCount} rejected by deterministic gate</p>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-gray-500">Model: {response?.researchModel} · generated {response?.generatedAt ? new Date(response.generatedAt).toLocaleString() : ''}</p>

          {acceptedFacts.length > 0 && (
            <div className="mt-4 space-y-2">
              {acceptedFacts.map(fact => (
                <div key={fact.id} className="rounded-xl border border-gray-700 bg-gray-950/50 p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-cyan-300">{fact.category.replaceAll('_', ' ')}</span>
                    <span className="text-[10px] text-gray-500">{fact.team} · {fact.effect}</span>
                  </div>
                  <p className="text-sm text-gray-200">{fact.summary}</p>
                  {fact.sourceDomains && fact.sourceDomains.length > 0 && <p className="mt-1 text-[10px] text-gray-500">Sources: {fact.sourceDomains.join(', ')}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default DeepSeekPregamePanel;
