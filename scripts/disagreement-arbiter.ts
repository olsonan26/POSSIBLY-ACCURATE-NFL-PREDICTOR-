import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const TRAIN_START = 2021;
const OOF_START = 2022;
const OOF_END = 2024;
const CONFIRM_SEASON = 2025;
const OBSERVATION_SEASON = 2026;
const EXP019_WEIGHT = 0.75;

const RIDGE_LAMBDAS = [0.1, 1, 10, 100] as const;
const PHASE_WEIGHTS = [0, 0.25, 0.5, 0.75, 1] as const;

type Game = ReturnType<typeof parseGamesCsv>[number];

type FeatureSet = 'CORE' | 'DECOMPOSED' | 'CONTRADICTION';

type Candidate =
  | { kind: 'ridge'; featureSet: FeatureSet; lambda: number; label: string }
  | { kind: 'phase'; early: number; mid: number; late: number; label: string };

interface MarketRow {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeMoneyline?: number;
  awayMoneyline?: number;
  spreadLine?: number;
  totalLine?: number;
}

interface BaseRow {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: boolean;
  controlPHome: number;
  marketPHome: number;
  exp019PHome: number;
  baseEloPHome: number;
  formAdj: number;
  venueAdj: number;
  h2hAdj: number;
  spreadLine: number;
  totalLine: number;
  disagree: boolean;
}

interface PredRow extends BaseRow {
  challengerPHome: number;
}

interface Metrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  ece: number;
}

interface RidgeModel {
  featureSet: FeatureSet;
  lambda: number;
  means: number[];
  stds: number[];
  beta: number[];
}

interface CandidateEval {
  candidate: Candidate;
  rows: PredRow[];
  metrics: Metrics;
}

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
      } else quoted = !quoted;
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

function parseMarketRows(text: string): MarketRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || '');
  const index = new Map(headers.map((header, i) => [header, i]));
  const required = ['game_id', 'season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'home_moneyline', 'away_moneyline'];
  for (const field of required) {
    if (!index.has(field)) throw new Error(`games.csv missing market column ${field}`);
  }
  const get = (cells: string[], field: string) => {
    const i = index.get(field);
    return i == null ? '' : (cells[i] ?? '').trim();
  };
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return {
      gameId: get(cells, 'game_id'),
      season: Number(get(cells, 'season') || 0),
      gameType: get(cells, 'game_type'),
      week: Number(get(cells, 'week') || 0),
      gameday: get(cells, 'gameday'),
      homeTeam: normalizeTeamAbbr(get(cells, 'home_team')),
      awayTeam: normalizeTeamAbbr(get(cells, 'away_team')),
      homeMoneyline: numberOrUndefined(get(cells, 'home_moneyline')),
      awayMoneyline: numberOrUndefined(get(cells, 'away_moneyline')),
      spreadLine: numberOrUndefined(get(cells, 'spread_line')),
      totalLine: numberOrUndefined(get(cells, 'total_line'))
    };
  });
}

function americanImplied(odds: number): number {
  return odds < 0 ? (-odds) / ((-odds) + 100) : 100 / (odds + 100);
}

function noVigHomeProbability(row: MarketRow): number | null {
  if (row.homeMoneyline == null || row.awayMoneyline == null || row.homeMoneyline === 0 || row.awayMoneyline === 0) return null;
  const h = americanImplied(row.homeMoneyline);
  const a = americanImplied(row.awayMoneyline);
  const total = h + a;
  if (!Number.isFinite(total) || total <= 0) return null;
  return clamp(h / total, 0.01, 0.99);
}

function blend(controlP: number, marketP: number, marketWeight: number): number {
  return logistic((1 - marketWeight) * logit(controlP) + marketWeight * logit(marketP));
}

function metrics(rows: PredRow[], key: 'controlPHome' | 'marketPHome' | 'exp019PHome' | 'challengerPHome'): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: NaN, logLoss: NaN, ece: NaN };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = clamp(row[key], 0.001, 0.999);
    const y = row.actualHome ? 1 : 0;
    if ((p >= 0.5) === row.actualHome) correct++;
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
    ece += (bin.n / rows.length) * Math.abs(bin.p / bin.n - bin.y / bin.n);
  }
  return { n: rows.length, correct, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length, ece };
}

function metricLine(label: string, m: Metrics): string {
  return `${label}: ${m.correct}/${m.n} = ${(m.accuracy * 100).toFixed(2)}% | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logLoss.toFixed(4)} | ECE ${m.ece.toFixed(4)}`;
}

function featureVector(row: BaseRow, set: FeatureSet): number[] {
  const control = logit(row.controlPHome);
  const market = logit(row.marketPHome);
  const base = logit(row.baseEloPHome);
  const gap = market - control;
  const marketSide = market >= 0 ? 1 : -1;
  const baseSide = base >= 0 ? 1 : -1;
  const formSide = Math.abs(row.formAdj) < 1e-9 ? 0 : row.formAdj >= 0 ? 1 : -1;
  const weekNorm = clamp((row.week - 1) / 17, 0, 1);
  const early = row.week <= 4 ? 1 : 0;
  const totalNorm = (row.totalLine - 44) / 10;
  const spreadNorm = row.spreadLine / 7;

  if (set === 'CORE') return [control, market, weekNorm, early];
  if (set === 'DECOMPOSED') return [market, base, row.formAdj, row.venueAdj, row.h2hAdj, weekNorm, early, spreadNorm, totalNorm];
  return [
    control,
    market,
    base,
    row.formAdj,
    row.venueAdj,
    row.h2hAdj,
    weekNorm,
    early,
    Math.abs(gap),
    row.disagree ? 1 : 0,
    marketSide === baseSide ? 1 : -1,
    formSide === 0 ? 0 : marketSide === formSide ? 1 : -1,
    spreadNorm,
    totalNorm
  ];
}

function fitRidge(rows: BaseRow[], featureSet: FeatureSet, lambda: number): RidgeModel {
  const raw = rows.map(row => featureVector(row, featureSet));
  const d = raw[0]?.length || 0;
  if (!d) throw new Error('No features available for ridge fit.');
  const means = Array(d).fill(0);
  const stds = Array(d).fill(0);
  for (const x of raw) for (let j = 0; j < d; j++) means[j] += x[j];
  for (let j = 0; j < d; j++) means[j] /= raw.length;
  for (const x of raw) for (let j = 0; j < d; j++) stds[j] += (x[j] - means[j]) ** 2;
  for (let j = 0; j < d; j++) stds[j] = Math.max(1e-6, Math.sqrt(stds[j] / raw.length));
  const xs = raw.map(x => x.map((v, j) => (v - means[j]) / stds[j]));
  const ys = rows.map(row => row.actualHome ? 1 : 0);
  const beta = Array(d + 1).fill(0);
  const lr = 0.05;
  const n = xs.length;
  for (let iter = 0; iter < 2500; iter++) {
    const grad = Array(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let z = beta[0];
      for (let j = 0; j < d; j++) z += beta[j + 1] * xs[i][j];
      const err = logistic(z) - ys[i];
      grad[0] += err;
      for (let j = 0; j < d; j++) grad[j + 1] += err * xs[i][j];
    }
    grad[0] /= n;
    for (let j = 1; j <= d; j++) grad[j] = grad[j] / n + (lambda / n) * beta[j];
    let maxMove = 0;
    for (let j = 0; j <= d; j++) {
      const move = lr * grad[j];
      beta[j] -= move;
      maxMove = Math.max(maxMove, Math.abs(move));
    }
    if (maxMove < 1e-8) break;
  }
  return { featureSet, lambda, means, stds, beta };
}

function ridgePredict(model: RidgeModel, row: BaseRow): number {
  const raw = featureVector(row, model.featureSet);
  let z = model.beta[0];
  for (let j = 0; j < raw.length; j++) z += model.beta[j + 1] * ((raw[j] - model.means[j]) / model.stds[j]);
  return clamp(logistic(z), 0.01, 0.99);
}

function phasePredict(row: BaseRow, candidate: Extract<Candidate, { kind: 'phase' }>): number {
  const w = row.week <= 4 ? candidate.early : row.week <= 9 ? candidate.mid : candidate.late;
  return blend(row.controlPHome, row.marketPHome, w);
}

function buildCandidates(): Candidate[] {
  const ridge: Candidate[] = [];
  for (const featureSet of ['CORE', 'DECOMPOSED', 'CONTRADICTION'] as const) {
    for (const lambda of RIDGE_LAMBDAS) ridge.push({ kind: 'ridge', featureSet, lambda, label: `RIDGE_${featureSet}_L${lambda}` });
  }
  const phases: Candidate[] = [];
  for (const early of PHASE_WEIGHTS) for (const mid of PHASE_WEIGHTS) for (const late of PHASE_WEIGHTS) {
    phases.push({ kind: 'phase', early, mid, late, label: `PHASE_E${early}_M${mid}_L${late}` });
  }
  return [...ridge, ...phases];
}

async function buildRows(games: Game[], markets: Map<string, MarketRow>): Promise<BaseRow[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const eligible = games.filter(game =>
    game.season >= TRAIN_START && game.season <= OBSERVATION_SEASON &&
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore) && game.homeScore !== game.awayScore
  );
  const rows: BaseRow[] = [];
  let i = 0;
  for (const game of eligible) {
    i++;
    const market = markets.get(game.gameId);
    if (!market) continue;
    const marketPHome = noVigHomeProbability(market);
    if (marketPHome == null) continue;
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;
    const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
    const s = result.modelScores;
    if (!s) continue;
    const controlPHome = clamp(s.finalHomeProbability / 100, 0.01, 0.99);
    const baseEloPHome = clamp(s.baseHomeProbability / 100, 0.01, 0.99);
    rows.push({
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      actualHome: game.homeScore! > game.awayScore!,
      controlPHome,
      marketPHome,
      exp019PHome: blend(controlPHome, marketPHome, EXP019_WEIGHT),
      baseEloPHome,
      formAdj: s.footballLogitAdjustment,
      venueAdj: s.venueLogitAdjustment,
      h2hAdj: s.h2hLogitAdjustment,
      spreadLine: market.spreadLine ?? 0,
      totalLine: market.totalLine ?? 44,
      disagree: (controlPHome >= 0.5) !== (marketPHome >= 0.5)
    });
    if (i % 250 === 0) console.log(`Built ${rows.length} eligible rows from ${i} completed games...`);
  }
  return rows;
}

function predictCandidate(candidate: Candidate, trainRows: BaseRow[], testRows: BaseRow[]): PredRow[] {
  if (candidate.kind === 'phase') return testRows.map(row => ({ ...row, challengerPHome: phasePredict(row, candidate) }));
  const model = fitRidge(trainRows, candidate.featureSet, candidate.lambda);
  return testRows.map(row => ({ ...row, challengerPHome: ridgePredict(model, row) }));
}

function evaluateWalkForward(candidate: Candidate, rows: BaseRow[]): CandidateEval {
  const predicted: PredRow[] = [];
  for (let season = OOF_START; season <= OOF_END; season++) {
    const trainRows = rows.filter(row => row.season >= TRAIN_START && row.season < season);
    const testRows = rows.filter(row => row.season === season);
    predicted.push(...predictCandidate(candidate, trainRows, testRows));
  }
  return { candidate, rows: predicted, metrics: metrics(predicted, 'challengerPHome') };
}

function compareCandidate(a: CandidateEval, b: CandidateEval): number {
  if (b.metrics.accuracy !== a.metrics.accuracy) return b.metrics.accuracy - a.metrics.accuracy;
  if (a.metrics.brier !== b.metrics.brier) return a.metrics.brier - b.metrics.brier;
  if (a.metrics.logLoss !== b.metrics.logLoss) return a.metrics.logLoss - b.metrics.logLoss;
  return a.candidate.label.localeCompare(b.candidate.label);
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

function paired(rows: PredRow[], baseline: 'controlPHome' | 'exp019PHome') {
  let challengerOnly = 0;
  let baselineOnly = 0;
  for (const row of rows) {
    const challengerHit = (row.challengerPHome >= 0.5) === row.actualHome;
    const baselineHit = (row[baseline] >= 0.5) === row.actualHome;
    if (challengerHit && !baselineHit) challengerOnly++;
    if (!challengerHit && baselineHit) baselineOnly++;
  }
  return { challengerOnly, baselineOnly, p: exactMcNemarP(challengerOnly, baselineOnly) };
}

function disagreementBreakdown(rows: PredRow[]) {
  const d = rows.filter(row => row.disagree);
  return {
    n: d.length,
    control: metrics(d, 'controlPHome'),
    market: metrics(d, 'marketPHome'),
    exp019: metrics(d, 'exp019PHome'),
    challenger: metrics(d, 'challengerPHome')
  };
}

function weekBreakdown(rows: PredRow[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const [label, predicate] of [
    ['W1-4', (r: PredRow) => r.week <= 4],
    ['W5-9', (r: PredRow) => r.week >= 5 && r.week <= 9],
    ['W10+', (r: PredRow) => r.week >= 10]
  ] as const) {
    const s = rows.filter(predicate);
    out[label] = {
      n: s.length,
      control: metrics(s, 'controlPHome').accuracy,
      market: metrics(s, 'marketPHome').accuracy,
      exp019: metrics(s, 'exp019PHome').accuracy,
      challenger: metrics(s, 'challengerPHome').accuracy
    };
  }
  return out;
}

async function main() {
  console.log('\nEXP-020 — Disagreement Arbiter / Meta-Stacker');
  console.log('==============================================');
  console.log('Goal: learn when the frozen football control versus the no-vig market deserves more trust, without touching 2026 outcomes during fitting.');
  console.log('Model selection uses expanding walk-forward OOF predictions: train <2022/test 2022, train <2023/test 2023, train <2024/test 2024.');
  console.log('2025 is confirmation. 2026 is observation only. Production v2.2 remains untouched.\n');

  const response = await fetch(GAMES_URL);
  if (!response.ok) throw new Error(`Could not load games.csv: ${response.status}`);
  const text = await response.text();
  const games = parseGamesCsv(text);
  const marketRows = parseMarketRows(text);
  const markets = new Map(marketRows.map(row => [row.gameId, row]));
  const rows = await buildRows(games, markets);

  console.log(`Usable rows by season: ${[2021, 2022, 2023, 2024, 2025, 2026].map(season => `${season}=${rows.filter(r => r.season === season).length}`).join(', ')}`);

  const candidates = buildCandidates();
  console.log(`Preregistered candidate family: ${candidates.length} total (${RIDGE_LAMBDAS.length * 3} ridge stackers + ${PHASE_WEIGHTS.length ** 3} phase schedules).`);
  const oofEvals = candidates.map(candidate => evaluateWalkForward(candidate, rows)).sort(compareCandidate);
  const selected = oofEvals[0];
  console.log(`\nSelected on 2022-2024 OOF: ${selected.candidate.label}`);
  console.log(metricLine('OOF challenger', selected.metrics));
  console.log(metricLine('OOF v2.2', metrics(selected.rows, 'controlPHome')));
  console.log(metricLine('OOF EXP-019', metrics(selected.rows, 'exp019PHome')));

  const development = rows.filter(row => row.season >= TRAIN_START && row.season <= OOF_END);
  const confirmBase = rows.filter(row => row.season === CONFIRM_SEASON);
  const observeBase = rows.filter(row => row.season === OBSERVATION_SEASON);
  const confirm = predictCandidate(selected.candidate, development, confirmBase);
  const observe = predictCandidate(selected.candidate, [...development, ...confirmBase], observeBase);

  const confirmControl = metrics(confirm, 'controlPHome');
  const confirmMarket = metrics(confirm, 'marketPHome');
  const confirmExp019 = metrics(confirm, 'exp019PHome');
  const confirmChallenger = metrics(confirm, 'challengerPHome');
  const observeControl = metrics(observe, 'controlPHome');
  const observeMarket = metrics(observe, 'marketPHome');
  const observeExp019 = metrics(observe, 'exp019PHome');
  const observeChallenger = metrics(observe, 'challengerPHome');

  console.log('\n2025 confirmation');
  console.log(metricLine('v2.2', confirmControl));
  console.log(metricLine('Market', confirmMarket));
  console.log(metricLine('EXP-019', confirmExp019));
  console.log(metricLine('EXP-020', confirmChallenger));
  const pairControl = paired(confirm, 'controlPHome');
  const pairExp019 = paired(confirm, 'exp019PHome');
  console.log(`Paired vs control: +${pairControl.challengerOnly}/-${pairControl.baselineOnly}, p=${pairControl.p.toFixed(4)}`);
  console.log(`Paired vs EXP-019: +${pairExp019.challengerOnly}/-${pairExp019.baselineOnly}, p=${pairExp019.p.toFixed(4)}`);

  console.log('\n2026 observation');
  console.log(metricLine('v2.2', observeControl));
  console.log(metricLine('Market', observeMarket));
  console.log(metricLine('EXP-019', observeExp019));
  console.log(metricLine('EXP-020', observeChallenger));

  const confirmDisagree = disagreementBreakdown(confirm);
  const observeDisagree = disagreementBreakdown(observe);
  console.log(`\n2025 disagreement games n=${confirmDisagree.n}: control ${(100 * confirmDisagree.control.accuracy).toFixed(2)}%, market ${(100 * confirmDisagree.market.accuracy).toFixed(2)}%, EXP019 ${(100 * confirmDisagree.exp019.accuracy).toFixed(2)}%, EXP020 ${(100 * confirmDisagree.challenger.accuracy).toFixed(2)}%`);
  console.log(`2026 disagreement games n=${observeDisagree.n}: control ${(100 * observeDisagree.control.accuracy).toFixed(2)}%, market ${(100 * observeDisagree.market.accuracy).toFixed(2)}%, EXP019 ${(100 * observeDisagree.exp019.accuracy).toFixed(2)}%, EXP020 ${(100 * observeDisagree.challenger.accuracy).toFixed(2)}%`);

  const confirmWeeks = weekBreakdown(confirm);
  const observeWeeks = weekBreakdown(observe);
  for (const [label, m] of Object.entries(confirmWeeks)) console.log(`2025 ${label} n=${m.n}: control ${(100 * m.control).toFixed(2)} | market ${(100 * m.market).toFixed(2)} | EXP019 ${(100 * m.exp019).toFixed(2)} | EXP020 ${(100 * m.challenger).toFixed(2)}`);
  for (const [label, m] of Object.entries(observeWeeks)) console.log(`2026 ${label} n=${m.n}: control ${(100 * m.control).toFixed(2)} | market ${(100 * m.market).toFixed(2)} | EXP019 ${(100 * m.exp019).toFixed(2)} | EXP020 ${(100 * m.challenger).toFixed(2)}`);

  const survives = confirmChallenger.accuracy >= confirmExp019.accuracy &&
    confirmChallenger.brier <= confirmExp019.brier &&
    confirmChallenger.logLoss <= confirmExp019.logLoss;
  const decision = survives ? 'SURVIVES AS SHADOW SUCCESSOR CANDIDATE' : 'REJECT / RETAIN EXP-019';
  console.log(`\nDecision: ${decision}`);

  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  const payload = {
    experiment: 'EXP-020',
    selected: selected.candidate,
    candidateCount: candidates.length,
    protocol: '2022-2024 expanding walk-forward OOF selection; refit through 2024; 2025 confirmation; 2026 observation only',
    oof: {
      challenger: selected.metrics,
      control: metrics(selected.rows, 'controlPHome'),
      exp019: metrics(selected.rows, 'exp019PHome')
    },
    confirmation2025: { control: confirmControl, market: confirmMarket, exp019: confirmExp019, challenger: confirmChallenger, disagreement: confirmDisagree, weeks: confirmWeeks, pairedVsControl: pairControl, pairedVsExp019: pairExp019 },
    observation2026: { control: observeControl, market: observeMarket, exp019: observeExp019, challenger: observeChallenger, disagreement: observeDisagree, weeks: observeWeeks },
    decision
  };
  await writeFile('research/runtime/exp-020.json', JSON.stringify(payload, null, 2));
  const report = [
    '# EXP-020 — Disagreement Arbiter / Meta-Stacker',
    '',
    `**Decision: ${decision}.**`,
    '',
    '## Protocol',
    '',
    '- Inputs are strictly pregame: frozen v2.2 probability/components, no-vig moneyline probability, spread/total, and NFL week.',
    '- Candidate selection uses expanding walk-forward OOF predictions for 2022-2024.',
    '- The selected specification is refit through 2024, then opened on 2025.',
    '- 2026 is observation only and never participates in fitting or model selection.',
    '- v2.2 remains unchanged.',
    '',
    `Selected specification: **${selected.candidate.label}** from **${candidates.length}** preregistered candidates.`,
    '',
    '## 2025 confirmation',
    '',
    `- v2.2: **${confirmControl.correct}/${confirmControl.n} = ${(100 * confirmControl.accuracy).toFixed(2)}%**, Brier ${confirmControl.brier.toFixed(4)}, log loss ${confirmControl.logLoss.toFixed(4)}.`,
    `- market: **${confirmMarket.correct}/${confirmMarket.n} = ${(100 * confirmMarket.accuracy).toFixed(2)}%**, Brier ${confirmMarket.brier.toFixed(4)}, log loss ${confirmMarket.logLoss.toFixed(4)}.`,
    `- EXP-019: **${confirmExp019.correct}/${confirmExp019.n} = ${(100 * confirmExp019.accuracy).toFixed(2)}%**, Brier ${confirmExp019.brier.toFixed(4)}, log loss ${confirmExp019.logLoss.toFixed(4)}.`,
    `- EXP-020: **${confirmChallenger.correct}/${confirmChallenger.n} = ${(100 * confirmChallenger.accuracy).toFixed(2)}%**, Brier ${confirmChallenger.brier.toFixed(4)}, log loss ${confirmChallenger.logLoss.toFixed(4)}.`,
    `- disagreement games n=${confirmDisagree.n}: v2.2 ${(100 * confirmDisagree.control.accuracy).toFixed(2)}%, market ${(100 * confirmDisagree.market.accuracy).toFixed(2)}%, EXP-019 ${(100 * confirmDisagree.exp019.accuracy).toFixed(2)}%, EXP-020 ${(100 * confirmDisagree.challenger.accuracy).toFixed(2)}%.`,
    '',
    '## 2026 observation',
    '',
    `- v2.2: **${observeControl.correct}/${observeControl.n} = ${(100 * observeControl.accuracy).toFixed(2)}%**.`,
    `- market: **${observeMarket.correct}/${observeMarket.n} = ${(100 * observeMarket.accuracy).toFixed(2)}%**.`,
    `- EXP-019: **${observeExp019.correct}/${observeExp019.n} = ${(100 * observeExp019.accuracy).toFixed(2)}%**.`,
    `- EXP-020: **${observeChallenger.correct}/${observeChallenger.n} = ${(100 * observeChallenger.accuracy).toFixed(2)}%**.`,
    `- disagreement games n=${observeDisagree.n}: v2.2 ${(100 * observeDisagree.control.accuracy).toFixed(2)}%, market ${(100 * observeDisagree.market.accuracy).toFixed(2)}%, EXP-019 ${(100 * observeDisagree.exp019.accuracy).toFixed(2)}%, EXP-020 ${(100 * observeDisagree.challenger.accuracy).toFixed(2)}%.`,
    '',
    '## Governance',
    '',
    survives
      ? 'EXP-020 may advance only as a separately labeled shadow model. Promotion still requires prospective 2026 evidence after the freeze date.'
      : 'EXP-020 failed the predeclared 2025 gate. It is retained as a failed experiment and cannot be rescued by retuning after seeing 2025 or 2026.'
  ].join('\n');
  await writeFile('research/reports/exp-020.md', report);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
