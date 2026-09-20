import { parseGamesCsv } from './validatedPredictionService';

const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

export interface ScheduledGame {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameday: string;
  awayTeam: string;
  homeTeam: string;
  awayScore?: number;
  homeScore?: number;
  neutralSite: boolean;
  completed: boolean;
}

let schedulePromise: Promise<ScheduledGame[]> | null = null;

async function fetchTextWithFallback(primary: string, fallback: string): Promise<string> {
  try {
    const response = await fetch(primary);
    if (response.ok) return response.text();
  } catch {
    // Direct-source fallback below.
  }

  const response = await fetch(fallback);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function loadSchedule(): Promise<ScheduledGame[]> {
  if (!schedulePromise) {
    schedulePromise = fetchTextWithFallback('/api/nfl-data?dataset=games', NFLVERSE_GAMES_URL)
      .then(parseGamesCsv)
      .then(games => games.map(game => ({
        gameId: game.gameId,
        season: game.season,
        gameType: game.gameType,
        week: game.week,
        gameday: game.gameday,
        awayTeam: game.awayTeam,
        homeTeam: game.homeTeam,
        awayScore: game.awayScore,
        homeScore: game.homeScore,
        neutralSite: game.location === 'Neutral',
        completed: Number.isFinite(game.awayScore) && Number.isFinite(game.homeScore)
      })))
      .then(games => {
        if (games.length < 1000) throw new Error(`NFL schedule feed returned only ${games.length} games`);
        return games;
      })
      .catch(error => {
        schedulePromise = null;
        throw error;
      });
  }

  return schedulePromise;
}

function sortGames(games: ScheduledGame[]): ScheduledGame[] {
  return [...games].sort((a, b) =>
    a.gameday.localeCompare(b.gameday) ||
    a.week - b.week ||
    a.gameId.localeCompare(b.gameId)
  );
}

export async function getGamesForDate(dateIso: string): Promise<ScheduledGame[]> {
  const games = await loadSchedule();
  return sortGames(games.filter(game => game.gameday === dateIso));
}

export async function getRegularSeasonWeek(season: number, week: number): Promise<ScheduledGame[]> {
  const games = await loadSchedule();
  return sortGames(games.filter(game =>
    game.season === season &&
    game.week === week &&
    game.gameType === 'REG'
  ));
}
