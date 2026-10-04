import { TEAM_BY_ABBR, normalizeTeamAbbr } from '../data/teamRegistry';

const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

export interface ScheduledGame {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameday: string;
  gametime?: string;
  awayTeam: string;
  homeTeam: string;
  awayScore?: number;
  homeScore?: number;
  neutralSite: boolean;
  completed: boolean;
}

let schedulePromise: Promise<ScheduledGame[]> | null = null;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function optionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseScheduleCsv(text: string): ScheduledGame[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);
  const column = {
    gameId: idx('game_id'),
    season: idx('season'),
    gameType: idx('game_type'),
    week: idx('week'),
    gameday: idx('gameday'),
    gametime: idx('gametime'),
    awayTeam: idx('away_team'),
    awayScore: idx('away_score'),
    homeTeam: idx('home_team'),
    homeScore: idx('home_score'),
    location: idx('location')
  };

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const get = (index: number) => index >= 0 ? (cells[index] ?? '').trim() : '';
    const awayScore = optionalNumber(get(column.awayScore));
    const homeScore = optionalNumber(get(column.homeScore));
    return {
      gameId: get(column.gameId),
      season: Number(get(column.season) || 0),
      gameType: get(column.gameType),
      week: Number(get(column.week) || 0),
      gameday: get(column.gameday),
      gametime: get(column.gametime) || undefined,
      awayTeam: normalizeTeamAbbr(get(column.awayTeam)),
      homeTeam: normalizeTeamAbbr(get(column.homeTeam)),
      awayScore,
      homeScore,
      neutralSite: get(column.location) === 'Neutral',
      completed: Number.isFinite(awayScore) && Number.isFinite(homeScore)
    } as ScheduledGame;
  }).filter(game => game.gameday && game.homeTeam && game.awayTeam && game.season >= 1999);
}

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
      .then(parseScheduleCsv)
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

function kickoffMinutes(gametime?: string): number {
  if (!gametime) return Number.MAX_SAFE_INTEGER;
  const [hourText, minuteText] = gametime.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : Number.MAX_SAFE_INTEGER;
}

function awaySortName(abbr: string): string {
  return TEAM_BY_ABBR.get(abbr)?.name || abbr;
}

/**
 * CBS-style Pick'em display order:
 * 1) game date (Thursday before Sunday before Monday),
 * 2) scheduled Eastern kickoff time,
 * 3) away-team name for simultaneous kickoff groups.
 *
 * This mirrors the public CBS Sports weekly schedule top-to-bottom layout while
 * keeping nflverse as the point-in-time schedule source.
 */
function sortGames(games: ScheduledGame[]): ScheduledGame[] {
  return [...games].sort((a, b) =>
    a.gameday.localeCompare(b.gameday) ||
    kickoffMinutes(a.gametime) - kickoffMinutes(b.gametime) ||
    awaySortName(a.awayTeam).localeCompare(awaySortName(b.awayTeam)) ||
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

export async function getSeasonGames(season: number, includePostseason = true): Promise<ScheduledGame[]> {
  const games = await loadSchedule();
  const allowedTypes = includePostseason
    ? new Set(['REG', 'WC', 'DIV', 'CON', 'SB'])
    : new Set(['REG']);

  return sortGames(games.filter(game =>
    game.season === season &&
    allowedTypes.has(game.gameType)
  ));
}
