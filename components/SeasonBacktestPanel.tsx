import React, { useMemo, useState } from 'react';
import { parseTeamData, predictWinner } from '../services/validatedPredictionService';
import { getRegularSeasonWeek, ScheduledGame } from '../services/scheduleService';
import { getMarketAwarePrediction } from '../services/marketAwareService';
import { Team } from '../types';

type WeeklySummary = {
  week: number;
  games: number;
  pureCorrect: number;
  marketCovered: number;
  pureOnMarketCorrect: number;
  marketCorrect: number;
};

type SeasonSummary = {
  season: number;
  games: number;
  pureCorrect: number;
  marketCovered: number;
  pureOnMarketCorrect: number;
  marketCorrect: number;
  errors: number;
  weeks: WeeklySummary[];
};

const currentNflSeason = () => {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() + 1 <= 2 ? year - 1 : year;
};

const actualWinner = (game: ScheduledGame): string | null => {
  if (!game.completed || !Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) return null;
  if (game.homeScore === game.awayScore) return null;
  return game.homeScore! > game.awayScore! ? game.homeTeam : game.awayTeam;
};

const pct = (correct: number, total: number) => total ? `${((correct / total) * 100).toFixed(2)}%` : 'N/A';

const SeasonBacktestPanel: React.FC = () => {
  const [season, setSeason] = useState(currentNflSeason());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<SeasonSummary | null>(null);
  const [error, setError] = useState('');

  const teams = useMemo<Team[]>(() => {
    try {
      return parseTeamData();
    } catch {
      return [];
    }
  }, []);
  const teamByAbbr = useMemo(() => new Map(teams.map(team => [team.abbr, team])), [teams]);

  const runSeason = async () => {
    if (loading || !season) return;
    setLoading(true);
    setError('');
    setSummary(null);
    setProgress({ done: 0, total: 0 });

    try {
      const weeks = await Promise.all(
        Array.from({ length: 18 }, (_, index) => getRegularSeasonWeek(Number(season), index + 1))
      );
      const byId = new Map<string, ScheduledGame>();
      weeks.flat().forEach(game => byId.set(game.gameId, game));
      const games = [...byId.values()]
        .filter(game => actualWinner(game))
        .sort((a, b) => a.week - b.week || a.gameday.localeCompare(b.gameday) || a.gameId.localeCompare(b.gameId));

      if (!games.length) {
        throw new Error(`No completed, non-tied regular-season games are available for ${season}.`);
      }
      if (!teams.length) throw new Error('Team registry could not be loaded.');

      setProgress({ done: 0, total: games.length });

      const weekly = new Map<number, WeeklySummary>();
      let pureCorrect = 0;
      let marketCovered = 0;
      let pureOnMarketCorrect = 0;
      let marketCorrect = 0;
      let errors = 0;
      let done = 0;
      const concurrency = 4;

      for (let i = 0; i < games.length; i += concurrency) {
        const chunk = games.slice(i, i + concurrency);
        const rows = await Promise.all(chunk.map(async game => {
          const home = teamByAbbr.get(game.homeTeam);
          const away = teamByAbbr.get(game.awayTeam);
          const actual = actualWinner(game);
          if (!home || !away || !actual) return { game, error: true } as const;

          try {
            const pure = await predictWinner(
              home,
              away,
              new Date(`${game.gameday}T12:00:00Z`),
              true,
              { neutralSite: game.neutralSite }
            );
            let market = null;
            try {
              market = await getMarketAwarePrediction(game, pure);
            } catch (marketError) {
              console.warn('Season backtest market shadow unavailable for', game.gameId, marketError);
            }
            return { game, actual, pure, market, error: false } as const;
          } catch (predictionError) {
            console.error('Season backtest prediction failed for', game.gameId, predictionError);
            return { game, error: true } as const;
          }
        }));

        for (const row of rows) {
          const weekSummary = weekly.get(row.game.week) || {
            week: row.game.week,
            games: 0,
            pureCorrect: 0,
            marketCovered: 0,
            pureOnMarketCorrect: 0,
            marketCorrect: 0,
          };

          if (row.error || !('pure' in row) || !('actual' in row)) {
            errors++;
            weekly.set(row.game.week, weekSummary);
            continue;
          }

          weekSummary.games++;
          const pureWasCorrect = row.pure.winner.abbr === row.actual;
          if (pureWasCorrect) {
            pureCorrect++;
            weekSummary.pureCorrect++;
          }

          if (row.market) {
            marketCovered++;
            weekSummary.marketCovered++;
            if (pureWasCorrect) {
              pureOnMarketCorrect++;
              weekSummary.pureOnMarketCorrect++;
            }
            if (row.market.winnerAbbr === row.actual) {
              marketCorrect++;
              weekSummary.marketCorrect++;
            }
          }
          weekly.set(row.game.week, weekSummary);
        }

        done += chunk.length;
        setProgress({ done, total: games.length });
      }

      setSummary({
        season: Number(season),
        games: games.length - errors,
        pureCorrect,
        marketCovered,
        pureOnMarketCorrect,
        marketCorrect,
        errors,
        weeks: [...weekly.values()].filter(item => item.games > 0).sort((a, b) => a.week - b.week),
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Full-season backtest failed.');
    } finally {
      setLoading(false);
    }
  };

  const fairWinner = summary && summary.marketCovered > 0
    ? summary.marketCorrect > summary.pureOnMarketCorrect
      ? 'Market Shadow'
      : summary.marketCorrect < summary.pureOnMarketCorrect
        ? 'Pure Forecast'
        : 'Tie'
    : null;

  return (
    <section className="bg-gray-950 bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950/70 text-white px-4 sm:px-6 lg:px-8 pt-6">
      <div className="w-full max-w-6xl mx-auto rounded-2xl border border-amber-500/25 bg-gray-900/85 p-5 sm:p-7 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] font-bold text-amber-300">Full Season Backtest</p>
            <h2 className="mt-1 text-2xl font-black text-white">Pure Forecast vs Market Shadow</h2>
            <p className="mt-1 max-w-3xl text-sm text-gray-400">Choose any NFL season and score every completed regular-season game. This runner calls the existing prediction formulas exactly as they are; it does not change model weights or calculations.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">NFL season</span>
              <input
                aria-label="Full season to backtest"
                type="number"
                min="1999"
                max="2100"
                value={season}
                onChange={event => setSeason(Number(event.target.value))}
                disabled={loading}
                className="w-full sm:w-32 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white disabled:opacity-50"
              />
            </label>
            <button
              onClick={runSeason}
              disabled={loading || !teams.length}
              className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-amber-950/60 disabled:cursor-not-allowed px-5 py-2.5 text-sm font-black text-white transition-colors"
            >
              {loading ? `Predicting ${progress.done}/${progress.total || '…'}` : 'Predict Full Season'}
            </button>
          </div>
        </div>

        {loading && progress.total > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
              <span>Scoring completed games chronologically</span>
              <span>{Math.round((progress.done / progress.total) * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-800">
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{error}</div>}

        {summary && !loading && (
          <div className="mt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">Pure Forecast · v2.2</p>
                <p className="mt-1 text-3xl font-black">{pct(summary.pureCorrect, summary.games)}</p>
                <p className="mt-1 text-xs text-gray-500">{summary.pureCorrect}/{summary.games} completed non-tied games</p>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Market Shadow · EXP-019</p>
                <p className="mt-1 text-3xl font-black">{pct(summary.marketCorrect, summary.marketCovered)}</p>
                <p className="mt-1 text-xs text-gray-500">{summary.marketCorrect}/{summary.marketCovered} games with two-sided moneylines</p>
              </div>
              <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300">Pure on Same Market Games</p>
                <p className="mt-1 text-3xl font-black">{pct(summary.pureOnMarketCorrect, summary.marketCovered)}</p>
                <p className="mt-1 text-xs text-gray-500">Apples-to-apples denominator: {summary.marketCovered}</p>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Same-Game Comparison</p>
                <p className="mt-1 text-2xl font-black">{fairWinner || 'No market coverage'}</p>
                <p className="mt-1 text-xs text-gray-500">Market coverage: {summary.marketCovered}/{summary.games} ({summary.games ? ((summary.marketCovered / summary.games) * 100).toFixed(1) : '0.0'}%)</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-700 bg-black/20 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Week-by-week audit · {summary.season}</p>
                <p className="mt-1 text-[11px] text-gray-600">Market comparison uses the same market-covered games for both models so missing historical moneylines cannot make one model look artificially better.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-gray-950/70 text-[10px] uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Week</th>
                      <th className="px-4 py-2 text-right">Games</th>
                      <th className="px-4 py-2 text-right">Pure overall</th>
                      <th className="px-4 py-2 text-right">Market coverage</th>
                      <th className="px-4 py-2 text-right">Pure same games</th>
                      <th className="px-4 py-2 text-right">Market shadow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.weeks.map(item => (
                      <tr key={item.week} className="border-t border-gray-800/80">
                        <td className="px-4 py-2 font-bold text-white">{item.week}</td>
                        <td className="px-4 py-2 text-right text-gray-400">{item.games}</td>
                        <td className="px-4 py-2 text-right text-indigo-300">{pct(item.pureCorrect, item.games)}</td>
                        <td className="px-4 py-2 text-right text-gray-400">{item.marketCovered}</td>
                        <td className="px-4 py-2 text-right text-sky-300">{pct(item.pureOnMarketCorrect, item.marketCovered)}</td>
                        <td className="px-4 py-2 text-right text-amber-300">{pct(item.marketCorrect, item.marketCovered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-gray-600">Regular season only. Ties and unfinished games are excluded from accuracy. {summary.errors > 0 ? `${summary.errors} game(s) could not be scored and were excluded.` : 'Every eligible game was scored successfully.'}</p>
          </div>
        )}
      </div>
    </section>
  );
};

export default SeasonBacktestPanel;
