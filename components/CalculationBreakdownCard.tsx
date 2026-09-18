import React from 'react';
import { Breakdown } from '../types';

interface CalculationBreakdownCardProps {
  breakdown: Breakdown;
}

const CalculationBreakdownCard: React.FC<CalculationBreakdownCardProps> = ({ breakdown }) => {
    const { role, name, patterns, evalResult, deStats } = breakdown;
    
     const finalPatternString = [
        patterns.yrPersonalEss.split('/').pop(),
        patterns.py.split('/').pop() || '0',
        patterns.pm.split('/').pop(),
        patterns.pme.split('/').pop(),
        patterns.monCombiner.split('/').pop(),
        patterns.yearCom.split('/').pop(),
        patterns.dayNum.split('/').pop(),
        patterns.dailyEssenceFull.split('/').pop(),
    ].join(' • ');


    return (
        <div className="bg-gray-800/70 p-4 rounded-lg border border-gray-700 mb-4">
            <div className="flex justify-between items-start">
                <div>
                    <h4 className="text-md font-bold text-indigo-300">{role}</h4>
                    <p className="text-sm text-gray-400 mb-2">{name}</p>
                </div>
                <div className="text-right text-xs">
                    {deStats && (
                        <div className="mb-1">
                            <span className="text-gray-400">Total DE Record: </span>
                            <span className={`font-mono font-bold ${deStats.winPct >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {deStats.wins}W - {deStats.losses}L ({deStats.winPct}%)
                            </span>
                        </div>
                    )}
                    {evalResult && (
                        <>
                            <p className="text-gray-400 font-semibold">Exact 8-Pattern: <span className="font-mono text-white">{evalResult.exact.wins}W - {evalResult.exact.losses}L</span></p>
                            <p className="text-gray-400 font-semibold">Subset 5-Pattern: <span className="font-mono text-white">{evalResult.subset.wins}W - {evalResult.subset.losses}L</span></p>
                        </>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                    <span className="font-semibold text-gray-500 block">Yr Personal ESS</span>
                    <span className="font-mono">{patterns.yrPersonalEss}</span>
                </div>
                <div>
                    <span className="font-semibold text-gray-500 block">Personal Year</span>
                    <span className="font-mono">{patterns.py || 'N/A'}</span>
                </div>
                <div>
                    <span className="font-semibold text-gray-500 block">Personal Month</span>
                    <span className="font-mono">{patterns.pm}</span>
                </div>
                <div>
                    <span className="font-semibold text-gray-500 block">Month Essence</span>
                    <span className="font-mono">{patterns.pme}</span>
                </div>
                 <div>
                    <span className="font-semibold text-gray-500 block">Daily Essence</span>
                    <span className="font-mono font-bold text-white">{patterns.dailyEssenceFull}</span>
                    {deStats && (
                        <span className={`block font-mono text-xxs font-semibold ${deStats.winPct >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            League: {deStats.wins}W - {deStats.losses}L ({deStats.winPct}%)
                        </span>
                    )}
                </div>
                <div>
                    <span className="font-semibold text-gray-500 block">Day Number</span>
                    <span className="font-mono">{patterns.dayNum}</span>
                </div>
                <div>
                    <span className="font-semibold text-gray-500 block">Mon Combiner</span>
                    <span className="font-mono">{patterns.monCombiner}</span>
                </div>
                <div>
                    <span className="font-semibold text-gray-500 block">Year COM</span>
                    <span className="font-mono">{patterns.yearCom}</span>
                </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-700">
                <p className="text-xs text-gray-500 font-semibold">Final Pattern (Tail Digits)</p>
                <p className="text-sm font-mono text-amber-400 tracking-wider">{finalPatternString}</p>
            </div>
        </div>
    );
}

export default CalculationBreakdownCard;