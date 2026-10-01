/**
 * Walk-Forward Validation Script
 *
 * Validates model accuracy across multiple seasons using a rolling window:
 * train on seasons 1..N, test on season N+1, then roll forward.
 *
 * This replaces the current 2-season validation (2024 select, 2025 confirm)
 * with a 5+ season walk-forward protocol that better detects overfitting.
 *
 * Usage:
 *   npx tsx scripts/walk-forward-validation.ts
 *
 * The script reads from the same nflverse games.csv data source as the
 * production model and evaluates the v2.2 control plus any challenger
 * features that have been integrated.
 */

import { parseGamesCsv } from '../services/validatedPredictionService';

const NFLVERSE_GAMES_URL =
  'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

const VALIDATION_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025];
const MIN_TRAIN_SEASONS = 5;

interface WalkForwardResult {
  season: number;
  totalGames: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
}

interface GamePrediction {
  homeWinProbability: number;
  actualHomeWin: boolean;
}

function brierScore(predictions: GamePrediction[]): number {
  if (!predictions.length) return NaN;
  return (
    predictions.reduce((sum, p) => sum + Math.pow(p.homeWinProbability - (p.actualHomeWin ? 1 : 0), 2), 0) /
    predictions.length
  );
}

function logLossScore(predictions: GamePrediction[]): number {
  if (!predictions.length) return NaN;
  return (
    -predictions.reduce((sum, p) => {
      const pClamped = Math.max(0.001, Math.min(0.999, p.homeWinProbability));
      const y = p.actualHomeWin ? 1 : 0;
      return sum + (y * Math.log(pClamped) + (1 - y) * Math.log(1 - pClamped));
    }, 0) / predictions.length
  );
}

async function fetchGamesCsv(): Promise<string> {
  const response = await fetch(NFLVERSE_GAMES_URL, {
    headers: { 'User-Agent': 'NFL-Predictor-WalkForward/1.0' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch games.csv: ${response.status}`);
  }
  return response.text();
}

/**
 * Naive baseline: predict home team wins every game.
 * Historical home win rate is ~57%.
 */
function naiveBaseline(games: any[]): GamePrediction[] {
  return games.map(() => ({
    homeWinProbability: 0.57,
    actualHomeWin: true, // Will be corrected below
  }));
}

/**
 * Elo-based baseline using season-to-date records.
 * This is a simplified version of the production model's Elo component.
 */
function eloBaseline(
  games: any[],
  trainGames: any[]
): GamePrediction[] {
  // Initialize Elo ratings from training data
  const elo: Record<string, number> = {};
  const K = 20;
  const HFA = 55;

  // Process training games to build Elo ratings
  for (const game of trainGames) {
    if (game.gameType !== 'REG') continue;
    const home = game.homeTeam;
    const away = game.awayTeam;
    if (!elo[home]) elo[home] = 1500;
    if (!elo[away]) elo[away] = 1500;

    const homeExpected = 1 / (1 + Math.pow(10, (elo[away] - elo[home] - HFA) / 400));
    const awayExpected = 1 - homeExpected;

    const homeScore = game.homeScore ?? 0;
    const awayScore = game.awayScore ?? 0;
    const homeActual = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;

    elo[home] += K * (homeActual - homeExpected);
    elo[away] += K * ((1 - homeActual) - awayExpected);
  }

  // Predict test games
  return games.map((game) => {
    const home = game.homeTeam;
    const away = game.awayTeam;
    const homeElo = elo[home] ?? 1500;
    const awayElo = elo[away] ?? 1500;
    const homeProb = 1 / (1 + Math.pow(10, (awayElo - homeElo - HFA) / 400));
    const homeScore = game.homeScore ?? 0;
    const awayScore = game.awayScore ?? 0;
    return {
      homeWinProbability: homeProb,
      actualHomeWin: homeScore > awayScore,
    };
  });
}

async function runWalkForward(): Promise<void> {
  console.log('Fetching nflverse games.csv...');
  const csvText = await fetchGamesCsv();
  const allGames = parseGamesCsv(csvText);

  console.log(`Loaded ${allGames.length} games total.\n`);

  const results: WalkForwardResult[] = [];

  for (const testSeason of VALIDATION_SEASONS) {
    const trainStart = testSeason - MIN_TRAIN_SEASONS;
    const trainGames = allGames.filter(
      (g: any) =>
        g.season >= trainStart &&
        g.season < testSeason &&
        g.gameType === 'REG' &&
        Number.isFinite(g.homeScore) &&
        Number.isFinite(g.awayScore)
    );

    const testGames = allGames.filter(
      (g: any) =>
        g.season === testSeason &&
        g.gameType === 'REG' &&
        Number.isFinite(g.homeScore) &&
        Number.isFinite(g.awayScore)
    );

    if (testGames.length === 0) {
      console.log(`No test games for ${testSeason}, skipping.`);
      continue;
    }

    // Run Elo baseline
    const predictions = eloBaseline(testGames, trainGames);

    const correct = predictions.filter((p) => {
      const predicted = p.homeWinProbability >= 0.5;
      return predicted === p.actualHomeWin;
    }).length;

    const brier = brierScore(predictions);
    const logLoss = logLossScore(predictions);

    const result: WalkForwardResult = {
      season: testSeason,
      totalGames: testGames.length,
      correct,
      accuracy: correct / testGames.length,
      brier,
      logLoss,
    };

    results.push(result);
    console.log(
      `${testSeason}: ${correct}/${testGames.length} = ${(result.accuracy * 100).toFixed(2)}% | Brier: ${brier.toFixed(4)} | LogLoss: ${logLoss.toFixed(4)}`
    );
  }

  // Summary
  if (results.length > 0) {
    const totalCorrect = results.reduce((sum, r) => sum + r.correct, 0);
    const totalGames = results.reduce((sum, r) => sum + r.totalGames, 0);
    const avgBrier = results.reduce((sum, r) => sum + r.brier, 0) / results.length;
    const avgLogLoss = results.reduce((sum, r) => sum + r.logLoss, 0) / results.length;

    console.log('\n--- Walk-Forward Summary ---');
    console.log(`Seasons: ${results.map((r) => r.season).join(', ')}`);
    console.log(`Total: ${totalCorrect}/${totalGames} = ${((totalCorrect / totalGames) * 100).toFixed(2)}%`);
    console.log(`Avg Brier: ${avgBrier.toFixed(4)}`);
    console.log(`Avg Log Loss: ${avgLogLoss.toFixed(4)}`);
    console.log(`\nNote: This is the Elo baseline only. To evaluate the full v2.2 model`);
    console.log(`or challenger features, integrate the corresponding prediction service`);
    console.log(`calls into the predictions array above.`);
  }
}

runWalkForward().catch((error) => {
  console.error('Walk-forward validation failed:', error);
  process.exit(1);
});
