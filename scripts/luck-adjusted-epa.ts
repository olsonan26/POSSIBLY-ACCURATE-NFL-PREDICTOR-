import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv`;

const MODEL_WEIGHTS = [0, 0.05, 0.10, 0.15, 0.20] as const;

interface Config {
  id: string;
  epaCap: number;
  turnoverMultiplier: number;
  fumbleMultiplier: number;
  touchdownMultiplier: number;
  garbageFilter: boolean;
}

const CONFIGS: Config[] = [
  { id: 'RAW_CAP6', epaCap: 6, turnoverMultiplier: 1.00, fumbleMultiplier: 1.00, touchdownMultiplier: 1.00, garbageFilter: false },
  { id: 'CAP3', epaCap: 3, turnoverMultiplier: 1.00, fumbleMultiplier: 1.00, touchdownMultiplier: 1.00, garbageFilter: false },
  { id: 'CAP3_TO75', epaCap: 3, turnoverMultiplier: 0.75, fumbleMultiplier: 1.00, touchdownMultiplier: 1.00, garbageFilter: false },
  { id: 'CAP3_TO50', epaCap: 3, turnoverMultiplier: 0.50, fumbleMultiplier: 1.00, touchdownMultiplier: 1.00, garbageFilter: false },
  { id: 'CAP3_TO50_F50_TD85', epaCap: 3, turnoverMultiplier: 0.50, fumbleMultiplier: 0.50, touchdownMultiplier: 0.85, garbageFilter: false },
  { id: 'CAP3_TO50_F25_TD75', epaCap: 3, turnoverMultiplier: 0.50, fumbleMultiplier: 0.25, touchdownMultiplier: 0.75, garbageFilter: false },
  { id: 'CAP3_TO50_F25_TD75_GF', epaCap: 3, turnoverMultiplier: 0.50, fumbleMultiplier: 0.25, touchdownMultiplier: 0.75, garbageFilter: true }
];

type Game = ReturnType<typeof parseGamesCsv>[number];

interface Play {
  week: number;
  offense: string;
  defense: string;
  epa: number;
  interception: boolean;
  fumble: boolean;
  fumbleLost: boolean;
  touchdown: boolean;
  wp: number | null;
}

interface TeamProfile {
  adjustedEpa: number;
  plays: number;
}

interface WeekProfiles {
  offense: Map<string, TeamProfile>;
  defenseAllowed: Map<string, TeamProfile>;
  offenseDist: { mean: number; sd: number };
  defenseDist: { mean: number; sd: number };
}

interface Metrics {
  n: number;
  correct: number;
  brier: number;
  logLoss: number;
  ece: number;
}

interface EvalRow {
  gameId: string;
  week: number;
  home: string;
  away: string;
  neutral: boolean;
  actualHome: boolean;
  margin: number;
  controlPHome: number;
  challengerPHome: number;
  controlHit: boolean;
  challengerHit: boolean;
}

type BaseRow = Omit<EvalRow, 'challengerPHome' | 'challengerHit'>;

interface Evaluation {
  metrics: Metrics;
  rows: EvalRow[];
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
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell); cell = '';
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
  const required = ['week', 'season_type', 'posteam', 'defteam', 'epa'];
  for (const field of required) if (!index.has(field)) throw new Error(`PBP missing required column: ${field}`);
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
    const week = numberOrNull(get(cells, 'week'));
    const epa = numberOrNull(get(cells, 'epa'));
    const offense = normalizeTeamAbbr(get(cells, 'posteam'));
    const defense = normalizeTeamAbbr(get(cells, 'defteam'));
    if (week == null || epa == null || !offense || !defense) continue;
    plays.push({
      week,
      offense,
      defense,
      epa,
      interception: get(cells, 'interception') === '1',
      fumble: get(cells, 'fumble') === '1',
      fumbleLost: get(cells, 'fumble_lost') === '1',
      touchdown: get(cells, 'touchdown') === '1',
      wp: numberOrNull(get(cells, 'wp'))
    });
  }
  return plays;
}

function adjustedEpa(play: Play, config: Config): number | null {
  if (config.garbageFilter && play.wp != null && (play.wp < 0.05 || play.wp > 0.95)) return null;
  let value = clamp(play.epa, -config.epaCap, config.epaCap);
  if (play.interception || play.fumbleLost) value *= config.turnoverMultiplier;
  if (play.fumble) value *= config.fumbleMultiplier;
  if (play.touchdown) value *= config.touchdownMultiplier;
  return value;
}

function meanSd(values: number[]) {
  if (!values.length) return { mean: 0, sd: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) || 1 };
}

function z(value: number, dist: { mean: number; sd: number }) {
  return (value - dist.mean) / dist.sd;
}

function buildWeekProfiles(plays: Play[], week: number, config: Config): WeekProfiles | null {
  if (week <= 1) return null;
  const offenseTotals = new Map<string, { sum: number; n: number }>();
  const defenseTotals = new Map<string, { sum: number; n: number }>();

  for (const play of plays) {
    if (play.week >= week) continue;
    const value = adjustedEpa(play, config);
    if (value == null) continue;
    const o = offenseTotals.get(play.offense) ?? { sum: 0, n: 0 };
    o.sum += value; o.n += 1; offenseTotals.set(play.offense, o);
    const d = defenseTotals.get(play.defense) ?? { sum: 0, n: 0 };
    d.sum += value; d.n += 1; defenseTotals.set(play.defense, d);
  }

  const teams = [...new Set([...offenseTotals.keys(), ...defenseTotals.keys()])];
  if (teams.length < 20) return null;
  const offense = new Map<string, TeamProfile>();
  const defenseAllowed = new Map<string, TeamProfile>();
  for (const team of teams) {
    const o = offenseTotals.get(team) ?? { sum: 0, n: 0 };
    const d = defenseTotals.get(team) ?? { sum: 0, n: 0 };
    offense.set(team, { adjustedEpa: o.n ? o.sum / o.n : 0, plays: o.n });
    defenseAllowed.set(team, { adjustedEpa: d.n ? d.sum / d.n : 0, plays: d.n });
  }
  const offenseDist = meanSd(teams.map(team => offense.get(team)!.adjustedEpa));
  const defenseDist = meanSd(teams.map(team => defenseAllowed.get(team)!.adjustedEpa));
  return { offense, defenseAllowed, offenseDist, defenseDist };
}

function matchupEdge(profiles: WeekProfiles | null, home: string, away: string): number {
  if (!profiles) return 0;
  const homeOff = profiles.offense.get(home);
  const awayOff = profiles.offense.get(away);
  const homeDef = profiles.defenseAllowed.get(home);
  const awayDef = profiles.defenseAllowed.get(away);
  if (!homeOff || !awayOff || !homeDef || !awayDef) return 0;

  // Higher offensive EPA is better. Higher defensive EPA allowed is worse for that defense and therefore
  // more favorable to the opposing offense. The home edge compares the two offense-vs-defense matchups.
  const homeMatchup = z(homeOff.adjustedEpa, profiles.offenseDist) + z(awayDef.adjustedEpa, profiles.defenseDist);
  const awayMatchup = z(awayOff.adjustedEpa, profiles.offenseDist) + z(homeDef.adjustedEpa, profiles.defenseDist);
  return clamp((homeMatchup - awayMatchup) / 2, -4, 4);
}

function calcMetrics(rows: EvalRow[]): Metrics {
  if (!rows.length) return { n: 0, correct: 0, brier: 0, logLoss: 0, ece: 0 };
  let correct = 0, brier = 0, logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const row of rows) {
    const p = clamp(row.challengerPHome, 0.001, 0.999);
    const y = row.actualHome ? 1 : 0;
    correct += (p >= 0.5) === row.actualHome ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.n++; bin.p += p; bin.y += y;
  }
  const ece = bins.reduce((sum, bin) => {
    if (!bin.n) return sum;
    return sum + (bin.n / rows.length) * Math.abs(bin.p / bin.n - bin.y / bin.n);
  }, 0);
  return { n: rows.length, correct, brier: brier / rows.length, logLoss: logLoss / rows.length, ece };
}

function controlMetrics(base: BaseRow[]): Metrics {
  return calcMetrics(base.map(row => ({ ...row, challengerPHome: row.controlPHome, challengerHit: row.controlHit })));
}

async function loadPbp(season: number): Promise<Play[]> {
  const response = await fetch(PBP_URL(season));
  if (!response.ok) throw new Error(`Could not load nflverse PBP ${season}: ${response.status}`);
  const plays = parsePbp(await response.text());
  if (plays.length < (season === 2026 ? 5000 : 20000)) throw new Error(`Too few eligible PBP plays for ${season}: ${plays.length}`);
  console.log(`PBP ${season}: ${plays.length} eligible plays`);
  return plays;
}

async function buildBaseRows(season: number, games: Game[]): Promise<BaseRow[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const sample = games.filter(game => game.season === season && game.gameType === 'REG' && Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore) && game.homeScore !== game.awayScore);
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

function evaluate(base: BaseRow[], plays: Play[], config: Config, weight: number): Evaluation {
  const weekCache = new Map<number, WeekProfiles | null>();
  const rows: EvalRow[] = base.map(row => {
    if (!weekCache.has(row.week)) weekCache.set(row.week, buildWeekProfiles(plays, row.week, config));
    const edge = matchupEdge(weekCache.get(row.week)!, row.home, row.away);
    const challengerPHome = logistic(logit(row.controlPHome) + edge * weight);
    return { ...row, challengerPHome, challengerHit: (challengerPHome >= 0.5) === row.actualHome };
  });
  return { metrics: calcMetrics(rows), rows };
}

function exactMcNemarP(a: number, b: number) {
  const n = a + b;
  if (!n) return 1;
  const tail = Math.min(a, b);
  let term = 0.5 ** n;
  let sum = term;
  for (let k = 0; k < tail; k++) { term *= (n - k) / (k + 1); sum += term; }
  return Math.min(1, 2 * sum);
}

function pct(x: number) { return `${(100 * x).toFixed(2)}%`; }
function metricLine(m: Metrics) {
  return `${m.correct}/${m.n} = ${pct(m.correct / m.n)} | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logLoss.toFixed(4)} | ECE ${m.ece.toFixed(4)}`;
}

function split(rows: EvalRow[], predicate: (row: EvalRow) => boolean) {
  const selected = rows.filter(predicate);
  const control = calcMetrics(selected.map(row => ({ ...row, challengerPHome: row.controlPHome, challengerHit: row.controlHit })));
  const challenger = calcMetrics(selected);
  return { n: selected.length, control, challenger };
}

function decision(control: Metrics, challenger: Metrics, p: number) {
  const accDelta = challenger.correct / challenger.n - control.correct / control.n;
  if (accDelta >= 0.01 && challenger.brier <= control.brier && challenger.logLoss <= control.logLoss && p < 0.10) return 'PROMOTION CANDIDATE';
  if (accDelta >= 0 && (challenger.brier < control.brier || challenger.logLoss < control.logLoss)) return 'KEEP FOR RESEARCH';
  if (challenger.brier < control.brier && challenger.logLoss < control.logLoss) return 'KEEP FOR RESEARCH';
  if (accDelta < 0 && challenger.brier >= control.brier && challenger.logLoss >= control.logLoss) return 'REJECT FOR PROMOTION';
  return 'INCONCLUSIVE';
}

async function main() {
  console.log('\nEXP-012 — Luck-Adjusted / Variance-Weighted EPA');
  console.log('=================================================');
  console.log('Hypothesis: discounting high-variance EPA outcomes (extreme plays, turnovers, fumble recovery outcomes, touchdowns, and garbage time) can isolate more repeatable team efficiency than raw EPA.');
  console.log('This is an auditable experimental WEPA-style family, not a claim to reproduce any external proprietary/canonical WEPA formula.');
  console.log('Protocol: 2024 discovery -> lock config/weight -> untouched 2025 -> frozen 2026 observation -> splits/robustness -> survive/kill.');
  console.log('No market, astrology, Lettrology, current roster leakage, or target-game PBP are used.');

  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());

  const [pbp2024, pbp2025, pbp2026] = await Promise.all([loadPbp(2024), loadPbp(2025), loadPbp(2026)]);
  const base2024 = await buildBaseRows(2024, games);
  const base2025 = await buildBaseRows(2025, games);
  const base2026 = await buildBaseRows(2026, games);
  const control2024 = controlMetrics(base2024);
  const control2025 = controlMetrics(base2025);
  const control2026 = controlMetrics(base2026);
  console.log(`Coverage: 2024=${base2024.length}, 2025=${base2025.length}, 2026=${base2026.length}`);
  console.log(`2024 control: ${metricLine(control2024)}`);

  console.log(`\n2024 DISCOVERY — ${CONFIGS.length * MODEL_WEIGHTS.length} preregistered variants; select by Brier then log loss`);
  const discovery: Array<{ config: Config; weight: number; metrics: Metrics }> = [];
  for (const config of CONFIGS) {
    for (const weight of MODEL_WEIGHTS) {
      const evaluation = evaluate(base2024, pbp2024, config, weight);
      discovery.push({ config, weight, metrics: evaluation.metrics });
      console.log(`${config.id.padEnd(26)} weight=${weight.toFixed(2)} | ${metricLine(evaluation.metrics)}`);
    }
  }
  discovery.sort((a, b) => a.metrics.brier - b.metrics.brier || a.metrics.logLoss - b.metrics.logLoss);
  const chosen = discovery[0];
  console.log(`\nLOCKED AFTER 2024: ${chosen.config.id}, weight=${chosen.weight.toFixed(2)}.`);
  console.log(`Config: cap=${chosen.config.epaCap}, turnover=${chosen.config.turnoverMultiplier}, fumble=${chosen.config.fumbleMultiplier}, TD=${chosen.config.touchdownMultiplier}, garbageFilter=${chosen.config.garbageFilter}.`);
  console.log('No 2025 result may reselect these parameters.');

  const confirmed = evaluate(base2025, pbp2025, chosen.config, chosen.weight);
  const challenger2025 = confirmed.metrics;
  const challengerOnly = confirmed.rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = confirmed.rows.filter(row => row.controlHit && !row.challengerHit).length;
  const pairedP = exactMcNemarP(challengerOnly, controlOnly);
  console.log('\nUNTOUCHED 2025 CONFIRMATION');
  console.log(`CONTROL v2.2: ${metricLine(control2025)}`);
  console.log(`EXP-012: ${metricLine(challenger2025)}`);
  console.log(`Δaccuracy ${((challenger2025.correct / challenger2025.n - control2025.correct / control2025.n) * 100).toFixed(2)} points | ΔBrier ${(challenger2025.brier - control2025.brier).toFixed(4)} | ΔLogLoss ${(challenger2025.logLoss - control2025.logLoss).toFixed(4)}`);
  console.log(`Paired flips: challenger-only=${challengerOnly}, control-only=${controlOnly}, exact p=${pairedP.toFixed(4)}`);

  console.log('\n2025 SPLITS');
  const splitDefs: Array<[string, (r: EvalRow) => boolean]> = [
    ['Weeks 1-4', r => r.week <= 4],
    ['Weeks 5-9', r => r.week >= 5 && r.week <= 9],
    ['Weeks 10-18', r => r.week >= 10],
    ['Actual home wins', r => r.actualHome],
    ['Actual away wins', r => !r.actualHome],
    ['One-score <=8', r => r.margin <= 8],
    ['Blowout >=14', r => r.margin >= 14],
    ['Neutral site', r => r.neutral]
  ];
  const splitOutput: Record<string, unknown> = {};
  for (const [label, predicate] of splitDefs) {
    const s = split(confirmed.rows, predicate);
    splitOutput[label] = s;
    if (s.n) console.log(`${label.padEnd(18)} n=${s.n} | control ${pct(s.control.correct / s.control.n)} | EXP-012 ${pct(s.challenger.correct / s.challenger.n)} | ΔBrier ${(s.challenger.brier - s.control.brier).toFixed(4)}`);
  }

  console.log('\nROBUSTNESS — 2025 diagnostics only, never reselect');
  const robustness: Array<{ label: string; metrics: Metrics }> = [];
  const selectedIndex = MODEL_WEIGHTS.indexOf(chosen.weight as typeof MODEL_WEIGHTS[number]);
  for (const index of [selectedIndex - 1, selectedIndex, selectedIndex + 1]) {
    if (index < 0 || index >= MODEL_WEIGHTS.length) continue;
    const weight = MODEL_WEIGHTS[index];
    const e = evaluate(base2025, pbp2025, chosen.config, weight);
    robustness.push({ label: `weight=${weight.toFixed(2)}`, metrics: e.metrics });
  }
  for (const config of CONFIGS.filter(c => c.id !== chosen.config.id)) {
    const e = evaluate(base2025, pbp2025, config, chosen.weight);
    robustness.push({ label: config.id, metrics: e.metrics });
  }
  for (const item of robustness) console.log(`${item.label.padEnd(26)} | ${metricLine(item.metrics)}`);

  const obs2026 = evaluate(base2026, pbp2026, chosen.config, chosen.weight);
  console.log('\n2026 OBSERVATIONAL CHECK — frozen 2024 parameters');
  console.log(`CONTROL v2.2: ${metricLine(control2026)}`);
  console.log(`EXP-012: ${metricLine(obs2026.metrics)}`);

  console.log('\n2026 WEEKLY OBSERVATION');
  const weekly2026: Record<string, unknown> = {};
  const weeks = [...new Set(obs2026.rows.map(r => r.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    const s = split(obs2026.rows, r => r.week === week);
    weekly2026[`Week ${week}`] = s;
    console.log(`Week ${week}: n=${s.n} | control ${pct(s.control.correct / s.control.n)} | EXP-012 ${pct(s.challenger.correct / s.challenger.n)} | control Brier ${s.control.brier.toFixed(4)} | EXP-012 Brier ${s.challenger.brier.toFixed(4)}`);
  }

  const verdict = decision(control2025, challenger2025, pairedP);
  console.log(`\nVERDICT: ${verdict}`);
  console.log('Production v2.2 remains unchanged. 2025 diagnostics and 2026 observations cannot be used to retune this locked experiment.');

  const result = {
    experiment: 'EXP-012',
    hypothesis: 'Variance-weighted/luck-adjusted prior-week EPA adds repeatable predictive value beyond v2.2.',
    discoveryVariants: CONFIGS.length * MODEL_WEIGHTS.length,
    configs: CONFIGS,
    locked: { config: chosen.config, weight: chosen.weight, discoveryMetrics: chosen.metrics },
    control2025,
    challenger2025,
    paired: { challengerOnly, controlOnly, p: pairedP },
    splits: splitOutput,
    robustness,
    observational2026: { control: control2026, challenger: obs2026.metrics, weekly: weekly2026 },
    verdict,
    governance: {
      productionChanged: false,
      discoverySeason: 2024,
      untouchedConfirmationSeason: 2025,
      liveForwardSeason: 2026,
      noTargetGamePbp: true,
      noMarket: true,
      noAstrology: true,
      postConfirmationDiagnosticsCannotRetune: true
    }
  };

  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  await writeFile('research/runtime/exp-012.json', JSON.stringify(result, null, 2));
  const markdown = `# EXP-012 Runtime Report\n\n- Locked config: **${chosen.config.id}**\n- Weight: **${chosen.weight.toFixed(2)}**\n- EPA cap: **${chosen.config.epaCap}**\n- Turnover multiplier: **${chosen.config.turnoverMultiplier}**\n- Fumble multiplier: **${chosen.config.fumbleMultiplier}**\n- Touchdown multiplier: **${chosen.config.touchdownMultiplier}**\n- Garbage-time filter: **${chosen.config.garbageFilter}**\n- 2025 control: **${metricLine(control2025)}**\n- 2025 challenger: **${metricLine(challenger2025)}**\n- Paired flips: challenger-only ${challengerOnly}, control-only ${controlOnly}, p=${pairedP.toFixed(4)}\n- 2026 control: **${metricLine(control2026)}**\n- 2026 challenger: **${metricLine(obs2026.metrics)}**\n- Verdict: **${verdict}**\n\nProduction v2.2 was not modified.\n`;
  await writeFile('research/reports/exp-012.md', markdown);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
