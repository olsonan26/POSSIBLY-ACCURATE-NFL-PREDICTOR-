import { mkdir } from 'node:fs/promises';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const FEATURE_NAMES = ['baseEloLogit', 'currentForm', 'venue', 'h2h'] as const;
const CANDIDATE_LAMBDAS = [0, 0.01, 0.1, 1, 10, 100] as const;

type FeatureName = typeof FEATURE_NAMES[number];
type Game = ReturnType<typeof parseGamesCsv>[number];

interface Snapshot {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  actualMargin: number;
  actualHomeWin: boolean;
  controlPHome: number;
  features: Record<FeatureName, number>;
}

interface Standardizer {
  mean: number[];
  sd: number[];
}

interface RidgeModel {
  lambda: number;
  featureNames: FeatureName[];
  standardizer: Standardizer;
  coefficients: number[];
}

interface PredictionRow extends Snapshot {
  predictedMargin: number;
  challengerPHome: number;
  controlHit: boolean;
  challengerHit: boolean;
}

interface ProbabilityMetrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  ece: number;
}

interface MarginMetrics {
  n: number;
  mae: number;
  rmse: number;
}

interface Evaluation {
  probability: ProbabilityMetrics;
  margin: MarginMetrics;
  rows: PredictionRow[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const logit = (probability: number) => {
  const p = clamp(probability, 0.001, 0.999);
  return Math.log(p / (1 - p));
};

// Abramowitz-Stegun approximation, sufficient for probability calibration diagnostics.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sd(values: number[], center = mean(values)): number {
  if (!values.length) return 1;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - center, 2), 0) / values.length;
  return Math.sqrt(variance) || 1;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) augmented[pivot][col] += 1e-8;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];

    const divisor = augmented[col][col] || 1e-8;
    for (let j = col; j <= n; j++) augmented[col][j] /= divisor;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (!factor) continue;
      for (let j = col; j <= n; j++) augmented[row][j] -= factor * augmented[col][j];
    }
  }

  return augmented.map(row => row[n]);
}

function fitRidge(rows: Snapshot[], lambda: number, featureNames: FeatureName[]): RidgeModel {
  if (rows.length < featureNames.length + 10) throw new Error('Too few training rows for ridge model.');
  const raw = rows.map(row => featureNames.map(name => row.features[name]));
  const means = featureNames.map((_, j) => mean(raw.map(values => values[j])));
  const sds = featureNames.map((_, j) => sd(raw.map(values => values[j]), means[j]));
  const x = raw.map(values => [1, ...values.map((value, j) => (value - means[j]) / sds[j])]);
  const y = rows.map(row => row.actualMargin);
  const p = x[0].length;
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);

  for (let i = 0; i < x.length; i++) {
    for (let a = 0; a < p; a++) {
      xty[a] += x[i][a] * y[i];
      for (let b = 0; b < p; b++) xtx[a][b] += x[i][a] * x[i][b];
    }
  }
  for (let j = 1; j < p; j++) xtx[j][j] += lambda;
  xtx[0][0] += 1e-8;

  return {
    lambda,
    featureNames,
    standardizer: { mean: means, sd: sds },
    coefficients: solveLinearSystem(xtx, xty)
  };
}

function predictMargin(model: RidgeModel, row: Snapshot): number {
  const standardized = model.featureNames.map((name, j) =>
    (row.features[name] - model.standardizer.mean[j]) / model.standardizer.sd[j]
  );
  return model.coefficients[0] + standardized.reduce((sum, value, j) => sum + value * model.coefficients[j + 1], 0);
}

function expectedCalibrationError(rows: Array<{ pHome: number; actualHomeWin: boolean }>, bins = 10): number {
  if (!rows.length) return 0;
  let ece = 0;
  for (let bin = 0; bin < bins; bin++) {
    const lo = bin / bins;
    const hi = (bin + 1) / bins;
    const bucket = rows.filter(row => row.pHome >= lo && (bin === bins - 1 ? row.pHome <= hi : row.pHome < hi));
    if (!bucket.length) continue;
    const avgP = mean(bucket.map(row => row.pHome));
    const actual = mean(bucket.map(row => row.actualHomeWin ? 1 : 0));
    ece += (bucket.length / rows.length) * Math.abs(avgP - actual);
  }
  return ece;
}

function probabilityMetrics(rows: PredictionRow[], probability: 'controlPHome' | 'challengerPHome'): ProbabilityMetrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, ece: 0 };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const p = clamp(row[probability], 0.001, 0.999);
    const y = row.actualHomeWin ? 1 : 0;
    correct += (p >= 0.5) === row.actualHomeWin ? 1 : 0;
    brier += Math.pow(p - y, 2);
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return {
    n: rows.length,
    correct,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    ece: expectedCalibrationError(rows.map(row => ({ pHome: row[probability], actualHomeWin: row.actualHomeWin })))
  };
}

function marginMetrics(rows: PredictionRow[]): MarginMetrics {
  if (!rows.length) return { n: 0, mae: 0, rmse: 0 };
  const errors = rows.map(row => row.predictedMargin - row.actualMargin);
  return {
    n: rows.length,
    mae: mean(errors.map(error => Math.abs(error))),
    rmse: Math.sqrt(mean(errors.map(error => error * error)))
  };
}

function evaluate(model: RidgeModel, rows: Snapshot[], sigma: number): Evaluation {
  const predictions: PredictionRow[] = rows.map(row => {
    const predictedMargin = predictMargin(model, row);
    const challengerPHome = clamp(normalCdf(predictedMargin / sigma), 0.001, 0.999);
    return {
      ...row,
      predictedMargin,
      challengerPHome,
      controlHit: (row.controlPHome >= 0.5) === row.actualHomeWin,
      challengerHit: (challengerPHome >= 0.5) === row.actualHomeWin
    };
  });
  return {
    probability: probabilityMetrics(predictions, 'challengerPHome'),
    margin: marginMetrics(predictions),
    rows: predictions
  };
}

function residualSigma(model: RidgeModel, rows: Snapshot[]): number {
  const residuals = rows.map(row => row.actualMargin - predictMargin(model, row));
  const center = mean(residuals);
  return Math.max(6, sd(residuals, center));
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

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function printProbability(label: string, metric: ProbabilityMetrics) {
  console.log(`${label}: ${metric.correct}/${metric.n} = ${fmtPct(metric.accuracy)} | Brier ${metric.brier.toFixed(4)} | LogLoss ${metric.logLoss.toFixed(4)} | ECE ${metric.ece.toFixed(4)}`);
}

function printMargin(label: string, metric: MarginMetrics) {
  console.log(`${label}: MAE ${metric.mae.toFixed(3)} | RMSE ${metric.rmse.toFixed(3)}`);
}

function splitRows(rows: PredictionRow[], predicate: (row: PredictionRow) => boolean) {
  return rows.filter(predicate);
}

function reportSplit(label: string, rows: PredictionRow[]) {
  if (!rows.length) return;
  const control = probabilityMetrics(rows, 'controlPHome');
  const challenger = probabilityMetrics(rows, 'challengerPHome');
  const margin = marginMetrics(rows);
  console.log(`${label.padEnd(18)} n=${rows.length} | control ${fmtPct(control.accuracy)} | margin ${fmtPct(challenger.accuracy)} | Δacc ${((challenger.accuracy - control.accuracy) * 100).toFixed(2)} | ΔBrier ${(challenger.brier - control.brier).toFixed(4)} | MAE ${margin.mae.toFixed(2)}`);
}

function failureClusters(rows: PredictionRow[]) {
  const misses = rows.filter(row => !row.challengerHit);
  return {
    misses: misses.length,
    earlyWeeks1to4: misses.filter(row => row.week <= 4).length,
    middleWeeks5to9: misses.filter(row => row.week >= 5 && row.week <= 9).length,
    lateWeeks10to18: misses.filter(row => row.week >= 10).length,
    oneScoreActual: misses.filter(row => Math.abs(row.actualMargin) <= 8).length,
    blowoutActual14Plus: misses.filter(row => Math.abs(row.actualMargin) >= 14).length,
    actualAwayWinner: misses.filter(row => !row.actualHomeWin).length,
    highConfidenceMiss67Plus: misses.filter(row => Math.max(row.challengerPHome, 1 - row.challengerPHome) >= 0.67).length,
    controlCorrectChallengerWrong: rows.filter(row => row.controlHit && !row.challengerHit).length,
    challengerCorrectControlWrong: rows.filter(row => !row.controlHit && row.challengerHit).length
  };
}

async function buildSnapshots(games: Game[], season: number): Promise<Snapshot[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const eligible = games.filter(game =>
    game.season === season &&
    game.gameType === 'REG' &&
    game.gameday < todayIso &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );

  const snapshots: Snapshot[] = [];
  let index = 0;
  for (const game of eligible) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;
    const result = await predictWinner(
      home,
      away,
      new Date(`${game.gameday}T12:00:00Z`),
      true,
      { neutralSite: game.location === 'Neutral' }
    );
    const scores = result.modelScores;
    if (!scores || !Number.isFinite(scores.finalHomeProbability)) continue;
    const homeScore = Number(game.homeScore);
    const awayScore = Number(game.awayScore);
    snapshots.push({
      gameId: String(game.gameId || `${season}:${game.week}:${game.awayTeam}@${game.homeTeam}`),
      season,
      week: game.week,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      actualMargin: homeScore - awayScore,
      actualHomeWin: homeScore > awayScore,
      controlPHome: clamp(scores.finalHomeProbability / 100, 0.001, 0.999),
      features: {
        baseEloLogit: logit(scores.baseHomeProbability / 100),
        currentForm: scores.footballLogitAdjustment,
        venue: scores.venueLogitAdjustment,
        h2h: scores.h2hLogitAdjustment
      }
    });
    index++;
    if (index % 100 === 0) console.log(`snapshot progress ${season}: ${index}/${eligible.length}`);
  }
  return snapshots;
}

function controlMetrics(rows: PredictionRow[]) {
  return probabilityMetrics(rows, 'controlPHome');
}

function decision(control: ProbabilityMetrics, challenger: ProbabilityMetrics, pValue: number): string {
  const better = [
    challenger.accuracy > control.accuracy,
    challenger.brier < control.brier,
    challenger.logLoss < control.logLoss
  ].filter(Boolean).length;
  const worse = [
    challenger.accuracy < control.accuracy,
    challenger.brier > control.brier,
    challenger.logLoss > control.logLoss
  ].filter(Boolean).length;
  if (better === 3 && pValue <= 0.10) return 'SURVIVES FOR REPLICATION';
  if (better >= 2) return 'PROMISING';
  if (worse === 3) return 'KILL';
  return 'INCONCLUSIVE';
}

async function writeOutputs(payload: Record<string, unknown>, markdown: string) {
  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  await Bun.write('research/runtime/exp-008.json', JSON.stringify(payload, null, 2));
  await Bun.write('research/reports/exp-008.md', markdown);
}

async function main() {
  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load nflverse games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());

  console.log('\nEXP-008 — Expected Margin Engine');
  console.log('================================');
  console.log('Hypothesis: predicting continuous home-minus-away scoring margin first, then mapping margin to win probability, can outperform direct winner classification.');
  console.log('Protocol: 2023 fit base -> 2024 discovery/select lambda -> lock -> refit through 2024 -> untouched 2025 confirmation -> 2026 observational check.');
  console.log('Production v2.2 is not modified. Betting market, astrology, Lettrology, and future information are excluded from this challenger.');

  const snapshots2023 = await buildSnapshots(games, 2023);
  const snapshots2024 = await buildSnapshots(games, 2024);
  const snapshots2025 = await buildSnapshots(games, 2025);
  const snapshots2026 = await buildSnapshots(games, 2026);
  console.log(`Snapshots: 2023=${snapshots2023.length}, 2024=${snapshots2024.length}, 2025=${snapshots2025.length}, 2026=${snapshots2026.length}`);

  if (snapshots2023.length < 200 || snapshots2024.length < 200 || snapshots2025.length < 200) {
    throw new Error('EXP-008 requires complete 2023-2025 regular-season snapshot populations.');
  }

  console.log('\n2024 DISCOVERY — lambda selection by margin MAE only');
  const discovery: Array<{ lambda: number; model: RidgeModel; evaluation: Evaluation; sigma: number }> = [];
  for (const lambda of CANDIDATE_LAMBDAS) {
    const model = fitRidge(snapshots2023, lambda, [...FEATURE_NAMES]);
    const sigma = residualSigma(model, snapshots2024);
    const evaluation = evaluate(model, snapshots2024, sigma);
    discovery.push({ lambda, model, evaluation, sigma });
    console.log(`lambda=${lambda.toFixed(2).padEnd(6)} | MAE ${evaluation.margin.mae.toFixed(3)} | RMSE ${evaluation.margin.rmse.toFixed(3)} | provisional Brier ${evaluation.probability.brier.toFixed(4)}`);
  }
  const selected = discovery.reduce((best, candidate) => {
    if (candidate.evaluation.margin.mae < best.evaluation.margin.mae - 1e-9) return candidate;
    if (Math.abs(candidate.evaluation.margin.mae - best.evaluation.margin.mae) <= 1e-9 && candidate.evaluation.probability.brier < best.evaluation.probability.brier) return candidate;
    return best;
  });
  const frozenLambda = selected.lambda;
  const frozenSigma = selected.sigma;
  console.log(`\nLOCKED after 2024 discovery: lambda=${frozenLambda}; residual sigma=${frozenSigma.toFixed(3)} points.`);
  console.log('No 2025 result is used to reselect either value.');

  const trainThrough2024 = [...snapshots2023, ...snapshots2024];
  const finalModel2025 = fitRidge(trainThrough2024, frozenLambda, [...FEATURE_NAMES]);
  const validation2025 = evaluate(finalModel2025, snapshots2025, frozenSigma);
  const control2025 = controlMetrics(validation2025.rows);
  const challenge2025 = validation2025.probability;
  const challengerOnly = validation2025.rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = validation2025.rows.filter(row => row.controlHit && !row.challengerHit).length;
  const pairedP = exactMcNemarP(challengerOnly, controlOnly);

  console.log('\nUNTOUCHED 2025 CONFIRMATION');
  printProbability('CONTROL v2.2', control2025);
  printProbability('EXP-008 margin', challenge2025);
  printMargin('EXP-008 margin error', validation2025.margin);
  console.log(`Paired flips: challenger-only correct=${challengerOnly}, control-only correct=${controlOnly}, exact p=${pairedP.toFixed(4)}`);
  console.log(`Δaccuracy ${((challenge2025.accuracy - control2025.accuracy) * 100).toFixed(2)} points | ΔBrier ${(challenge2025.brier - control2025.brier).toFixed(4)} | ΔLogLoss ${(challenge2025.logLoss - control2025.logLoss).toFixed(4)}`);

  console.log('\n2025 SPLITS');
  reportSplit('Weeks 1-4', splitRows(validation2025.rows, row => row.week <= 4));
  reportSplit('Weeks 5-9', splitRows(validation2025.rows, row => row.week >= 5 && row.week <= 9));
  reportSplit('Weeks 10-18', splitRows(validation2025.rows, row => row.week >= 10));
  reportSplit('Actual home wins', splitRows(validation2025.rows, row => row.actualHomeWin));
  reportSplit('Actual away wins', splitRows(validation2025.rows, row => !row.actualHomeWin));
  reportSplit('One-score <=8', splitRows(validation2025.rows, row => Math.abs(row.actualMargin) <= 8));
  reportSplit('Blowout >=14', splitRows(validation2025.rows, row => Math.abs(row.actualMargin) >= 14));

  console.log('\nABLATION — frozen lambda/sigma, no 2025 reselection');
  const ablations: Record<string, { accuracy: number; brier: number; logLoss: number; mae: number }> = {};
  for (const removed of FEATURE_NAMES) {
    const names = FEATURE_NAMES.filter(name => name !== removed);
    const model = fitRidge(trainThrough2024, frozenLambda, names);
    const result = evaluate(model, snapshots2025, frozenSigma);
    ablations[`remove_${removed}`] = {
      accuracy: result.probability.accuracy,
      brier: result.probability.brier,
      logLoss: result.probability.logLoss,
      mae: result.margin.mae
    };
    console.log(`REMOVE ${removed.padEnd(14)} | acc ${fmtPct(result.probability.accuracy)} | Brier ${result.probability.brier.toFixed(4)} | LogLoss ${result.probability.logLoss.toFixed(4)} | MAE ${result.margin.mae.toFixed(3)}`);
  }

  console.log('\nNEIGHBORING LAMBDAS — 2025 diagnostic only, never reselect');
  const selectedIndex = CANDIDATE_LAMBDAS.indexOf(frozenLambda as typeof CANDIDATE_LAMBDAS[number]);
  const neighborIndexes = [...new Set([Math.max(0, selectedIndex - 1), selectedIndex, Math.min(CANDIDATE_LAMBDAS.length - 1, selectedIndex + 1)])];
  const robustness: Record<string, { accuracy: number; brier: number; logLoss: number; mae: number }> = {};
  for (const index of neighborIndexes) {
    const lambda = CANDIDATE_LAMBDAS[index];
    const model = fitRidge(trainThrough2024, lambda, [...FEATURE_NAMES]);
    const result = evaluate(model, snapshots2025, frozenSigma);
    robustness[String(lambda)] = {
      accuracy: result.probability.accuracy,
      brier: result.probability.brier,
      logLoss: result.probability.logLoss,
      mae: result.margin.mae
    };
    console.log(`lambda=${lambda.toFixed(2).padEnd(6)} | acc ${fmtPct(result.probability.accuracy)} | Brier ${result.probability.brier.toFixed(4)} | LogLoss ${result.probability.logLoss.toFixed(4)} | MAE ${result.margin.mae.toFixed(3)}`);
  }

  const failures = failureClusters(validation2025.rows);
  console.log('\nFAILURE CLUSTERS — descriptive, not tuning targets');
  for (const [name, value] of Object.entries(failures)) console.log(`${name}: ${value}`);

  let observation2026: Evaluation | null = null;
  let control2026: ProbabilityMetrics | null = null;
  if (snapshots2026.length) {
    const trainThrough2025 = [...trainThrough2024, ...snapshots2025];
    const model2026 = fitRidge(trainThrough2025, frozenLambda, [...FEATURE_NAMES]);
    observation2026 = evaluate(model2026, snapshots2026, frozenSigma);
    control2026 = controlMetrics(observation2026.rows);
    console.log('\n2026 OBSERVATIONAL CHECK — parameters remain frozen');
    printProbability('CONTROL v2.2', control2026);
    printProbability('EXP-008 margin', observation2026.probability);
    printMargin('EXP-008 margin error', observation2026.margin);
  }

  const verdict = decision(control2025, challenge2025, pairedP);
  console.log(`\nVERDICT: ${verdict}`);
  console.log('Governance: EXP-008 does not change production v2.2. Any future promotion requires a separate explicit decision.');

  const payload = {
    experiment: 'EXP-008',
    title: 'Expected Margin Engine',
    generatedAt: new Date().toISOString(),
    hypothesis: 'Predicting continuous home-minus-away point margin first, then converting the frozen margin estimate through a discovery-only residual distribution, can improve winner probability quality versus direct winner classification.',
    protocol: {
      baseFit: 2023,
      discovery: 2024,
      confirmation: 2025,
      observation: 2026,
      selectionMetric: '2024 margin MAE',
      candidateLambdas: CANDIDATE_LAMBDAS,
      featureNames: FEATURE_NAMES,
      marketDataUsed: false,
      astrologyUsed: false,
      lettrologyUsed: false
    },
    locked: { lambda: frozenLambda, residualSigmaPoints: frozenSigma },
    discovery2024: discovery.map(item => ({
      lambda: item.lambda,
      margin: item.evaluation.margin,
      probability: item.evaluation.probability,
      residualSigmaPoints: item.sigma
    })),
    confirmation2025: {
      control: control2025,
      challenger: challenge2025,
      margin: validation2025.margin,
      delta: {
        accuracyPoints: (challenge2025.accuracy - control2025.accuracy) * 100,
        brier: challenge2025.brier - control2025.brier,
        logLoss: challenge2025.logLoss - control2025.logLoss
      },
      paired: { challengerOnly, controlOnly, exactP: pairedP },
      failureClusters: failures,
      ablations,
      robustness
    },
    observation2026: observation2026 && control2026 ? {
      control: control2026,
      challenger: observation2026.probability,
      margin: observation2026.margin,
      games: observation2026.rows.length
    } : null,
    verdict
  };

  const markdown = `# EXP-008 — Expected Margin Engine\n\n` +
    `## Hypothesis\nPredict continuous home-minus-away scoring margin first, then convert that margin to win probability using a residual distribution estimated only from discovery data.\n\n` +
    `## Research contract\n- 2023: coefficient training base\n- 2024: discovery and ridge-lambda selection by margin MAE\n- Lock lambda and residual sigma\n- 2025: untouched confirmation\n- 2026: observational forward-style check\n- No market data, astrology, Lettrology, or future information in the challenger\n- Production v2.2 remains unchanged\n\n` +
    `## Locked parameters\n- Ridge lambda: **${frozenLambda}**\n- Margin residual sigma: **${frozenSigma.toFixed(3)} points**\n- Features: ${FEATURE_NAMES.join(', ')}\n\n` +
    `## Untouched 2025 confirmation\n| Model | Accuracy | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|\n| v2.2 control | ${fmtPct(control2025.accuracy)} | ${control2025.brier.toFixed(4)} | ${control2025.logLoss.toFixed(4)} | ${control2025.ece.toFixed(4)} |\n| EXP-008 | ${fmtPct(challenge2025.accuracy)} | ${challenge2025.brier.toFixed(4)} | ${challenge2025.logLoss.toFixed(4)} | ${challenge2025.ece.toFixed(4)} |\n\n` +
    `EXP-008 margin MAE: **${validation2025.margin.mae.toFixed(3)}** points; RMSE: **${validation2025.margin.rmse.toFixed(3)}** points.\n\n` +
    `Paired flips: challenger-only correct **${challengerOnly}**, control-only correct **${controlOnly}**, exact paired p **${pairedP.toFixed(4)}**.\n\n` +
    `## Decision\n**${verdict}**\n\n` +
    `This status is research-only and does not promote the challenger into production.\n`;

  await writeOutputs(payload, markdown);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
