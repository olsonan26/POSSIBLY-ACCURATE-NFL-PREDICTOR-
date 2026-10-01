/**
 * Historical Features Loader
 *
 * Loads the pre-computed NFL_All_Stats.csv containing 12,781 games from
 * 1976-2026 with pregame features (win%, point diff, rest days, venue
 * splits, composite strength, model predictions).
 *
 * This data is used for:
 * - Walk-forward validation across 5+ seasons
 * - XGBoost model training
 * - Fallback pregame context when real-time computation fails
 *
 * The CSV is a static snapshot. For live predictions, the real-time services
 * (EPA, weather, etc.) should be preferred. This loader provides the
 * historical baseline for backtesting and validation.
 */

import { normalizeTeamAbbr } from '../data/teamRegistry';

const CSV_URL = '/data/NFL_All_Stats.csv';

export interface HistoricalFeatureRow {
  season: number;
  week: string;
  gameDate: string;
  gameId: string;
  gameType: string;
  resultStatus: string;
  neutralSite: boolean;
  source: string;

  awayTeam: string;
  awayFranchiseId: string;
  awayScore: number | null;
  awayResult: string;
  awayActualPointDiff: number | null;

  homeTeam: string;
  homeFranchiseId: string;
  homeScore: number | null;
  homeResult: string;
  homeActualPointDiff: number | null;

  actualWinner: string;
  actualMarginHome: number | null;

  // Pregame features
  homePregameWinPct: number | null;
  homePregamePointDiffPg: number | null;
  homePrior5WinPct: number | null;
  homePrior5PointDiffPg: number | null;
  homePregameHomeWinPct: number | null;
  homePregameHomePdPg: number | null;
  homeRestDays: number | null;
  homeRestBucket: string;

  awayPregameWinPct: number | null;
  awayPregamePointDiffPg: number | null;
  awayPrior5WinPct: number | null;
  awayPrior5PointDiffPg: number | null;
  awayPregameRoadWinPct: number | null;
  awayPregameRoadPdPg: number | null;
  awayRestDays: number | null;
  awayRestBucket: string;
  awayBackToBackRoad: boolean;

  // Model output
  homeCompositeStrength: number | null;
  awayCompositeStrength: number | null;
  modelEdgeHome: number | null;
  strongerSide: string;
  confidenceTier: string;
  modelCorrect: boolean | null;
}

let cache: HistoricalFeatureRow[] | null = null;
let loadPromise: Promise<HistoricalFeatureRow[]> | null = null;

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

function numOrNull(value: string): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value: string): boolean {
  return String(value).toUpperCase() === 'TRUE';
}

function normalizeTeam(abbr: string): string {
  const normalized = normalizeTeamAbbr(abbr);
  return normalized || abbr;
}

function parseRow(headers: string[], cells: string[]): HistoricalFeatureRow {
  const get = (name: string) => {
    const i = headers.indexOf(name);
    return i >= 0 ? (cells[i] ?? '').trim() : '';
  };

  return {
    season: Number(get('season')) || 0,
    week: get('week'),
    gameDate: get('game_date'),
    gameId: get('game_id'),
    gameType: get('game_type'),
    resultStatus: get('result_status'),
    neutralSite: boolOrNull(get('neutral_site')),
    source: get('source'),

    awayTeam: normalizeTeam(get('away_team')),
    awayFranchiseId: get('away_franchise_id'),
    awayScore: numOrNull(get('away_score')),
    awayResult: get('away_result'),
    awayActualPointDiff: numOrNull(get('away_actual_point_diff')),

    homeTeam: normalizeTeam(get('home_team')),
    homeFranchiseId: get('home_franchise_id'),
    homeScore: numOrNull(get('home_score')),
    homeResult: get('home_result'),
    homeActualPointDiff: numOrNull(get('home_actual_point_diff')),

    actualWinner: normalizeTeam(get('actual_winner')),
    actualMarginHome: numOrNull(get('actual_margin_home')),

    homePregameWinPct: numOrNull(get('home_pregame_win_pct')),
    homePregamePointDiffPg: numOrNull(get('home_pregame_point_diff_pg')),
    homePrior5WinPct: numOrNull(get('home_prior5_win_pct')),
    homePrior5PointDiffPg: numOrNull(get('home_prior5_point_diff_pg')),
    homePregameHomeWinPct: numOrNull(get('home_pregame_home_win_pct')),
    homePregameHomePdPg: numOrNull(get('home_pregame_home_pd_pg')),
    homeRestDays: numOrNull(get('home_rest_days')),
    homeRestBucket: get('home_rest_bucket'),

    awayPregameWinPct: numOrNull(get('away_pregame_win_pct')),
    awayPregamePointDiffPg: numOrNull(get('away_pregame_point_diff_pg')),
    awayPrior5WinPct: numOrNull(get('away_prior5_win_pct')),
    awayPrior5PointDiffPg: numOrNull(get('away_prior5_point_diff_pg')),
    awayPregameRoadWinPct: numOrNull(get('away_pregame_road_win_pct')),
    awayPregameRoadPdPg: numOrNull(get('away_pregame_road_pd_pg')),
    awayRestDays: numOrNull(get('away_rest_days')),
    awayRestBucket: get('away_rest_bucket'),
    awayBackToBackRoad: boolOrNull(get('away_back_to_back_road')),

    homeCompositeStrength: numOrNull(get('home_composite_strength')),
    awayCompositeStrength: numOrNull(get('away_composite_strength')),
    modelEdgeHome: numOrNull(get('model_edge_home')),
    strongerSide: get('stronger_side'),
    confidenceTier: get('confidence_tier'),
    modelCorrect: get('model_correct') ? boolOrNull(get('model_correct')) : null,
  };
}

/**
 * Loads the historical features CSV. Cached after first load.
 * In the browser, fetches from the static /data/ path.
 * In Node.js (for walk-forward validation), fetches from the file system.
 */
export async function loadHistoricalFeatures(): Promise<HistoricalFeatureRow[]> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let text: string;

    if (typeof fetch !== 'undefined') {
      // Browser: fetch from static path
      const response = await fetch(CSV_URL);
      if (!response.ok) {
        throw new Error(`Failed to load historical features: ${response.status}`);
      }
      text = await response.text();
    } else {
      // Node.js: read from file system
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(__dirname, '..', 'data', 'NFL_All_Stats.csv');
      text = fs.readFileSync(filePath, 'utf-8');
    }

    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      throw new Error('Historical features CSV is empty');
    }

    const headers = parseCsvLine(lines[0]);
    const rows: HistoricalFeatureRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      if (cells.length < headers.length - 5) continue; // Skip malformed rows
      rows.push(parseRow(headers, cells));
    }

    cache = rows;
    return rows;
  })();

  return loadPromise;
}

/**
 * Finds a historical feature row matching a specific game.
 * Used as a fallback when real-time feature computation fails.
 */
export async function findHistoricalFeatures(
  homeAbbr: string,
  awayAbbr: string,
  gameDateIso: string
): Promise<HistoricalFeatureRow | null> {
  const rows = await loadHistoricalFeatures();
  const home = normalizeTeamAbbr(homeAbbr) || homeAbbr;
  const away = normalizeTeamAbbr(awayAbbr) || awayAbbr;

  return (
    rows.find(
      (r) =>
        r.gameDate === gameDateIso &&
        r.homeTeam === home &&
        r.awayTeam === away
    ) ?? null
  );
}

/**
 * Returns all games for a specific season. Used by walk-forward validation.
 */
export async function getSeasonFeatures(season: number): Promise<HistoricalFeatureRow[]> {
  const rows = await loadHistoricalFeatures();
  return rows.filter((r) => r.season === season);
}
