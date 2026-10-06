import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { PredictionResult, Team } from './types';
import { parseTeamData, predictWinner } from './services/validatedPredictionService';
import { getGamesForDate, getRegularSeasonWeek, ScheduledGame } from './services/scheduleService';
import { getMarketAwarePrediction, MarketAwarePrediction } from './services/marketAwareService';
import { createLedgerRunId, freezePredictionToServer, LedgerCaptureStatus, recordPredictionOutcomeToServer } from './services/serverPredictionLedger';
import TeamSelector from './components/TeamSelector';
import DatePicker from './components/DatePicker';
import PredictionDisplay from './components/PredictionDisplay';
import PostgameLearningPanel from './components/PostgameLearningPanel';
import DeepSeekPregamePanel from './components/DeepSeekPregamePanel';
import Button from './components/Button';

interface BatchPredictionRow {
  game: ScheduledGame;
  result?: PredictionResult;
  marketAware?: MarketAwarePrediction;
  ledger?: LedgerCaptureStatus;
  error?: string;
}

const localDateIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const estimatedSeason = () => {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() + 1 <= 2 ? year - 1 : year;
};

const actualWinnerAbbr = (game: ScheduledGame): string | null => {
  if (!game.completed || !Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) return null;
  if (game.homeScore! === game.awayScore!) return 'TIE';
  return game.homeScore! > game.awayScore! ? game.homeTeam : game.awayTeam;
};

const moneyline = (value: number) => value > 0 ? `+${value}` : String(value);

const homeProbabilityDecimal = (result: PredictionResult, homeAbbr: string): number => {
  const finalHome = result.modelScores?.finalHomeProbability;
  if (Number.isFinite(finalHome)) return Math.max(0.001, Math.min(0.999, Number(finalHome) / 100));
  const pct = result.winner.abbr === homeAbbr ? result.confidence : 100 - result.confidence;
  return Math.max(0.001, Math.min(0.999, pct / 100));
};

const App: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [gameDate, setGameDate] = useState(localDateIso());
  const [neutralSite, setNeutralSite] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [marketPrediction, setMarketPrediction] = useState<MarketAwarePrediction | null>(null);
  const [manualLedger, setManualLedger] = useState<LedgerCaptureStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [scheduleDate, setScheduleDate] = useState(localDateIso());
  const [season, setSeason] = useState(estimatedSeason());
  const [week, setWeek] = useState(1);
  const [scheduleGames, setScheduleGames] = useState<ScheduledGame[]>([]);
  const [scheduleLabel, setScheduleLabel] = useState('');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [batchRows, setBatchRows] = useState<BatchPredictionRow[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchCompleted, setBatchCompleted] = useState(0);
  const [selectedBatchPrediction, setSelectedBatchPrediction] = useState<PredictionResult | null>(null);

  useEffect(() => {
    try {
      setTeams(parseTeamData());
    } catch (err) {
      setError('Failed to load team registry.');
      console.error(err);
    }
  }, []);

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const teamByAbbr = useMemo(() => new Map(teams.map(team => [team.abbr, team])), [teams]);

  const historicalBatch = useMemo(
    () => batchRows.filter(row => row.result && actualWinnerAbbr(row.game) && actualWinnerAbbr(row.game) !== 'TIE'),
    [batchRows]
  );

  const historicalCorrect = useMemo(
    () => historicalBatch.filter(row => row.result?.winner.abbr === actualWinnerAbbr(row.game)).length,
    [historicalBatch]
  );
  const historicalIncorrect = historicalBatch.length - historicalCorrect;

  const historicalMarketBatch = useMemo(
    () => batchRows.filter(row => row.marketAware && actualWinnerAbbr(row.game) && actualWinnerAbbr(row.game) !== 'TIE'),
    [batchRows]
  );
  const historicalMarketCorrect = useMemo(
    () => historicalMarketBatch.filter(row => row.marketAware?.winnerAbbr === actualWinnerAbbr(row.game)).length,
    [historicalMarketBatch]
  );

  const resetScheduleResults = () => {
    setBatchRows([]);
    setBatchCompleted(0);
    setSelectedBatchPrediction(null);
  };

  const loadGamesByDate = async (dateIso: string, label?: string) => {
    if (!dateIso) return;
    setScheduleError('');
    setScheduleLoading(true);
    resetScheduleResults();
    try {
      const games = await getGamesForDate(dateIso);
      setScheduleGames(games);
      setScheduleLabel(label || dateIso);
      if (!games.length) setScheduleError(`No NFL games were found for ${dateIso}.`);
    } catch (err) {
      console.error(err);
      setScheduleGames([]);
      setScheduleError(err instanceof Error ? err.message : 'Could not load the NFL schedule.');
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleToday = async () => {
    const today = localDateIso();
    setScheduleDate(today);
    await loadGamesByDate(today, "Today's games");
  };

  const handleLoadWeek = async () => {
    if (!season || !week) return;
    setScheduleError('');
    setScheduleLoading(true);
    resetScheduleResults();
    try {
      const games = await getRegularSeasonWeek(Number(season), Number(week));
      setScheduleGames(games);
      setScheduleLabel(`${season} regular season · Week ${week}`);
      if (!games.length) setScheduleError(`No regular-season games were found for ${season} Week ${week}.`);
    } catch (err) {
      console.error(err);
      setScheduleGames([]);
      setScheduleError(err instanceof Error ? err.message : 'Could not load that NFL week.');
    } finally {
      setScheduleLoading(false);
    }
  };

  const handlePredictAll = async () => {
    if (!scheduleGames.length || batchLoading) return;
    setBatchLoading(true);
    setBatchCompleted(0);
    setScheduleError('');
    setSelectedBatchPrediction(null);
    setBatchRows(scheduleGames.map(game => ({ game })));
    const ledgerRunId = createLedgerRunId('batch');

    try {
      const completedRows: BatchPredictionRow[] = [];
      const concurrency = 2;
      for (let i = 0; i < scheduleGames.length; i += concurrency) {
        const chunk = scheduleGames.slice(i, i + concurrency);
        const chunkRows = await Promise.all(chunk.map(async game => {
          const home = teamByAbbr.get(game.homeTeam);
          const away = teamByAbbr.get(game.awayTeam);
          if (!home || !away) return { game, error: `Team registry could not match ${game.awayTeam} @ ${game.homeTeam}.` } as BatchPredictionRow;
          try {
            const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.neutralSite });
            let marketAware: MarketAwarePrediction | undefined;
            try {
              marketAware = (await getMarketAwarePrediction(game, result)) || undefined;
            } catch (marketError) {
              console.warn('Market-aware shadow unavailable for game', game.gameId, marketError);
            }

            let ledger: LedgerCaptureStatus | undefined;
            try {
              ledger = game.completed
                ? await recordPredictionOutcomeToServer(game)
                : await freezePredictionToServer({ game, result, marketAware, runId: ledgerRunId });
            } catch (ledgerError) {
              console.warn('Server prediction ledger unavailable for game', game.gameId, ledgerError);
              ledger = {
                state: 'failed',
                message: ledgerError instanceof Error ? ledgerError.message : 'Server ledger unavailable.'
              };
            }
            return { game, result, marketAware, ledger } as BatchPredictionRow;
          } catch (err) {
            console.error(err);
            return { game, error: err instanceof Error ? err.message : 'Prediction failed.' } as BatchPredictionRow;
          }
        }));
        completedRows.push(...chunkRows);
        setBatchCompleted(completedRows.length);
        setBatchRows(scheduleGames.map(game => completedRows.find(row => row.game.gameId === game.gameId) || { game }));
      }
    } finally {
      setBatchLoading(false);
    }
  };

  const handlePredict = async () => {
    if (!homeTeam || !awayTeam || !gameDate) {
      setError('Select both teams and a game date.');
      return;
    }
    if (homeTeam === awayTeam) {
      setError('Home and away teams must be different.');
      return;
    }
    const home = teams.find(team => team.name === homeTeam);
    const away = teams.find(team => team.name === awayTeam);
    if (!home || !away) {
      setError('Could not resolve the selected teams.');
      return;
    }
    setError('');
    setPrediction(null);
    setMarketPrediction(null);
    setManualLedger(null);
    setIsLoading(true);
    try {
      const result = await predictWinner(home, away, new Date(`${gameDate}T12:00:00Z`), true, { neutralSite });
      setPrediction(result);
      let manualMarket: MarketAwarePrediction | null = null;
      try {
        manualMarket = await getMarketAwarePrediction({
          gameday: gameDate,
          homeTeam: home.abbr,
          awayTeam: away.abbr,
          completed: false
        }, result);
        setMarketPrediction(manualMarket);
      } catch (marketError) {
        console.warn('Market-aware shadow unavailable for manual matchup', marketError);
      }

      try {
        const exactGames = await getGamesForDate(gameDate);
        const scheduled = exactGames.find(game => game.homeTeam === home.abbr && game.awayTeam === away.abbr);
        if (scheduled) {
          const ledger = scheduled.completed
            ? await recordPredictionOutcomeToServer(scheduled)
            : await freezePredictionToServer({
                game: scheduled,
                result,
                marketAware: manualMarket || undefined,
                runId: createLedgerRunId('manual')
              });
          setManualLedger(ledger);
        } else {
          setManualLedger({
            state: 'skipped',
            message: 'No exact NFL schedule match was found, so this manual prediction was not prospectively frozen.'
          });
        }
      } catch (ledgerError) {
        console.warn('Manual prediction ledger unavailable', ledgerError);
        setManualLedger({
          state: 'failed',
          message: ledgerError instanceof Error ? ledgerError.message : 'Server ledger unavailable.'
        });
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Prediction failed because verified NFL data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950/70 text-white p-4 sm:p-6 lg:p-8 flex items-start justify-center font-sans">
      <main className="w-full max-w-6xl mx-auto py-4 sm:py-8">
        <header className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-3 py-1 text-xs font-semibold text-emerald-300 mb-4">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Verified-data engine v2.2 + immutable ledger + market shadow + optional DeepSeek
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-purple-400">NFL Numerology Predictor</h1>
          <p className="mt-3 max-w-3xl mx-auto text-sm sm:text-base text-gray-400 leading-relaxed">Run the frozen football control and market-aware shadow. Upcoming scheduled predictions are timestamped to an append-only server ledger before kickoff. DeepSeek EXP-031 stays off unless you explicitly press its button, so normal predictions never spend OpenRouter credits.</p>
        </header>

        <section className="bg-gray-900/80 backdrop-blur-sm p-5 sm:p-7 rounded-2xl shadow-2xl border border-indigo-500/25 mb-7">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] font-bold text-indigo-300">Schedule Runner</p>
              <h2 className="mt-1 text-2xl font-black text-white">Test a whole NFL slate</h2>
              <p className="mt-1 text-sm text-gray-400">Today's games, any exact date, or any past regular-season week.</p>
            </div>
            <button onClick={handleToday} disabled={scheduleLoading || batchLoading} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900/50 disabled:cursor-not-allowed px-5 py-3 font-bold text-sm transition-colors">Test Today's Games</button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <div className="rounded-xl border border-gray-700 bg-black/20 p-4">
              <label htmlFor="schedule-date" className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Load any date</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input id="schedule-date" type="date" value={scheduleDate} onChange={event => setScheduleDate(event.target.value)} className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white" />
                <button onClick={() => loadGamesByDate(scheduleDate)} disabled={!scheduleDate || scheduleLoading || batchLoading} className="rounded-lg border border-indigo-500/40 bg-indigo-950/40 hover:bg-indigo-900/50 disabled:opacity-40 px-4 py-2.5 text-sm font-bold text-indigo-200">Load Date</button>
              </div>
            </div>
            <div className="rounded-xl border border-gray-700 bg-black/20 p-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Load regular-season week</label>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input aria-label="NFL season" type="number" min="1999" max="2100" value={season} onChange={event => setSeason(Number(event.target.value))} className="min-w-0 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white" />
                <select aria-label="NFL week" value={week} onChange={event => setWeek(Number(event.target.value))} className="min-w-0 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white">
                  {Array.from({ length: 18 }, (_, index) => index + 1).map(value => <option key={value} value={value}>Week {value}</option>)}
                </select>
                <button onClick={handleLoadWeek} disabled={scheduleLoading || batchLoading} className="rounded-lg border border-indigo-500/40 bg-indigo-950/40 hover:bg-indigo-900/50 disabled:opacity-40 px-4 py-2.5 text-sm font-bold text-indigo-200">Load</button>
              </div>
            </div>
          </div>

          {scheduleLoading && <div className="rounded-xl border border-gray-700 bg-black/20 p-4 text-sm text-gray-300">Loading verified NFL schedule…</div>}
          {scheduleError && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{scheduleError}</div>}

          {scheduleGames.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-bold text-white">{scheduleLabel || 'Loaded schedule'}</h3>
                  <p className="text-xs text-gray-500">{scheduleGames.length} game{scheduleGames.length === 1 ? '' : 's'} matched from the NFL schedule feed.</p>
                  <p className="mt-1 text-[10px] text-emerald-300/80">Pregame runs are frozen server-side; after kickoff the ledger refuses new prospective snapshots.</p>
                </div>
                <button onClick={handlePredictAll} disabled={batchLoading || !teams.length} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 disabled:cursor-not-allowed px-5 py-3 font-black text-sm transition-colors">{batchLoading ? `Predicting ${batchCompleted}/${scheduleGames.length}…` : 'Predict All Games'}</button>
              </div>

              {historicalBatch.length > 0 && !batchLoading && (
                <div className="mb-4 rounded-xl border border-gray-700 bg-gray-950/60 p-4">
                  <p className="text-xs uppercase tracking-wider font-bold text-gray-400">Historical results for this loaded slate</p>
                  <div className={`mt-3 grid grid-cols-1 sm:grid-cols-2 ${historicalMarketBatch.length ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3`}>
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
                      <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-wider">v2.2 Correct</span></div>
                      <p className="mt-1 text-2xl font-black text-white">{historicalCorrect}</p>
                    </div>
                    <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3">
                      <div className="flex items-center gap-2 text-rose-300"><XCircle className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-wider">v2.2 Wrong</span></div>
                      <p className="mt-1 text-2xl font-black text-white">{historicalIncorrect}</p>
                    </div>
                    <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">v2.2 Accuracy</p>
                      <p className="mt-1 text-2xl font-black text-white">{((historicalCorrect / historicalBatch.length) * 100).toFixed(1)}%</p>
                      <p className="mt-1 text-[10px] text-gray-500">{historicalCorrect}/{historicalBatch.length} completed non-tied games</p>
                    </div>
                    {historicalMarketBatch.length > 0 && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Market-Aware Shadow</p>
                        <p className="mt-1 text-2xl font-black text-white">{((historicalMarketCorrect / historicalMarketBatch.length) * 100).toFixed(1)}%</p>
                        <p className="mt-1 text-[10px] text-gray-500">{historicalMarketCorrect}/{historicalMarketBatch.length} games with two-sided moneylines</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {scheduleGames.map(game => {
                  const row = batchRows.find(item => item.game.gameId === game.gameId);
                  const result = row?.result;
                  const shadow = row?.marketAware;
                  const actual = actualWinnerAbbr(game);
                  const scoredHistoricalGame = Boolean(result && actual && actual !== 'TIE');
                  const correct = Boolean(scoredHistoricalGame && result!.winner.abbr === actual);
                  const shadowCorrect = Boolean(shadow && actual && actual !== 'TIE' && shadow.winnerAbbr === actual);
                  const awayName = teamByAbbr.get(game.awayTeam)?.name || game.awayTeam;
                  const homeName = teamByAbbr.get(game.homeTeam)?.name || game.homeTeam;
                  const shadowWinnerName = shadow ? (teamByAbbr.get(shadow.winnerAbbr)?.name || shadow.winnerAbbr) : '';

                  return (
                    <div key={game.gameId} className={`rounded-xl border p-4 ${scoredHistoricalGame ? (correct ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-rose-500/30 bg-rose-950/10') : 'border-gray-700 bg-gray-950/50'}`}>
                      <div className="flex items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-black text-white">{awayName} @ {homeName}</span>
                                {game.neutralSite && <span className="rounded-full border border-gray-600 px-2 py-0.5 text-[10px] text-gray-400">Neutral</span>}
                                <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[10px] text-gray-500">{game.gameday}</span>
                                {row?.ledger?.state === 'frozen' && <span title={row.ledger.message} className="rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Server Frozen</span>}
                                {row?.ledger?.state === 'outcome_recorded' && <span title={row.ledger.message} className="rounded-full border border-cyan-500/30 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300">Outcome Logged</span>}
                                {(row?.ledger?.state === 'rejected' || row?.ledger?.state === 'failed') && <span title={row.ledger.message} className="rounded-full border border-rose-500/30 bg-rose-950/30 px-2 py-0.5 text-[10px] font-bold text-rose-300">Not Frozen</span>}
                              </div>
                              {game.completed && <p className="mt-1 text-xs text-gray-500">Final: {game.awayTeam} {game.awayScore} · {game.homeTeam} {game.homeScore}</p>}
                            </div>

                            <div className="xl:text-right">
                              {row?.error ? (
                                <p className="text-xs text-rose-300 max-w-lg">{row.error}</p>
                              ) : result ? (
                                <div className="flex flex-wrap xl:justify-end items-center gap-3">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Pure Football · v2.2</p>
                                    <p className="text-sm font-black text-emerald-300">{result.winner.name} {result.confidence.toFixed(1)}%</p>
                                    <p className="text-xs text-gray-500">{result.loser.name} {(100 - result.confidence).toFixed(1)}%</p>
                                  </div>
                                  {shadow && (
                                    <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-left xl:text-right">
                                      <p className="text-[10px] uppercase tracking-wider font-bold text-amber-300">Market-Aware Shadow</p>
                                      <p className="text-sm font-black text-amber-100">{shadowWinnerName} {shadow.confidence.toFixed(1)}%</p>
                                      <p className="text-[10px] text-amber-200/60">Market {shadow.marketWinnerAbbr} {shadow.marketConfidence.toFixed(1)}% · ML {game.awayTeam} {moneyline(shadow.awayMoneyline)} / {game.homeTeam} {moneyline(shadow.homeMoneyline)}</p>
                                      {actual && actual !== 'TIE' && <p className={`mt-1 text-[10px] font-bold ${shadowCorrect ? 'text-emerald-300' : 'text-rose-300'}`}>{shadowCorrect ? 'Shadow correct' : `Shadow wrong · Actual ${actual}`}</p>}
                                    </div>
                                  )}
                                  {scoredHistoricalGame && <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold ${correct ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300' : 'border-rose-500/30 bg-rose-950/30 text-rose-300'}`}>{correct ? 'v2.2 Correct' : `v2.2 Wrong · Actual ${actual}`}</span>}
                                  {actual === 'TIE' && <span className="text-[10px] uppercase tracking-wider text-gray-500">Actual: Tie</span>}
                                  <button onClick={() => setSelectedBatchPrediction(result)} className="rounded-lg border border-gray-600 bg-gray-900 hover:bg-gray-800 px-3 py-2 text-xs font-bold text-gray-200">Full Breakdown</button>
                                  <DeepSeekPregamePanel
                                    homeTeamAbbr={game.homeTeam}
                                    awayTeamAbbr={game.awayTeam}
                                    gameDate={game.gameday}
                                    baseHomeProbability={homeProbabilityDecimal(result, game.homeTeam)}
                                    compact
                                  />
                                </div>
                              ) : batchLoading ? <span className="text-xs text-gray-500">Queued…</span> : <span className="text-xs text-gray-600">Not predicted yet</span>}
                            </div>
                          </div>
                        </div>

                        {scoredHistoricalGame && (
                          <div className={`shrink-0 rounded-full p-1 ${correct ? 'text-emerald-400' : 'text-rose-400'}`} title={correct ? 'Prediction correct' : 'Prediction incorrect'} aria-label={correct ? 'Prediction correct' : 'Prediction incorrect'}>
                            {correct ? <CheckCircle2 className="h-9 w-9 sm:h-11 sm:w-11" strokeWidth={2.25} /> : <XCircle className="h-9 w-9 sm:h-11 sm:w-11" strokeWidth={2.25} />}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <PostgameLearningPanel />

        {selectedBatchPrediction && <PredictionDisplay result={selectedBatchPrediction} />}

        <section className="mt-7 bg-gray-900/70 backdrop-blur-sm p-6 sm:p-8 rounded-2xl shadow-2xl border border-gray-700/80">
          <div className="mb-6"><p className="text-xs uppercase tracking-[0.18em] font-bold text-gray-500">Manual matchup</p><h2 className="mt-1 text-xl font-black text-white">Predict one game</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <TeamSelector id="home-team" label={neutralSite ? 'Team A' : 'Home Team'} teams={sortedTeams} selectedTeam={homeTeam} onChange={event => setHomeTeam(event.target.value)} disabledTeam={awayTeam} />
            <TeamSelector id="away-team" label={neutralSite ? 'Team B' : 'Away Team'} teams={sortedTeams} selectedTeam={awayTeam} onChange={event => setAwayTeam(event.target.value)} disabledTeam={homeTeam} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-end mb-8">
            <DatePicker id="game-date" label="Game Date" selectedDate={gameDate} onChange={event => setGameDate(event.target.value)} />
            <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-700 bg-gray-950/40 cursor-pointer select-none min-h-[46px]"><input type="checkbox" checked={neutralSite} onChange={event => setNeutralSite(event.target.checked)} className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500" /><span className="text-sm text-gray-300">Neutral site</span></label>
          </div>
          <Button onClick={handlePredict} disabled={!homeTeam || !awayTeam || !gameDate || isLoading}>{isLoading ? 'Loading verified pregame data…' : 'Predict Winner'}</Button>
          {manualLedger && manualLedger.state !== 'skipped' && (
            <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${manualLedger.state === 'frozen' || manualLedger.state === 'outcome_recorded' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' : 'border-rose-500/30 bg-rose-950/20 text-rose-300'}`}>
              <strong>{manualLedger.state === 'frozen' ? 'Server Frozen: ' : manualLedger.state === 'outcome_recorded' ? 'Outcome Logged: ' : 'Not Frozen: '}</strong>{manualLedger.message}
            </div>
          )}
          {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-center text-sm text-rose-300">{error}</div>}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-400">
            <div className="rounded-lg bg-black/20 border border-gray-800 p-3"><strong className="block text-gray-200 mb-1">Pure + shadow lanes</strong>v2.2 stays frozen. The market-aware shadow appears only when a verified two-sided moneyline is available.</div>
            <div className="rounded-lg bg-black/20 border border-gray-800 p-3"><strong className="block text-gray-200 mb-1">No future leakage</strong>Historical predictions only use information available before the selected game date.</div>
            <div className="rounded-lg bg-black/20 border border-gray-800 p-3"><strong className="block text-gray-200 mb-1">Immutable pregame record</strong>Scheduled future picks are written to the server before kickoff with model probabilities, feature snapshot, market context, Git SHA, and a SHA-256 payload fingerprint.</div>
          </div>
        </section>

        {isLoading && <div className="text-center mt-8" role="status" aria-live="polite"><div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" /><p className="mt-3 text-sm text-gray-300">Building the pregame snapshot and checking live availability…</p></div>}
        {prediction && <PredictionDisplay result={prediction} />}
        {prediction && (() => {
          const home = teams.find(team => team.name === homeTeam);
          const away = teams.find(team => team.name === awayTeam);
          if (!home || !away) return null;
          return (
            <DeepSeekPregamePanel
              key={`${home.abbr}-${away.abbr}-${gameDate}`}
              homeTeamAbbr={home.abbr}
              awayTeamAbbr={away.abbr}
              gameDate={gameDate}
              baseHomeProbability={homeProbabilityDecimal(prediction, home.abbr)}
            />
          );
        })()}
        {prediction && marketPrediction && (
          <section className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 sm:p-6 shadow-xl">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] font-bold text-amber-300">Market-Aware Shadow · EXP-019</p>
                <h3 className="mt-1 text-2xl font-black text-white">{teamByAbbr.get(marketPrediction.winnerAbbr)?.name || marketPrediction.winnerAbbr} · {marketPrediction.confidence.toFixed(1)}%</h3>
                <p className="mt-1 text-sm text-gray-400">Locked formula: 25% v2.2 + 75% no-vig market probability in logit space.</p>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-black/20 p-4 text-sm">
                <p className="text-gray-300">Market-only: <strong className="text-white">{marketPrediction.marketWinnerAbbr} {marketPrediction.marketConfidence.toFixed(1)}%</strong></p>
                <p className="mt-1 text-gray-400">Moneyline: {marketPrediction.awayTeam} {moneyline(marketPrediction.awayMoneyline)} · {marketPrediction.homeTeam} {moneyline(marketPrediction.homeMoneyline)}</p>
                <p className="mt-1 text-[11px] text-gray-500">{marketPrediction.lineLabel} · snapshot {new Date(marketPrediction.snapshotAt).toLocaleString()}</p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default App;
