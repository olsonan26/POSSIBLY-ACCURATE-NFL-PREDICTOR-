import React, { useEffect, useMemo, useState } from 'react';
import { PredictionResult, Team } from './types';
import { parseTeamData, predictWinner } from './services/validatedPredictionService';
import TeamSelector from './components/TeamSelector';
import DatePicker from './components/DatePicker';
import PredictionDisplay from './components/PredictionDisplay';
import Button from './components/Button';

const App: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [gameDate, setGameDate] = useState(new Date().toISOString().split('T')[0]);
  const [neutralSite, setNeutralSite] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      setTeams(parseTeamData());
    } catch (err) {
      setError('Failed to load team registry.');
      console.error(err);
    }
  }, []);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams]
  );

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
    setIsLoading(true);

    try {
      const result = await predictWinner(
        home,
        away,
        new Date(`${gameDate}T12:00:00Z`),
        true,
        { neutralSite }
      );
      setPrediction(result);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error
        ? err.message
        : 'Prediction failed because verified NFL data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950/70 text-white p-4 sm:p-6 lg:p-8 flex items-start justify-center font-sans">
      <main className="w-full max-w-5xl mx-auto py-4 sm:py-8">
        <header className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-3 py-1 text-xs font-semibold text-emerald-300 mb-4">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Verified-data engine v2.2
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-purple-400">
            NFL Numerology Predictor
          </h1>
          <p className="mt-3 max-w-2xl mx-auto text-sm sm:text-base text-gray-400 leading-relaxed">
            Pregame-only NFL results, current-season football form, live availability and generalized venue history.
            Prior-season recent form resets at each new NFL season. Numerology and PURE Astrology remain calculated for prospective research, but do not affect the production pick until they prove stable incremental value on untouched games.
          </p>
        </header>

        <section className="bg-gray-900/70 backdrop-blur-sm p-6 sm:p-8 rounded-2xl shadow-2xl border border-gray-700/80">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <TeamSelector
              id="home-team"
              label={neutralSite ? 'Team A' : 'Home Team'}
              teams={sortedTeams}
              selectedTeam={homeTeam}
              onChange={(event) => setHomeTeam(event.target.value)}
              disabledTeam={awayTeam}
            />
            <TeamSelector
              id="away-team"
              label={neutralSite ? 'Team B' : 'Away Team'}
              teams={sortedTeams}
              selectedTeam={awayTeam}
              onChange={(event) => setAwayTeam(event.target.value)}
              disabledTeam={homeTeam}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-end mb-8">
            <DatePicker
              id="game-date"
              label="Game Date"
              selectedDate={gameDate}
              onChange={(event) => setGameDate(event.target.value)}
            />

            <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-700 bg-gray-950/40 cursor-pointer select-none min-h-[46px]">
              <input
                type="checkbox"
                checked={neutralSite}
                onChange={(event) => setNeutralSite(event.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-300">Neutral site</span>
            </label>
          </div>

          <Button
            onClick={handlePredict}
            disabled={!homeTeam || !awayTeam || !gameDate || isLoading}
          >
            {isLoading ? 'Loading verified pregame data…' : 'Predict Winner'}
          </Button>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-center text-sm text-rose-300">
              {error}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-400">
            <div className="rounded-lg bg-black/20 border border-gray-800 p-3">
              <strong className="block text-gray-200 mb-1">No future leakage</strong>
              Only games before the chosen date may influence historical features.
            </div>
            <div className="rounded-lg bg-black/20 border border-gray-800 p-3">
              <strong className="block text-gray-200 mb-1">Current personnel</strong>
              Current/future games attempt live depth-chart and injury retrieval.
            </div>
            <div className="rounded-lg bg-black/20 border border-gray-800 p-3">
              <strong className="block text-gray-200 mb-1">Validation-gated factors</strong>
              Variables only score after demonstrating incremental value; no one-off matchup rules are allowed.
            </div>
          </div>
        </section>

        {isLoading && (
          <div className="text-center mt-8" role="status" aria-live="polite">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
            <p className="mt-3 text-sm text-gray-300">Building the pregame snapshot and checking live availability…</p>
          </div>
        )}

        {prediction && <PredictionDisplay result={prediction} />}
      </main>
    </div>
  );
};

export default App;