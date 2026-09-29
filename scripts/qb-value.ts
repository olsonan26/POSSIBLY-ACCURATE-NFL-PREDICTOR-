import { mkdir, writeFile } from 'node:fs/promises';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PLAYER_STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

const WINDOWS = [4, 8, 16] as const;
const PRIOR_DROPBACKS = [100, 200, 400] as const;
const QB_WEIGHTS = [0, 0.05, 0.1, 0.15, 0.2] as const;
const COMPONENTS = ['epa', 'cpoe', 'protection', 'rushing'] as const;

type Component = typeof COMPONENTS[number];
type Game = ReturnType<typeof parseGamesCsv>[number];

interface PlayerWeek {
  season: number;
  week: number;
  seasonType: string;
  playerName: string;
  normalizedName: string;
  team: string;
  position: string;
  attempts: number;
  passingEpa: number;
  passingCpoe?: number;
  sacksSuffered: number;
  carries: number;
  rushingEpa: number;
}

interface BaseGame {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeQbName: string;
  awayQbName: string;
  homeQbNormalized: string;
  awayQbNormalized: string;
  actualHomeWin: boolean;
  actualMargin: number;
  controlPHome: number;
  neutralSite: boolean;
  starterChange: boolean;
}

interface LeagueContext {
  means: Record<Component, number>;
  sds: Record<Component, number>;
}

interface QbProfile {
  score: number;
  componentScores: Record<Component, number>;
  historyDropbacks: number;
  historyGames: number;
  coldStart: boolean;
}

interface FeatureRow extends BaseGame {
  qbEdge: number;
  componentEdges: Record<Component, number>;
  homeQbScore: number;
  awayQbScore: number;
  homeHistoryDropbacks: number;
  awayHistoryDropbacks: number;
  coldStartEither: boolean;
}

interface EvalRow extends FeatureRow {
  challengerPHome: number;
  controlHit: boolean;
  challengerHit: boolean;
}

interface Metrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  ece: number;
}

interface Candidate {
  window: number;
  priorDropbacks: number;
  weight: number;
  metrics: Metrics;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const q = clamp(p, 0.001, 0.999);
  return Math.log(q / (1 - q));
};
const mean = (values: number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
const sd = (values: number[], center = mean(values)) => {
  if (values.length < 2) return 1;
  const variance = values.reduce((s, v) => s + Math.pow(v - center, 2), 0) / values.length;
  return Math.sqrt(variance) || 1;
};
const safeNumber = (value: string | undefined) => {
  const n = Number(value ?? '');
  return Number.isFinite(n) ? n : 0;
};
const optionalNumber = (value: string | undefined): number | undefined => {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

function normalizeName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

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

function parsePlayerStats(text: string): PlayerWeek[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const get = (cells: string[], name: string) => {
    const i = index.get(name);
    return i == null ? '' : (cells[i] ?? '').trim();
  };
  const required = ['season', 'week', 'season_type', 'player_display_name', 'position', 'attempts', 'passing_epa', 'sacks_suffered', 'carries', 'rushing_epa'];
  for (const field of required) {
    if (!index.has(field)) throw new Error(`Player stats missing required column: ${field}`);
  }

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const playerName = get(cells, 'player_display_name') || get(cells, 'player_name');
    return {
      season: safeNumber(get(cells, 'season')),
      week: safeNumber(get(cells, 'week')),
      seasonType: get(cells, 'season_type'),
      playerName,
      normalizedName: normalizeName(playerName),
      team: get(cells, 'team') || get(cells, 'recent_team'),
      position: get(cells, 'position'),
      attempts: safeNumber(get(cells, 'attempts')),
      passingEpa: safeNumber(get(cells, 'passing_epa')),
      passingCpoe: optionalNumber(get(cells, 'passing_cpoe')),
      sacksSuffered: safeNumber(get(cells, 'sacks_suffered')),
      carries: safeNumber(get(cells, 'carries')),
      rushingEpa: safeNumber(get(cells, 'rushing_epa'))
    };
  }).filter(row => row.seasonType === 'REG' && row.week > 0 && row.normalizedName && row.position === 'QB');
}

function isBefore(row: PlayerWeek, season: number, week: number): boolean {
  return row.season < season || (row.season === season && row.week < week);
}

function rowMetrics(row: PlayerWeek): Record<Component, number> | null {
  const dropbacks = row.attempts + row.sacksSuffered;
  if (dropbacks < 10) return null;
  return {
    epa: row.passingEpa / dropbacks,
    cpoe: row.passingCpoe ?? 0,
    protection: -(row.sacksSuffered / dropbacks),
    rushing: row.carries > 0 ? row.rushingEpa / row.carries : 0
  };
}

const contextCache = new Map<string, LeagueContext>();
function leagueContext(stats: PlayerWeek[], season: number, week: number): LeagueContext {
  const key = `${season}:${week}`;
  const cached = contextCache.get(key);
  if (cached) return cached;
  const metrics = stats.filter(row => isBefore(row, season, week)).map(rowMetrics).filter((x): x is Record<Component, number> => Boolean(x));
  const means = {} as Record<Component, number>;
  const sds = {} as Record<Component, number>;
  for (const component of COMPONENTS) {
    const values = metrics.map(metric => metric[component]).filter(Number.isFinite);
    means[component] = mean(values);
    sds[component] = Math.max(0.001, sd(values, means[component]));
  }
  const context = { means, sds };
  contextCache.set(key, context);
  return context;
}

function aggregateProfile(
  rows: PlayerWeek[],
  context: LeagueContext,
  priorDropbacks: number,
  enabled: readonly Component[]
): QbProfile {
  if (!rows.length) {
    return {
      score: 0,
      componentScores: { epa: 0, cpoe: 0, protection: 0, rushing: 0 },
      historyDropbacks: 0,
      historyGames: 0,
      coldStart: true
    };
  }

  const totals = rows.reduce((acc, row) => {
    const db = row.attempts + row.sacksSuffered;
    acc.dropbacks += db;
    acc.attempts += row.attempts;
    acc.passingEpa += row.passingEpa;
    acc.sacks += row.sacksSuffered;
    if (row.passingCpoe != null && row.attempts > 0) {
      acc.cpoeWeighted += row.passingCpoe * row.attempts;
      acc.cpoeAttempts += row.attempts;
    }
    acc.carries += row.carries;
    acc.rushingEpa += row.rushingEpa;
    return acc;
  }, { dropbacks: 0, attempts: 0, passingEpa: 0, sacks: 0, cpoeWeighted: 0, cpoeAttempts: 0, carries: 0, rushingEpa: 0 });

  const observed: Record<Component, number> = {
    epa: totals.dropbacks ? totals.passingEpa / totals.dropbacks : context.means.epa,
    cpoe: totals.cpoeAttempts ? totals.cpoeWeighted / totals.cpoeAttempts : context.means.cpoe,
    protection: totals.dropbacks ? -(totals.sacks / totals.dropbacks) : context.means.protection,
    rushing: totals.carries ? totals.rushingEpa / totals.carries : context.means.rushing
  };

  const passWeight = totals.dropbacks / (totals.dropbacks + priorDropbacks);
  const rushPrior = Math.max(20, priorDropbacks / 4);
  const rushWeight = totals.carries / (totals.carries + rushPrior);
  const componentScores = {} as Record<Component, number>;

  for (const component of COMPONENTS) {
    const w = component === 'rushing' ? rushWeight : passWeight;
    const shrunk = context.means[component] + w * (observed[component] - context.means[component]);
    componentScores[component] = clamp((shrunk - context.means[component]) / context.sds[component], -3, 3);
  }

  const active = enabled.length ? enabled : COMPONENTS;
  const score = mean(active.map(component => componentScores[component]));
  return {
    score,
    componentScores,
    historyDropbacks: totals.dropbacks,
    historyGames: rows.length,
    coldStart: totals.dropbacks < 50
  };
}

function qbProfile(
  stats: PlayerWeek[],
  qbName: string,
  season: number,
  week: number,
  window: number,
  priorDropbacks: number,
  enabled: readonly Component[] = COMPONENTS
): QbProfile {
  const normalized = normalizeName(qbName);
  const context = leagueContext(stats, season, week);
  const rows = stats
    .filter(row => row.normalizedName === normalized && row.attempts > 0 && isBefore(row, season, week))
    .sort((a, b) => (b.season - a.season) || (b.week - a.week))
    .slice(0, window);
  return aggregateProfile(rows, context, priorDropbacks, enabled);
}

function expectedCalibrationError(rows: Array<{ p: number; actual: boolean }>, bins = 10): number {
  if (!rows.length) return 0;
  let ece = 0;
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const bucket = rows.filter(row => row.p >= lo && (i === bins - 1 ? row.p <= hi : row.p < hi));
    if (!bucket.length) continue;
    const avgP = mean(bucket.map(row => row.p));
    const actual = mean(bucket.map(row => row.actual ? 1 : 0));
    ece += bucket.length / rows.length * Math.abs(avgP - actual);
  }
  return ece;
}

function evaluate(rows: FeatureRow[], weight: number, edgeSelector: (row: FeatureRow) => number = row => row.qbEdge): { metrics: Metrics; rows: EvalRow[] } {
  const out: EvalRow[] = rows.map(row => {
    const challengerPHome = logistic(logit(row.controlPHome) + weight * edgeSelector(row));
    return {
      ...row,
      challengerPHome,
      controlHit: (row.controlPHome >= 0.5) === row.actualHomeWin,
      challengerHit: (challengerPHome >= 0.5) === row.actualHomeWin
    };
  });
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of out) {
    const y = row.actualHomeWin ? 1 : 0;
    const p = clamp(row.challengerPHome, 0.001, 0.999);
    correct += (p >= 0.5) === row.actualHomeWin ? 1 : 0;
    brier += Math.pow(p - y, 2);
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  const metrics: Metrics = {
    n: out.length,
    correct,
    accuracy: out.length ? correct / out.length : 0,
    brier: out.length ? brier / out.length : 0,
    logLoss: out.length ? logLoss / out.length : 0,
    ece: expectedCalibrationError(out.map(row => ({ p: row.challengerPHome, actual: row.actualHomeWin })))
  };
  return { metrics, rows: out };
}

function controlMetrics(rows: FeatureRow[]): Metrics {
  const normalized = rows.map(row => ({ ...row, challengerPHome: row.controlPHome }));
  return evaluate(normalized, 0, () => 0).metrics;
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

function fmtPct(value: number) {
  return `${(100 * value).toFixed(2)}%`;
}

function printMetrics(label: string, metric: Metrics) {
  console.log(`${label}: ${metric.correct}/${metric.n} = ${fmtPct(metric.accuracy)} | Brier ${metric.brier.toFixed(4)} | LogLoss ${metric.logLoss.toFixed(4)} | ECE ${metric.ece.toFixed(4)}`);
}

function previousStarter(games: Game[], target: Game, team: string): string | undefined {
  const prior = games
    .filter(game => game.gameType === 'REG' && game.gameday < target.gameday && (game.homeTeam === team || game.awayTeam === team))
    .sort((a, b) => b.gameday.localeCompare(a.gameday));
  for (const game of prior) {
    const name = game.homeTeam === team ? game.homeQbName : game.awayQbName;
    if (name) return name;
  }
  return undefined;
}

async function loadBaseGames(games: Game[], season: number): Promise<BaseGame[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const eligible = games.filter(game =>
    game.season === season &&
    game.gameType === 'REG' &&
    game.gameday < todayIso &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore &&
    game.homeQbName &&
    game.awayQbName
  );
  const rows: BaseGame[] = [];
  let count = 0;
  for (const game of eligible) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away || !game.homeQbName || !game.awayQbName) continue;
    const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
    const p = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
    const homePrev = previousStarter(games, game, game.homeTeam);
    const awayPrev = previousStarter(games, game, game.awayTeam);
    rows.push({
      gameId: String(game.gameId || `${season}:${game.week}:${game.awayTeam}@${game.homeTeam}`),
      season,
      week: game.week,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeQbName: game.homeQbName,
      awayQbName: game.awayQbName,
      homeQbNormalized: normalizeName(game.homeQbName),
      awayQbNormalized: normalizeName(game.awayQbName),
      actualHomeWin: Number(game.homeScore) > Number(game.awayScore),
      actualMargin: Number(game.homeScore) - Number(game.awayScore),
      controlPHome: clamp(p, 0.001, 0.999),
      neutralSite: game.location === 'Neutral',
      starterChange: Boolean(
        (homePrev && normalizeName(homePrev) !== normalizeName(game.homeQbName)) ||
        (awayPrev && normalizeName(awayPrev) !== normalizeName(game.awayQbName))
      )
    });
    count++;
    if (count % 100 === 0) console.log(`control snapshot progress ${season}: ${count}/${eligible.length}`);
  }
  return rows;
}

function buildFeatureRows(
  base: BaseGame[],
  stats: PlayerWeek[],
  window: number,
  priorDropbacks: number,
  enabled: readonly Component[] = COMPONENTS
): FeatureRow[] {
  return base.map(game => {
    const home = qbProfile(stats, game.homeQbName, game.season, game.week, window, priorDropbacks, enabled);
    const away = qbProfile(stats, game.awayQbName, game.season, game.week, window, priorDropbacks, enabled);
    const componentEdges = {} as Record<Component, number>;
    for (const component of COMPONENTS) componentEdges[component] = home.componentScores[component] - away.componentScores[component];
    return {
      ...game,
      qbEdge: home.score - away.score,
      componentEdges,
      homeQbScore: home.score,
      awayQbScore: away.score,
      homeHistoryDropbacks: home.historyDropbacks,
      awayHistoryDropbacks: away.historyDropbacks,
      coldStartEither: home.coldStart || away.coldStart
    };
  });
}

function reportSplit(label: string, rows: EvalRow[]) {
  if (!rows.length) return;
  const features: FeatureRow[] = rows;
  const control = controlMetrics(features);
  const challenger = evaluate(features, 0, row => logit((row as EvalRow).challengerPHome) - logit(row.controlPHome)).metrics;
  console.log(`${label.padEnd(22)} n=${rows.length} | control ${fmtPct(control.accuracy)} | challenger ${fmtPct(challenger.accuracy)} | Δacc ${((challenger.accuracy - control.accuracy) * 100).toFixed(2)} | ΔBrier ${(challenger.brier - control.brier).toFixed(4)}`);
}

function metricsForProbabilities(rows: EvalRow[], useControl: boolean): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, ece: 0 };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const calibration: Array<{ p: number; actual: boolean }> = [];
  for (const row of rows) {
    const p = useControl ? row.controlPHome : row.challengerPHome;
    const y = row.actualHomeWin ? 1 : 0;
    correct += (p >= 0.5) === row.actualHomeWin ? 1 : 0;
    brier += Math.pow(p - y, 2);
    logLoss += -(y * Math.log(clamp(p, 0.001, 0.999)) + (1 - y) * Math.log(clamp(1 - p, 0.001, 0.999)));
    calibration.push({ p, actual: row.actualHomeWin });
  }
  return { n: rows.length, correct, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length, ece: expectedCalibrationError(calibration) };
}

function printSplit(label: string, rows: EvalRow[]) {
  if (!rows.length) return;
  const control = metricsForProbabilities(rows, true);
  const challenger = metricsForProbabilities(rows, false);
  console.log(`${label.padEnd(22)} n=${rows.length} | control ${fmtPct(control.accuracy)} | QB ${fmtPct(challenger.accuracy)} | Δacc ${((challenger.accuracy - control.accuracy) * 100).toFixed(2)} | ΔBrier ${(challenger.brier - control.brier).toFixed(4)}`);
}

function verdict(control: Metrics, challenger: Metrics, pValue: number): string {
  const improved = [challenger.accuracy > control.accuracy, challenger.brier < control.brier, challenger.logLoss < control.logLoss].filter(Boolean).length;
  if (improved === 3 && pValue <= 0.10) return 'SURVIVES FOR REPLICATION';
  if (improved >= 2) return 'KEEP FOR RESEARCH';
  if (challenger.accuracy < control.accuracy && challenger.brier > control.brier && challenger.logLoss > control.logLoss) return 'REJECT FOR PROMOTION';
  return 'INCONCLUSIVE';
}

async function loadPlayerStats(seasons: number[]): Promise<PlayerWeek[]> {
  const all: PlayerWeek[] = [];
  for (const season of seasons) {
    const response = await fetch(PLAYER_STATS_URL(season));
    if (!response.ok) throw new Error(`Could not load nflverse player stats ${season}: ${response.status}`);
    const rows = parsePlayerStats(await response.text());
    console.log(`player stats ${season}: ${rows.length} QB-week rows`);
    all.push(...rows);
  }
  return all;
}

async function main() {
  console.log('\nEXP-010 — QB EPA + CPOE Value Engine');
  console.log('======================================');
  console.log('Hypothesis: a leakage-safe rolling QB value signal built from EPA/dropback, CPOE, sack avoidance, and QB rushing adds predictive information beyond team-level v2.2.');
  console.log('Historical starter identity comes from the schedule QB-name fields; same-game QB performance is never used in that game\'s profile.');
  console.log('The first version uses starter-to-starter QB value delta. Named backup/depth-chart replacement value is intentionally deferred until a point-in-time personnel layer can verify it.');
  console.log('Protocol: choose window/prior/weight on 2024 only -> lock -> untouched 2025 -> 2026 observational -> ablation/robustness/splits -> survive/kill.');

  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());
  const stats = await loadPlayerStats([2021, 2022, 2023, 2024, 2025, 2026]);
  const base2024 = await loadBaseGames(games, 2024);
  const base2025 = await loadBaseGames(games, 2025);
  const base2026 = await loadBaseGames(games, 2026);
  console.log(`Eligible games with named starters: 2024=${base2024.length}, 2025=${base2025.length}, 2026=${base2026.length}`);

  console.log('\n2024 DISCOVERY — 45 preregistered variants, select by Brier then log loss');
  const candidates: Candidate[] = [];
  const discoveryCache = new Map<string, FeatureRow[]>();
  for (const window of WINDOWS) {
    for (const priorDropbacks of PRIOR_DROPBACKS) {
      const featureRows = buildFeatureRows(base2024, stats, window, priorDropbacks);
      discoveryCache.set(`${window}:${priorDropbacks}`, featureRows);
      for (const weight of QB_WEIGHTS) {
        const metrics = evaluate(featureRows, weight).metrics;
        candidates.push({ window, priorDropbacks, weight, metrics });
        console.log(`window=${String(window).padStart(2)} prior=${String(priorDropbacks).padStart(3)} weight=${weight.toFixed(2)} | ${metrics.correct}/${metrics.n} ${fmtPct(metrics.accuracy)} | Brier ${metrics.brier.toFixed(4)} | LogLoss ${metrics.logLoss.toFixed(4)}`);
      }
    }
  }

  const selected = candidates.reduce((best, candidate) => {
    if (candidate.metrics.brier < best.metrics.brier - 1e-9) return candidate;
    if (Math.abs(candidate.metrics.brier - best.metrics.brier) <= 1e-9 && candidate.metrics.logLoss < best.metrics.logLoss) return candidate;
    return best;
  });
  console.log(`\nLOCKED AFTER 2024: window=${selected.window}, priorDropbacks=${selected.priorDropbacks}, weight=${selected.weight.toFixed(2)}.`);
  console.log('No 2025 result may reselect these parameters.');

  const feature2025 = buildFeatureRows(base2025, stats, selected.window, selected.priorDropbacks);
  const confirmation = evaluate(feature2025, selected.weight);
  const control2025 = controlMetrics(feature2025);
  console.log('\nUNTOUCHED 2025 CONFIRMATION');
  printMetrics('CONTROL v2.2', control2025);
  printMetrics('EXP-010 QB', confirmation.metrics);
  console.log(`Δaccuracy ${((confirmation.metrics.accuracy - control2025.accuracy) * 100).toFixed(2)} points | ΔBrier ${(confirmation.metrics.brier - control2025.brier).toFixed(4)} | ΔLogLoss ${(confirmation.metrics.logLoss - control2025.logLoss).toFixed(4)}`);

  const challengerOnly = confirmation.rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = confirmation.rows.filter(row => row.controlHit && !row.challengerHit).length;
  const pValue = exactMcNemarP(challengerOnly, controlOnly);
  console.log(`Paired flips: challenger-only correct=${challengerOnly}, control-only correct=${controlOnly}, exact p=${pValue.toFixed(4)}`);

  console.log('\n2025 SPLITS');
  printSplit('Weeks 1-4', confirmation.rows.filter(row => row.week <= 4));
  printSplit('Weeks 5-9', confirmation.rows.filter(row => row.week >= 5 && row.week <= 9));
  printSplit('Weeks 10-18', confirmation.rows.filter(row => row.week >= 10));
  printSplit('Starter-change games', confirmation.rows.filter(row => row.starterChange));
  printSplit('Stable-starter games', confirmation.rows.filter(row => !row.starterChange));
  printSplit('Cold-start either QB', confirmation.rows.filter(row => row.coldStartEither));
  printSplit('Both >=200 prior DB', confirmation.rows.filter(row => row.homeHistoryDropbacks >= 200 && row.awayHistoryDropbacks >= 200));
  printSplit('One-score <=8', confirmation.rows.filter(row => Math.abs(row.actualMargin) <= 8));
  printSplit('Blowout >=14', confirmation.rows.filter(row => Math.abs(row.actualMargin) >= 14));
  printSplit('Neutral site', confirmation.rows.filter(row => row.neutralSite));

  console.log('\nCOMPONENT ABLATION — frozen parameters, diagnostic only');
  const ablations: Record<string, Metrics> = {};
  for (const removed of COMPONENTS) {
    const enabled = COMPONENTS.filter(component => component !== removed);
    const rows = buildFeatureRows(base2025, stats, selected.window, selected.priorDropbacks, enabled);
    const metrics = evaluate(rows, selected.weight).metrics;
    ablations[removed] = metrics;
    printMetrics(`REMOVE ${removed}`, metrics);
  }

  console.log('\nNEIGHBORING PARAMETERS — 2025 diagnostics only, never reselect');
  const weightIndex = QB_WEIGHTS.indexOf(selected.weight as typeof QB_WEIGHTS[number]);
  const neighborWeights = [...new Set([QB_WEIGHTS[Math.max(0, weightIndex - 1)], selected.weight, QB_WEIGHTS[Math.min(QB_WEIGHTS.length - 1, weightIndex + 1)]])];
  const robustness: Array<{ window: number; priorDropbacks: number; weight: number; metrics: Metrics }> = [];
  for (const weight of neighborWeights) {
    const metrics = evaluate(feature2025, weight).metrics;
    robustness.push({ window: selected.window, priorDropbacks: selected.priorDropbacks, weight, metrics });
    printMetrics(`weight=${weight.toFixed(2)}`, metrics);
  }
  for (const window of WINDOWS.filter(w => w !== selected.window)) {
    const rows = buildFeatureRows(base2025, stats, window, selected.priorDropbacks);
    const metrics = evaluate(rows, selected.weight).metrics;
    robustness.push({ window, priorDropbacks: selected.priorDropbacks, weight: selected.weight, metrics });
    printMetrics(`window=${window}`, metrics);
  }
  for (const priorDropbacks of PRIOR_DROPBACKS.filter(p => p !== selected.priorDropbacks)) {
    const rows = buildFeatureRows(base2025, stats, selected.window, priorDropbacks);
    const metrics = evaluate(rows, selected.weight).metrics;
    robustness.push({ window: selected.window, priorDropbacks, weight: selected.weight, metrics });
    printMetrics(`prior=${priorDropbacks}`, metrics);
  }

  const feature2026 = buildFeatureRows(base2026, stats, selected.window, selected.priorDropbacks);
  const observation2026 = evaluate(feature2026, selected.weight);
  const control2026 = controlMetrics(feature2026);
  console.log('\n2026 OBSERVATIONAL CHECK — frozen 2024 parameters');
  printMetrics('CONTROL v2.2', control2026);
  printMetrics('EXP-010 QB', observation2026.metrics);

  const finalVerdict = verdict(control2025, confirmation.metrics, pValue);
  console.log(`\nVERDICT: ${finalVerdict}`);
  console.log('Production v2.2 remains unchanged. The 2026 sample is observational and cannot be used to rescue or retune EXP-010.');

  const result = {
    experiment: 'EXP-010',
    generatedAt: new Date().toISOString(),
    hypothesis: 'Rolling QB EPA/dropback + CPOE + sack avoidance + rushing value adds information beyond the frozen team-level control.',
    governance: {
      productionChanged: false,
      discoverySeason: 2024,
      confirmationSeason: 2025,
      liveForwardSeason: 2026,
      variantsTried: candidates.length,
      starterIdentitySource: 'nfldata games.csv home_qb_name / away_qb_name',
      sameGamePerformanceUsed: false,
      backupValueIncluded: false,
      backupNote: 'Named backup value deferred until point-in-time personnel/depth-chart data are validated.'
    },
    selected: { window: selected.window, priorDropbacks: selected.priorDropbacks, weight: selected.weight },
    control2025,
    challenger2025: confirmation.metrics,
    paired: { challengerOnly, controlOnly, pValue },
    ablations,
    robustness,
    control2026,
    challenger2026: observation2026.metrics,
    coverage: { games2024: base2024.length, games2025: base2025.length, games2026: base2026.length },
    verdict: finalVerdict
  };

  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  await writeFile('research/runtime/exp-010.json', JSON.stringify(result, null, 2));
  const markdown = `# EXP-010 — QB EPA + CPOE Value Engine\n\nGenerated: ${result.generatedAt}\n\n## Locked 2024 parameters\n\n- Window: ${selected.window} QB games\n- Prior shrinkage: ${selected.priorDropbacks} dropbacks\n- Logit weight: ${selected.weight.toFixed(2)}\n- Variants tried: ${candidates.length}\n\n## Untouched 2025\n\n| Model | Accuracy | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|\n| v2.2 | ${fmtPct(control2025.accuracy)} | ${control2025.brier.toFixed(4)} | ${control2025.logLoss.toFixed(4)} | ${control2025.ece.toFixed(4)} |\n| EXP-010 | ${fmtPct(confirmation.metrics.accuracy)} | ${confirmation.metrics.brier.toFixed(4)} | ${confirmation.metrics.logLoss.toFixed(4)} | ${confirmation.metrics.ece.toFixed(4)} |\n\nPaired flips: EXP-010-only ${challengerOnly}, control-only ${controlOnly}, exact p=${pValue.toFixed(4)}.\n\n## 2026 observational\n\n- Control: ${fmtPct(control2026.accuracy)}, Brier ${control2026.brier.toFixed(4)}\n- EXP-010: ${fmtPct(observation2026.metrics.accuracy)}, Brier ${observation2026.metrics.brier.toFixed(4)}\n\n## Verdict\n\n**${finalVerdict}**\n\nProduction remains unchanged. Named backup/depth-chart replacement value is not claimed in this version.\n`;
  await writeFile('research/reports/exp-010.md', markdown);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
