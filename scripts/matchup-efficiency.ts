import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const TEAM_STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
const CANDIDATE_WEIGHTS = [0, 0.05, 0.10, 0.15, 0.20] as const;
const ALL_COMPONENTS = ['passing', 'rushing', 'protection', 'ballSecurity'] as const;
type Component = typeof ALL_COMPONENTS[number];

type Game = ReturnType<typeof parseGamesCsv>[number];

interface TeamWeek {
  season: number;
  week: number;
  team: string;
  opponent: string;
  seasonType: string;
  attempts: number;
  passingEpa: number;
  sacksSuffered: number;
  passingInterceptions: number;
  carries: number;
  rushingYards: number;
  rushingFumblesLost: number;
}

interface Profile {
  passEpaPerDropback: number;
  rushYpc: number;
  sackRate: number;
  turnoverRate: number;
}

interface Metrics {
  n: number;
  correct: number;
  brier: number;
  logLoss: number;
}

interface EvaluationRow {
  week: number;
  actualHome: boolean;
  controlPHome: number;
  challengerPHome: number;
  controlHit: boolean;
  challengerHit: boolean;
}

interface Evaluation {
  metrics: Metrics;
  rows: EvaluationRow[];
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const bounded = Math.max(0.001, Math.min(0.999, p));
  return Math.log(bounded / (1 - bounded));
};
const safeNumber = (value: string | undefined) => {
  const n = Number(value ?? '0');
  return Number.isFinite(n) ? n : 0;
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

function parseTeamStats(text: string): TeamWeek[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const get = (cells: string[], name: string) => {
    const i = index.get(name);
    return i == null ? '' : (cells[i] ?? '').trim();
  };
  const required = ['season', 'week', 'team', 'opponent_team', 'season_type', 'attempts', 'passing_epa', 'sacks_suffered', 'passing_interceptions', 'carries', 'rushing_yards'];
  for (const field of required) {
    if (!index.has(field)) throw new Error(`Team stats missing required column: ${field}`);
  }

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return {
      season: safeNumber(get(cells, 'season')),
      week: safeNumber(get(cells, 'week')),
      team: normalizeTeamAbbr(get(cells, 'team')),
      opponent: normalizeTeamAbbr(get(cells, 'opponent_team')),
      seasonType: get(cells, 'season_type'),
      attempts: safeNumber(get(cells, 'attempts')),
      passingEpa: safeNumber(get(cells, 'passing_epa')),
      sacksSuffered: safeNumber(get(cells, 'sacks_suffered')),
      passingInterceptions: safeNumber(get(cells, 'passing_interceptions')),
      carries: safeNumber(get(cells, 'carries')),
      rushingYards: safeNumber(get(cells, 'rushing_yards')),
      rushingFumblesLost: safeNumber(get(cells, 'rushing_fumbles_lost'))
    };
  }).filter(row => row.seasonType === 'REG' && row.week > 0 && row.team && row.opponent);
}

function aggregate(rows: TeamWeek[]): Profile {
  const totals = rows.reduce((acc, row) => {
    acc.attempts += row.attempts;
    acc.passingEpa += row.passingEpa;
    acc.sacks += row.sacksSuffered;
    acc.interceptions += row.passingInterceptions;
    acc.carries += row.carries;
    acc.rushingYards += row.rushingYards;
    acc.rushFumblesLost += row.rushingFumblesLost;
    return acc;
  }, { attempts: 0, passingEpa: 0, sacks: 0, interceptions: 0, carries: 0, rushingYards: 0, rushFumblesLost: 0 });

  const dropbacks = totals.attempts + totals.sacks;
  const opportunities = totals.attempts + totals.carries;
  return {
    passEpaPerDropback: dropbacks ? totals.passingEpa / dropbacks : 0,
    rushYpc: totals.carries ? totals.rushingYards / totals.carries : 0,
    sackRate: dropbacks ? totals.sacks / dropbacks : 0,
    turnoverRate: opportunities ? (totals.interceptions + totals.rushFumblesLost) / opportunities : 0
  };
}

function offenseProfile(stats: TeamWeek[], team: string, week: number): Profile {
  return aggregate(stats.filter(row => row.team === team && row.week < week));
}

function defenseAllowedProfile(stats: TeamWeek[], team: string, week: number): Profile {
  return aggregate(stats.filter(row => row.opponent === team && row.week < week));
}

function meanSd(values: number[]): { mean: number; sd: number } {
  if (!values.length) return { mean: 0, sd: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return { mean, sd: Math.sqrt(variance) || 1 };
}

function z(value: number, dist: { mean: number; sd: number }): number {
  return (value - dist.mean) / dist.sd;
}

function matchupEdge(
  stats: TeamWeek[],
  home: string,
  away: string,
  week: number,
  enabled: readonly Component[] = ALL_COMPONENTS
): number {
  if (week <= 1) return 0;
  const teams = [...new Set(stats.filter(row => row.week < week).map(row => row.team))];
  if (teams.length < 20) return 0;

  const offenseProfiles = new Map(teams.map(team => [team, offenseProfile(stats, team, week)]));
  const defenseProfiles = new Map(teams.map(team => [team, defenseAllowedProfile(stats, team, week)]));
  const metrics: Array<keyof Profile> = ['passEpaPerDropback', 'rushYpc', 'sackRate', 'turnoverRate'];
  const offenseDist = new Map(metrics.map(metric => [metric, meanSd(teams.map(team => offenseProfiles.get(team)![metric]))]));
  const defenseDist = new Map(metrics.map(metric => [metric, meanSd(teams.map(team => defenseProfiles.get(team)![metric]))]));

  const matchup = (offenseTeam: string, defenseTeam: string): number => {
    const offense = offenseProfiles.get(offenseTeam) ?? aggregate([]);
    const allowed = defenseProfiles.get(defenseTeam) ?? aggregate([]);
    const components: Record<Component, number> = {
      passing:
        z(offense.passEpaPerDropback, offenseDist.get('passEpaPerDropback')!) +
        z(allowed.passEpaPerDropback, defenseDist.get('passEpaPerDropback')!),
      rushing:
        z(offense.rushYpc, offenseDist.get('rushYpc')!) +
        z(allowed.rushYpc, defenseDist.get('rushYpc')!),
      protection:
        -z(offense.sackRate, offenseDist.get('sackRate')!) -
        z(allowed.sackRate, defenseDist.get('sackRate')!),
      ballSecurity:
        -z(offense.turnoverRate, offenseDist.get('turnoverRate')!) -
        z(allowed.turnoverRate, defenseDist.get('turnoverRate')!)
    };
    return enabled.length
      ? enabled.reduce((sum, component) => sum + components[component], 0) / enabled.length
      : 0;
  };

  return Math.max(-4, Math.min(4, matchup(home, away) - matchup(away, home)));
}

function emptyMetrics(): Metrics {
  return { n: 0, correct: 0, brier: 0, logLoss: 0 };
}

function addMetric(metric: Metrics, pHome: number, actualHome: boolean) {
  const p = Math.max(0.001, Math.min(0.999, pHome));
  const y = actualHome ? 1 : 0;
  metric.n++;
  metric.correct += (p >= 0.5) === actualHome ? 1 : 0;
  metric.brier += Math.pow(p - y, 2);
  metric.logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

function metricsFromRows(rows: EvaluationRow[], probability: 'controlPHome' | 'challengerPHome'): Metrics {
  const metric = emptyMetrics();
  for (const row of rows) addMetric(metric, row[probability], row.actualHome);
  return metric;
}

async function loadStats(season: number): Promise<TeamWeek[]> {
  const response = await fetch(TEAM_STATS_URL(season));
  if (!response.ok) throw new Error(`Could not load nflverse team stats ${season}: ${response.status}`);
  const rows = parseTeamStats(await response.text());
  if (rows.length < 400) throw new Error(`Too few team-week rows for ${season}: ${rows.length}`);
  return rows;
}

async function evaluate(
  season: number,
  games: Game[],
  stats: TeamWeek[],
  weight: number,
  controlCache: Map<string, number>,
  enabled: readonly Component[] = ALL_COMPONENTS
): Promise<Evaluation> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const sample = games.filter(game => game.season === season && game.gameType === 'REG' && Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore) && game.homeScore !== game.awayScore);
  const metrics = emptyMetrics();
  const rows: EvaluationRow[] = [];

  for (const game of sample) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;
    const key = `${season}:${game.gameId || `${game.week}:${game.awayTeam}@${game.homeTeam}`}`;
    let control = controlCache.get(key);
    if (control == null) {
      const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
      control = result.modelScores?.finalHomeProbability != null
        ? result.modelScores.finalHomeProbability / 100
        : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
      controlCache.set(key, control);
    }
    const edge = matchupEdge(stats, game.homeTeam, game.awayTeam, game.week, enabled);
    const challengerPHome = logistic(logit(control) + edge * weight);
    const actualHome = game.homeScore! > game.awayScore!;
    addMetric(metrics, challengerPHome, actualHome);
    rows.push({
      week: game.week,
      actualHome,
      controlPHome: control,
      challengerPHome,
      controlHit: (control >= 0.5) === actualHome,
      challengerHit: (challengerPHome >= 0.5) === actualHome
    });
  }
  return { metrics, rows };
}

function report(label: string, metric: Metrics) {
  console.log(`${label}: ${metric.correct}/${metric.n} = ${(100 * metric.correct / metric.n).toFixed(2)}% | Brier ${(metric.brier / metric.n).toFixed(4)} | LogLoss ${(metric.logLoss / metric.n).toFixed(4)}`);
}

function delta(control: Metrics, challenger: Metrics) {
  return {
    accuracy: challenger.correct / challenger.n - control.correct / control.n,
    brier: challenger.brier / challenger.n - control.brier / control.n,
    logLoss: challenger.logLoss / challenger.n - control.logLoss / control.n
  };
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

function reportSplit(label: string, rows: EvaluationRow[]) {
  if (!rows.length) return;
  const control = metricsFromRows(rows, 'controlPHome');
  const challenger = metricsFromRows(rows, 'challengerPHome');
  const d = delta(control, challenger);
  console.log(`${label.padEnd(14)} n=${rows.length} | control ${(100 * control.correct / control.n).toFixed(2)}% | challenger ${(100 * challenger.correct / challenger.n).toFixed(2)}% | Δacc ${(d.accuracy * 100).toFixed(2)} | ΔBrier ${d.brier.toFixed(4)}`);
}

async function main() {
  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load nflverse games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());
  const stats2024 = await loadStats(2024);
  const stats2025 = await loadStats(2025);
  const cache = new Map<string, number>();

  console.log('\nEXP-007 — Offense-vs-defense matchup efficiency');
  console.log('=================================================');
  console.log('Components: passing EPA/dropback, rushing yards/carry, sack/protection rate, turnover rate.');
  console.log('All matchup inputs use prior weeks only; same-week completed games are conservatively excluded.');
  console.log(`Discovery weights: ${CANDIDATE_WEIGHTS.join(', ')} logit per matchup-z edge. 2024 selects by Brier; 2025 is untouched confirmation.`);

  const discovery: Array<{ weight: number; evaluation: Evaluation }> = [];
  for (const weight of CANDIDATE_WEIGHTS) {
    const evaluation = await evaluate(2024, games, stats2024, weight, cache);
    discovery.push({ weight, evaluation });
    report(`2024 weight=${weight.toFixed(2)}`, evaluation.metrics);
  }
  const selected = discovery.reduce((best, candidate) => candidate.evaluation.metrics.brier / candidate.evaluation.metrics.n < best.evaluation.metrics.brier / best.evaluation.metrics.n ? candidate : best);
  console.log(`\nSelected on 2024 Brier: weight=${selected.weight.toFixed(2)}`);

  const controlEval = await evaluate(2025, games, stats2025, 0, cache);
  const challengerEval = await evaluate(2025, games, stats2025, selected.weight, cache);
  const control = controlEval.metrics;
  const challenger = challengerEval.metrics;
  console.log('\nUntouched 2025 confirmation');
  report('CONTROL v2.2', control);
  report(`CHALLENGER matchup weight=${selected.weight.toFixed(2)}`, challenger);

  const d = delta(control, challenger);
  console.log('\nDelta challenger - control');
  console.log(`Accuracy: ${(d.accuracy * 100).toFixed(2)} points`);
  console.log(`Brier: ${d.brier.toFixed(4)} (negative is better)`);
  console.log(`LogLoss: ${d.logLoss.toFixed(4)} (negative is better)`);

  console.log('\nPost-confirmation neighboring-weight robustness (NOT used to reselect weight)');
  for (const weight of [0.10, 0.15, 0.20]) {
    const evaluation = await evaluate(2025, games, stats2025, weight, cache);
    report(`2025 robustness weight=${weight.toFixed(2)}`, evaluation.metrics);
  }

  console.log('\nComponent ablation at the frozen selected weight');
  for (const removed of ALL_COMPONENTS) {
    const enabled = ALL_COMPONENTS.filter(component => component !== removed);
    const evaluation = await evaluate(2025, games, stats2025, selected.weight, cache, enabled);
    report(`REMOVE ${removed}`, evaluation.metrics);
  }

  console.log('\n2025 split behavior at frozen selected weight');
  const rows = challengerEval.rows;
  reportSplit('Weeks 1-4', rows.filter(row => row.week <= 4));
  reportSplit('Weeks 5-9', rows.filter(row => row.week >= 5 && row.week <= 9));
  reportSplit('Weeks 10-18', rows.filter(row => row.week >= 10));
  reportSplit('Control home', rows.filter(row => row.controlPHome >= 0.5));
  reportSplit('Control away', rows.filter(row => row.controlPHome < 0.5));

  const challengerOnly = rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = rows.filter(row => row.controlHit && !row.challengerHit).length;
  const pairedP = exactMcNemarP(challengerOnly, controlOnly);
  console.log('\nPaired winner comparison');
  console.log(`Challenger correct / control wrong: ${challengerOnly}`);
  console.log(`Control correct / challenger wrong: ${controlOnly}`);
  console.log(`Exact McNemar/binomial two-sided p: ${pairedP.toFixed(4)}`);
  console.log(pairedP < 0.05
    ? 'Paired winner improvement clears the conventional 0.05 threshold on this test.'
    : 'Winner gain does NOT clear the conventional 0.05 threshold; treat it as promising rather than established.');

  const improvesAll = selected.weight !== 0 && d.accuracy > 0 && d.brier < 0 && d.logLoss < 0;
  const verdict = improvesAll
    ? 'KEEP FOR RESEARCH: untouched 2025 improved all three primary metrics. Robustness and ablation are reported above; promotion still requires broader walk-forward replication and uncertainty review.'
    : selected.weight === 0
      ? 'REJECT: discovery selected the zero-weight control.'
      : 'INCONCLUSIVE/REJECT FOR PROMOTION: untouched 2025 did not improve all primary metrics.';
  console.log(`\nVERDICT: ${verdict}`);
  console.log('Governance: 2025 robustness/ablation output is diagnostic only and cannot be used to reselect the frozen 0.15 weight. Production weights remain unchanged.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
