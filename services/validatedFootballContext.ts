import { parseGamesCsv } from './numerologyService';

const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

interface GameRow {
  season: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  location: 'Home' | 'Neutral';
}

interface TeamForm {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  avgPointDiff: number;
}

export interface ValidatedFootballContext {
  footballLogitAdjustment: number;
  venueLogitAdjustment: number;
  currentSeason: number;
  recentHome: TeamForm;
  recentAway: TeamForm;
  seasonHome: TeamForm;
  seasonAway: TeamForm;
  homeVenue: TeamForm;
  awayVenue: TeamForm;
}

let gamesPromise: Promise<GameRow[]> | null = null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const completed = (game: GameRow) => Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore);

async function fetchTextWithFallback(primary: string, fallback: string): Promise<string> {
  try {
    const response = await fetch(primary);
    if (response.ok) return response.text();
  } catch {
    // Direct source fallback below.
  }
  const response = await fetch(fallback);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function loadGames(): Promise<GameRow[]> {
  if (!gamesPromise) {
    gamesPromise = fetchTextWithFallback('/api/nfl-data?dataset=games', NFLVERSE_GAMES_URL)
      .then(text => parseGamesCsv(text) as unknown as GameRow[])
      .then(games => {
        if (games.length < 1000) throw new Error(`NFL history feed returned only ${games.length} games`);
        return games;
      })
      .catch(error => {
        gamesPromise = null;
        throw error;
      });
  }
  return gamesPromise;
}

function exactGame(games: GameRow[], targetIso: string, home: string, away: string): GameRow | undefined {
  return games.find(game => game.gameday === targetIso && game.homeTeam === home && game.awayTeam === away);
}

function seasonForTarget(games: GameRow[], targetIso: string, home: string, away: string): number {
  const exact = exactGame(games, targetIso, home, away);
  if (exact?.season) return exact.season;
  const date = new Date(`${targetIso}T12:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return month <= 2 ? year - 1 : year;
}

/**
 * v2.2 validation rule: recent-form and home/road refinements use only games
 * from the target NFL season. This rule was selected by Brier score on 2024
 * before evaluating the untouched 2025 validation season.
 *
 * Elo and same-venue H2H remain long-horizon signals elsewhere in the model;
 * this change only prevents stale prior-season "recent form" from leaking into
 * a new season's current form/venue adjustment.
 */
function getCurrentSeasonForm(
  games: GameRow[],
  team: string,
  targetIso: string,
  currentSeason: number,
  limit: number,
  venue?: 'home' | 'away'
): TeamForm {
  const selected = games
    .filter(game => completed(game) && game.gameday < targetIso && game.season === currentSeason)
    .filter(game => game.homeTeam === team || game.awayTeam === team)
    .filter(game => venue == null || (venue === 'home'
      ? game.homeTeam === team && game.location !== 'Neutral'
      : game.awayTeam === team && game.location !== 'Neutral'))
    .sort((a, b) => b.gameday.localeCompare(a.gameday))
    .slice(0, limit);

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let weightedPointDiff = 0;
  let weightDenominator = 0;

  selected.forEach((game, index) => {
    const isHome = game.homeTeam === team;
    const scored = isHome ? game.homeScore! : game.awayScore!;
    const allowed = isHome ? game.awayScore! : game.homeScore!;
    const weight = Math.pow(0.9, index);
    weightedPointDiff += (scored - allowed) * weight;
    weightDenominator += weight;
    if (scored > allowed) wins++;
    else if (scored < allowed) losses++;
    else ties++;
  });

  const n = selected.length;
  return {
    games: n,
    wins,
    losses,
    ties,
    winPct: n ? (wins + ties * 0.5) / n : 0.5,
    avgPointDiff: n ? weightedPointDiff / (weightDenominator || 1) : 0
  };
}

export async function getValidatedFootballContext(
  home: string,
  away: string,
  targetIso: string,
  neutral: boolean
): Promise<ValidatedFootballContext> {
  const games = await loadGames();
  const scheduled = exactGame(games, targetIso, home, away);
  const effectiveNeutral = neutral || scheduled?.location === 'Neutral';
  const currentSeason = seasonForTarget(games, targetIso, home, away);

  const recentHome = getCurrentSeasonForm(games, home, targetIso, currentSeason, 8);
  const recentAway = getCurrentSeasonForm(games, away, targetIso, currentSeason, 8);
  const seasonHome = getCurrentSeasonForm(games, home, targetIso, currentSeason, 30);
  const seasonAway = getCurrentSeasonForm(games, away, targetIso, currentSeason, 30);
  const homeVenue = getCurrentSeasonForm(games, home, targetIso, currentSeason, 24, 'home');
  const awayVenue = getCurrentSeasonForm(games, away, targetIso, currentSeason, 24, 'away');

  const recentEdge = clamp(
    ((recentHome.winPct - recentAway.winPct) * 0.22) +
    ((recentHome.avgPointDiff - recentAway.avgPointDiff) / 100),
    -0.24,
    0.24
  );
  const seasonEdge = seasonHome.games + seasonAway.games >= 4
    ? clamp(
      ((seasonHome.winPct - seasonAway.winPct) * 0.14) +
      ((seasonHome.avgPointDiff - seasonAway.avgPointDiff) / 140),
      -0.16,
      0.16
    )
    : 0;
  const footballLogitAdjustment = recentEdge + seasonEdge;

  const venueLogitAdjustment = effectiveNeutral
    ? 0
    : clamp(
      ((homeVenue.winPct - 0.55) - (awayVenue.winPct - 0.45)) * 0.24,
      -0.12,
      0.12
    );

  return {
    footballLogitAdjustment,
    venueLogitAdjustment,
    currentSeason,
    recentHome,
    recentAway,
    seasonHome,
    seasonAway,
    homeVenue,
    awayVenue
  };
}