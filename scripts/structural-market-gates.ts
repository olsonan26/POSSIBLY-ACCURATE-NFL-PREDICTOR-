import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const EXP019_WEIGHT = 0.75;
const DISCOVERY_SEASONS = [2021, 2022, 2023, 2024] as const;
const STABILITY_SEASON = 2025;
const OBSERVATION_SEASON = 2026;

type Game = ReturnType<typeof parseGamesCsv>[number];
type GateId =
  | 'MARKET_MORE_CONFIDENT'
  | 'MARKET_CONF_55'
  | 'MARKET_CONF_60'
  | 'ELO_ALIGNMENT'
  | 'ELO_ALIGNMENT_MORE_CONFIDENT'
  | 'ELO_ALIGNMENT_CONF_55'
  | 'BASE_REVERSAL_STRONG'
  | 'FORM_OPPOSES_ELO_MARKET';

interface MarketRow {
  gameId: string;
  homeMoneyline?: number;
  awayMoneyline?: number;
}

interface BaseRow {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  actualHome: boolean;
  controlPHome: number;
  marketPHome: number;
  exp019PHome: number;
  basePHome: number;
  formAdj: number;
  venueAdj: number;
  h2hAdj: number;
  disagree: boolean;
}

interface PredRow extends BaseRow {
  challengerPHome: number;
  triggered: boolean;
}

interface Metrics { n: number; correct: number; accuracy: number; brier: number; logLoss: number; ece: number; }
interface Eval { gate: GateId; rows: PredRow[]; metrics: Metrics; seasonDeltas: Record<string, number>; aggregateDelta: number; robust: boolean; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => { const q = clamp(p, .001, .999); return Math.log(q / (1 - q)); };
const side = (p: number) => p >= .5 ? 1 : -1;
const confidence = (p: number) => Math.max(p, 1 - p);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cell); cell = ''; } else cell += c;
  }
  out.push(cell);
  return out;
}
function num(v: string | undefined): number | undefined { if (v == null || v.trim() === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function parseMarkets(text: string): MarketRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || '');
  const idx = new Map(headers.map((h, i) => [h, i]));
  const get = (cells: string[], key: string) => { const i = idx.get(key); return i == null ? '' : (cells[i] ?? '').trim(); };
  for (const key of ['game_id', 'home_moneyline', 'away_moneyline']) if (!idx.has(key)) throw new Error(`games.csv missing ${key}`);
  return lines.slice(1).map(line => { const c = parseCsvLine(line); return { gameId: get(c, 'game_id'), homeMoneyline: num(get(c, 'home_moneyline')), awayMoneyline: num(get(c, 'away_moneyline')) }; });
}
function implied(odds: number): number { return odds < 0 ? (-odds) / ((-odds) + 100) : 100 / (odds + 100); }
function noVig(row: MarketRow): number | null {
  if (row.homeMoneyline == null || row.awayMoneyline == null || row.homeMoneyline === 0 || row.awayMoneyline === 0) return null;
  const h = implied(row.homeMoneyline), a = implied(row.awayMoneyline), t = h + a;
  return Number.isFinite(t) && t > 0 ? clamp(h / t, .01, .99) : null;
}
function blend(control: number, market: number): number { return logistic(.25 * logit(control) + EXP019_WEIGHT * logit(market)); }

function calc(rows: PredRow[], key: 'controlPHome' | 'marketPHome' | 'exp019PHome' | 'challengerPHome'): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: NaN, logLoss: NaN, ece: NaN };
  let correct = 0, brier = 0, logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = clamp(row[key], .001, .999), y = row.actualHome ? 1 : 0;
    if ((p >= .5) === row.actualHome) correct++;
    brier += (p-y)**2;
    logLoss += -(y*Math.log(p)+(1-y)*Math.log(1-p));
    const b = Math.min(9, Math.floor(p*10)); bins[b].n++; bins[b].p += p; bins[b].y += y;
  }
  let ece = 0;
  for (const b of bins) if (b.n) ece += (b.n/rows.length)*Math.abs(b.p/b.n-b.y/b.n);
  return { n: rows.length, correct, accuracy: correct/rows.length, brier: brier/rows.length, logLoss: logLoss/rows.length, ece };
}
function line(label: string, m: Metrics): string { return `${label}: ${m.correct}/${m.n} = ${(100*m.accuracy).toFixed(2)}% | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logLoss.toFixed(4)} | ECE ${m.ece.toFixed(4)}`; }

function gateApplies(row: BaseRow, gate: GateId): boolean {
  if (row.week > 4 || !row.disagree) return false;
  const marketSide = side(row.marketPHome), controlSide = side(row.controlPHome), baseSide = side(row.basePHome);
  const marketMoreConfident = confidence(row.marketPHome) > confidence(row.controlPHome);
  const eloAlignment = marketSide === baseSide && controlSide !== baseSide;
  const productionDelta = row.formAdj + row.venueAdj + row.h2hAdj;
  const formSide = Math.abs(row.formAdj) < .01 ? 0 : row.formAdj > 0 ? 1 : -1;
  switch (gate) {
    case 'MARKET_MORE_CONFIDENT': return marketMoreConfident;
    case 'MARKET_CONF_55': return confidence(row.marketPHome) >= .55;
    case 'MARKET_CONF_60': return confidence(row.marketPHome) >= .60;
    case 'ELO_ALIGNMENT': return eloAlignment;
    case 'ELO_ALIGNMENT_MORE_CONFIDENT': return eloAlignment && marketMoreConfident;
    case 'ELO_ALIGNMENT_CONF_55': return eloAlignment && confidence(row.marketPHome) >= .55;
    case 'BASE_REVERSAL_STRONG': return eloAlignment && Math.abs(productionDelta) >= .12;
    case 'FORM_OPPOSES_ELO_MARKET': return eloAlignment && formSide !== 0 && formSide === controlSide && formSide !== marketSide;
  }
}

function predict(rows: BaseRow[], gate: GateId): PredRow[] {
  return rows.map(row => {
    const triggered = gateApplies(row, gate);
    return { ...row, triggered, challengerPHome: triggered ? row.marketPHome : row.exp019PHome };
  });
}

async function buildRows(games: Game[], markets: Map<string, MarketRow>): Promise<BaseRow[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(t => [t.abbr, t]));
  const eligible = games.filter(g => g.season >= 2021 && g.season <= OBSERVATION_SEASON && g.gameType === 'REG' && Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore) && g.homeScore !== g.awayScore);
  const out: BaseRow[] = [];
  let n = 0;
  for (const game of eligible) {
    const market = markets.get(game.gameId); if (!market) continue;
    const marketPHome = noVig(market); if (marketPHome == null) continue;
    const home = byAbbr.get(normalizeTeamAbbr(game.homeTeam)), away = byAbbr.get(normalizeTeamAbbr(game.awayTeam));
    if (!home || !away) continue;
    const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
    const s = result.modelScores; if (!s) continue;
    const controlPHome = clamp(s.finalHomeProbability/100, .01, .99);
    const basePHome = clamp(s.baseHomeProbability/100, .01, .99);
    out.push({ gameId: game.gameId, season: game.season, week: game.week, homeTeam: game.homeTeam, awayTeam: game.awayTeam, actualHome: game.homeScore! > game.awayScore!, controlPHome, marketPHome, exp019PHome: blend(controlPHome, marketPHome), basePHome, formAdj: s.footballLogitAdjustment, venueAdj: s.venueLogitAdjustment, h2hAdj: s.h2hLogitAdjustment, disagree: side(controlPHome) !== side(marketPHome) });
    n++; if (n % 300 === 0) console.log(`Built ${n} rows...`);
  }
  return out;
}

function evalGate(gate: GateId, discovery: BaseRow[]): Eval {
  const rows = predict(discovery, gate);
  const m = calc(rows, 'challengerPHome');
  const baseline = calc(rows, 'exp019PHome');
  const seasonDeltas: Record<string, number> = {};
  let seasonsNotWorse = 0;
  let worstDelta = 999;
  for (const season of DISCOVERY_SEASONS) {
    const s = rows.filter(r => r.season === season);
    const delta = calc(s, 'challengerPHome').correct - calc(s, 'exp019PHome').correct;
    seasonDeltas[String(season)] = delta;
    if (delta >= 0) seasonsNotWorse++;
    worstDelta = Math.min(worstDelta, delta);
  }
  const aggregateDelta = m.correct - baseline.correct;
  const robust = aggregateDelta >= 0 && seasonsNotWorse >= 3 && worstDelta >= -1 && m.brier <= baseline.brier + .0005 && m.logLoss <= baseline.logLoss + .001;
  return { gate, rows, metrics: m, seasonDeltas, aggregateDelta, robust };
}

async function main() {
  console.log('\nEXP-022 — Structural Early-Season Market Trust Gates');
  console.log('=====================================================');
  console.log('Predeclared structural gates ask WHEN to let the market override EXP-019 on Weeks 1-4 disagreement games.');
  console.log('Selection uses 2021-2024 only. 2025 is a non-regression/stability gate. 2026 is observation only and cannot choose the gate.\n');
  const res = await fetch(GAMES_URL); if (!res.ok) throw new Error(`Could not load games.csv: ${res.status}`);
  const text = await res.text();
  const games = parseGamesCsv(text), marketRows = parseMarkets(text), markets = new Map(marketRows.map(r => [r.gameId, r]));
  const rows = await buildRows(games, markets);
  const discovery = rows.filter(r => DISCOVERY_SEASONS.includes(r.season as 2021|2022|2023|2024));
  const gates: GateId[] = ['MARKET_MORE_CONFIDENT','MARKET_CONF_55','MARKET_CONF_60','ELO_ALIGNMENT','ELO_ALIGNMENT_MORE_CONFIDENT','ELO_ALIGNMENT_CONF_55','BASE_REVERSAL_STRONG','FORM_OPPOSES_ELO_MARKET'];
  const baselineDiscovery = calc(predict(discovery, gates[0]), 'exp019PHome');
  console.log(line('Discovery EXP-019', baselineDiscovery));
  const evals = gates.map(g => evalGate(g, discovery));
  for (const e of evals) console.log(`${e.gate.padEnd(30)} ${e.metrics.correct}/${e.metrics.n} ${(100*e.metrics.accuracy).toFixed(2)}% | Δwins ${e.aggregateDelta >= 0 ? '+' : ''}${e.aggregateDelta} | Brier ${e.metrics.brier.toFixed(4)} | seasons ${JSON.stringify(e.seasonDeltas)} | robust=${e.robust}`);
  const robust = evals.filter(e => e.robust).sort((a,b) => b.metrics.accuracy-a.metrics.accuracy || a.metrics.brier-b.metrics.brier || a.metrics.logLoss-b.metrics.logLoss || a.gate.localeCompare(b.gate));
  const selected = robust[0] || null;
  if (!selected) {
    console.log('\nNo structural gate survived discovery robustness constraints. Decision: RETAIN EXP-019.');
    await mkdir('research/runtime', { recursive: true }); await mkdir('research/reports', { recursive: true });
    const payload = { experiment:'EXP-022', selected:null, gates: evals.map(e => ({gate:e.gate, metrics:e.metrics, aggregateDelta:e.aggregateDelta, seasonDeltas:e.seasonDeltas, robust:e.robust})), decision:'REJECT / RETAIN EXP-019' };
    await writeFile('research/runtime/exp-022.json', JSON.stringify(payload,null,2));
    await writeFile('research/reports/exp-022.md', '# EXP-022 — Structural Early-Season Market Trust Gates\n\n**Decision: REJECT / RETAIN EXP-019.**\n\nNo predeclared structural gate passed the 2021–2024 robustness constraints. No 2025 or 2026 result was used to rescue a failed gate.');
    return;
  }
  console.log(`\nSelected from 2021-2024 only: ${selected.gate}`);
  const stabilityBase = rows.filter(r => r.season === STABILITY_SEASON);
  const stability = predict(stabilityBase, selected.gate);
  const s019 = calc(stability,'exp019PHome'), s022 = calc(stability,'challengerPHome');
  const obsBase = rows.filter(r => r.season === OBSERVATION_SEASON);
  const obs = predict(obsBase, selected.gate);
  const oControl = calc(obs,'controlPHome'), oMarket = calc(obs,'marketPHome'), o019 = calc(obs,'exp019PHome'), o022 = calc(obs,'challengerPHome');
  const stabilityPass = s022.correct >= s019.correct && s022.brier <= s019.brier + .0005 && s022.logLoss <= s019.logLoss + .001;
  const obsTriggered = obs.filter(r => r.triggered);
  console.log('\n2025 stability'); console.log(line('EXP-019',s019)); console.log(line('EXP-022',s022)); console.log(`Gate ${stabilityPass ? 'PASS' : 'FAIL'}`);
  console.log('\n2026 observation'); console.log(line('v2.2',oControl)); console.log(line('Market',oMarket)); console.log(line('EXP-019',o019)); console.log(line('EXP-022',o022));
  console.log(`2026 triggered games n=${obsTriggered.length}: EXP019 ${calc(obsTriggered,'exp019PHome').correct}/${obsTriggered.length}; EXP022 ${calc(obsTriggered,'challengerPHome').correct}/${obsTriggered.length}`);
  const decision = stabilityPass ? 'SURVIVES AS PROSPECTIVE STRUCTURAL SHADOW CANDIDATE' : 'REJECT / RETAIN EXP-019';
  console.log(`Decision: ${decision}`);
  await mkdir('research/runtime',{recursive:true}); await mkdir('research/reports',{recursive:true});
  const payload = { experiment:'EXP-022', selected:selected.gate, discovery:{ exp019:baselineDiscovery, challenger:selected.metrics, aggregateDelta:selected.aggregateDelta, seasonDeltas:selected.seasonDeltas }, stability2025:{ exp019:s019, challenger:s022, pass:stabilityPass }, observation2026:{ control:oControl, market:oMarket, exp019:o019, challenger:o022, triggeredN:obsTriggered.length }, gates:evals.map(e=>({gate:e.gate,metrics:e.metrics,aggregateDelta:e.aggregateDelta,seasonDeltas:e.seasonDeltas,robust:e.robust})), decision };
  await writeFile('research/runtime/exp-022.json',JSON.stringify(payload,null,2));
  const report = ['# EXP-022 — Structural Early-Season Market Trust Gates','',`**Decision: ${decision}.**`,'','Selection was limited to 2021–2024. 2025 was used only as a non-regression/stability gate. 2026 was observation only.','',`Selected gate: **${selected.gate}**.`,'',`2021–2024 EXP-019: **${baselineDiscovery.correct}/${baselineDiscovery.n} = ${(100*baselineDiscovery.accuracy).toFixed(2)}%**.` ,`2021–2024 EXP-022: **${selected.metrics.correct}/${selected.metrics.n} = ${(100*selected.metrics.accuracy).toFixed(2)}%**, Brier ${selected.metrics.brier.toFixed(4)}, log loss ${selected.metrics.logLoss.toFixed(4)}.`,'',`2025 EXP-019: **${s019.correct}/${s019.n} = ${(100*s019.accuracy).toFixed(2)}%**.` ,`2025 EXP-022: **${s022.correct}/${s022.n} = ${(100*s022.accuracy).toFixed(2)}%**, stability gate **${stabilityPass?'PASS':'FAIL'}**.`,'',`2026 observation EXP-019: **${o019.correct}/${o019.n} = ${(100*o019.accuracy).toFixed(2)}%**.` ,`2026 observation EXP-022: **${o022.correct}/${o022.n} = ${(100*o022.accuracy).toFixed(2)}%**.`,'', decision.startsWith('SURVIVES') ? 'This candidate may be frozen prospectively as a separate shadow rule; observed 2026 games are not claimed as prospective validation.' : 'No promotion. EXP-019 remains the market-aware shadow.'].join('\n');
  await writeFile('research/reports/exp-022.md',report);
}
main().catch(err => { console.error(err); process.exit(1); });
