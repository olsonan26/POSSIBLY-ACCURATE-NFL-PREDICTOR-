import { getSeasonGames } from './scheduleService.js';

export type TeamStatsRow = Record<string, string>;

export interface TeamStatsDataset {
  headers: Set<string>;
  rows: TeamStatsRow[];
}

export interface PointInTimeTeamStats extends TeamStatsDataset {
  targetWeek: number;
}

const datasetCache = new Map<number, Promise<TeamStatsDataset>>();
const targetWeekCache = new Map<string, Promise<number | null>>();

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

export function parseTeamStatsCsv(csvText: string): TeamStatsDataset {
  const lines = csvText
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => line.trim().length > 0);

  if (lines.length === 0) return { headers: new Set(), rows: [] };

  const headerCells = parseCsvLine(lines[0]).map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim().toLowerCase()
  );
  const headers = new Set(headerCells);

  const rows = lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row: TeamStatsRow = {};
    headerCells.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim();
    });
    return row;
  });

  return { headers, rows };
}

export function hasRequiredTeamStatsFields(
  dataset: TeamStatsDataset,
  requiredFields: string[],
): boolean {
  return requiredFields.every(field => dataset.headers.has(field.toLowerCase()));
}

export function filterTeamStatsBeforeWeek(
  dataset: TeamStatsDataset,
  teamAbbr: string,
  season: number,
  targetWeek: number,
): TeamStatsRow[] {
  return dataset.rows.filter(row => {
    const rowSeason = Number.parseInt(row.season ?? '', 10);
    const rowWeek = Number.parseInt(row.week ?? '', 10);
    return rowSeason === season &&
      row.team === teamAbbr &&
      Number.isFinite(rowWeek) &&
      rowWeek >= 1 &&
      rowWeek < targetWeek;
  });
}

async function fetchTextWithFallback(primary: string, fallback: string): Promise<string> {
  try {
    const response = await fetch(primary);
    if (response.ok) return response.text();
  } catch {
    // Same-origin proxy can be unavailable in local/offline tooling; use nflverse directly below.
  }

  const response = await fetch(fallback);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function loadTeamStatsDataset(season: number): Promise<TeamStatsDataset> {
  const existing = datasetCache.get(season);
  if (existing) return existing;

  const promise = fetchTextWithFallback(
    `/api/nfl-data?dataset=team-stats&season=${season}`,
    `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`,
  )
    .then(parseTeamStatsCsv)
    .then(dataset => {
      if (!hasRequiredTeamStatsFields(dataset, ['season', 'week', 'team'])) {
        throw new Error('nflverse team stats feed is missing season/week/team columns');
      }
      return dataset;
    })
    .catch(error => {
      datasetCache.delete(season);
      throw error;
    });

  datasetCache.set(season, promise);
  return promise;
}

async function resolveTargetWeek(
  teamAbbr: string,
  targetIso: string,
  season: number,
): Promise<number | null> {
  const key = `${teamAbbr}|${season}|${targetIso}`;
  const existing = targetWeekCache.get(key);
  if (existing) return existing;

  const promise = getSeasonGames(season, true)
    .then(games => {
      const exact = games.find(game =>
        game.gameday === targetIso &&
        (game.homeTeam === teamAbbr || game.awayTeam === teamAbbr)
      );
      return exact?.week ?? null;
    })
    .catch(error => {
      targetWeekCache.delete(key);
      throw error;
    });

  targetWeekCache.set(key, promise);
  return promise;
}

/**
 * Returns only rows that were knowable before the target game.
 *
 * Integrity rule: the target game's NFL week is excluded in full. If we cannot
 * prove the target week from the schedule, the caller gets null rather than a
 * guessed or contaminated feature set.
 */
export async function getTeamStatsBeforeTarget(
  teamAbbr: string,
  targetIso: string,
  season: number,
): Promise<PointInTimeTeamStats | null> {
  const [dataset, targetWeek] = await Promise.all([
    loadTeamStatsDataset(season),
    resolveTargetWeek(teamAbbr, targetIso, season),
  ]);

  if (targetWeek == null) {
    console.warn(`[pointInTimeTeamStats] Could not prove target week for ${teamAbbr} ${targetIso}; feature unavailable.`);
    return null;
  }

  return {
    ...dataset,
    targetWeek,
    rows: filterTeamStatsBeforeWeek(dataset, teamAbbr, season, targetWeek),
  };
}
