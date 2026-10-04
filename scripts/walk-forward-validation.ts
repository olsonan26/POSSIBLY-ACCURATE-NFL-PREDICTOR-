import { mkdirSync, writeFileSync } from 'node:fs';
import {
  parseGamesCsv,
  parseTeamData,
  predictWinner,
} from '../services/validatedPredictionService';

/**
 * Production v2.2 expanding-history walk-forward replay.
 *
 * This script deliberately calls the same validatedPredictionService.predictWinner()
 * used by the application. It does NOT substitute a simplified Elo model and it
 * does NOT tune weights while moving through the seasons.
 *
 * Historical calls are governed by the production retrospective guard:
 * - current/live personnel contributes zero historical weight
 * - EXP-025 remains shadow-only and cannot change the production probability
 * - current-season form / venue context only use games before the target date
 * - Elo and same-venue H2H are calculated from pre-target history
 *
 * Important governance note: this is a chronological replay of the frozen model,
 * not six untouched holdout seasons. 2024 was used during v2.2 selection and 2025
 * was the confirmation season. Earlier seasons are historical backcasts.
 */

const NFLVERSE_GAMES_URL =
  'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const DEFAULT_START_SEASON = 2020;
const DEFAULT_END_SEASON = 2025;
const EXPECTED_MODEL_VERSION = 'v2.2-validated-current-season';
const REPORT_PATH = 'research/reports/production-walk-forward.md';
const RUNTIME_PATH = 'research/runtime/production-walk-forward.json';

interface ScoredGame {
  season: number;
  week: number;
  gameId: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;
  pHome: number;
  confidence: number;
  pickedHome: boolean;
  actualHome: boolean;
  hit: boolean;
  modelVersion: string;
}

interface Metrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  ece: number;
  homePickRate: number;
  actualHomeWinRate: number;
  ci95Low: number;
  ci95High: number;
}

interface SeasonResult extends Metrics {
  season: number;
  role: 'historical-backcast' | 'selection-era' | 'confirmation-era';
}

function parseIntegerArg(name: string, fallback: number): number {
  const arg = process.argv.find(value => value.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const value = Number.parseInt(arg.split('=')[1] ?? '', 10);
  if (!Number.isInteger(value)) throw new Error(`Invalid --${name} value: ${arg}`);
  return value;
}

function clampProbability(value: number): number {
  return Math.max(0.001, Math.min(0.999, value));
}

function wilson95(correct: number, n: number): [number, number] {
  if (!n) return [Number.NaN, Number.NaN];
  const z = 1.959963984540054;
  const p = correct / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function expectedCalibrationError(rows: ScoredGame[]): number {
  if (!rows.length) return Number.NaN;
  const edges = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.90, 1.001];
  let weightedError = 0;

  for (let i = 0; i < edges.length - 1; i++) {
    const low = edges[i];
    const high = edges[i + 1];
    const bucket = rows.filter(row => row.confidence >= low && row.confidence < high);
    if (!bucket.length) continue;

    const meanConfidence = bucket.reduce((sum, row) => sum + row.confidence, 0) / bucket.length;
    const observedAccuracy = bucket.filter(row => row.hit).length / bucket.length;
    weightedError += Math.abs(meanConfidence - observedAccuracy) * (bucket.length / rows.length);
  }

  return weightedError;
}

function metrics(rows: ScoredGame[]): Metrics {
  if (!rows.length) {
    return {
      n: 0,
      correct: 0,
      accuracy: Number.NaN,
      brier: Number.NaN,
      logLoss: Number.NaN,
      ece: Number.NaN,
      homePickRate: Number.NaN,
      actualHomeWinRate: Number.NaN,
      ci95Low: Number.NaN,
      ci95High: Number.NaN,
    };
  }

  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let homePicks = 0;
  let homeWins = 0;

  for (const row of rows) {
    const y = row.actualHome ? 1 : 0;
    const p = clampProbability(row.pHome);
    correct += row.hit ? 1 : 0;
    homePicks += row.pickedHome ? 1 : 0;
    homeWins += row.actualHome ? 1 : 0;
    brier += Math.pow(p - y, 2);
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }

  const [ci95Low, ci95High] = wilson95(correct, rows.length);
  return {
    n: rows.length,
    correct,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    ece: expectedCalibrationError(rows),
    homePickRate: homePicks / rows.length,
    actualHomeWinRate: homeWins / rows.length,
    ci95Low,
    ci95High,
  };
}

function seasonRole(season: number): SeasonResult['role'] {
  if (season === 2024) return 'selection-era';
  if (season === 2025) return 'confirmation-era';
  return 'historical-backcast';
}

function pct(value: number, digits = 2): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'n/a';
}

async function fetchGamesCsv(): Promise<string> {
  const response = await fetch(NFLVERSE_GAMES_URL, {
    headers: { 'User-Agent': 'NFL-Predictor-Production-WalkForward/2.0' },
  });
  if (!response.ok) throw new Error(`Failed to fetch games.csv: ${response.status}`);
  return response.text();
}

function reportMarkdown(
  startSeason: number,
  endSeason: number,
  seasonResults: SeasonResult[],
  pooled: Metrics,
  modelVersions: string[],
): string {
  const table = seasonResults.map(result =>
    `| ${result.season} | ${result.role} | ${result.correct}/${result.n} | ${pct(result.accuracy)} | ${result.brier.toFixed(4)} | ${result.logLoss.toFixed(4)} | ${result.ece.toFixed(4)} | ${pct(result.ci95Low)}–${pct(result.ci95High)} |`
  ).join('\n');

  return `# Frozen Production v2.2 Walk-Forward Replay\n\n` +
    `Generated by \`scripts/walk-forward-validation.ts\`.\n\n` +
    `## Scope\n\n` +
    `- Seasons: ${startSeason}–${endSeason}, regular season only.\n` +
    `- Exact application predictor entry point: \`validatedPredictionService.predictWinner()\`.\n` +
    `- Model version observed: ${modelVersions.join(', ')}.\n` +
    `- Predictions are replayed chronologically with production historical guards.\n` +
    `- Ties are excluded from binary winner scoring.\n` +
    `- The current production model is date-granular historically; this report does not pretend that exact timestamped historical injury/market snapshots exist.\n\n` +
    `## Results\n\n` +
    `| Season | Evaluation role | Correct | Accuracy | Brier | Log loss | ECE | 95% accuracy CI |\n` +
    `| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${table}\n` +
    `| **Pooled** | **all rows** | **${pooled.correct}/${pooled.n}** | **${pct(pooled.accuracy)}** | **${pooled.brier.toFixed(4)}** | **${pooled.logLoss.toFixed(4)}** | **${pooled.ece.toFixed(4)}** | **${pct(pooled.ci95Low)}–${pct(pooled.ci95High)}** |\n\n` +
    `## Interpretation rules\n\n` +
    `- 2020–2023 are historical backcasts of the frozen current model.\n` +
    `- 2024 is labeled selection-era because v2.2 rules were selected using 2024 evidence.\n` +
    `- 2025 is labeled confirmation-era; it must not be re-described as untouched if later model choices use its results.\n` +
    `- This script measures the production football control only. Shadow research features do not alter \`finalHomeProbability\`.\n` +
    `- No pass/fail threshold is tied to a desired accuracy such as 70%; doing that would incentivize overfitting.\n` +
    `- The next legitimate improvement must be evaluated prospectively or under a separately frozen validation protocol.\n`;
}

async function main(): Promise<void> {
  const startSeason = parseIntegerArg('start', DEFAULT_START_SEASON);
  const endSeason = parseIntegerArg('end', DEFAULT_END_SEASON);
  if (startSeason < 1999 || endSeason < startSeason) {
    throw new Error(`Invalid season range: ${startSeason}-${endSeason}`);
  }

  console.log(`\nProduction v2.2 walk-forward replay: ${startSeason}-${endSeason}`);
  console.log('============================================================');
  console.log('Loading nflverse schedule/results and current team registry...');

  const csvText = await fetchGamesCsv();
  const allGames = parseGamesCsv(csvText);
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const rows: ScoredGame[] = [];
  const modelVersions = new Set<string>();
  let missingTeams = 0;

  const sample = allGames
    .filter(game =>
      game.season >= startSeason &&
      game.season <= endSeason &&
      game.gameType === 'REG' &&
      Number.isFinite(game.homeScore) &&
      Number.isFinite(game.awayScore) &&
      game.homeScore !== game.awayScore
    )
    .sort((a, b) =>
      a.gameday.localeCompare(b.gameday) ||
      a.week - b.week ||
      a.gameId.localeCompare(b.gameId)
    );

  for (const game of sample) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) {
      missingTeams += 1;
      console.warn(`Skipping ${game.gameId}: team registry missing ${game.homeTeam} or ${game.awayTeam}`);
      continue;
    }

    // Production historical scoring is currently date-granular. Noon UTC is a
    // neutral carrier for the known game date; production football features use
    // targetIso and explicitly reject target-date/future completed games.
    const result = await predictWinner(
      home,
      away,
      new Date(`${game.gameday}T12:00:00Z`),
      true,
      { neutralSite: game.location === 'Neutral' },
    );

    if (!result.modelScores || !Number.isFinite(result.modelScores.finalHomeProbability)) {
      throw new Error(`Production model did not return a scored probability for ${game.gameId}`);
    }

    const modelVersion = result.modelVersion || 'unknown';
    modelVersions.add(modelVersion);
    const pHome = result.modelScores.finalHomeProbability / 100;
    if (!(pHome > 0 && pHome < 1)) {
      throw new Error(`Invalid home probability ${pHome} for ${game.gameId}`);
    }

    const actualHome = game.homeScore! > game.awayScore!;
    const pickedHome = pHome >= 0.5;
    rows.push({
      season: game.season,
      week: game.week,
      gameId: game.gameId,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      neutral: game.location === 'Neutral',
      pHome,
      confidence: pickedHome ? pHome : 1 - pHome,
      pickedHome,
      actualHome,
      hit: pickedHome === actualHome,
      modelVersion,
    });
  }

  const versions = [...modelVersions].sort();
  if (versions.length !== 1 || versions[0] !== EXPECTED_MODEL_VERSION) {
    throw new Error(`Expected only ${EXPECTED_MODEL_VERSION}; observed: ${versions.join(', ') || 'none'}`);
  }
  if (missingTeams > 0) throw new Error(`Walk-forward skipped ${missingTeams} games because of missing team mappings`);

  const seasonResults: SeasonResult[] = [];
  for (let season = startSeason; season <= endSeason; season++) {
    const seasonRows = rows.filter(row => row.season === season);
    const scored = metrics(seasonRows);
    if (scored.n < 250) {
      throw new Error(`Coverage too small for season ${season}: ${scored.n} scored games`);
    }

    const result: SeasonResult = {
      season,
      role: seasonRole(season),
      ...scored,
    };
    seasonResults.push(result);
    console.log(
      `${season} [${result.role}] ${result.correct}/${result.n} = ${pct(result.accuracy)} | ` +
      `Brier ${result.brier.toFixed(4)} | LogLoss ${result.logLoss.toFixed(4)} | ` +
      `ECE ${result.ece.toFixed(4)} | 95% CI ${pct(result.ci95Low)}-${pct(result.ci95High)}`
    );
  }

  const pooled = metrics(rows);
  const minimumExpected = (endSeason - startSeason + 1) * 250;
  if (pooled.n < minimumExpected) {
    throw new Error(`Pooled walk-forward coverage too small: ${pooled.n} < ${minimumExpected}`);
  }

  console.log('\nPooled production replay');
  console.log(`  ${pooled.correct}/${pooled.n} = ${pct(pooled.accuracy)}`);
  console.log(`  Brier: ${pooled.brier.toFixed(4)}`);
  console.log(`  Log loss: ${pooled.logLoss.toFixed(4)}`);
  console.log(`  ECE: ${pooled.ece.toFixed(4)}`);
  console.log(`  95% accuracy CI: ${pct(pooled.ci95Low)}-${pct(pooled.ci95High)}`);
  console.log(`  Home-pick rate: ${pct(pooled.homePickRate)}`);
  console.log(`  Actual home-win rate: ${pct(pooled.actualHomeWinRate)}`);

  mkdirSync('research/reports', { recursive: true });
  mkdirSync('research/runtime', { recursive: true });

  const generatedAt = new Date().toISOString();
  const runtime = {
    schemaVersion: 1,
    generatedAt,
    source: NFLVERSE_GAMES_URL,
    modelVersion: versions[0],
    startSeason,
    endSeason,
    governance: {
      chronology: 'expanding-history production replay',
      personnel: 'retrospective live personnel disabled by production guard',
      shadowFeatures: 'excluded from finalHomeProbability',
      historicalGranularity: 'date-level; exact timestamped injury/market snapshots not claimed',
      untouchedClaim: false,
    },
    seasons: seasonResults,
    pooled,
    rows,
  };

  writeFileSync(RUNTIME_PATH, `${JSON.stringify(runtime, null, 2)}\n`);
  writeFileSync(
    REPORT_PATH,
    reportMarkdown(startSeason, endSeason, seasonResults, pooled, versions),
  );

  console.log(`\nWrote ${REPORT_PATH}`);
  console.log(`Wrote ${RUNTIME_PATH}`);
}

main().catch(error => {
  console.error('Production walk-forward validation failed:', error);
  process.exit(1);
});
