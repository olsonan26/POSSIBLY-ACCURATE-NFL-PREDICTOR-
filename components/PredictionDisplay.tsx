import React, { useState } from 'react';
import { DecisionFactor, PersonnelSnapshot, PredictionResult } from '../types';
import CalculationBreakdownCard from './CalculationBreakdownCard';

interface PredictionDisplayProps {
  result: PredictionResult;
}

type Tab = 'factors' | 'personnel' | 'numerology' | 'history';

const probabilityTone = (value: number) => {
  if (value >= 70) return 'text-emerald-300';
  if (value >= 60) return 'text-amber-300';
  return 'text-orange-300';
};

const factorTone = (factor: DecisionFactor) => {
  if (factor.advantage === 'winner') return 'border-emerald-500/30 bg-emerald-950/15';
  if (factor.advantage === 'loser') return 'border-rose-500/30 bg-rose-950/15';
  return 'border-gray-700 bg-gray-900/40';
};

const FactorCard: React.FC<{ factor: DecisionFactor }> = ({ factor }) => (
  <div className={`rounded-xl border p-4 ${factorTone(factor)}`}>
    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-bold text-sm text-white">{factor.title}</h4>
          {factor.category && (
            <span className="rounded-full border border-gray-600 bg-gray-950/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              {factor.category}
            </span>
          )}
        </div>
      </div>
      <span className={`text-[10px] uppercase font-bold tracking-wider ${factor.includedInScore === false ? 'text-gray-500' : factor.advantage === 'winner' ? 'text-emerald-300' : factor.advantage === 'loser' ? 'text-rose-300' : 'text-gray-400'}`}>
        {factor.includedInScore === false ? 'Not scored' : factor.advantage === 'winner' ? 'Supports pick' : factor.advantage === 'loser' ? 'Opposes pick' : 'Neutral'}
      </span>
    </div>
    <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">{factor.description}</p>
    {factor.edgeScore > 0 && (
      <p className="mt-2 text-[11px] text-gray-500">Model adjustment magnitude: {factor.edgeScore.toFixed(1)}</p>
    )}
  </div>
);

const PersonnelCard: React.FC<{ title: string; snapshot?: PersonnelSnapshot }> = ({ title, snapshot }) => {
  if (!snapshot) return null;
  const injuries = snapshot.injuries || [];
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h4 className="font-bold text-white">{title}</h4>
        <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full border ${snapshot.sourceStatus === 'live' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30' : snapshot.sourceStatus === 'partial' ? 'text-amber-300 border-amber-500/30 bg-amber-950/30' : 'text-gray-400 border-gray-600 bg-gray-900'}`}>
          {snapshot.sourceStatus} personnel
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mb-4">
        {[
          ['Head Coach', snapshot.coach?.name],
          ['Starting QB', snapshot.startingQb?.name],
          ['Backup QB', snapshot.backupQb?.name],
          ['Blindside Tackle', snapshot.blindsideTackle?.name],
          ['Kicker', snapshot.kicker?.name]
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-800 bg-black/20 p-2.5">
            <span className="block text-gray-500">{label}</span>
            <span className="font-semibold text-gray-200">{value || 'Not verified'}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Relevant injuries / availability</h5>
          <span className="text-[10px] text-gray-500">Top weighted items</span>
        </div>
        {injuries.length === 0 ? (
          <p className="text-xs text-gray-500">No live injury items were returned for this team, or this is a historical calculation where current injuries are intentionally excluded.</p>
        ) : (
          <div className="space-y-2">
            {injuries.slice(0, 7).map((injury, index) => (
              <div key={`${injury.name}-${index}`} className="flex justify-between gap-3 rounded-lg bg-black/20 border border-gray-800 p-2 text-xs">
                <div>
                  <span className="font-semibold text-gray-200">{injury.name}</span>
                  {injury.position && <span className="ml-2 text-gray-500">{injury.position}</span>}
                  <div className="text-gray-500">{[injury.status, injury.injury].filter(Boolean).join(' · ') || 'Availability flag'}</div>
                </div>
                <span className="font-mono text-amber-300">{injury.impact.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PredictionDisplay: React.FC<PredictionDisplayProps> = ({ result }) => {
  const [activeTab, setActiveTab] = useState<Tab>('factors');
  const freshness = result.dataFreshness;
  const scores = result.modelScores;

  const tabs: Array<[Tab, string]> = [
    ['factors', 'Decision factors'],
    ['personnel', 'Personnel & injuries'],
    ['numerology', 'Numerology'],
    ['history', 'Venue history']
  ];

  return (
    <section className="mt-8 rounded-2xl border border-gray-700/80 bg-gray-900/90 p-5 sm:p-7 shadow-2xl">
      <div className="text-center mb-6">
        <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-950/40 px-3 py-1 text-[11px] uppercase tracking-wider font-bold text-indigo-300">
          {result.modelVersion || 'Verified predictor'}
        </span>
        <h2 className="mt-3 text-2xl sm:text-3xl font-black text-white">Projected Game Outcome</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="rounded-xl border-2 border-emerald-500/50 bg-gradient-to-b from-emerald-950/35 to-gray-950 p-5 text-center">
          <div className="flex justify-center gap-2 flex-wrap mb-2">
            <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] uppercase tracking-wider font-black text-gray-950">Projected winner</span>
            <span className="rounded-full border border-gray-600 bg-gray-900 px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold text-gray-300">
              {result.isWinnerHome ? 'Home' : 'Away'}
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white">{result.winner.name}</p>
          <p className={`mt-2 text-4xl font-black ${probabilityTone(result.confidence)}`}>{result.confidence.toFixed(1)}%</p>
          <p className="text-xs text-gray-500 mt-1">Model win probability</p>
        </div>

        <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-5 text-center flex flex-col justify-center">
          <p className="text-xs uppercase tracking-wider font-bold text-gray-500">Opponent</p>
          <p className="mt-2 text-2xl font-bold text-gray-200">{result.loser.name}</p>
          <p className="mt-2 text-2xl font-bold text-gray-500">{(100 - result.confidence).toFixed(1)}%</p>
        </div>
      </div>

      <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 p-4 mb-5">
        <p className="text-sm text-indigo-100 leading-relaxed">{result.reasoning}</p>
      </div>

      {scores && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="rounded-xl border border-gray-700 bg-black/20 p-3">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500">Pregame Elo</span>
            <span className="block mt-1 text-sm font-mono font-bold text-white">{scores.eloHome} / {scores.eloAway}</span>
          </div>
          <div className="rounded-xl border border-gray-700 bg-black/20 p-3">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500">Base home %</span>
            <span className="block mt-1 text-sm font-mono font-bold text-white">{scores.baseHomeProbability.toFixed(1)}%</span>
          </div>
          <div className="rounded-xl border border-gray-700 bg-black/20 p-3">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500">Final home %</span>
            <span className="block mt-1 text-sm font-mono font-bold text-white">{scores.finalHomeProbability.toFixed(1)}%</span>
          </div>
          <div className="rounded-xl border border-gray-700 bg-black/20 p-3">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500">Numerology cap</span>
            <span className="block mt-1 text-sm font-mono font-bold text-white">{scores.numerologyLogitAdjustment >= 0 ? '+' : ''}{scores.numerologyLogitAdjustment.toFixed(3)}</span>
          </div>
        </div>
      )}

      {freshness && (
        <div className="rounded-xl border border-gray-700 bg-gray-950/40 p-4 mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="font-bold text-sm text-white">Data integrity</h3>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold ${freshness.leakageGuard ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300' : 'border-rose-500/30 bg-rose-950/30 text-rose-300'}`}>
              {freshness.leakageGuard ? 'Pregame cutoff enforced' : 'Cutoff warning'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2 text-xs text-gray-400">
            <p><strong className="text-gray-200">Historical source:</strong> {freshness.historicalSource}</p>
            <p><strong className="text-gray-200">Games available before cutoff:</strong> {freshness.historicalGamesUsed.toLocaleString()}</p>
            <p><strong className="text-gray-200">Cutoff:</strong> {freshness.cutoffDate}</p>
            <p><strong className="text-gray-200">Schedule matched:</strong> {freshness.scheduleMatched ? 'Yes' : 'No / manual matchup'}</p>
            <p><strong className="text-gray-200">Live depth chart:</strong> {freshness.livePersonnelLoaded ? 'Loaded' : 'Fallback/partial'}</p>
            <p><strong className="text-gray-200">Live injury feed:</strong> {freshness.injuryDataLoaded ? 'Loaded' : 'Not loaded / historical'}</p>
            <p><strong className="text-gray-200">Neutral site:</strong> {freshness.neutralSite ? 'Yes' : 'No'}</p>
          </div>
          {freshness.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] text-gray-500 list-disc pl-4">
              {freshness.notes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          )}
        </div>
      )}

      {result.warnings && result.warnings.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2">Model notes</h3>
          <ul className="space-y-1.5 text-xs text-amber-100/80 list-disc pl-4">
            {result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-gray-700 mb-5">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`whitespace-nowrap px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors ${activeTab === key ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'factors' && (
        <div className="space-y-3">
          {result.decisionFactors.map((factor, index) => <FactorCard key={`${factor.title}-${index}`} factor={factor} />)}
        </div>
      )}

      {activeTab === 'personnel' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PersonnelCard title={result.homePersonnel?.team || 'Home team'} snapshot={result.homePersonnel} />
          <PersonnelCard title={result.awayPersonnel?.team || 'Away team'} snapshot={result.awayPersonnel} />
        </div>
      )}

      {activeTab === 'numerology' && (
        <div>
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/15 p-4 mb-4 text-xs text-gray-300 leading-relaxed">
            The scoring numerology layer now uses Bayesian-smoothed, verified pregame history. Team, coach and starting-QB inputs may score when their dates are known. Backup QB, tackle and kicker are displayed for research but do not score until they demonstrate incremental performance on untouched games. Owner scoring and the legacy exact/subset archives have been removed from the decision score.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-bold text-emerald-300 mb-3">{result.winner.name}</h3>
              {result.winnerBreakdown.map((breakdown, index) => <CalculationBreakdownCard key={`${breakdown.role}-${index}`} breakdown={breakdown} />)}
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-300 mb-3">{result.loser.name}</h3>
              {result.loserBreakdown.map((breakdown, index) => <CalculationBreakdownCard key={`${breakdown.role}-${index}`} breakdown={breakdown} />)}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
            <h3 className="font-bold text-white mb-2">Generic venue/H2H model</h3>
            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">{result.historicalSeries?.narrativeNotes || 'No venue-series information was available.'}</p>
            {result.historicalSeries && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-xs">
                <div className="rounded-lg bg-black/20 p-2"><span className="block text-gray-500">Meetings</span><strong>{result.historicalSeries.meetings ?? 0}</strong></div>
                <div className="rounded-lg bg-black/20 p-2"><span className="block text-gray-500">Home wins</span><strong>{result.historicalSeries.homeWins ?? 0}</strong></div>
                <div className="rounded-lg bg-black/20 p-2"><span className="block text-gray-500">Away wins</span><strong>{result.historicalSeries.awayWins ?? 0}</strong></div>
                <div className="rounded-lg bg-black/20 p-2"><span className="block text-gray-500">Shrunk home rate</span><strong>{result.historicalSeries.recencyWeightedHomePct?.toFixed(1) ?? '—'}%</strong></div>
              </div>
            )}
          </div>

          {result.precedentGames.length === 0 ? (
            <div className="rounded-xl border border-gray-700 bg-gray-800/30 p-5 text-sm text-gray-500">No same-venue direct meetings were found in the available verified history before this game.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-700">
              <table className="w-full min-w-[650px] text-xs text-left">
                <thead className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Away</th>
                    <th className="p-3">Score</th>
                    <th className="p-3">Home</th>
                    <th className="p-3">Winner</th>
                    <th className="p-3">Stadium</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-gray-900/50">
                  {result.precedentGames.map((game, index) => (
                    <tr key={`${game.date}-${index}`}>
                      <td className="p-3 text-gray-400">{game.date}</td>
                      <td className="p-3 text-gray-200">{game.awayTeam}</td>
                      <td className="p-3 font-mono text-white">{game.awayScore}–{game.homeScore}</td>
                      <td className="p-3 text-gray-200">{game.homeTeam}</td>
                      <td className="p-3 text-emerald-300">{game.winnerTeam}</td>
                      <td className="p-3 text-gray-500">{game.stadium || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-gray-600">
        Predictions are model estimates, not guarantees. Model changes should be judged on future/untouched games, not by fitting individual known outcomes.
      </p>
    </section>
  );
};

export default PredictionDisplay;
