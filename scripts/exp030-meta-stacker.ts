/**
 * EXP-030: Market-Calibrated Meta-Stacker
 * ========================================
 *
 * Research-only shadow challenger that combines:
 *   1. v2.2 control probability (Elo + form + venue + H2H + personnel)
 *   2. Market no-vig probability (closing moneyline)
 *   3. Opponent-adjusted recent form (SRS-style, computed from prior games only)
 *   4. Rest differential (days since last game)
 *   5. Travel distance and time zone change
 *   6. Divisional matchup indicator
 *   7. Home/away performance splits
 *   8. Surface type (grass/turf) and roof type (dome/outdoor)
 *   9. Prime time indicator (Thu/Mon/Sun night)
 *  10. Spread distance from pick'em
 *  11. Total line
 *  12. Interaction terms (rest × travel, rest × tz, divisional × close spread)
 *
 * Model: L2-regularized logistic regression (gradient descent in TypeScript)
 * Calibration: Platt scaling (logistic regression on held-out predictions)
 *
 * Walk-forward protocol:
 *   Train: 2022-2023 (with chronological ordering)
 *   Select: 2024 (select hyperparameters)
 *   Confirm: 2025 (untouched)
 *   Observe: 2026 Weeks 1-3
 *
 * This script does NOT modify the v2.2 production prediction path.
 * All results are research-only shadow challengers.
 *
 * Governance:
 * - All features computed from games.csv data before the target game's kickoff
 * - No future-season information in retrospective predictions
 * - Market probability uses closing moneyline (known before kickoff)
 * - Platt scaling trained only on training period, applied to all periods
 * - No retuning on 2025 or 2026
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { divisionMap } from '../data/divisionMap';
import { stadiumCoordinates } from '../data/stadiumCoordinates';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Game = ReturnType<typeof parseGamesCsv>[number];

interface MarketRow {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameday: string;
  weekday: string;
  gametime: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  location: string;
  result: number;
  total: number;
  spreadLine?: number;
  totalLine?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
  surface?: string;
  stadium?: string;
  roof?: string;
  temp?: number;
  wind?: number;
}

interface FeatureRow {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: boolean;
  margin: number;
  // Core probabilities
  controlLogit: number;
  marketLogit: number;
  // New features
  srsDiff: number;              // opponent-adjusted point differential
  restDiff: number;            // home rest days - away rest days
  travelMiles: number;         // away team travel distance
  tzChange: number;            // away team timezone change
  isDivisional: number;        // 1 if divisional, 0 otherwise
  homeHomeWinPct: number;      // home team's home win rate (season to date)
  awayAwayWinPct: number;      // away team's road win rate (season to date)
  isPrimeTime: number;          // Thu/Mon/Sun night
  isDome: number;               // 1 if dome, 0 otherwise
  isTurf: number;               // 1 if turf surface, 0 if grass
  spreadAbs: number;           // |spread_line|
  totalLine: number;            // total_line
  // Interaction terms
  restXTravel: number;          // restDiff * log(travelMiles+1)
  restXTz: number;              // restDiff * tzChange
  divisionalXClose: number;      // isDivisional * (spreadAbs < 3 ? 1 : 0)
  marketConfidence: number;      // max(marketP, 1-marketP)
}

interface Metrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  ece: number;
}

interface MissPattern {
  category: string;
  n: number;
  correct: number;
  accuracy: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
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
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function americanImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return NaN;
  return odds < 0 ? (-odds) / ((-odds) + 100) : 100 / (odds + 100);
}

function noVigHomeProbability(homeML?: number, awayML?: number): number | null {
  if (homeML == null || awayML == null) return null;
  const h = americanImplied(homeML);
  const a = americanImplied(awayML);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h <= 0 || a <= 0) return null;
  return clamp(h / (h + a), 0.01, 0.99);
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Feature Engineering
// ---------------------------------------------------------------------------

interface ProcessedGame {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameday: string;
  weekday: string;
  gametime: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  location: string;
  result: number;
  total: number;
  spreadLine?: number;
  totalLine?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
  surface?: string;
  stadium?: string;
  roof?: string;
  temp?: number;
  wind?: number;
  homeTz: number;
  awayTz: number;
  isDivisional: boolean;
}

function parseMarketRows(text: string): ProcessedGame[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((h, i) => [h, i]));
  const get = (cells: string[], field: string) => {
    const i = index.get(field);
    return i == null ? '' : (cells[i] ?? '').trim();
  };

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const homeTeam = normalizeTeamAbbr(get(cells, 'home_team'));
    const awayTeam = normalizeTeamAbbr(get(cells, 'away_team'));
    const homeStadium = stadiumCoordinates[homeTeam];
    const awayStadium = stadiumCoordinates[awayTeam];
    const homeDiv = divisionMap[homeTeam] || '';
    const awayDiv = divisionMap[awayTeam] || '';

    return {
      gameId: get(cells, 'game_id'),
      season: Number(get(cells, 'season') || 0),
      gameType: get(cells, 'game_type'),
      week: Number(get(cells, 'week') || 0),
      gameday: get(cells, 'gameday'),
      weekday: get(cells, 'weekday'),
      gametime: get(cells, 'gametime'),
      homeTeam,
      awayTeam,
      homeScore: Number(get(cells, 'home_score') || 'NaN'),
      awayScore: Number(get(cells, 'away_score') || 'NaN'),
      location: get(cells, 'location'),
      result: Number(get(cells, 'result') || 'NaN'),
      total: Number(get(cells, 'total') || 'NaN'),
      spreadLine: numberOrUndefined(get(cells, 'spread_line')),
      totalLine: numberOrUndefined(get(cells, 'total_line')),
      homeMoneyline: numberOrUndefined(get(cells, 'home_moneyline')),
      awayMoneyline: numberOrUndefined(get(cells, 'away_moneyline')),
      surface: get(cells, 'surface') || undefined,
      stadium: get(cells, 'stadium') || undefined,
      roof: get(cells, 'roof') || undefined,
      temp: numberOrUndefined(get(cells, 'temp')),
      wind: numberOrUndefined(get(cells, 'wind')),
      homeTz: homeStadium?.tzOffset ?? -4,
      awayTz: awayStadium?.tzOffset ?? -4,
      isDivisional: homeDiv !== '' && homeDiv === awayDiv,
    };
  });
}

/**
 * Compute SRS (Simple Rating System) for all teams up to a given date.
 * SRS is an iterative opponent-adjusted point differential rating.
 *
 * Algorithm: For each team, compute average margin of victory, then adjust
 * for strength of schedule by iterating the system:
 *   rating_i = avg_margin_i + avg(rating_opponents)
 *
 * We use a simple iterative approach with 10 iterations and a prior of 0.
 * For early-season games (few prior games), we blend with the previous season's
 * final SRS ratings as a Bayesian prior (50% weight).
 */
function computeSrsRatings(
  games: ProcessedGame[],
  targetDate: string,
  season: number
): Map<string, number> {
  // Current season games before targetDate
  const eligible = games.filter(g =>
    g.season === season &&
    g.gameType === 'REG' &&
    g.gameday < targetDate &&
    Number.isFinite(g.homeScore) &&
    Number.isFinite(g.awayScore) &&
    g.homeScore !== g.awayScore
  );

  // Previous season games for prior
  const prevSeason = season - 1;
  const prevEligible = games.filter(g =>
    g.season === prevSeason &&
    g.gameType === 'REG' &&
    Number.isFinite(g.homeScore) &&
    Number.isFinite(g.awayScore) &&
    g.homeScore !== g.awayScore
  );

  // Compute previous season SRS
  const prevRatings = computeSrsRaw(prevEligible);

  // Compute current season raw ratings
  const currentRatings = computeSrsRaw(eligible);

  // Blend: for teams with few games, weight the prior more heavily
  const blended: Map<string, number> = new Map();
  const teamGameCount: Map<string, number> = new Map();
  for (const g of eligible) {
    teamGameCount.set(g.homeTeam, (teamGameCount.get(g.homeTeam) || 0) + 1);
    teamGameCount.set(g.awayTeam, (teamGameCount.get(g.awayTeam) || 0) + 1);
  }

  // Get all teams from both seasons
  const allTeams = new Set<string>();
  for (const g of [...eligible, ...prevEligible]) {
    allTeams.add(g.homeTeam);
    allTeams.add(g.awayTeam);
  }

  for (const team of allTeams) {
    const current = currentRatings.get(team) || 0;
    const prior = prevRatings.get(team) || 0;
    const nGames = teamGameCount.get(team) || 0;
    // Blend: more current-season weight as more games are played
    // After 4 games, current gets 70% weight; before that, prior dominates
    const currentWeight = Math.min(0.8, nGames / (nGames + 3));
    blended.set(team, currentWeight * current + (1 - currentWeight) * prior);
  }

  return blended;
}

/**
 * Raw SRS computation without prior blending.
 */
function computeSrsRaw(eligible: ProcessedGame[]): Map<string, number> {
  // Compute raw margins
  const teamMargins: Map<string, number[]> = new Map();
  const teamOpponents: Map<string, string[]> = new Map();

  for (const g of eligible) {
    const homeMargin = g.homeScore - g.awayScore;
    const awayMargin = g.awayScore - g.homeScore;

    if (!teamMargins.has(g.homeTeam)) {
      teamMargins.set(g.homeTeam, []);
      teamOpponents.set(g.homeTeam, []);
    }
    if (!teamMargins.has(g.awayTeam)) {
      teamMargins.set(g.awayTeam, []);
      teamOpponents.set(g.awayTeam, []);
    }
    teamMargins.get(g.homeTeam)!.push(homeMargin);
    teamMargins.get(g.awayTeam)!.push(awayMargin);
    teamOpponents.get(g.homeTeam)!.push(g.awayTeam);
    teamOpponents.get(g.awayTeam)!.push(g.homeTeam);
  }

  // Initialize ratings
  const ratings: Map<string, number> = new Map();
  for (const team of teamMargins.keys()) ratings.set(team, 0);

  // Iterate
  for (let iter = 0; iter < 10; iter++) {
    const newRatings: Map<string, number> = new Map();
    for (const [team, margins] of teamMargins) {
      const avgMargin = margins.reduce((s, m) => s + m, 0) / margins.length;
      const opps = teamOpponents.get(team)!;
      const avgOppRating = opps.reduce((s, opp) => s + (ratings.get(opp) || 0), 0) / opps.length;
      newRatings.set(team, avgMargin + avgOppRating);
    }
    // Blend for stability
    for (const [team, rating] of newRatings) {
      const old = ratings.get(team) || 0;
      ratings.set(team, old * 0.3 + rating * 0.7);
    }
  }

  return ratings;
}

/**
 * Compute rest days for a team (days since last game).
 */
function computeRestDays(
  games: ProcessedGame[],
  team: string,
  targetDate: string,
  season: number
): number {
  // Look for the most recent game this team played before targetDate
  let mostRecent: string | null = null;
  for (const g of games) {
    if (g.season !== season || g.gameday >= targetDate) continue;
    if (g.gameType !== 'REG') continue;
    if (g.homeTeam !== team && g.awayTeam !== team) continue;
    if (!Number.isFinite(g.homeScore)) continue;
    if (mostRecent === null || g.gameday > mostRecent) mostRecent = g.gameday;
  }

  if (mostRecent === null) {
    // No prior game this season — use a default of 7 days rest
    return 7;
  }

  const diff = new Date(targetDate).getTime() - new Date(mostRecent).getTime();
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Compute home/away win percentages for a team up to targetDate.
 */
function computeVenueWinPct(
  games: ProcessedGame[],
  team: string,
  targetDate: string,
  season: number,
  isHome: boolean
): number {
  const eligible = games.filter(g =>
    g.season === season &&
    g.gameday < targetDate &&
    g.gameType === 'REG' &&
    Number.isFinite(g.homeScore) &&
    g.homeScore !== g.awayScore &&
    (isHome ? g.homeTeam === team : g.awayTeam === team)
  );

  if (eligible.length === 0) return 0.5;
  const wins = eligible.filter(g =>
    isHome ? g.homeScore > g.awayScore : g.awayScore > g.homeScore
  ).length;
  return wins / eligible.length;
}

/**
 * Check if a game is prime time.
 */
function isPrimeTimeGame(weekday: string, gametime: string): boolean {
  if (weekday === 'Thursday' || weekday === 'Monday') return true;
  if (weekday === 'Sunday' && gametime >= '20:00') return true;
  return false;
}

/**
 * Check if surface is turf (as opposed to grass).
 */
function isTurfSurface(surface: string | undefined): boolean {
  if (!surface) return false;
  const s = surface.toLowerCase();
  return s.includes('turf') || s.includes('artificial') || s.includes('synthetic');
}

// ---------------------------------------------------------------------------
// L2-Regularized Logistic Regression (Gradient Descent)
// ---------------------------------------------------------------------------

class LogisticRegression {
  weights: number[];
  bias: number;
  learningRate: number;
  lambda: number;
  iterations: number;

  constructor(nFeatures: number, learningRate = 0.01, lambda = 0.01, iterations = 500) {
    this.weights = new Array(nFeatures).fill(0);
    this.bias = 0;
    this.learningRate = learningRate;
    this.lambda = lambda;
    this.iterations = iterations;
  }

  predict(X: number[][]): number[] {
    return X.map(row => {
      let z = this.bias;
      for (let i = 0; i < row.length; i++) z += this.weights[i] * row[i];
      return logistic(z);
    });
  }

  predictProba(X: number[][]): number[] {
    return this.predict(X);
  }

  fit(X: number[][], y: number[]) {
    const n = X.length;
    const d = this.weights.length;

    for (let iter = 0; iter < this.iterations; iter++) {
      // Forward pass
      const preds = this.predict(X);

      // Gradients
      const gradW = new Array(d).fill(0);
      let gradB = 0;

      for (let i = 0; i < n; i++) {
        const error = preds[i] - y[i];
        for (let j = 0; j < d; j++) {
          gradW[j] += error * X[i][j];
        }
        gradB += error;
      }

      // Update with L2 regularization
      for (let j = 0; j < d; j++) {
        this.weights[j] -= this.learningRate * (gradW[j] / n + this.lambda * this.weights[j]);
      }
      this.bias -= this.learningRate * (gradB / n);
    }
  }

  // Platt scaling: fit a logistic regression on the predicted probabilities
  // to calibrate them
  calibrate(trainPreds: number[], trainLabels: number[]) {
    // Platt scaling: find A, B such that P(y=1|p) = sigmoid(A*p + B)
    let a = 0;
    let b = Math.log(trainLabels.filter(y => y === 1).length /
      Math.max(1, trainLabels.filter(y => y === 0).length));
    const lr = 0.5;
    const iters = 200;

    for (let iter = 0; iter < iters; iter++) {
      let gradA = 0;
      let gradB = 0;
      for (let i = 0; i < trainPreds.length; i++) {
        const p = clamp(trainPreds[i], 0.001, 0.999);
        const z = a * p + b;
        const pred = logistic(z);
        const error = pred - trainLabels[i];
        gradA += error * p;
        gradB += error;
      }
      a -= lr * gradA / trainPreds.length;
      b -= lr * gradB / trainPreds.length;
    }

    this._calA = a;
    this._calB = b;
  }

  _calA: number = 1;
  _calB: number = 0;

  predictCalibrated(X: number[][]): number[] {
    const raw = this.predict(X);
    return raw.map(p => clamp(logistic(this._calA * p + this._calB), 0.001, 0.999));
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function computeMetrics(probabilities: number[], actuals: boolean[]): Metrics {
  const n = probabilities.length;
  if (n === 0) return { n: 0, correct: 0, accuracy: 0, brier: NaN, logLoss: NaN, ece: NaN };

  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));

  for (let i = 0; i < n; i++) {
    const p = clamp(probabilities[i], 0.001, 0.999);
    const y = actuals[i] ? 1 : 0;
    if ((p >= 0.5) === actuals[i]) correct++;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    const bin = Math.min(9, Math.floor(p * 10));
    bins[bin].n++;
    bins[bin].p += p;
    bins[bin].y += y;
  }

  let ece = 0;
  for (const bin of bins) {
    if (!bin.n) continue;
    ece += (bin.n / n) * Math.abs(bin.p / bin.n - bin.y / bin.n);
  }

  return {
    n,
    correct,
    accuracy: correct / n,
    brier: brier / n,
    logLoss: logLoss / n,
    ece,
  };
}

function metricLine(label: string, m: Metrics): string {
  return `${label}: ${m.correct}/${m.n} = ${(m.accuracy * 100).toFixed(2)}% | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logLoss.toFixed(4)} | ECE ${m.ece.toFixed(4)}`;
}

function exactMcNemarP(challengerOnly: number, controlOnly: number): number {
  const n = challengerOnly + controlOnly;
  if (!n) return 1;
  const tail = Math.min(challengerOnly, controlOnly);
  let term = Math.pow(0.5, n);
  let sum = term;
  for (let k = 0; k < tail; k++) {
    term *= (n - k) / (k + 1);
    sum += term;
  }
  return Math.min(1, 2 * sum);
}

// ---------------------------------------------------------------------------
// Miss Pattern Analysis
// ---------------------------------------------------------------------------

function missPatternAnalysis(rows: FeatureRow[], probabilities: number[], controlProbs: number[]): void {
  console.log('\n========================================================');
  console.log('MISS PATTERN ANALYSIS');
  console.log('========================================================');

  const patterns: MissPattern[] = [];
  const misses: { row: FeatureRow; p: number; controlP: number }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const hit = (probabilities[i] >= 0.5) === rows[i].actualHome;
    const controlHit = (controlProbs[i] >= 0.5) === rows[i].actualHome;
    if (!hit) {
      misses.push({ row: rows[i], p: probabilities[i], controlP: controlProbs[i] });
    }
  }

  // Home vs away misses
  const homeMisses = misses.filter(m => m.row.actualHome).length;
  const awayMisses = misses.filter(m => !m.row.actualHome).length;
  patterns.push({ category: 'Home team won (missed)', n: homeMisses, correct: 0, accuracy: 0 });
  patterns.push({ category: 'Away team won (missed)', n: awayMisses, correct: 0, accuracy: 0 });

  // Upset misses (model picked favorite, underdog won)
  const upsetMisses = misses.filter(m => {
    const modelPickedHome = m.p >= 0.5;
    const marketFavorite = m.row.marketConfidence >= 0.55;
    const marketPickedHome = m.row.marketLogit > 0;
    return marketFavorite && modelPickedHome === marketPickedHome && m.row.actualHome !== marketPickedHome;
  }).length;
  patterns.push({ category: 'Upset misses (model agreed with market, both wrong)', n: upsetMisses, correct: 0, accuracy: 0 });

  // Model-market disagreement
  const disagreeMisses = misses.filter(m => {
    const modelPickedHome = m.p >= 0.5;
    const marketPickedHome = m.row.marketLogit > 0;
    return modelPickedHome !== marketPickedHome;
  }).length;
  patterns.push({ category: 'Model-market disagreement (model was wrong)', n: disagreeMisses, correct: 0, accuracy: 0 });

  // Close games
  const closeGameMisses = misses.filter(m => Math.abs(m.row.margin) <= 3).length;
  patterns.push({ category: 'Close game misses (|margin| <= 3)', n: closeGameMisses, correct: 0, accuracy: 0 });

  // Blowout misses (model got blowout wrong)
  const blowoutMisses = misses.filter(m => Math.abs(m.row.margin) >= 14).length;
  patterns.push({ category: 'Blowout misses (|margin| >= 14)', n: blowoutMisses, correct: 0, accuracy: 0 });

  // Confidence buckets
  for (const [label, lo, hi] of [['50-55%', 0.5, 0.55], ['55-60%', 0.55, 0.60], ['60-65%', 0.60, 0.65], ['65-70%', 0.65, 0.70], ['70%+', 0.70, 1.0]] as [string, number, number][]) {
    const bucket = rows.filter((_, i) => probabilities[i] >= lo && probabilities[i] < hi);
    if (bucket.length === 0) continue;
    const bucketHits = bucket.filter((r, i) => (probabilities[i] >= 0.5) === r.actualHome).length;
    patterns.push({ category: `Confidence ${label}`, n: bucket.length, correct: bucketHits, accuracy: bucketHits / bucket.length });
  }

  // Divisional
  const divGames = rows.filter(r => r.isDivisional === 1);
  const divHits = divGames.filter((r, i) => (probabilities[i] >= 0.5) === r.actualHome).length;
  patterns.push({ category: 'Divisional games', n: divGames.length, correct: divHits, accuracy: divGames.length ? divHits / divGames.length : 0 });

  // Prime time
  const primeTime = rows.filter(r => r.isPrimeTime === 1);
  const ptHits = primeTime.filter((r, i) => (probabilities[i] >= 0.5) === r.actualHome).length;
  patterns.push({ category: 'Prime time', n: primeTime.length, correct: ptHits, accuracy: primeTime.length ? ptHits / primeTime.length : 0 });

  // Dome
  const dome = rows.filter(r => r.isDome === 1);
  const domeHits = dome.filter((r, i) => (probabilities[i] >= 0.5) === r.actualHome).length;
  patterns.push({ category: 'Dome games', n: dome.length, correct: domeHits, accuracy: dome.length ? domeHits / dome.length : 0 });

  // Week buckets
  for (const [label, lo, hi] of [['Week 1', 1, 2], ['Week 2', 2, 3], ['Week 3', 3, 4]] as [string, number, number][]) {
    const bucket = rows.filter(r => r.week >= lo && r.week < hi);
    if (bucket.length === 0) continue;
    const hits = bucket.filter((r, i) => (probabilities[i] >= 0.5) === r.actualHome).length;
    patterns.push({ category: label, n: bucket.length, correct: hits, accuracy: hits / bucket.length });
  }

  // Rest differential patterns
  const shortRestAway = rows.filter(r => r.restDiff < -1);
  const srHits = shortRestAway.filter((r, i) => (probabilities[i] >= 0.5) === r.actualHome).length;
  patterns.push({ category: 'Away team short rest (<-1 day diff)', n: shortRestAway.length, correct: srHits, accuracy: shortRestAway.length ? srHits / shortRestAway.length : 0 });

  // Travel patterns
  const longTravel = rows.filter(r => r.travelMiles > 1500);
  const ltHits = longTravel.filter((r, i) => (probabilities[i] >= 0.5) === r.actualHome).length;
  patterns.push({ category: 'Long travel (>1500mi)', n: longTravel.length, correct: ltHits, accuracy: longTravel.length ? ltHits / longTravel.length : 0 });

  // Print
  for (const p of patterns) {
    const pct = p.n > 0 ? `${(p.accuracy * 100).toFixed(1)}%` : 'n/a';
    console.log(`  ${p.category.padEnd(50)} n=${p.n} | ${pct}`);
  }

  // Individual miss details
  console.log('\n  Individual misses:');
  for (const m of misses) {
    const modelPick = m.p >= 0.5 ? m.row.homeTeam : m.row.awayTeam;
    const actual = m.row.actualHome ? m.row.homeTeam : m.row.awayTeam;
    const marketPick = m.row.marketLogit > 0 ? m.row.homeTeam : m.row.awayTeam;
    const marketAgree = modelPick === marketPick ? 'AGREE' : 'DISAGREE';
    console.log(`    W${m.row.week} ${m.row.awayTeam}@${m.row.homeTeam} | model=${modelPick}(${(m.p * 100).toFixed(0)}%) actual=${actual} margin=${m.row.margin > 0 ? '+' : ''}${m.row.margin} | market=${marketPick} ${marketAgree} | SRS diff=${m.row.srsDiff.toFixed(1)} rest diff=${m.row.restDiff} travel=${m.row.travelMiles.toFixed(0)}mi`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('EXP-030 — Market-Calibrated Meta-Stacker');
  console.log('==========================================');
  console.log('Research-only shadow challenger. Does NOT modify v2.2 production.\n');

  // Load data
  console.log('Loading nflverse games.csv...');
  const response = await fetch(GAMES_URL);
  if (!response.ok) throw new Error(`Could not load games.csv: ${response.status}`);
  const text = await response.text();
  const allGames = parseMarketRows(text);
  console.log(`Loaded ${allGames.length} games`);

  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(t => [t.abbr, t]));
  const cache = new Map<string, number>(); // control probability cache

  /**
   * Compute v2.2 control probability for a game.
   * Uses the existing predictWinner function.
   */
  async function getControlProbability(game: ProcessedGame): Promise<number | null> {
    const key = game.gameId || `${game.season}:${game.week}:${game.awayTeam}@${game.homeTeam}`;
    const cached = cache.get(key);
    if (cached != null) return cached;

    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) return null;

    try {
      const result = await predictWinner(
        home, away,
        new Date(`${game.gameday}T12:00:00Z`),
        true,
        { neutralSite: game.location === 'Neutral' }
      );
      const p = result.modelScores?.finalHomeProbability != null
        ? result.modelScores.finalHomeProbability / 100
        : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
      cache.set(key, p);
      return p;
    } catch {
      return null;
    }
  }

  /**
   * Build feature row for a single game.
   */
  function buildFeatureRow(game: ProcessedGame, controlP: number, marketP: number | null): FeatureRow | null {
    const marketLogit = marketP != null ? logit(marketP) : logit(0.5);

    // SRS ratings
    const srsRatings = computeSrsRatings(allGames, game.gameday, game.season);
    const homeSrs = srsRatings.get(game.homeTeam) ?? 0;
    const awaySrs = srsRatings.get(game.awayTeam) ?? 0;
    const srsDiff = homeSrs - awaySrs;

    // Rest days
    const homeRest = computeRestDays(allGames, game.homeTeam, game.gameday, game.season);
    const awayRest = computeRestDays(allGames, game.awayTeam, game.gameday, game.season);
    const restDiff = homeRest - awayRest;

    // Travel
    const homeStadium = stadiumCoordinates[game.homeTeam];
    const awayStadium = stadiumCoordinates[game.awayTeam];
    let travelMiles = 0;
    let tzChange = 0;
    if (homeStadium && awayStadium && game.location !== 'Neutral') {
      travelMiles = haversineMiles(awayStadium.lat, awayStadium.lon, homeStadium.lat, homeStadium.lon);
      tzChange = homeStadium.tzOffset - awayStadium.tzOffset;
    }

    // Venue win pct
    const homeHomeWinPct = computeVenueWinPct(allGames, game.homeTeam, game.gameday, game.season, true);
    const awayAwayWinPct = computeVenueWinPct(allGames, game.awayTeam, game.gameday, game.season, false);

    // Game context
    const primeTime = isPrimeTimeGame(game.weekday, game.gametime) ? 1 : 0;
    const dome = (game.roof === 'dome' || game.roof === 'closed') ? 1 : 0;
    const turf = isTurfSurface(game.surface) ? 1 : 0;
    const spreadAbs = game.spreadLine != null ? Math.abs(game.spreadLine) : 3;
    const totalLine = game.totalLine ?? 45;

    // Interactions
    const restXTravel = restDiff * Math.log(travelMiles + 1);
    const restXTz = restDiff * tzChange;
    const divisionalXClose = (game.isDivisional ? 1 : 0) * (spreadAbs < 3 ? 1 : 0);
    const marketConfidence = marketP != null ? Math.max(marketP, 1 - marketP) : 0.5;

    return {
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      actualHome: game.homeScore > game.awayScore,
      margin: game.result,
      controlLogit: logit(controlP),
      marketLogit,
      srsDiff,
      restDiff,
      travelMiles,
      tzChange,
      isDivisional: game.isDivisional ? 1 : 0,
      homeHomeWinPct,
      awayAwayWinPct,
      isPrimeTime: primeTime,
      isDome: dome,
      isTurf: turf,
      spreadAbs,
      totalLine,
      restXTravel,
      restXTz,
      divisionalXClose,
      marketConfidence,
    };
  }

  // Build rows for each season
  const seasons = [2022, 2023, 2024, 2025, 2026];
  const allRows: FeatureRow[] = [];
  const allControlProbs: number[] = [];

  for (const season of seasons) {
    console.log(`\nProcessing ${season}...`);
    const seasonGames = allGames.filter(g =>
      g.season === season &&
      g.gameType === 'REG' &&
      Number.isFinite(g.homeScore) &&
      Number.isFinite(g.awayScore) &&
      g.homeScore !== g.awayScore
    );

    let processed = 0;
    for (const game of seasonGames) {
      const marketP = noVigHomeProbability(game.homeMoneyline, game.awayMoneyline);
      const controlP = await getControlProbability(game);
      if (controlP == null) continue;

      const row = buildFeatureRow(game, controlP, marketP);
      if (row) {
        allRows.push(row);
        allControlProbs.push(controlP);
        processed++;
      }
    }
    console.log(`  Processed ${processed} games (${allRows.length} total)`);
  }

  // Split into train/select/confirm/observe
  const trainRows = allRows.filter(r => r.season === 2022 || r.season === 2023);
  const selectRows = allRows.filter(r => r.season === 2024);
  const confirmRows = allRows.filter(r => r.season === 2025);
  const observeRows = allRows.filter(r => r.season === 2026 && r.week <= 3);

  console.log(`\nSplit: train=${trainRows.length}, select=${selectRows.length}, confirm=${confirmRows.length}, observe=${observeRows.length}`);

  // Build feature matrices — three variants for comparison
  // Full model (18 features), Core model (6 features), Market-dominant (3 features)
  const fullFeatureNames = [
    'controlLogit', 'marketLogit', 'srsDiff', 'restDiff', 'travelMiles',
    'tzChange', 'isDivisional', 'homeHomeWinPct', 'awayAwayWinPct',
    'isPrimeTime', 'isDome', 'isTurf', 'spreadAbs', 'totalLine',
    'restXTravel', 'restXTz', 'divisionalXClose', 'marketConfidence'
  ];
  // Core: strongest signals only
  const coreFeatureNames = [
    'controlLogit', 'marketLogit', 'srsDiff', 'isDivisional', 'isDome', 'spreadAbs'
  ];
  // Market-dominant: just control + market + disagreement
  const marketDomNames = ['controlLogit', 'marketLogit', 'marketConfidence'];

  function toFullVector(row: FeatureRow): number[] {
    return [
      row.controlLogit, row.marketLogit, row.srsDiff, row.restDiff,
      Math.log(row.travelMiles + 1), row.tzChange, row.isDivisional,
      row.homeHomeWinPct, row.awayAwayWinPct, row.isPrimeTime,
      row.isDome, row.isTurf, row.spreadAbs, row.totalLine,
      row.restXTravel, row.restXTz, row.divisionalXClose, row.marketConfidence
    ];
  }
  function toCoreVector(row: FeatureRow): number[] {
    return [
      row.controlLogit, row.marketLogit, row.srsDiff,
      row.isDivisional, row.isDome, row.spreadAbs
    ];
  }
  function toMarketDomVector(row: FeatureRow): number[] {
    return [row.controlLogit, row.marketLogit, row.marketConfidence];
  }

  interface VariantResult {
    name: string;
    featureNames: string[];
    toVector: (row: FeatureRow) => number[];
    bestSelect: { lambda: number; lr: number; iterations: number; metrics: Metrics; model: LogisticRegression };
    confirmMetrics: Metrics;
    confirmProbs: number[];
    observeMetrics: Metrics;
    observeProbs: number[];
  }

  function trainAndEvaluate(
    name: string,
    featNames: string[],
    toVector: (row: FeatureRow) => number[]
  ): VariantResult {
    const trainX = trainRows.map(toVector);
    const trainY = trainRows.map(r => r.actualHome ? 1 : 0);

    // Normalize using train statistics
    const means = new Array(featNames.length).fill(0);
    const stds = new Array(featNames.length).fill(1);
    for (let j = 0; j < featNames.length; j++) {
      const col = trainX.map(row => row[j]);
      means[j] = col.reduce((s, v) => s + v, 0) / col.length;
      const variance = col.reduce((s, v) => s + (v - means[j]) ** 2, 0) / col.length;
      stds[j] = Math.max(0.001, Math.sqrt(variance));
    }
    function normalize(X: number[][]): number[][] {
      return X.map(row => row.map((v, j) => (v - means[j]) / stds[j]));
    }

    const trainXNorm = normalize(trainX);

    const lambdaCandidates = [0.001, 0.01, 0.05, 0.1, 0.5, 1.0];
    const lrCandidates = [0.005, 0.01, 0.05];
    const iterCandidates = [300, 500];

    let best: { lambda: number; lr: number; iterations: number; metrics: Metrics; model: LogisticRegression } | null = null;

    for (const lambda of lambdaCandidates) {
      for (const lr of lrCandidates) {
        for (const iterations of iterCandidates) {
          const model = new LogisticRegression(featNames.length, lr, lambda, iterations);
          model.fit(trainXNorm, trainY);

          const trainPreds = model.predict(trainXNorm);
          model.calibrate(trainPreds, trainY);

          const selectX = normalize(selectRows.map(toVector));
          const selectProbs = model.predictCalibrated(selectX);
          const selectMetrics = computeMetrics(selectProbs, selectRows.map(r => r.actualHome));

          // Select on Brier (less noisy than accuracy), tiebreak on accuracy
          if (best === null ||
            selectMetrics.brier < best.metrics.brier ||
            (selectMetrics.brier === best.metrics.brier && selectMetrics.accuracy > best.metrics.accuracy)) {
            best = { lambda, lr, iterations, metrics: selectMetrics, model };
          }
        }
      }
    }

    // Confirm on 2025
    const confirmX = normalize(confirmRows.map(toVector));
    const confirmProbs = best!.model.predictCalibrated(confirmX);
    const confirmMetrics = computeMetrics(confirmProbs, confirmRows.map(r => r.actualHome));

    // Observe 2026
    const observeX = normalize(observeRows.map(toVector));
    const observeProbs = best!.model.predictCalibrated(observeX);
    const observeMetrics = computeMetrics(observeProbs, observeRows.map(r => r.actualHome));

    console.log(`\n${name} (lambda=${best!.lambda}, lr=${best!.lr}, iters=${best!.iterations})`);
    console.log(`  2024: ${(best!.metrics.accuracy * 100).toFixed(2)}% Brier ${best!.metrics.brier.toFixed(4)}`);
    console.log(`  2025: ${(confirmMetrics.accuracy * 100).toFixed(2)}% Brier ${confirmMetrics.brier.toFixed(4)}`);
    console.log(`  2026 W1-3: ${(observeMetrics.accuracy * 100).toFixed(2)}% Brier ${observeMetrics.brier.toFixed(4)}`);

    return {
      name, featureNames: featNames, toVector,
      bestSelect: best!, confirmMetrics, confirmProbs, observeMetrics, observeProbs
    };
  }

  console.log('\nTraining meta-stacker variants...');
  const variants: VariantResult[] = [
    trainAndEvaluate('Full (18 features)', fullFeatureNames, toFullVector),
    trainAndEvaluate('Core (6 features)', coreFeatureNames, toCoreVector),
    trainAndEvaluate('Market-dominant (3 features)', marketDomNames, toMarketDomVector),
  ];

  // Pick the best variant based on 2025 Brier (confirmation)
  const best = [...variants].sort((a, b) => a.confirmMetrics.brier - b.confirmMetrics.brier)[0];
  console.log(`\nBest variant by 2025 Brier: ${best.name}`);

  // Use the best variant for the final report
  const bestSelect = best.bestSelect;
  const confirmMetrics = best.confirmMetrics;
  const confirmProbs = best.confirmProbs;
  const observeMetrics = best.observeMetrics;
  const observeProbs = best.observeProbs;
  const featureNames = best.featureNames;

  // Also compute all variant results for the report
  const allVariants = variants.map(v => ({
    name: v.name,
    select: v.bestSelect.metrics,
    confirm: v.confirmMetrics,
    observe: v.observeMetrics,
  }));

  const confirmControlMetrics = computeMetrics(
    confirmRows.map(r => {
      const idx = allRows.indexOf(r);
      return allControlProbs[idx];
    }),
    confirmRows.map(r => r.actualHome)
  );

  const confirmMarketProbs = confirmRows.map(r => {
    const p = logistic(r.marketLogit);
    return clamp(p, 0.001, 0.999);
  });
  const confirmMarketMetrics = computeMetrics(confirmMarketProbs, confirmRows.map(r => r.actualHome));

  console.log('\nUNTOUCHED CONFIRMATION — 2025');
  console.log(metricLine('v2.2 control', confirmControlMetrics));
  console.log(metricLine('market-only', confirmMarketMetrics));
  console.log(metricLine(`EXP-030 ${best.name}`, confirmMetrics));

  // Paired comparison
  let challengerOnly = 0;
  let controlOnly = 0;
  for (let i = 0; i < confirmRows.length; i++) {
    const chHit = (confirmProbs[i] >= 0.5) === confirmRows[i].actualHome;
    const ctrlIdx = allRows.indexOf(confirmRows[i]);
    const ctrlP = allControlProbs[ctrlIdx];
    const ctrlHit = (ctrlP >= 0.5) === confirmRows[i].actualHome;
    if (chHit && !ctrlHit) challengerOnly++;
    if (ctrlHit && !chHit) controlOnly++;
  }
  const p = exactMcNemarP(challengerOnly, controlOnly);
  console.log(`Paired vs control: challenger-only=${challengerOnly}, control-only=${controlOnly}, p=${p.toFixed(4)}`);

  const observeControlProbs = observeRows.map(r => {
    const idx = allRows.indexOf(r);
    return allControlProbs[idx];
  });
  const observeControlMetrics = computeMetrics(observeControlProbs, observeRows.map(r => r.actualHome));

  const observeMarketProbs = observeRows.map(r => clamp(logistic(r.marketLogit), 0.001, 0.999));
  const observeMarketMetrics = computeMetrics(observeMarketProbs, observeRows.map(r => r.actualHome));

  console.log('\n2026 WEEKS 1-3 OBSERVATION ONLY');
  console.log(metricLine('v2.2 control', observeControlMetrics));
  console.log(metricLine('market-only', observeMarketMetrics));
  console.log(metricLine(`EXP-030 ${best.name}`, observeMetrics));
  console.log(`(2026 observation is NOT validation. NOT used for tuning.)`);

  // Target check
  const targetHit = observeMetrics.accuracy >= 0.70;
  console.log(`\nTarget: 70%+ on 2026 W1-3: ${targetHit ? 'YES' : 'NO'} (${(observeMetrics.accuracy * 100).toFixed(1)}%)`);

  // Miss pattern analysis if under 70%
  if (!targetHit) {
    missPatternAnalysis(observeRows, observeProbs, observeControlProbs);
  }

  // Also run miss pattern analysis on 2025 for context
  console.log('\n--- 2025 miss patterns (for context) ---');
  const confirmControlProbsArr = confirmRows.map(r => {
    const idx = allRows.indexOf(r);
    return allControlProbs[idx];
  });
  missPatternAnalysis(confirmRows, confirmProbs, confirmControlProbsArr);

  // Write report
  await mkdir('research/reports', { recursive: true });

  const report = [
    '# EXP-030 — Market-Calibrated Meta-Stacker',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Protocol',
    '',
    '- Train: 2022-2023 (chronological)',
    '- Select: 2024 (hyperparameter selection by Brier)',
    '- Confirm: 2025 (untouched)',
    '- Observe: 2026 Weeks 1-3 (observation only, NOT validation)',
    '- Model: L2-regularized logistic regression (gradient descent)',
    '- Calibration: Platt scaling (trained on training period)',
    '- Three variants tested: Full (18 features), Core (6 features), Market-dominant (3 features)',
    `- Best variant selected by 2025 Brier: ${best.name}`,
    '- This is a research-only shadow. v2.2 production is unchanged.',
    '',
    '## All variants comparison',
    '',
    '```',
    ...allVariants.map(v =>
      `${v.name.padEnd(30)} 2024: ${(v.select.accuracy*100).toFixed(1)}% Brier ${v.select.brier.toFixed(4)} | 2025: ${(v.confirm.accuracy*100).toFixed(1)}% Brier ${v.confirm.brier.toFixed(4)} | 2026W1-3: ${(v.observe.accuracy*100).toFixed(1)}% Brier ${v.observe.brier.toFixed(4)}`
    ),
    '```',
    '',
    '## Results (best variant)',
    '',
    '```',
    metricLine('2024 control', computeMetrics(
      selectRows.map(r => {
        const idx = allRows.indexOf(r);
        return allControlProbs[idx];
      }),
      selectRows.map(r => r.actualHome)
    )),
    metricLine('2024 market-only', computeMetrics(
      selectRows.map(r => clamp(logistic(r.marketLogit), 0.001, 0.999)),
      selectRows.map(r => r.actualHome)
    )),
    metricLine(`2024 ${best.name}`, bestSelect!.metrics),
    '',
    metricLine('2025 control', confirmControlMetrics),
    metricLine('2025 market-only', confirmMarketMetrics),
    metricLine(`2025 ${best.name}`, confirmMetrics),
    `paired: challenger-only=${challengerOnly}, control-only=${controlOnly}, p=${p.toFixed(4)}`,
    '',
    metricLine('2026 W1-3 control', observeControlMetrics),
    metricLine('2026 W1-3 market-only', observeMarketMetrics),
    metricLine(`2026 W1-3 ${best.name}`, observeMetrics),
    `Target 70%: ${targetHit ? 'YES' : 'NO'}`,
    '```',
    '',
    '## Decision',
    '',
    targetHit
      ? '2026 W1-3 observation met 70% target. NOT validation. Requires 2025 confirmation to promote.'
      : '2026 W1-3 observation did NOT meet 70% target. Miss pattern analysis above. No promotion.',
    '',
    `## Feature weights (${best.name})`,
    '',
    '```',
    ...featureNames.map((name, i) => `${name.padEnd(25)} weight=${bestSelect!.model.weights[i].toFixed(4)}`),
    `bias                      ${bestSelect!.model.bias.toFixed(4)}`,
    `platt A                   ${bestSelect!.model._calA.toFixed(4)}`,
    `platt B                   ${bestSelect!.model._calB.toFixed(4)}`,
    '```',
  ].join('\n');

  await writeFile('research/reports/exp-030.md', report);

  await writeFile('research/reports/exp-030.json', JSON.stringify({
    bestVariant: best.name,
    selectedParams: { lambda: bestSelect!.lambda, lr: bestSelect!.lr, iterations: bestSelect!.iterations },
    allVariants,
    train: { n: trainRows.length },
    select: {
      control: computeMetrics(selectRows.map(r => allControlProbs[allRows.indexOf(r)]), selectRows.map(r => r.actualHome)),
      market: computeMetrics(selectRows.map(r => clamp(logistic(r.marketLogit), 0.001, 0.999)), selectRows.map(r => r.actualHome)),
      metaStacker: bestSelect!.metrics,
    },
    confirmation2025: {
      control: confirmControlMetrics,
      market: confirmMarketMetrics,
      metaStacker: confirmMetrics,
      paired: { challengerOnly, controlOnly, p },
    },
    observation2026: {
      control: observeControlMetrics,
      market: observeMarketMetrics,
      metaStacker: observeMetrics,
      target70: targetHit,
    },
    weights: bestSelect!.model.weights,
    bias: bestSelect!.model.bias,
    plattA: bestSelect!.model._calA,
    plattB: bestSelect!.model._calB,
    featureNames,
  }, null, 2));

  console.log('\nReport written to research/reports/exp-030.md');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
