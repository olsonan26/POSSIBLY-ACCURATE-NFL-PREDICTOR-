
import React, { useState, useEffect, useMemo } from 'react';
import { Team, PredictionResult } from './types';
import { parseTeamData, predictWinner } from './services/numerologyService';
import TeamSelector from './components/TeamSelector';
import DatePicker from './components/DatePicker';
import PredictionDisplay from './components/PredictionDisplay';
import Button from './components/Button';

const App: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [homeTeam, setHomeTeam] = useState<string>('');
  const [awayTeam, setAwayTeam] = useState<string>('');
  const [gameDate, setGameDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    try {
      const teamData = parseTeamData();
      setTeams(teamData);
    } catch (err) {
      setError('Failed to load team data.');
      console.error(err);
    }
  }, []);

  const handlePredict = () => {
    if (!homeTeam || !awayTeam || !gameDate) {
      setError('Please select both teams and a game date.');
      return;
    }
    setError('');
    setIsLoading(true);
    setPrediction(null);

    setTimeout(() => {
      const teamA = teams.find(t => t.name === homeTeam);
      const teamB = teams.find(t => t.name === awayTeam);
      
      if (teamA && teamB) {
        const result = predictWinner(teamA, teamB, new Date(gameDate), true);
        setPrediction(result);
      } else {
        setError('Could not find selected team data.');
      }
      setIsLoading(false);
    }, 1500); // Simulate calculation delay for better UX
  };

  const sortedTeams = useMemo(() => {
      return [...teams].sort((a, b) => a.name.localeCompare(b.name));
  }, [teams]);

  return (
    <div className="min-h-screen bg-gray-900 bg-gradient-to-br from-gray-900 to-indigo-900/50 text-white p-4 sm:p-6 lg:p-8 flex items-center justify-center font-sans">
      <main className="w-full max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">
            NFL Numerology Predictor
          </h1>
          <p className="mt-3 max-w-md mx-auto text-lg text-gray-400">
            Harnessing the power of numbers to forecast game outcomes.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 bg-indigo-950/60 border border-indigo-700/50 px-3.5 py-1 rounded-full text-xs text-indigo-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Powered by 1,365 Documented NFL Games &amp; Historical Pattern Archives</span>
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm p-6 sm:p-8 rounded-2xl shadow-2xl border border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <TeamSelector
              id="home-team"
              label="Home Team"
              teams={sortedTeams}
              selectedTeam={homeTeam}
              onChange={(e) => setHomeTeam(e.target.value)}
              disabledTeam={awayTeam}
            />
            <TeamSelector
              id="away-team"
              label="Away Team"
              teams={sortedTeams}
              selectedTeam={awayTeam}
              onChange={(e) => setAwayTeam(e.target.value)}
              disabledTeam={homeTeam}
            />
          </div>
          <div className="mb-8">
             <DatePicker
              id="game-date"
              label="Game Date"
              selectedDate={gameDate}
              onChange={(e) => setGameDate(e.target.value)}
            />
          </div>

          <Button
            onClick={handlePredict}
            disabled={!homeTeam || !awayTeam || !gameDate || isLoading}
          >
            {isLoading ? 'Calculating...' : 'Predict Winner'}
          </Button>

          {error && <p className="text-red-400 text-center mt-4">{error}</p>}
        </div>

        {isLoading && (
           <div className="text-center mt-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400"></div>
            <p className="mt-2 text-gray-300">Analyzing numerological patterns...</p>
          </div>
        )}

        {prediction && <PredictionDisplay result={prediction} />}
      </main>
    </div>
  );
};

export default App;
