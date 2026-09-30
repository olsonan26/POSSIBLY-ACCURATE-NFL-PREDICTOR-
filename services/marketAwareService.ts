import { PredictionResult } from '../types';
import { normalizeTeamAbbr } from '../data/teamRegistry';

const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const CACHE_TTL_MS = 60_000;
const MARKET_WEIGHT = 0.75;

export interface MarketLookupGame {
  gameId?: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  completed?: boolean;
}

interface MarketRow {
  gameId: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeMoneyline?: number;
  awayMoneyline?: number;
}

export interface MarketAwarePrediction {
  modelVersion: 'market-aware-shadow-v1';
  gameId?: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  pureHomeProbability: number;
  marketHomeProbability: number;
  blendedHomeProbability: number;
  winnerAbbr: string;
  loserAbbr: string;
  confidence: number;
  marketWinnerAbbr: string;
  marketConfidence: number;
  homeMoneyline: number;
  awayMoneyline: number;
  marketWeight: number;
  snapshotAt: string;
  source: string;
  lineLabel: string;
}

let cache: { rows: MarketRow[]; fetchedAt: string; loadedAt: number } | null = null;
let inflight: Promise<{ rows: MarketRow[]; fetchedAt: string; loadedAt: number }> | null = null;

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const q = clamp(p, 0.001, 0.999);
  return Math.log(q / (1 - q));
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
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

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseMarketRows(text: string): MarketRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  for (const field of ['game_id', 'gameday', 'home_team', 'away_team', 'home_moneyline', 'away_moneyline']) {
    if (!index.has(field)) throw new Error(`Market feed is missing ${field}.`);
  }
  const get = (cells: string[], field: string) => {
    const i = index.get(field);
    return i == null ? '' : (cells[i] ?? '').trim();
  };
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return {
      gameId: get(cells, 'game_id'),
      gameday: get(cells, 'gameday'),
      homeTeam: normalizeTeamAbbr(get(cells, 'home_team')),
      awayTeam: normalizeTeamAbbr(get(cells, 'away_team')),
      homeMoneyline: numberOrUndefined(get(cells, 'home_moneyline')),
      awayMoneyline: numberOrUndefined(get(cells, 'away_moneyline'))
    };
  });
}

async function fetchTextWithFallback(primary: string, fallback: string): Promise<string> {
  try {
    const response = await fetch(primary, { cache: 'no-store' });
    if (response.ok) return response.text();
  } catch {
    // Direct-source fallback below.
  }
  const response = await fetch(fallback, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Market feed unavailable: ${response.status} ${response.statusText}`);
  return response.text();
}

async function loadMarketRows(): Promise<{ rows: MarketRow[]; fetchedAt: string; loadedAt: number }> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = fetchTextWithFallback('/api/nfl-data?dataset=games', NFLVERSE_GAMES_URL)
    .then(text => ({ rows: parseMarketRows(text), fetchedAt: new Date().toISOString(), loadedAt: Date.now() }))
    .then(value => {
      cache = value;
      inflight = null;
      return value;
    })
    .catch(error => {
      inflight = null;
      throw error;
    });
  return inflight;
}

function americanImplied(odds: number): number {
  return odds < 0 ? (-odds) / ((-odds) + 100) : 100 / (odds + 100);
}

function noVigHomeProbability(homeMoneyline: number, awayMoneyline: number): number | null {
  if (!Number.isFinite(homeMoneyline) || !Number.isFinite(awayMoneyline) || homeMoneyline === 0 || awayMoneyline === 0) return null;
  const homeRaw = americanImplied(homeMoneyline);
  const awayRaw = americanImplied(awayMoneyline);
  const total = homeRaw + awayRaw;
  if (!Number.isFinite(total) || total <= 0) return null;
  return clamp(homeRaw / total, 0.01, 0.99);
}

function pureHomeProbability(result: PredictionResult, homeAbbr: string): number {
  if (result.modelScores?.finalHomeProbability != null) {
    return clamp(result.modelScores.finalHomeProbability / 100, 0.001, 0.999);
  }
  const winnerP = clamp(result.confidence / 100, 0.001, 0.999);
  return result.winner.abbr === homeAbbr ? winnerP : 1 - winnerP;
}

function findMarketRow(rows: MarketRow[], game: MarketLookupGame): MarketRow | undefined {
  if (game.gameId) {
    const byId = rows.find(row => row.gameId === game.gameId);
    if (byId) return byId;
  }
  return rows.find(row =>
    row.gameday === game.gameday &&
    row.homeTeam === normalizeTeamAbbr(game.homeTeam) &&
    row.awayTeam === normalizeTeamAbbr(game.awayTeam)
  );
}

function persistSnapshot(snapshot: MarketAwarePrediction) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const key = `nfl-market-shadow:${snapshot.gameId || `${snapshot.gameday}:${snapshot.awayTeam}@${snapshot.homeTeam}`}`;
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Prediction must never fail because local audit persistence is unavailable.
  }
}

export async function getMarketAwarePrediction(
  game: MarketLookupGame,
  pureResult: PredictionResult
): Promise<MarketAwarePrediction | null> {
  const loaded = await loadMarketRows();
  const row = findMarketRow(loaded.rows, game);
  if (!row || row.homeMoneyline == null || row.awayMoneyline == null) return null;

  const marketPHome = noVigHomeProbability(row.homeMoneyline, row.awayMoneyline);
  if (marketPHome == null) return null;

  const homeAbbr = normalizeTeamAbbr(game.homeTeam);
  const awayAbbr = normalizeTeamAbbr(game.awayTeam);
  const controlPHome = pureHomeProbability(pureResult, homeAbbr);
  const blendedPHome = logistic((1 - MARKET_WEIGHT) * logit(controlPHome) + MARKET_WEIGHT * logit(marketPHome));
  const homeWins = blendedPHome >= 0.5;
  const marketHomeWins = marketPHome >= 0.5;

  const snapshot: MarketAwarePrediction = {
    modelVersion: 'market-aware-shadow-v1',
    gameId: row.gameId || game.gameId,
    gameday: game.gameday,
    homeTeam: homeAbbr,
    awayTeam: awayAbbr,
    pureHomeProbability: controlPHome,
    marketHomeProbability: marketPHome,
    blendedHomeProbability: blendedPHome,
    winnerAbbr: homeWins ? homeAbbr : awayAbbr,
    loserAbbr: homeWins ? awayAbbr : homeAbbr,
    confidence: 100 * Math.max(blendedPHome, 1 - blendedPHome),
    marketWinnerAbbr: marketHomeWins ? homeAbbr : awayAbbr,
    marketConfidence: 100 * Math.max(marketPHome, 1 - marketPHome),
    homeMoneyline: row.homeMoneyline,
    awayMoneyline: row.awayMoneyline,
    marketWeight: MARKET_WEIGHT,
    snapshotAt: loaded.fetchedAt,
    source: 'nflverse games.csv moneyline',
    lineLabel: game.completed ? 'Historical recorded pregame/closing line' : 'Current available pregame line snapshot'
  };
  persistSnapshot(snapshot);
  return snapshot;
}
