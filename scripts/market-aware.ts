import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const DISCOVERY_SEASON = 2024;
const CONFIRM_SEASON = 2025;
const OBSERVATION_SEASON = 2026;

const BLEND_WEIGHTS = [0, 0.25, 0.5, 0.75, 1] as const;
const GUARDRAIL_THRESHOLDS = [0.55, 0.60, 0.65, 0.70] as const;

type Game = ReturnType<typeof parseGamesCsv>[number];

type Candidate =
  | { kind: 'blend'; weight: number; label: string }
  | { kind: 'guardrail'; threshold: number; label: string }
  | { kind: 'disagreement-blend'; weight: number; label: string };

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

interface EvaluationRow {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  actualHome: boolean;
  controlPHome: number;
  marketPHome: number;
  challengerPHome: number;
  controlHit: boolean;
  marketHit: boolean;
  challengerHit: boolean;
  disagreeControlMarket: boolean;
  marketConfidence: number;
}

interface Metrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  ece: number;
}

interface Evaluation {
  candidate: Candidate;
  rows: EvaluationRow[];
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
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
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
  if (!Number.isFinite(odds) || odds === 0) return NaN;
  return odds < 0 ? (-odds) / ((-odds) + 100) : 100 / (odds + 100);
}

function noVigHomeProbability(row: MarketRow): number | null {
  if (row.homeMoneyline == null || row.awayMoneyline == null) return null;
  const h = americanImplied(row.homeMoneyline);
  const a = americanImplied(row.awayMoneyline);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h <= 0 || a <= 0) return null;
  return clamp(h / (h + a), 0.01, 0.99);
}

function applyCandidate(controlPHome: number, marketPHome: number, candidate: Candidate): number {
  if (candidate.kind === 'blend') {
    return logistic((1 - candidate.weight) * logit(controlPHome) + candidate.weight * logit(marketPHome));
  }
  const disagree = (controlPHome >= 0.5) !== (marketPHome >= 0.5);
  if (candidate.kind === 'guardrail') {
    const marketConfidence = Math.max(marketPHome, 1 - marketPHome);
    return disagree && marketConfidence >= candidate.threshold ? marketPHome : controlPHome;
  }
  if (!disagree) return controlPHome;
  return logistic((1 - candidate.weight) * logit(controlPHome) + candidate.weight * logit(marketPHome));
}

function buildCandidates(): Candidate[] {
  return [
    ...BLEND_WEIGHTS.map(weight => ({ kind: 'blend' as const, weight, label: `BLEND_${weight.toFixed(2)}` })),
    ...GUARDRAIL_THRESHOLDS.map(threshold => ({ kind: 'guardrail' as const, threshold, label: `GUARDRAIL_${threshold.toFixed(2)}` })),
    { kind: 'disagreement-blend' as const, weight: 0.5, label: 'DISAGREE_BLEND_0.50' },
    { kind: 'disagreement-blend' as const, weight: 1.0, label: 'DISAGREE_MARKET' }
  ];
}

function computeMetrics(rows: EvaluationRow[], probability: 'controlPHome' | 'marketPHome' | 'challengerPHome'): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: NaN, logLoss: NaN, ece: NaN };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = clamp(row[probability], 0.001, 0.999);
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
  return {
    n: rows.length,
    correct,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    ece
  };
}

function metricLine(label: string, metric: Metrics): string {
  return `${label}: ${metric.correct}/${metric.n} = ${(metric.accuracy * 100).toFixed(2)}% | Brier ${metric.brier.toFixed(4)} | LogLoss ${metric.logLoss.toFixed(4)} | ECE ${metric.ece.toFixed(4)}`;
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

function selectCandidate(evaluations: Evaluation[]): Evaluation {
  return [...evaluations].sort((a, b) => {
    if (b.metrics.accuracy !== a.metrics.accuracy) return b.metrics.accuracy - a.metrics.accuracy;
    if (a.metrics.brier !== b.metrics.brier) return a.metrics.brier - b.metrics.brier;
    if (a.metrics.logLoss !== b.metrics.logLoss) return a.metrics.logLoss - b.metrics.logLoss;
    return a.candidate.label.localeCompare(b.candidate.label);
  })[0];
}

async function controlProbability(game: Game, cache: Map<string, number>): Promise<number | null> {
  const key = game.gameId || `${game.season}:${game.week}:${game.awayTeam}@${game.homeTeam}`;
  const cached = cache.get(key);
  if (cached != null) return cached;
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const home = byAbbr.get(game.homeTeam);
  const away = byAbbr.get(game.awayTeam);
  if (!home || !away) return null;
  const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
  const p = result.modelScores?.finalHomeProbability != null
    ? result.modelScores.finalHomeProbability / 100
    : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
  cache.set(key, p);
  return p;
}

async function buildBaseRows(
  season: number,
  games: Game[],
  markets: Map<string, MarketRow>,
  cache: Map<string, number>
): Promise<Omit<EvaluationRow, 'challengerPHome' | 'challengerHit'>[]> {
  const completed = games.filter(game =>
    game.season === season &&
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );
  const rows: Omit<EvaluationRow, 'challengerPHome' | 'challengerHit'>[] = [];
  for (const game of completed) {
    const market = markets.get(game.gameId);
    if (!market) continue;
    const marketPHome = noVigHomeProbability(market);
    if (marketPHome == null) continue;
    const controlPHome = await controlProbability(game, cache);
    if (controlPHome == null) continue;
    const actualHome = game.homeScore! > game.awayScore!;
    rows.push({
      gameId: game.gameId,
      season,
      week: game.week,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      actualHome,
      controlPHome,
      marketPHome,
      controlHit: (controlPHome >= 0.5) === actualHome,
      marketHit: (marketPHome >= 0.5) === actualHome,
      disagreeControlMarket: (controlPHome >= 0.5) !== (marketPHome >= 0.5),
      marketConfidence: Math.max(marketPHome, 1 - marketPHome)
    });
  }
  return rows;
}

function evaluateCandidate(
  baseRows: Omit<EvaluationRow, 'challengerPHome' | 'challengerHit'>[],
  candidate: Candidate
): Evaluation {
  const rows: EvaluationRow[] = baseRows.map(row => {
    const challengerPHome = applyCandidate(row.controlPHome, row.marketPHome, candidate);
    return {
      ...row,
      challengerPHome,
      challengerHit: (challengerPHome >= 0.5) === row.actualHome
    };
  });
  return { candidate, rows, metrics: computeMetrics(rows, 'challengerPHome') };
}

function reportSplits(rows: EvaluationRow[]) {
  const splits: Array<[string, (row: EvaluationRow) => boolean]> = [
    ['Weeks 1-4', row => row.week <= 4],
    ['Weeks 5-9', row => row.week >= 5 && row.week <= 9],
    ['Weeks 10+', row => row.week >= 10],
    ['Control/market disagree', row => row.disagreeControlMarket],
    ['Market >=60%', row => row.marketConfidence >= 0.60],
    ['Market >=70%', row => row.marketConfidence >= 0.70]
  ];
  for (const [label, predicate] of splits) {
    const sample = rows.filter(predicate);
    if (!sample.length) continue;
    const c = computeMetrics(sample, 'controlPHome');
    const m = computeMetrics(sample, 'marketPHome');
    const x = computeMetrics(sample, 'challengerPHome');
    console.log(`${label.padEnd(24)} n=${sample.length} | control ${(100 * c.accuracy).toFixed(2)}% | market ${(100 * m.accuracy).toFixed(2)}% | challenger ${(100 * x.accuracy).toFixed(2)}%`);
  }
}

function pairedSummary(rows: EvaluationRow[]) {
  const challengerOnly = rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = rows.filter(row => row.controlHit && !row.challengerHit).length;
  return { challengerOnly, controlOnly, p: exactMcNemarP(challengerOnly, controlOnly) };
}

async function main() {
  const response = await fetch(GAMES_URL);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);
  const text = await response.text();
  const games = parseGamesCsv(text);
  const marketRows = parseMarketRows(text);
  const markets = new Map(marketRows.map(row => [row.gameId, row]));
  const cache = new Map<string, number>();

  console.log('\nEXP-019 — Market-aware residual / disagreement layer');
  console.log('====================================================');
  console.log('Historical market input is the nflverse pregame closing moneyline. It is converted to a two-sided no-vig home probability.');
  console.log('This is explicitly a separate market-aware lane, not a replacement of the pure-football v2.2 control.');
  console.log('Candidate rules are frozen before 2025: logit blends, confidence guardrails, and disagreement-only blends.');
  console.log('Selection objective is 2024 straight-up accuracy, then Brier, then log loss. 2025 is confirmation; 2026 is observational.');

  const discoveryBase = await buildBaseRows(DISCOVERY_SEASON, games, markets, cache);
  const candidates = buildCandidates();
  const discovery = candidates.map(candidate => evaluateCandidate(discoveryBase, candidate));
  const discoveryControl = computeMetrics(discovery[0].rows, 'controlPHome');
  const discoveryMarket = computeMetrics(discovery[0].rows, 'marketPHome');
  console.log(`\n2024 market-eligible games: ${discoveryBase.length}`);
  console.log(metricLine('2024 v2.2 control', discoveryControl));
  console.log(metricLine('2024 market-only', discoveryMarket));
  for (const evaluation of discovery) console.log(metricLine(`2024 ${evaluation.candidate.label}`, evaluation.metrics));

  const selected = selectCandidate(discovery);
  console.log(`\nLOCKED FROM 2024: ${selected.candidate.label}`);

  const confirmBase = await buildBaseRows(CONFIRM_SEASON, games, markets, cache);
  const confirm = evaluateCandidate(confirmBase, selected.candidate);
  const confirmControl = computeMetrics(confirm.rows, 'controlPHome');
  const confirmMarket = computeMetrics(confirm.rows, 'marketPHome');
  console.log('\nUNTOUCHED MODEL-SPEC CONFIRMATION — 2025');
  console.log(metricLine('v2.2 control', confirmControl));
  console.log(metricLine('market-only', confirmMarket));
  console.log(metricLine(`EXP-019 ${selected.candidate.label}`, confirm.metrics));
  const paired = pairedSummary(confirm.rows);
  console.log(`Paired vs control: challenger-only correct=${paired.challengerOnly}, control-only correct=${paired.controlOnly}, exact p=${paired.p.toFixed(4)}`);
  reportSplits(confirm.rows);

  const obsBase = await buildBaseRows(OBSERVATION_SEASON, games, markets, cache);
  const observation = evaluateCandidate(obsBase, selected.candidate);
  const obsControl = computeMetrics(observation.rows, 'controlPHome');
  const obsMarket = computeMetrics(observation.rows, 'marketPHome');
  console.log('\n2026 OBSERVATION ONLY');
  console.log(metricLine('v2.2 control', obsControl));
  console.log(metricLine('market-only', obsMarket));
  console.log(metricLine(`EXP-019 ${selected.candidate.label}`, observation.metrics));
  reportSplits(observation.rows);

  const promoted = confirm.metrics.accuracy > confirmControl.accuracy &&
    confirm.metrics.brier <= confirmControl.brier &&
    confirm.metrics.logLoss <= confirmControl.logLoss;
  const decision = promoted ? 'SURVIVES AS MARKET-AWARE SHADOW CANDIDATE' : 'NO PROMOTION';
  console.log(`\nDecision: ${decision}`);
  console.log('Production v2.2 remains unchanged. A surviving result belongs in a separately labeled market-aware lane because closing odds aggregate external information.');

  await mkdir('research/reports', { recursive: true });
  const report = [
    '# EXP-019 — Market-aware residual / disagreement layer',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Protocol',
    '',
    '- Source: nflverse `games.csv` pregame moneylines.',
    '- Moneylines are converted to no-vig two-sided probabilities.',
    '- Candidate family fixed before 2025: logit blends, confidence guardrails, disagreement-only blends.',
    '- 2024 selects by winner accuracy, then Brier/log loss.',
    '- 2025 confirms the locked candidate.',
    '- 2026 is observational only.',
    '- Market-aware output remains separate from pure-football v2.2.',
    '',
    `## Locked candidate: ${selected.candidate.label}`,
    '',
    '```',
    metricLine('2024 control', discoveryControl),
    metricLine('2024 market', discoveryMarket),
    metricLine('2024 selected', selected.metrics),
    '',
    metricLine('2025 control', confirmControl),
    metricLine('2025 market', confirmMarket),
    metricLine('2025 selected', confirm.metrics),
    `paired: challenger-only=${paired.challengerOnly}, control-only=${paired.controlOnly}, p=${paired.p.toFixed(4)}`,
    '',
    metricLine('2026 control', obsControl),
    metricLine('2026 market', obsMarket),
    metricLine('2026 selected', observation.metrics),
    '```',
    '',
    `## Decision: ${decision}`,
    '',
    'This experiment cannot redefine the pure-football control. Closing market odds are valid pregame information but represent an external aggregate signal and must remain visibly separate.'
  ].join('\n');
  await writeFile('research/reports/exp-019.md', report);
  await writeFile('research/reports/exp-019.json', JSON.stringify({
    selected: selected.candidate,
    decision,
    discovery: { control: discoveryControl, market: discoveryMarket, selected: selected.metrics },
    confirmation2025: { control: confirmControl, market: confirmMarket, selected: confirm.metrics, paired },
    observation2026: { control: obsControl, market: obsMarket, selected: observation.metrics },
    rows2026: observation.rows
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
