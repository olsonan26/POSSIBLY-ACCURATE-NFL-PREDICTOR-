import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv`;

const LAMBDAS = [25, 100, 400] as const;
const WEIGHTS = [0, 0.05, 0.10, 0.15, 0.20] as const;
const RAMPS = ['NONE', 'FAST', 'MODERATE', 'CONSERVATIVE'] as const;
const COMPONENTS = ['pass', 'rush'] as const;

type Ramp = typeof RAMPS[number];
type Component = typeof COMPONENTS[number];
type Game = ReturnType<typeof parseGamesCsv>[number];

interface Play {
  week: number;
  offense: string;
  defense: string;
  type: Component;
  epa: number;
}

interface Ratings {
  offense: Map<string, number>;
  defense: Map<string, number>;
  offenseDist: { mean: number; sd: number };
  defenseDist: { mean: number; sd: number };
  nPlays: number;
}

interface GameEdge {
  pass: number;
  rush: number;
}

interface BaseRow {
  gameId: string;
  week: number;
  home: string;
  away: string;
  neutral: boolean;
  actualHome: boolean;
  margin: number;
  controlPHome: number;
  controlHit: boolean;
}

interface EvalRow extends BaseRow {
  challengerPHome: number;
  challengerHit: boolean;
  rawPassEdge: number;
  rawRushEdge: number;
  rampMultiplier: number;
}

interface Metrics {
  n: number;
  correct: number;
  brier: number;
  logLoss: number;
  ece: number;
}

interface Evaluation {
  metrics: Metrics;
  rows: EvalRow[];
}

interface Spec {
  lambda: number;
  ramp: Ramp;
  weight: number;
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const bounded = Math.max(0.001, Math.min(0.999, p));
  return Math.log(bounded / (1 - bounded));
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

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
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

function numberOrNull(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parsePbp(text: string): Play[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const required = ['week', 'season_type', 'posteam', 'defteam', 'play_type', 'epa'];
  for (const field of required) {
    if (!index.has(field)) throw new Error(`PBP missing required column: ${field}`);
  }
  const get = (cells: string[], name: string) => {
    const i = index.get(name);
    return i == null ? '' : (cells[i] ?? '').trim();
  };

  const plays: Play[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (get(cells, 'season_type') !== 'REG') continue;
    if (get(cells, 'no_play') === '1') continue;
    if (get(cells, 'qb_kneel') === '1' || get(cells, 'qb_spike') === '1') continue;
    const playType = get(cells, 'play_type');
    const type: Component | null = playType === 'pass' ? 'pass' : playType === 'run' ? 'rush' : null;
    if (!type) continue;
    const epa = numberOrNull(get(cells, 'epa'));
    const week = numberOrNull(get(cells, 'week'));
    const offense = normalizeTeamAbbr(get(cells, 'posteam'));
    const defense = normalizeTeamAbbr(get(cells, 'defteam'));
    if (epa == null || week == null || !offense || !defense) continue;
    plays.push({ week, offense, defense, type, epa });
  }
  return plays;
}

function meanSd(values: number[]) {
  if (!values.length) return { mean: 0, sd: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) || 1 };
}

function z(value: number, dist: { mean: number; sd: number }) {
  return (value - dist.mean) / dist.sd;
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let row = col + 1; row < n; row++) {
      const value = Math.abs(a[row][col]);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (best < 1e-10) continue;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
    const pivotValue = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= pivotValue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row, i) => Number.isFinite(row[n]) ? row[n] : 0);
}

function fitRatings(plays: Play[], week: number, type: Component, lambda: number): Ratings | null {
  const sample = plays.filter(play => play.week < week && play.type === type);
  if (sample.length < 500) return null;
  const teams = [...new Set(sample.flatMap(play => [play.offense, play.defense]))].sort();
  if (teams.length < 20) return null;
  const teamIndex = new Map(teams.map((team, i) => [team, i]));
  const nTeams = teams.length;
  const p = 1 + 2 * nTeams;
  const xtx = Array.from({ length: p }, () => Array<number>(p).fill(0));
  const xty = Array<number>(p).fill(0);

  for (const play of sample) {
    const oi = teamIndex.get(play.offense);
    const di = teamIndex.get(play.defense);
    if (oi == null || di == null) continue;
    const indices = [0, 1 + oi, 1 + nTeams + di];
    const y = play.epa;
    for (const i of indices) {
      xty[i] += y;
      for (const j of indices) xtx[i][j] += 1;
    }
  }

  xtx[0][0] += 1e-8;
  for (let i = 1; i < p; i++) xtx[i][i] += lambda;
  const beta = solveLinearSystem(xtx, xty);
  const offense = new Map<string, number>();
  const defense = new Map<string, number>();
  for (let i = 0; i < nTeams; i++) {
    offense.set(teams[i], beta[1 + i] ?? 0);
    defense.set(teams[i], beta[1 + nTeams + i] ?? 0);
  }
  return {
    offense,
    defense,
    offenseDist: meanSd([...offense.values()]),
    defenseDist: meanSd([...defense.values()]),
    nPlays: sample.length
  };
}

function ratingEdge(pass: Ratings | null, rush: Ratings | null, home: string, away: string): GameEdge {
  const edgeFor = (ratings: Ratings | null) => {
    if (!ratings) return 0;
    const homeOff = z(ratings.offense.get(home) ?? ratings.offenseDist.mean, ratings.offenseDist);
    const awayOff = z(ratings.offense.get(away) ?? ratings.offenseDist.mean, ratings.offenseDist);
    // Defense coefficient is EPA allowed: larger means weaker defense, so awayDef - homeDef favors home.
    const homeDef = z(ratings.defense.get(home) ?? ratings.defenseDist.mean, ratings.defenseDist);
    const awayDef = z(ratings.defense.get(away) ?? ratings.defenseDist.mean, ratings.defenseDist);
    return clamp((homeOff - awayOff) + (awayDef - homeDef), -6, 6);
  };
  return { pass: edgeFor(pass), rush: edgeFor(rush) };
}

function rampMultiplier(week: number, ramp: Ramp): number {
  if (week <= 1) return 0;
  if (ramp === 'NONE') return 1;
  if (ramp === 'FAST') {
    if (week === 2) return 0.50;
    if (week === 3) return 0.75;
    return 1;
  }
  if (ramp === 'MODERATE') {
    if (week === 2) return 0.25;
    if (week === 3) return 0.50;
    if (week === 4) return 0.75;
    return 1;
  }
  if (week === 2) return 0;
  if (week === 3) return 0.25;
  if (week === 4) return 0.50;
  if (week === 5) return 0.75;
  return 1;
}

function metrics(rows: EvalRow[]): Metrics {
  if (!rows.length) return { n: 0, correct: 0, brier: 0, logLoss: 0, ece: 0 };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = clamp(row.challengerPHome, 0.001, 0.999);
    const y = row.actualHome ? 1 : 0;
    correct += (p >= 0.5) === row.actualHome ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.n++;
    bin.p += p;
    bin.y += y;
  }
  const ece = bins.reduce((sum, bin) => {
    if (!bin.n) return sum;
    return sum + (bin.n / rows.length) * Math.abs(bin.p / bin.n - bin.y / bin.n);
  }, 0);
  return { n: rows.length, correct, brier: brier / rows.length, logLoss: logLoss / rows.length, ece };
}

function controlMetrics(base: BaseRow[]): Metrics {
  return metrics(base.map(row => ({
    ...row,
    challengerPHome: row.controlPHome,
    challengerHit: row.controlHit,
    rawPassEdge: 0,
    rawRushEdge: 0,
    rampMultiplier: 0
  })));
}

async function loadPbp(season: number): Promise<Play[]> {
  const response = await fetch(PBP_URL(season));
  if (!response.ok) throw new Error(`Could not load nflverse PBP ${season}: ${response.status}`);
  const plays = parsePbp(await response.text());
  const minimum = season === 2026 ? 5000 : 20000;
  if (plays.length < minimum) throw new Error(`Too few eligible PBP plays for ${season}: ${plays.length}`);
  console.log(`PBP ${season}: ${plays.length} eligible EPA plays`);
  return plays;
}

async function buildBaseRows(season: number, games: Game[]): Promise<BaseRow[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const sample = games.filter(game =>
    game.season === season &&
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );
  const rows: BaseRow[] = [];
  for (let i = 0; i < sample.length; i++) {
    const game = sample[i];
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;
    const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
    const controlPHome = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
    const actualHome = game.homeScore! > game.awayScore!;
    rows.push({
      gameId: game.gameId || `${season}:${game.week}:${game.awayTeam}@${game.homeTeam}`,
      week: game.week,
      home: game.homeTeam,
      away: game.awayTeam,
      neutral: game.location === 'Neutral',
      actualHome,
      margin: Math.abs(game.homeScore! - game.awayScore!),
      controlPHome,
      controlHit: (controlPHome >= 0.5) === actualHome
    });
    if ((i + 1) % 100 === 0) console.log(`control snapshot ${season}: ${i + 1}/${sample.length}`);
  }
  return rows;
}

function buildEdges(base: BaseRow[], plays: Play[], lambda: number): Map<string, GameEdge> {
  const weekCache = new Map<number, { pass: Ratings | null; rush: Ratings | null }>();
  const edges = new Map<string, GameEdge>();
  for (const row of base) {
    if (!weekCache.has(row.week)) {
      weekCache.set(row.week, {
        pass: fitRatings(plays, row.week, 'pass', lambda),
        rush: fitRatings(plays, row.week, 'rush', lambda)
      });
    }
    const fitted = weekCache.get(row.week)!;
    edges.set(row.gameId, ratingEdge(fitted.pass, fitted.rush, row.home, row.away));
  }
  return edges;
}

function evaluate(
  base: BaseRow[],
  edges: Map<string, GameEdge>,
  spec: Spec,
  enabled: readonly Component[] = COMPONENTS
): Evaluation {
  const rows = base.map(row => {
    const edge = edges.get(row.gameId) ?? { pass: 0, rush: 0 };
    const active = enabled.length
      ? enabled.reduce((sum, component) => sum + edge[component], 0) / enabled.length
      : 0;
    const ramp = rampMultiplier(row.week, spec.ramp);
    const challengerPHome = logistic(logit(row.controlPHome) + active * ramp * spec.weight);
    return {
      ...row,
      challengerPHome,
      challengerHit: (challengerPHome >= 0.5) === row.actualHome,
      rawPassEdge: edge.pass,
      rawRushEdge: edge.rush,
      rampMultiplier: ramp
    };
  });
  return { metrics: metrics(rows), rows };
}

function fmtMetric(label: string, metric: Metrics) {
  return `${label}: ${metric.correct}/${metric.n} = ${(100 * metric.correct / metric.n).toFixed(2)}% | Brier ${metric.brier.toFixed(4)} | LogLoss ${metric.logLoss.toFixed(4)} | ECE ${metric.ece.toFixed(4)}`;
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

function splitMetrics(rows: EvalRow[]) {
  return metrics(rows);
}

function reportSplit(label: string, rows: EvalRow[]) {
  if (!rows.length) return;
  const challenger = splitMetrics(rows);
  const controlRows = rows.map(row => ({ ...row, challengerPHome: row.controlPHome, challengerHit: row.controlHit }));
  const control = splitMetrics(controlRows);
  console.log(`${label.padEnd(20)} n=${rows.length} | control ${(100 * control.correct / control.n).toFixed(2)}% | EXP-009 ${(100 * challenger.correct / challenger.n).toFixed(2)}% | ΔBrier ${(challenger.brier - control.brier).toFixed(4)}`);
}

function decision(control: Metrics, challenger: Metrics, challengerOnly: number, controlOnly: number): string {
  const accDelta = challenger.correct / challenger.n - control.correct / control.n;
  const probabilityBetter = challenger.brier < control.brier && challenger.logLoss < control.logLoss;
  if (accDelta > 0 && probabilityBetter && challengerOnly > controlOnly) return 'KEEP FOR RESEARCH';
  if (accDelta === 0 && probabilityBetter) return 'KEEP FOR RESEARCH';
  return 'REJECT FOR PROMOTION';
}

async function writeOutputs(payload: unknown, markdown: string) {
  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  await writeFile('research/runtime/exp-009.json', JSON.stringify(payload, null, 2));
  await writeFile('research/reports/exp-009.md', markdown);
}

async function main() {
  console.log('\nEXP-009 — Ridge Opponent-Adjusted EPA');
  console.log('========================================');
  console.log('Hypothesis: simultaneous regularized offense/defense EPA ratings add repeatable signal beyond simple point-differential adjustment.');
  console.log('The model is fitted at play level, separately for pass and rush EPA, using only prior weeks of the same season.');
  console.log('Protocol: 2024 discovery -> lock lambda/ramp/weight -> untouched 2025 -> 2026 observation -> ablation/robustness -> survive/kill.');

  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());
  const [pbp2024, pbp2025, pbp2026] = await Promise.all([loadPbp(2024), loadPbp(2025), loadPbp(2026)]);
  const base2024 = await buildBaseRows(2024, games);
  const base2025 = await buildBaseRows(2025, games);
  const base2026 = await buildBaseRows(2026, games);
  console.log(`Coverage: 2024=${base2024.length}, 2025=${base2025.length}, 2026=${base2026.length}`);

  const edge2024 = new Map<number, Map<string, GameEdge>>();
  for (const lambda of LAMBDAS) edge2024.set(lambda, buildEdges(base2024, pbp2024, lambda));

  const discovery: Array<{ spec: Spec; evaluation: Evaluation }> = [];
  console.log(`\n2024 DISCOVERY — ${LAMBDAS.length * RAMPS.length * WEIGHTS.length} preregistered variants; select by Brier then log loss`);
  for (const lambda of LAMBDAS) {
    for (const ramp of RAMPS) {
      for (const weight of WEIGHTS) {
        const spec: Spec = { lambda, ramp, weight };
        const evaluation = evaluate(base2024, edge2024.get(lambda)!, spec);
        discovery.push({ spec, evaluation });
        console.log(`lambda=${String(lambda).padStart(3)} ramp=${ramp.padEnd(12)} weight=${weight.toFixed(2)} | ${evaluation.metrics.correct}/${evaluation.metrics.n} ${(100 * evaluation.metrics.correct / evaluation.metrics.n).toFixed(2)}% | Brier ${evaluation.metrics.brier.toFixed(4)} | LogLoss ${evaluation.metrics.logLoss.toFixed(4)}`);
      }
    }
  }

  discovery.sort((a, b) =>
    a.evaluation.metrics.brier - b.evaluation.metrics.brier ||
    a.evaluation.metrics.logLoss - b.evaluation.metrics.logLoss
  );
  const selected = discovery[0];
  console.log(`\nLOCKED AFTER 2024: lambda=${selected.spec.lambda}, ramp=${selected.spec.ramp}, weight=${selected.spec.weight.toFixed(2)}.`);
  console.log('No 2025 result may reselect these parameters.');

  const edges2025 = buildEdges(base2025, pbp2025, selected.spec.lambda);
  const edges2026 = buildEdges(base2026, pbp2026, selected.spec.lambda);
  const control2025 = controlMetrics(base2025);
  const confirmation = evaluate(base2025, edges2025, selected.spec);
  const control2026 = controlMetrics(base2026);
  const observational = evaluate(base2026, edges2026, selected.spec);

  const challengerOnly = confirmation.rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = confirmation.rows.filter(row => !row.challengerHit && row.controlHit).length;
  const pairedP = exactMcNemarP(challengerOnly, controlOnly);

  console.log('\nUNTOUCHED 2025 CONFIRMATION');
  console.log(fmtMetric('CONTROL v2.2', control2025));
  console.log(fmtMetric('EXP-009', confirmation.metrics));
  console.log(`Δaccuracy ${((confirmation.metrics.correct / confirmation.metrics.n - control2025.correct / control2025.n) * 100).toFixed(2)} points | ΔBrier ${(confirmation.metrics.brier - control2025.brier).toFixed(4)} | ΔLogLoss ${(confirmation.metrics.logLoss - control2025.logLoss).toFixed(4)}`);
  console.log(`Paired flips: challenger-only=${challengerOnly}, control-only=${controlOnly}, exact p=${pairedP.toFixed(4)}`);

  console.log('\n2025 SPLITS');
  reportSplit('Weeks 1-4', confirmation.rows.filter(row => row.week <= 4));
  reportSplit('Weeks 5-9', confirmation.rows.filter(row => row.week >= 5 && row.week <= 9));
  reportSplit('Weeks 10-18', confirmation.rows.filter(row => row.week >= 10));
  reportSplit('Actual home wins', confirmation.rows.filter(row => row.actualHome));
  reportSplit('Actual away wins', confirmation.rows.filter(row => !row.actualHome));
  reportSplit('One-score <=8', confirmation.rows.filter(row => row.margin <= 8));
  reportSplit('Blowout >=14', confirmation.rows.filter(row => row.margin >= 14));
  reportSplit('Neutral site', confirmation.rows.filter(row => row.neutral));

  console.log('\nCOMPONENT ABLATION — diagnostic only');
  const passOnly = evaluate(base2025, edges2025, selected.spec, ['pass']);
  const rushOnly = evaluate(base2025, edges2025, selected.spec, ['rush']);
  console.log(fmtMetric('PASS ONLY', passOnly.metrics));
  console.log(fmtMetric('RUSH ONLY', rushOnly.metrics));

  console.log('\nNEIGHBORING PARAMETERS — 2025 diagnostics only, never reselect');
  const lambdaNeighbors = LAMBDAS.filter(lambda => lambda !== selected.spec.lambda);
  const robustness: Array<{ label: string; metrics: Metrics }> = [];
  for (const lambda of lambdaNeighbors) {
    const edges = buildEdges(base2025, pbp2025, lambda);
    const evaluation = evaluate(base2025, edges, { ...selected.spec, lambda });
    robustness.push({ label: `lambda=${lambda}`, metrics: evaluation.metrics });
    console.log(fmtMetric(`lambda=${lambda}`, evaluation.metrics));
  }
  for (const weight of WEIGHTS.filter(weight => weight !== selected.spec.weight && Math.abs(weight - selected.spec.weight) <= 0.05 + 1e-9)) {
    const evaluation = evaluate(base2025, edges2025, { ...selected.spec, weight });
    robustness.push({ label: `weight=${weight.toFixed(2)}`, metrics: evaluation.metrics });
    console.log(fmtMetric(`weight=${weight.toFixed(2)}`, evaluation.metrics));
  }
  for (const ramp of RAMPS.filter(ramp => ramp !== selected.spec.ramp)) {
    const evaluation = evaluate(base2025, edges2025, { ...selected.spec, ramp });
    robustness.push({ label: `ramp=${ramp}`, metrics: evaluation.metrics });
    console.log(fmtMetric(`ramp=${ramp}`, evaluation.metrics));
  }

  console.log('\n2026 OBSERVATIONAL CHECK — frozen 2024 parameters');
  console.log(fmtMetric('CONTROL v2.2', control2026));
  console.log(fmtMetric('EXP-009', observational.metrics));

  const verdict = decision(control2025, confirmation.metrics, challengerOnly, controlOnly);
  console.log(`\nVERDICT: ${verdict}`);
  console.log('Production v2.2 remains unchanged. 2025 diagnostics and 2026 observations cannot be used to retune this locked experiment.');

  const payload = {
    experiment: 'EXP-009',
    generatedAt: new Date().toISOString(),
    hypothesis: 'Play-level ridge opponent-adjusted pass/rush EPA ratings add signal beyond v2.2.',
    variantsTried: LAMBDAS.length * RAMPS.length * WEIGHTS.length,
    selected: selected.spec,
    selected2024: selected.evaluation.metrics,
    control2025,
    challenger2025: confirmation.metrics,
    paired: { challengerOnly, controlOnly, exactP: pairedP },
    ablation: { passOnly: passOnly.metrics, rushOnly: rushOnly.metrics },
    robustness,
    control2026,
    challenger2026: observational.metrics,
    verdict
  };

  const markdown = `# EXP-009 — Ridge Opponent-Adjusted EPA\n\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `## Locked 2024 specification\n\n- Ridge lambda: **${selected.spec.lambda}**\n- Early-season ramp: **${selected.spec.ramp}**\n- Logit weight: **${selected.spec.weight.toFixed(2)}**\n\n` +
    `## Untouched 2025\n\n| Model | Accuracy | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|\n` +
    `| v2.2 | ${(100 * control2025.correct / control2025.n).toFixed(2)}% (${control2025.correct}/${control2025.n}) | ${control2025.brier.toFixed(4)} | ${control2025.logLoss.toFixed(4)} | ${control2025.ece.toFixed(4)} |\n` +
    `| EXP-009 | ${(100 * confirmation.metrics.correct / confirmation.metrics.n).toFixed(2)}% (${confirmation.metrics.correct}/${confirmation.metrics.n}) | ${confirmation.metrics.brier.toFixed(4)} | ${confirmation.metrics.logLoss.toFixed(4)} | ${confirmation.metrics.ece.toFixed(4)} |\n\n` +
    `Paired flips: challenger-only **${challengerOnly}**, control-only **${controlOnly}**, exact p **${pairedP.toFixed(4)}**.\n\n` +
    `## 2026 observational\n\n- control: ${(100 * control2026.correct / control2026.n).toFixed(2)}% (${control2026.correct}/${control2026.n})\n- EXP-009: ${(100 * observational.metrics.correct / observational.metrics.n).toFixed(2)}% (${observational.metrics.correct}/${observational.metrics.n})\n\n` +
    `## Verdict\n\n**${verdict}**\n\nProduction v2.2 remains unchanged.\n`;

  await writeOutputs(payload, markdown);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
