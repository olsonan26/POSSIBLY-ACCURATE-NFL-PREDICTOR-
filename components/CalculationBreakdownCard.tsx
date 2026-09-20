import React from 'react';
import { Breakdown } from '../types';

interface CalculationBreakdownCardProps {
  breakdown: Breakdown;
}

const CalculationBreakdownCard: React.FC<CalculationBreakdownCardProps> = ({ breakdown }) => {
  const { role, name, patterns, deStats, includedInScore, source } = breakdown;
  const dailyEnvironment = patterns.dailyEnvironmentFull || patterns.dayNum;
  const fullSignature = `${patterns.dailyEssenceFull} over ${dailyEnvironment}`;
  const finalPatternString = [
    patterns.yrPersonalEss.split('/').pop(),
    patterns.py.split('/').pop() || '0',
    patterns.pm.split('/').pop(),
    patterns.pme.split('/').pop(),
    patterns.monCombiner.split('/').pop(),
    patterns.yearCom.split('/').pop(),
    dailyEnvironment.split('/').pop(),
    patterns.dailyEssenceFull.split('/').pop()
  ].join(' • ');

  return (
    <div className="bg-gray-800/70 p-4 rounded-xl border border-gray-700 mb-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-md font-bold text-indigo-300">{role}</h4>
            <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${includedInScore ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300' : 'bg-gray-900 border-gray-600 text-gray-400'}`}>
              {includedInScore ? 'Scoring input' : 'Research only'}
            </span>
          </div>
          <p className="text-sm text-gray-300 mt-1">{name}</p>
          {source && <p className="text-[11px] text-gray-500 mt-1">Source: {source}</p>}
        </div>

        {deStats && (
          <div className="text-left sm:text-right text-xs">
            <p className="text-gray-400">Verified pregame DE history</p>
            <p className="font-mono font-bold text-white">
              {deStats.wins}W - {deStats.losses}L
            </p>
            <p className="text-gray-400">
              Raw {deStats.winPct.toFixed(1)}% · Smoothed {(deStats.smoothedWinPct ?? deStats.winPct).toFixed(1)}%
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/15 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] uppercase tracking-wider font-bold text-amber-300">Provisional Daily Lettrology Signature</p>
          <span className="rounded-full border border-amber-500/30 px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-200">Formula confirmation pending</span>
        </div>
        <p className="mt-1 text-lg font-mono font-black text-amber-200">{fullSignature}</p>
        <p className="mt-1 text-[11px] text-gray-500">Candidate definition: Daily ESS over Daily Environment. Research only; never used in the production winner.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-xs">
        {[
          ['Yr Personal ESS', patterns.yrPersonalEss],
          ['Personal Year', patterns.py],
          ['Personal Month', patterns.pm],
          ['Month Essence (PME)', patterns.pme],
          ['Daily Environment', dailyEnvironment],
          ['Daily Essence', patterns.dailyEssenceFull],
          ['Calendar Day', patterns.dayNum],
          ['Mon Combiner', patterns.monCombiner],
          ['Year COM', patterns.yearCom]
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-black/20 p-2 border border-gray-800">
            <span className="font-semibold text-gray-500 block">{label}</span>
            <span className="font-mono text-gray-200">{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-700">
        <p className="text-xs text-gray-500 font-semibold">Pattern Trail (Tail Digits)</p>
        <p className="text-sm font-mono text-amber-400 tracking-wider">{finalPatternString}</p>
      </div>
    </div>
  );
};

export default CalculationBreakdownCard;
