import React, { useState } from 'react';
import { PredictionResult, DisplayNumbers, DecisionFactor, HistoricalGame } from '../types';
import CalculationBreakdownCard from './CalculationBreakdownCard';

interface PredictionDisplayProps {
  result: PredictionResult;
}

const StatCard: React.FC<{ title: string; numbers: DisplayNumbers; isWinner?: boolean }> = ({ title, numbers, isWinner }) => (
  <div className={`p-4 rounded-xl border flex-1 transition-all ${isWinner ? 'bg-indigo-950/40 border-indigo-500/40 shadow-md' : 'bg-gray-800/60 border-gray-700/60'}`}>
    <h3 className={`text-base font-bold text-center mb-3 ${isWinner ? 'text-indigo-300' : 'text-gray-300'}`}>{title}</h3>
    <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
      <div className="flex justify-between bg-black/20 p-2 rounded">
        <span className="text-gray-400 font-medium">Year Essence:</span>
        <span className="font-mono font-bold text-white">{numbers.yearEssence}</span>
      </div>
      <div className="flex justify-between bg-black/20 p-2 rounded">
        <span className="text-gray-400 font-medium">Personal Year:</span>
        <span className="font-mono font-bold text-white">{numbers.personalYear}</span>
      </div>
      <div className="flex justify-between bg-black/20 p-2 rounded">
        <span className="text-gray-400 font-medium">Personal Month:</span>
        <span className="font-mono font-bold text-white">{numbers.personalMonth}</span>
      </div>
      <div className="flex justify-between bg-black/20 p-2 rounded">
        <span className="text-gray-400 font-medium">Month Essence:</span>
        <span className="font-mono font-bold text-white">{numbers.personalMonthEssence}</span>
      </div>
      <div className="col-span-2 flex justify-between bg-indigo-900/20 p-2 rounded border border-indigo-500/20">
        <span className="text-indigo-300 font-semibold">Daily Essence:</span>
        <span className="font-mono font-bold text-indigo-200">{numbers.dailyEssence}</span>
      </div>
    </div>
  </div>
);

const PredictionDisplay: React.FC<PredictionDisplayProps> = ({ result }) => {
  const [activeTab, setActiveTab] = useState<'patternStats' | 'decision' | 'precedents' | 'breakdown'>('patternStats');
  const confidenceColor = result.confidence >= 75 ? 'text-emerald-400' : result.confidence >= 62 ? 'text-amber-400' : 'text-orange-400';
  const confidenceBarColor = result.confidence >= 75 ? 'bg-emerald-500' : result.confidence >= 62 ? 'bg-amber-500' : 'bg-orange-500';

  const totalWinDiff = (result.winnerTotalPatternWins ?? 0) - (result.loserTotalPatternWins ?? 0);

  return (
    <div className="bg-gray-900/90 backdrop-blur-md p-5 sm:p-7 rounded-2xl shadow-2xl border border-gray-700/80 mt-8 w-full animate-fade-in">
      {/* Header Matchup Result */}
      <div className="text-center mb-6">
        <span className="inline-block px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-300 bg-indigo-950/80 border border-indigo-700/50 rounded-full mb-2">
          Calculated Historical Prediction • 1,365 NFL Games Database
        </span>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white">Projected Game Outcome</h2>
      </div>
      
      {/* Winner vs Loser Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 items-stretch mb-6">
        <div className="relative overflow-hidden text-center p-6 bg-gradient-to-b from-emerald-950/40 to-gray-900/80 rounded-xl border-2 border-emerald-500/60 shadow-lg shadow-emerald-950/30">
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            {result.isWinnerHome !== undefined && (
              <span className={`px-2 py-0.5 text-xxs font-bold uppercase rounded ${result.isWinnerHome ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40' : 'bg-gray-700/60 text-gray-300'}`}>
                {result.isWinnerHome ? '🏠 Home' : '✈️ Away'}
              </span>
            )}
            <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-emerald-500 text-gray-950 rounded">
              Projected Winner
            </span>
          </div>
          <p className="text-xs uppercase tracking-widest text-emerald-400 font-semibold mb-1">Calculated Advantage</p>
          <p className="text-2xl sm:text-3xl font-black text-white tracking-wide">{result.winner.name}</p>
          
          {result.winnerTotalPatternWins !== undefined && (
            <div className="mt-3 flex justify-center items-center gap-2">
              <span className="bg-emerald-900/40 border border-emerald-500/40 px-3 py-1 rounded-lg text-xs font-mono font-bold text-emerald-300">
                Pattern Record: {result.winnerTotalPatternWins}W - {result.winnerTotalPatternLosses}L ({result.winnerTotalPatternPct}%)
              </span>
            </div>
          )}

          {result.winnerDE && (
            <div className="mt-2 inline-flex items-center gap-2 bg-emerald-900/20 border border-emerald-500/20 px-3 py-0.5 rounded-full text-xs text-emerald-300">
              <span>DE: <strong className="font-mono text-white">{result.winnerDE}</strong></span>
              <span>•</span>
              <span>Day: <strong className="font-mono text-white">{result.winnerDay}</strong></span>
            </div>
          )}
        </div>

        <div className="relative overflow-hidden text-center p-6 bg-gradient-to-b from-rose-950/30 to-gray-900/80 rounded-xl border border-rose-500/40 shadow-lg">
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            {result.isWinnerHome !== undefined && (
              <span className={`px-2 py-0.5 text-xxs font-bold uppercase rounded ${!result.isWinnerHome ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40' : 'bg-gray-700/60 text-gray-300'}`}>
                {!result.isWinnerHome ? '🏠 Home' : '✈️ Away'}
              </span>
            )}
            <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded">
              Opponent
            </span>
          </div>
          <p className="text-xs uppercase tracking-widest text-rose-400 font-semibold mb-1">Projected Deficit</p>
          <p className="text-2xl sm:text-3xl font-bold text-gray-300 tracking-wide">{result.loser.name}</p>

          {result.loserTotalPatternWins !== undefined && (
            <div className="mt-3 flex justify-center items-center gap-2">
              <span className="bg-rose-900/30 border border-rose-500/30 px-3 py-1 rounded-lg text-xs font-mono font-bold text-rose-300">
                Pattern Record: {result.loserTotalPatternWins}W - {result.loserTotalPatternLosses}L ({result.loserTotalPatternPct}%)
              </span>
            </div>
          )}

          {result.loserDE && (
            <div className="mt-2 inline-flex items-center gap-2 bg-rose-900/20 border border-rose-500/20 px-3 py-0.5 rounded-full text-xs text-rose-300">
              <span>DE: <strong className="font-mono text-white">{result.loserDE}</strong></span>
              <span>•</span>
              <span>Day: <strong className="font-mono text-white">{result.loserDay}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Confidence Meter */}
      <div className="bg-gray-800/60 p-4 sm:p-5 rounded-xl border border-gray-700/60 mb-6 text-center">
        <div className="flex justify-between items-center max-w-md mx-auto mb-2 text-sm">
          <span className="text-gray-400 font-medium">Confidence Rating</span>
          <span className={`text-2xl sm:text-3xl font-black ${confidenceColor}`}>{result.confidence.toFixed(1)}%</span>
        </div>
        <div className="w-full max-w-md mx-auto h-2.5 bg-gray-700 rounded-full overflow-hidden">
          <div 
            className={`h-full ${confidenceBarColor} transition-all duration-700 rounded-full`}
            style={{ width: `${result.confidence}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Calibrated across 1,365 documented historical games, personnel Daily Essence records, and collective pattern totals.
        </p>
      </div>

      {/* Summary Reasoning Quote */}
      <div className="bg-indigo-950/30 p-4 rounded-xl border border-indigo-500/30 mb-6">
        <p className="text-center text-sm sm:text-base text-indigo-200 leading-relaxed font-medium">
          "{result.reasoning}"
        </p>
      </div>

      {/* Chaos / Script Upset Risk Alert (When 4 or 7 vibration is active) */}
      {result.isChaosDay && (
        <div className="bg-purple-950/40 p-4 rounded-xl border border-purple-500/50 mb-6 shadow-lg shadow-purple-950/30">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="text-xs sm:text-sm text-gray-200 leading-relaxed">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h4 className="font-bold text-purple-300 text-sm">
                  High Volatility / "Script Reversal" Alert
                </h4>
                {result.chaosType && (
                  <span className="px-2 py-0.5 bg-purple-500/30 text-purple-200 border border-purple-400/40 rounded text-xxs font-bold uppercase">
                    {result.chaosType}
                  </span>
                )}
              </div>
              <p className="text-gray-300">
                {result.chaosWarning}
              </p>
              <p className="mt-2 text-purple-200 text-xs font-medium">
                🎯 <strong>Why Games Feel "Rigged":</strong> In sports numerology and narrative script analysis, games played on 4 or 7 vibrations consistently produce "trap results." Mathematical favorites frequently drop these games due to bizarre penalty flags, freak turnovers, or missed kicks that appear scripted against the expected outcome.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Key Root Cause & Analysis Banner */}
      <div className="bg-amber-950/20 p-4 rounded-xl border border-amber-500/30 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-xl">💡</span>
          <div className="text-xs sm:text-sm text-gray-300 leading-relaxed">
            <h4 className="font-bold text-amber-300 text-sm mb-1">
              Pattern Numbers Total Wins & Losses Analysis
            </h4>
            <p>
              Looking at the <strong className="text-white">total wins and losses associated with each pattern number across all 1,365 documented NFL games</strong> (rather than isolated franchise records) reveals the true structural advantage.
              {result.winnerCoachDEStats && result.loserCoachDEStats && (
                <span>
                  {' '}The winner's Head Coach Daily Essence ({result.winnerCoachDE}) holds a <strong className="text-emerald-400 font-mono">{result.winnerCoachDEStats.wins}W - {result.winnerCoachDEStats.losses}L ({result.winnerCoachDEStats.winPct}%)</strong> league-wide record, outperforming the opponent's Coach DE ({result.loserCoachDE}) at <strong className="text-rose-400 font-mono">{result.loserCoachDEStats.wins}W - {result.loserCoachDEStats.losses}L ({result.loserCoachDEStats.winPct}%)</strong>.
                </span>
              )}
              {totalWinDiff !== 0 && (
                <span>
                  {' '}Across all game pattern numbers combined, {result.winner.name} holds a <strong className="text-emerald-400">+{totalWinDiff > 0 ? totalWinDiff : Math.abs(totalWinDiff)} historical win margin</strong>.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Basic Display Numbers Cards */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <StatCard title={`${result.winner.name} Numerology Stats`} numbers={result.winnerStats} isWinner />
        <StatCard title={`${result.loser.name} Numerology Stats`} numbers={result.loserStats} />
      </div>

      {/* Navigation Tabs for Deep Dive Sections */}
      <div className="flex border-b border-gray-700/80 mb-6 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('patternStats')}
          className={`py-2 px-4 text-xs sm:text-sm font-bold border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'patternStats'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Total Pattern Wins & Losses
        </button>
        <button
          onClick={() => setActiveTab('decision')}
          className={`py-2 px-4 text-xs sm:text-sm font-bold border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'decision'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Calculated Decision Factors ({result.decisionFactors?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('precedents')}
          className={`py-2 px-4 text-xs sm:text-sm font-bold border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'precedents'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Historical Precedent Games ({result.precedentGames?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('breakdown')}
          className={`py-2 px-4 text-xs sm:text-sm font-bold border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'breakdown'
              ? 'border-indigo-500 text-indigo-300'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Personnel Numerology Breakdown
        </button>
      </div>

      {/* Tab 1: Total Pattern Wins & Losses Matrix */}
      {activeTab === 'patternStats' && (
        <div className="space-y-4 animate-fade-in">
          {/* Detailed Matrix Table */}
          <div className="bg-gray-800/50 p-4 sm:p-5 rounded-xl border border-gray-700/60">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
              <h4 className="text-sm sm:text-base font-bold text-white">
                League-Wide Total Wins & Losses by Pattern Number (1,365 Documented NFL Games)
              </h4>
              <span className="text-xs text-gray-400">
                Normalized Variant Matching
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <th className="py-2.5 px-3">Pattern Category</th>
                    <th className="py-2.5 px-3 text-emerald-400 font-semibold">{result.winner.name} (Winner)</th>
                    <th className="py-2.5 px-3 text-rose-400 font-semibold">{result.loser.name} (Loser)</th>
                    <th className="py-2.5 px-3 text-right">Advantage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {/* Team Daily Essence */}
                  {result.winnerDEStats && result.loserDEStats && (
                    <tr>
                      <td className="py-3 px-3 font-medium text-gray-300">
                        <div className="font-semibold text-white">Team Daily Essence</div>
                        <div className="text-xxs text-gray-400">Daily essence of the franchise</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.winnerDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.winnerDEStats.wins}W - {result.winnerDEStats.losses}L ({result.winnerDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.loserDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.loserDEStats.wins}W - {result.loserDEStats.losses}L ({result.loserDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          result.winnerDEStats.winPct >= result.loserDEStats.winPct 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {result.winnerDEStats.winPct >= result.loserDEStats.winPct ? `+${(result.winnerDEStats.winPct - result.loserDEStats.winPct).toFixed(1)}%` : `-${(result.loserDEStats.winPct - result.winnerDEStats.winPct).toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Coach Daily Essence */}
                  {result.winnerCoachDEStats && result.loserCoachDEStats && (
                    <tr className="bg-indigo-950/15">
                      <td className="py-3 px-3 font-medium text-gray-300">
                        <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                          Head Coach Daily Essence
                          <span className="text-xxs px-1.5 py-0.2 bg-indigo-500/30 text-indigo-200 rounded">Key Factor</span>
                        </div>
                        <div className="text-xxs text-gray-400">Tactical decision-maker daily rhythm</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.winnerCoachDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.winnerCoachDEStats.wins}W - {result.winnerCoachDEStats.losses}L ({result.winnerCoachDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.loserCoachDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.loserCoachDEStats.wins}W - {result.loserCoachDEStats.losses}L ({result.loserCoachDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          result.winnerCoachDEStats.winPct >= result.loserCoachDEStats.winPct 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {result.winnerCoachDEStats.winPct >= result.loserCoachDEStats.winPct 
                            ? `+${(result.winnerCoachDEStats.winPct - result.loserCoachDEStats.winPct).toFixed(1)}%` 
                            : `-${(result.loserCoachDEStats.winPct - result.winnerCoachDEStats.winPct).toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* QB Daily Essence */}
                  {result.winnerQbDEStats && result.loserQbDEStats && (
                    <tr>
                      <td className="py-3 px-3 font-medium text-gray-300">
                        <div className="font-semibold text-white">Starting QB Daily Essence</div>
                        <div className="text-xxs text-gray-400">On-field field general daily essence</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.winnerQbDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.winnerQbDEStats.wins}W - {result.winnerQbDEStats.losses}L ({result.winnerQbDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.loserQbDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.loserQbDEStats.wins}W - {result.loserQbDEStats.losses}L ({result.loserQbDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          result.winnerQbDEStats.winPct >= result.loserQbDEStats.winPct 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {result.winnerQbDEStats.winPct >= result.loserQbDEStats.winPct 
                            ? `+${(result.winnerQbDEStats.winPct - result.loserQbDEStats.winPct).toFixed(1)}%` 
                            : `-${(result.loserQbDEStats.winPct - result.winnerQbDEStats.winPct).toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Franchise Owner Daily Essence */}
                  {result.winnerOwnerDEStats && result.loserOwnerDEStats && (
                    <tr className="bg-indigo-950/10">
                      <td className="py-3 px-3 font-medium text-gray-300">
                        <div className="font-semibold text-indigo-200">Franchise Owner Daily Essence</div>
                        <div className="text-xxs text-gray-400">Top-of-pyramid organizational resonance</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.winnerOwnerDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.winnerOwnerDEStats.wins}W - {result.winnerOwnerDEStats.losses}L ({result.winnerOwnerDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.loserOwnerDE}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.loserOwnerDEStats.wins}W - {result.loserOwnerDEStats.losses}L ({result.loserOwnerDEStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          result.winnerOwnerDEStats.winPct >= result.loserOwnerDEStats.winPct 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {result.winnerOwnerDEStats.winPct >= result.loserOwnerDEStats.winPct 
                            ? `+${(result.winnerOwnerDEStats.winPct - result.loserOwnerDEStats.winPct).toFixed(1)}%` 
                            : `-${(result.loserOwnerDEStats.winPct - result.winnerOwnerDEStats.winPct).toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Day Number */}
                  {result.winnerDayStats && result.loserDayStats && (
                    <tr>
                      <td className="py-3 px-3 font-medium text-gray-300">
                        <div className="font-semibold text-white">Game Day Number</div>
                        <div className="text-xxs text-gray-400">Calendar resonance of the matchup day</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.winnerDay}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.winnerDayStats.wins}W - {result.winnerDayStats.losses}L ({result.winnerDayStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">{result.loserDay}</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.loserDayStats.wins}W - {result.loserDayStats.losses}L ({result.loserDayStats.winPct}%)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          result.winnerDayStats.wins >= result.loserDayStats.wins
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {result.winnerDayStats.wins >= result.loserDayStats.wins ? `+${result.winnerDayStats.wins - result.loserDayStats.wins} wins` : `-${result.loserDayStats.wins - result.winnerDayStats.wins} wins`}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* DE | Day Combo Wins */}
                  {result.winnerComboWins !== undefined && result.loserComboWins !== undefined && (
                    <tr>
                      <td className="py-3 px-3 font-medium text-gray-300">
                        <div className="font-semibold text-white">DE | Day Combo Frequency</div>
                        <div className="text-xxs text-gray-400">Historical synergy of DE paired with Day</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">[{result.winnerDE} | {result.winnerDay}]</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.winnerComboWins} Historical Wins
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-white text-sm">[{result.loserDE} | {result.loserDay}]</span>
                        <div className="text-xs text-gray-300 font-mono mt-0.5">
                          {result.loserComboWins} Historical Wins
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          result.winnerComboWins >= result.loserComboWins
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {result.winnerComboWins >= result.loserComboWins ? `+${result.winnerComboWins - result.loserComboWins} wins` : `-${result.loserComboWins - result.winnerComboWins} wins`}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* All Pattern Numbers Combined Total */}
                  {result.winnerTotalPatternWins !== undefined && result.loserTotalPatternWins !== undefined && (
                    <tr className="bg-gray-700/40 border-t-2 border-indigo-500/50">
                      <td className="py-3.5 px-3 font-bold text-white">
                        <div className="text-indigo-300">Total Pattern Numbers Record</div>
                        <div className="text-xxs text-gray-400">Sum of Team, Coach, QB & Day League History</div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-mono font-black text-emerald-400 text-sm sm:text-base">
                          {result.winnerTotalPatternWins}W - {result.winnerTotalPatternLosses}L
                        </div>
                        <div className="text-xs font-bold text-emerald-300">
                          {result.winnerTotalPatternPct}% Win Rate
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-mono font-black text-rose-400 text-sm sm:text-base">
                          {result.loserTotalPatternWins}W - {result.loserTotalPatternLosses}L
                        </div>
                        <div className="text-xs font-bold text-rose-300">
                          {result.loserTotalPatternPct}% Win Rate
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <span className="inline-block px-2.5 py-1 rounded text-xs font-black bg-emerald-500/30 text-emerald-200 border border-emerald-500/50">
                          +{totalWinDiff > 0 ? totalWinDiff : 0} Total Wins
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Calculated Decision Factors */}
      {activeTab === 'decision' && (
        <div className="space-y-3 animate-fade-in">
          {result.decisionFactors && result.decisionFactors.length > 0 ? (
            result.decisionFactors.map((factor, index) => (
              <div 
                key={index}
                className="bg-gray-800/60 p-4 rounded-xl border border-gray-700/60 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-gray-400">0{index + 1}.</span>
                    <h5 className="text-sm sm:text-base font-bold text-white">{factor.title}</h5>
                  </div>
                  <p className="text-xs sm:text-sm text-gray-300 leading-normal">{factor.description}</p>
                </div>
                <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${
                    factor.advantage === 'winner' 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                      : factor.advantage === 'loser'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-gray-700 text-gray-300'
                  }`}>
                    {factor.advantage === 'winner' ? 'FAVORS WINNER' : factor.advantage === 'loser' ? 'FAVORS LOSER' : 'NEUTRAL'}
                  </span>
                  {factor.edgeScore > 0 && (
                    <span className="text-xs font-mono text-gray-400">
                      Edge: +{factor.edgeScore}
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-gray-400 text-center py-4">No specific decision factors recorded.</p>
          )}
        </div>
      )}

      {/* Tab 3: Precedent Games from the Database */}
      {activeTab === 'precedents' && (
        <div className="space-y-3 animate-fade-in">
          <p className="text-xs text-gray-400 mb-2">
            Historical games from our verified 1,365-game NFL database featuring matching pattern profiles or franchise matchups:
          </p>
          {result.precedentGames && result.precedentGames.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {result.precedentGames.map((game, idx) => (
                <div 
                  key={idx}
                  className="bg-gray-800/60 p-3.5 rounded-xl border border-gray-700/60 text-xs flex flex-col justify-between"
                >
                  <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-gray-700/50">
                    <span className="text-indigo-400 font-bold">{game.date} (Season {game.season})</span>
                    <span className="text-gray-400 font-mono text-xxs bg-gray-900 px-2 py-0.5 rounded">
                      {game.winnerHomeAway} Win
                    </span>
                  </div>
                  <div className="space-y-1 my-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-emerald-300">{game.winnerTeam}</span>
                      <span className="font-mono font-bold text-white text-sm">{game.homeTeam === game.winnerTeam ? game.homeScore : game.awayScore}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-400">
                      <span>{game.loserTeam}</span>
                      <span className="font-mono text-gray-300">{game.homeTeam === game.loserTeam ? game.homeScore : game.awayScore}</span>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-700/40 flex justify-between text-xxs text-gray-400 font-mono">
                    <span>Winner [DE: {game.winnerDE} | Day: {game.winnerDay}]</span>
                    <span>Loser [DE: {game.loserDE} | Day: {game.loserDay}]</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-6">No matching precedent games found in database for these specific pattern sets.</p>
          )}
        </div>
      )}

      {/* Tab 4: Detailed Personnel Calculation Breakdown */}
      {activeTab === 'breakdown' && (
        <div className="animate-fade-in mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-bold text-center text-emerald-300 mb-4 pb-2 border-b border-emerald-500/30">
                {result.winner.name} Personnel Patterns
              </h3>
              {result.winnerBreakdown.map(bd => (
                <CalculationBreakdownCard key={`${result.winner.name}-${bd.role}`} breakdown={bd} />
              ))}
            </div>
            <div>
              <h3 className="text-lg font-bold text-center text-gray-300 mb-4 pb-2 border-b border-gray-700">
                {result.loser.name} Personnel Patterns
              </h3>
              {result.loserBreakdown.map(bd => (
                <CalculationBreakdownCard key={`${result.loser.name}-${bd.role}`} breakdown={bd} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PredictionDisplay;
