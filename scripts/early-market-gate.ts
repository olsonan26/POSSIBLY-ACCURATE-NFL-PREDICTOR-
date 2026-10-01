import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const EXP019_WEIGHT = 0.75;
const GATE_LAST_WEEK = 4;

type Game = ReturnType<typeof parseGamesCsv>[number];

interface MarketRow {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
}

interface Row {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  actualHome: boolean;
  controlPHome: number;
  marketPHome: number;
  exp019PHome: number;
  exp021PHome: number;
  disagree: boolean;
  gateTriggered: boolean;
}

interface Metrics { n: number; correct: number; accuracy: number; brier: number; logLoss: number; ece: number; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => { const q = clamp(p, 0.001, 0.999); return Math.log(q / (1 - q)); };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cell); cell = ''; } else cell += c;
  }
  out.push(cell);
  return out;
}

function num(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseMarkets(text: string): MarketRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || '');
  const idx = new Map(headers.map((h, i) => [h, i]));
  const get = (cells: string[], key: string) => { const i = idx.get(key); return i == null ? '' : (cells[i] ?? '').trim(); };
  for (const key of ['game_id', 'season', 'game_type', 'week', 'home_moneyline', 'away_moneyline']) if (!idx.has(key)) throw new Error(`games.csv missing ${key}`);
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return {
      gameId: get(cells, 'game_id'),
      season: Number(get(cells, 'season') || 0),
      gameType: get(cells, 'game_type'),
      week: Number(get(cells, 'week') || 0),
      homeMoneyline: num(get(cells, 'home_moneyline')),
      awayMoneyline: num(get(cells, 'away_moneyline'))
    };
  });
}

function implied(odds: number): number { return odds < 0 ? (-odds) / ((-odds) + 100) : 100 / (odds + 100); }
function noVig(row: MarketRow): number | null {
  if (row.homeMoneyline == null || row.awayMoneyline == null || row.homeMoneyline === 0 || row.awayMoneyline === 0) return null;
  const h = implied(row.homeMoneyline), a = implied(row.awayMoneyline), t = h + a;
  return Number.isFinite(t) && t > 0 ? clamp(h / t, 0.01, 0.99) : null;
}
function blend(control: number, market: number): number { return logistic(0.25 * logit(control) + EXP019_WEIGHT * logit(market)); }

function calcMetrics(rows: Row[], key: 'controlPHome' | 'marketPHome' | 'exp019PHome' | 'exp021PHome'): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: NaN, logLoss: NaN, ece: NaN };
  let correct = 0, brier = 0, logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = clamp(row[key], 0.001, 0.999), y = row.actualHome ? 1 : 0;
    if ((p >= 0.5) === row.actualHome) correct++;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    const b = Math.min(9, Math.floor(p * 10)); bins[b].n++; bins[b].p += p; bins[b].y += y;
  }
  let ece = 0;
  for (const b of bins) if (b.n) ece += (b.n / rows.length) * Math.abs(b.p / b.n - b.y / b.n);
  return { n: rows.length, correct, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length, ece };
}

function line(label: string, m: Metrics) { return `${label}: ${m.correct}/${m.n} = ${(100 * m.accuracy).toFixed(2)}% | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logLoss.toFixed(4)} | ECE ${m.ece.toFixed(4)}`; }

async function buildRows(games: Game[], markets: Map<string, MarketRow>): Promise<Row[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(t => [t.abbr, t]));
  const eligible = games.filter(g => g.season >= 2021 && g.season <= 2026 && g.gameType === 'REG' && Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore) && g.homeScore !== g.awayScore);
  const rows: Row[] = [];
  for (const game of eligible) {
    const market = markets.get(game.gameId); if (!market) continue;
    const marketPHome = noVig(market); if (marketPHome == null) continue;
    const home = byAbbr.get(normalizeTeamAbbr(game.homeTeam));
    const away = byAbbr.get(normalizeTeamAbbr(game.awayTeam));
    if (!home || !away) continue;
    const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
    const controlPHome = result.modelScores?.finalHomeProbability != null
      ? clamp(result.modelScores.finalHomeProbability / 100, 0.01, 0.99)
      : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
    const disagree = (controlPHome >= 0.5) !== (marketPHome >= 0.5);
    const exp019PHome = blend(controlPHome, marketPHome);
    const gateTriggered = game.week <= GATE_LAST_WEEK && disagree;
    const exp021PHome = gateTriggered ? marketPHome : exp019PHome;
    rows.push({
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      actualHome: game.homeScore! > game.awayScore!,
      controlPHome,
      marketPHome,
      exp019PHome,
      exp021PHome,
      disagree,
      gateTriggered
    });
  }
  return rows;
}

async function main() {
  console.log('\nEXP-021 — Early-Season Market Disagreement Gate');
  console.log('================================================');
  console.log('Fixed rule, no parameter search: Weeks 1-4 only, if v2.2 and market disagree on winner, use the no-vig market probability; otherwise retain locked EXP-019 BLEND_0.75.');
  console.log('This experiment is explicitly motivated after observing early-2026 disagreement failures. Historical seasons are a non-regression/stability check, not a newly untouched test. The rule freezes prospectively from this point forward.\n');

  const response = await fetch(GAMES_URL); if (!response.ok) throw new Error(`Could not load games.csv: ${response.status}`);
  const text = await response.text();
  const games = parseGamesCsv(text);
  const marketRows = parseMarkets(text);
  const markets = new Map(marketRows.map(r => [r.gameId, r]));
  const rows = await buildRows(games, markets);

  const years: Record<string, unknown> = {};
  for (const season of [2021, 2022, 2023, 2024, 2025, 2026]) {
    const sample = rows.filter(r => r.season === season);
    const gate = sample.filter(r => r.gateTriggered);
    const control = calcMetrics(sample, 'controlPHome');
    const market = calcMetrics(sample, 'marketPHome');
    const exp019 = calcMetrics(sample, 'exp019PHome');
    const exp021 = calcMetrics(sample, 'exp021PHome');
    const gate019 = calcMetrics(gate, 'exp019PHome');
    const gate021 = calcMetrics(gate, 'exp021PHome');
    console.log(`\n${season}`);
    console.log(line('v2.2', control));
    console.log(line('Market', market));
    console.log(line('EXP-019', exp019));
    console.log(line('EXP-021', exp021));
    console.log(`Early disagreement gate: n=${gate.length} | EXP019 ${(100 * gate019.accuracy).toFixed(2)}% -> EXP021 ${(100 * gate021.accuracy).toFixed(2)}%`);
    years[String(season)] = { n: sample.length, gateN: gate.length, control, market, exp019, exp021, gate019, gate021 };
  }

  const history = rows.filter(r => r.season >= 2021 && r.season <= 2025);
  const h019 = calcMetrics(history, 'exp019PHome');
  const h021 = calcMetrics(history, 'exp021PHome');
  const y2025 = rows.filter(r => r.season === 2025);
  const m25019 = calcMetrics(y2025, 'exp019PHome');
  const m25021 = calcMetrics(y2025, 'exp021PHome');
  const y2026 = rows.filter(r => r.season === 2026);
  const m26019 = calcMetrics(y2026, 'exp019PHome');
  const m26021 = calcMetrics(y2026, 'exp021PHome');

  const historicalNonRegression = h021.accuracy >= h019.accuracy && h021.brier <= h019.brier && h021.logLoss <= h019.logLoss;
  const y2025NonRegression = m25021.accuracy >= m25019.accuracy && m25021.brier <= m25019.brier && m25021.logLoss <= m25019.logLoss;
  const improvesObserved2026 = m26021.accuracy > m26019.accuracy;
  const decision = historicalNonRegression && y2025NonRegression && improvesObserved2026
    ? 'SURVIVES AS PROSPECTIVE EARLY-SEASON SHADOW GATE'
    : 'DO NOT PROMOTE';

  console.log(`\n2021-2025 aggregate: ${line('EXP-019', h019)} | ${line('EXP-021', h021)}`);
  console.log(`Decision: ${decision}`);

  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  const payload = { experiment: 'EXP-021', rule: 'Weeks 1-4 + control/market winner disagreement => market no-vig; else EXP-019 BLEND_0.75', years, historicalAggregate: { exp019: h019, exp021: h021 }, gates: { historicalNonRegression, y2025NonRegression, improvesObserved2026 }, decision };
  await writeFile('research/runtime/exp-021.json', JSON.stringify(payload, null, 2));
  const report = [
    '# EXP-021 — Early-Season Market Disagreement Gate', '',
    `**Decision: ${decision}.**`, '',
    '## Frozen rule', '',
    'For Weeks 1–4 only, when frozen v2.2 and the no-vig moneyline disagree on the winner, use the market probability. In every other case, keep the locked EXP-019 75% market / 25% v2.2 logit blend.', '',
    'This rule was created after observing the early-2026 disagreement failure cluster. Therefore 2021–2025 are used as historical non-regression/stability evidence, not described as untouched confirmation. The rule is frozen prospectively from this implementation forward.', '',
    `2021–2025 aggregate EXP-019: **${h019.correct}/${h019.n} = ${(100*h019.accuracy).toFixed(2)}%**, Brier ${h019.brier.toFixed(4)}, log loss ${h019.logLoss.toFixed(4)}.`,
    `2021–2025 aggregate EXP-021: **${h021.correct}/${h021.n} = ${(100*h021.accuracy).toFixed(2)}%**, Brier ${h021.brier.toFixed(4)}, log loss ${h021.logLoss.toFixed(4)}.`, '',
    `2025 EXP-019: **${m25019.correct}/${m25019.n} = ${(100*m25019.accuracy).toFixed(2)}%**, Brier ${m25019.brier.toFixed(4)}, log loss ${m25019.logLoss.toFixed(4)}.`,
    `2025 EXP-021: **${m25021.correct}/${m25021.n} = ${(100*m25021.accuracy).toFixed(2)}%**, Brier ${m25021.brier.toFixed(4)}, log loss ${m25021.logLoss.toFixed(4)}.`, '',
    `2026 observation EXP-019: **${m26019.correct}/${m26019.n} = ${(100*m26019.accuracy).toFixed(2)}%**.`,
    `2026 observation EXP-021: **${m26021.correct}/${m26021.n} = ${(100*m26021.accuracy).toFixed(2)}%**.`, '',
    `Historical non-regression: **${historicalNonRegression ? 'PASS' : 'FAIL'}**.`,
    `2025 non-regression: **${y2025NonRegression ? 'PASS' : 'FAIL'}**.`,
    `2026 observed winner improvement: **${improvesObserved2026 ? 'PASS' : 'FAIL'}**.`, '',
    decision.startsWith('SURVIVES')
      ? 'EXP-021 may be exposed only as a separately labeled prospective shadow gate. It does not rewrite v2.2 or claim the already-observed 2026 games as prospective validation.'
      : 'EXP-021 remains research-only and cannot replace EXP-019.'
  ].join('\n');
  await writeFile('research/reports/exp-021.md', report);
}

main().catch(error => { console.error(error); process.exit(1); });
