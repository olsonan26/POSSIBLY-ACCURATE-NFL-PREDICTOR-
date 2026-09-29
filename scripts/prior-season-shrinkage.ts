import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const TEAM_STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;

const OFFENSE_K = [2, 4, 6] as const;
const DEFENSE_K = [3, 6, 9] as const;
const PRIOR_RETENTION = [0.50, 0.75, 1.00] as const;
const LOGIT_WEIGHTS = [0, 0.05, 0.10, 0.15, 0.20] as const;

type Game = ReturnType<typeof parseGamesCsv>[number];
type Component = 'pass' | 'rush';
type Side = 'offense' | 'defense';

interface TeamWeek {
  season: number;
  week: number;
  team: string;
  opponent: string;
  seasonType: string;
  attempts: number;
  passingEpa: number;
  sacksSuffered: number;
  carries: number;
  rushingEpa: number;
}

interface EfficiencyProfile {
  pass: number;
  rush: number;
  games: number;
}

interface BaseGame {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  actualHomeWin: boolean;
  actualMargin: number;
  controlPHome: number;
  neutralSite: boolean;
}

interface FeatureRow extends BaseGame {
  priorEdge: number;
  offenseEdge: number;
  defenseEdge: number;
  passEdge: number;
  rushEdge: number;
  homeCurrentGames: number;
  awayCurrentGames: number;
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
  offenseK: number;
  defenseK: number;
  retention: number;
  weight: number;
  metrics: Metrics;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const q = clamp(p, 0.001, 0.999);
  return Math.log(q / (1 - q));
};
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const safeNumber = (value: string | undefined) => {
  const n = Number(value ?? '');
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
  const required = ['season', 'week', 'team', 'opponent_team', 'season_type', 'attempts', 'passing_epa', 'sacks_suffered', 'carries', 'rushing_epa'];
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
      carries: safeNumber(get(cells, 'carries')),
      rushingEpa: safeNumber(get(cells, 'rushing_epa'))
    };
  }).filter(row => row.seasonType === 'REG' && row.week > 0 && row.team && row.opponent);
}

function aggregate(rows: TeamWeek[]): EfficiencyProfile {
  const totals = rows.reduce((acc, row) => {
    acc.attempts += row.attempts;
    acc.passingEpa += row.passingEpa;
    acc.sacks += row.sacksSuffered;
    acc.carries += row.carries;
    acc.rushingEpa += row.rushingEpa;
    return acc;
  }, { attempts: 0, passingEpa: 0, sacks: 0, carries: 0, rushingEpa: 0 });
  const dropbacks = totals.attempts + totals.sacks;
  return {
    pass: dropbacks ? totals.passingEpa / dropbacks : 0,
    rush: totals.carries ? totals.rushingEpa / totals.carries : 0,
    games: rows.length
  };
}

function profile(
  stats: TeamWeek[],
  season: number,
  team: string,
  side: Side,
  beforeWeek?: number
): EfficiencyProfile {
  const rows = stats.filter(row =>
    row.season === season &&
    (beforeWeek == null || row.week < beforeWeek) &&
    (side === 'offense' ? row.team === team : row.opponent === team)
  );
  return aggregate(rows);
}

function meanSd(values: number[]): { mean: number; sd: number } {
  if (!values.length) return { mean: 0, sd: 1 };
  const center = mean(values);
  const variance = mean(values.map(value => Math.pow(value - center, 2)));
  return { mean: center, sd: Math.sqrt(variance) || 1 };
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

function blendMetric(current: number, prior: number, priorMean: number, currentGames: number, k: number, retention: number): number {
  const retainedPrior = priorMean + retention * (prior - priorMean);
  const currentWeight = currentGames / (currentGames + k);
  return currentWeight * current + (1 - currentWeight) * retainedPrior;
}

function buildWeekRatings(
  stats: TeamWeek[],
  season: number,
  week: number,
  offenseK: number,
  defenseK: number,
  retention: number,
  enabledSides: readonly Side[] = ['offense', 'defense'],
  enabledComponents: readonly Component[] = ['pass', 'rush']
): Map<string, { total: number; offense: number; defense: number; pass: number; rush: number; currentGames: number }> {
  const priorSeason = season - 1;
  const teams = [...new Set(stats.filter(row => row.season === season || row.season === priorSeason).flatMap(row => [row.team, row.opponent]))]
    .filter(Boolean);

  const priorOffense = new Map(teams.map(team => [team, profile(stats, priorSeason, team, 'offense')]));
  const priorDefense = new Map(teams.map(team => [team, profile(stats, priorSeason, team, 'defense')]));
  const currentOffense = new Map(teams.map(team => [team, profile(stats, season, team, 'offense', week)]));
  const currentDefense = new Map(teams.map(team => [team, profile(stats, season, team, 'defense', week)]));

  const priorOffMeans: Record<Component, number> = {
    pass: mean(teams.map(team => priorOffense.get(team)!.pass)),
    rush: mean(teams.map(team => priorOffense.get(team)!.rush))
  };
  const priorDefMeans: Record<Component, number> = {
    pass: mean(teams.map(team => priorDefense.get(team)!.pass)),
    rush: mean(teams.map(team => priorDefense.get(team)!.rush))
  };

  const blended = new Map<string, {
    offense: Record<Component, number>;
    defenseAllowed: Record<Component, number>;
    currentGames: number;
  }>();

  for (const team of teams) {
    const prevOff = priorOffense.get(team)!;
    const prevDef = priorDefense.get(team)!;
    const curOff = currentOffense.get(team)!;
    const curDef = currentDefense.get(team)!;
    blended.set(team, {
      offense: {
        pass: blendMetric(curOff.pass, prevOff.pass, priorOffMeans.pass, curOff.games, offenseK, retention),
        rush: blendMetric(curOff.rush, prevOff.rush, priorOffMeans.rush, curOff.games, offenseK, retention)
      },
      defenseAllowed: {
        pass: blendMetric(curDef.pass, prevDef.pass, priorDefMeans.pass, curDef.games, defenseK, retention),
        rush: blendMetric(curDef.rush, prevDef.rush, priorDefMeans.rush, curDef.games, defenseK, retention)
      },
      currentGames: Math.max(curOff.games, curDef.games)
    });
  }

  const offenseDist: Record<Component, { mean: number; sd: number }> = {
    pass: meanSd(teams.map(team => blended.get(team)!.offense.pass)),
    rush: meanSd(teams.map(team => blended.get(team)!.offense.rush))
  };
  const defenseDist: Record<Component, { mean: number; sd: number }> = {
    pass: meanSd(teams.map(team => blended.get(team)!.defenseAllowed.pass)),
    rush: meanSd(teams.map(team => blended.get(team)!.defenseAllowed.rush))
  };

  const output = new Map<string, { total: number; offense: number; defense: number; pass: number; rush: number; currentGames: number }>();
  for (const team of teams) {
    const values = blended.get(team)!;
    const offenseComponents: Record<Component, number> = {
      pass: (values.offense.pass - offenseDist.pass.mean) / offenseDist.pass.sd,
      rush: (values.offense.rush - offenseDist.rush.mean) / offenseDist.rush.sd
    };
    const defenseComponents: Record<Component, number> = {
      pass: -(values.defenseAllowed.pass - defenseDist.pass.mean) / defenseDist.pass.sd,
      rush: -(values.defenseAllowed.rush - defenseDist.rush.mean) / defenseDist.rush.sd
    };

    const offense = enabledSides.includes('offense')
      ? mean(enabledComponents.map(component => offenseComponents[component]))
      : 0;
    const defense = enabledSides.includes('defense')
      ? mean(enabledComponents.map(component => defenseComponents[component]))
      : 0;
    const pass = (enabledSides.includes('offense') ? offenseComponents.pass : 0) + (enabledSides.includes('defense') ? defenseComponents.pass : 0);
    const rush = (enabledSides.includes('offense') ? offenseComponents.rush : 0) + (enabledSides.includes('defense') ? defenseComponents.rush : 0);
    output.set(team, {
      total: clamp(offense + defense, -4, 4),
      offense,
      defense,
      pass,
      rush,
      currentGames: values.currentGames
    });
  }
  return output;
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
    game.homeScore !== game.awayScore
  );
  const rows: BaseGame[] = [];
  let count = 0;
  for (const game of eligible) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;
    const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
    const p = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
    rows.push({
      gameId: String(game.gameId || `${season}:${game.week}:${game.awayTeam}@${game.homeTeam}`),
      season,
      week: game.week,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      actualHomeWin: Number(game.homeScore) > Number(game.awayScore),
      actualMargin: Number(game.homeScore) - Number(game.awayScore),
      controlPHome: clamp(p, 0.001, 0.999),
      neutralSite: game.location === 'Neutral'
    });
    count++;
    if (count % 100 === 0) console.log(`control snapshot ${season}: ${count}/${eligible.length}`);
  }
  return rows;
}

function buildFeatureRows(
  base: BaseGame[],
  stats: TeamWeek[],
  offenseK: number,
  defenseK: number,
  retention: number,
  enabledSides: readonly Side[] = ['offense', 'defense'],
  enabledComponents: readonly Component[] = ['pass', 'rush']
): FeatureRow[] {
  const cache = new Map<number, ReturnType<typeof buildWeekRatings>>();
  return base.map(game => {
    let ratings = cache.get(game.week);
    if (!ratings) {
      ratings = buildWeekRatings(stats, game.season, game.week, offenseK, defenseK, retention, enabledSides, enabledComponents);
      cache.set(game.week, ratings);
    }
    const home = ratings.get(game.homeTeam) ?? { total: 0, offense: 0, defense: 0, pass: 0, rush: 0, currentGames: 0 };
    const away = ratings.get(game.awayTeam) ?? { total: 0, offense: 0, defense: 0, pass: 0, rush: 0, currentGames: 0 };
    return {
      ...game,
      priorEdge: clamp(home.total - away.total, -4, 4),
      offenseEdge: clamp(home.offense - away.offense, -4, 4),
      defenseEdge: clamp(home.defense - away.defense, -4, 4),
      passEdge: clamp(home.pass - away.pass, -4, 4),
      rushEdge: clamp(home.rush - away.rush, -4, 4),
      homeCurrentGames: home.currentGames,
      awayCurrentGames: away.currentGames
    };
  });
}

function metricsFromRows(rows: Array<{ actualHomeWin: boolean; pHome: number }>): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, ece: 0 };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const p = clamp(row.pHome, 0.001, 0.999);
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
    ece: expectedCalibrationError(rows.map(row => ({ p: row.pHome, actual: row.actualHomeWin })))
  };
}

function evaluate(rows: FeatureRow[], weight: number, edgeSelector: (row: FeatureRow) => number = row => row.priorEdge): { metrics: Metrics; rows: EvalRow[] } {
  const evaluated = rows.map(row => {
    const challengerPHome = logistic(logit(row.controlPHome) + weight * edgeSelector(row));
    return {
      ...row,
      challengerPHome,
      controlHit: (row.controlPHome >= 0.5) === row.actualHomeWin,
      challengerHit: (challengerPHome >= 0.5) === row.actualHomeWin
    };
  });
  return {
    metrics: metricsFromRows(evaluated.map(row => ({ actualHomeWin: row.actualHomeWin, pHome: row.challengerPHome }))),
    rows: evaluated
  };
}

function controlMetrics(rows: FeatureRow[]): Metrics {
  return metricsFromRows(rows.map(row => ({ actualHomeWin: row.actualHomeWin, pHome: row.controlPHome })));
}

function evalRowsMetrics(rows: EvalRow[], field: 'controlPHome' | 'challengerPHome'): Metrics {
  return metricsFromRows(rows.map(row => ({ actualHomeWin: row.actualHomeWin, pHome: row[field] })));
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
  return `${(value * 100).toFixed(2)}%`;
}

function printMetrics(label: string, metric: Metrics) {
  console.log(`${label}: ${metric.correct}/${metric.n} = ${fmtPct(metric.accuracy)} | Brier ${metric.brier.toFixed(4)} | LogLoss ${metric.logLoss.toFixed(4)} | ECE ${metric.ece.toFixed(4)}`);
}

function printSplit(label: string, rows: EvalRow[]) {
  if (!rows.length) return;
  const control = evalRowsMetrics(rows, 'controlPHome');
  const challenger = evalRowsMetrics(rows, 'challengerPHome');
  console.log(`${label.padEnd(20)} n=${rows.length} | control ${fmtPct(control.accuracy)} | EXP-011 ${fmtPct(challenger.accuracy)} | Δacc ${((challenger.accuracy - control.accuracy) * 100).toFixed(2)} | ΔBrier ${(challenger.brier - control.brier).toFixed(4)}`);
}

async function loadStats(seasons: number[]): Promise<TeamWeek[]> {
  const all: TeamWeek[] = [];
  for (const season of seasons) {
    const response = await fetch(TEAM_STATS_URL(season));
    if (!response.ok) throw new Error(`Could not load nflverse team stats ${season}: ${response.status}`);
    const rows = parseTeamStats(await response.text());
    console.log(`team stats ${season}: ${rows.length} regular-season team-week rows`);
    all.push(...rows);
  }
  return all;
}

function verdict(control: Metrics, challenger: Metrics, pValue: number): string {
  const wins = [
    challenger.accuracy > control.accuracy,
    challenger.brier < control.brier,
    challenger.logLoss < control.logLoss
  ].filter(Boolean).length;
  if (wins === 3 && pValue <= 0.10) return 'SURVIVES FOR REPLICATION';
  if (wins >= 2) return 'KEEP FOR RESEARCH';
  if (challenger.accuracy < control.accuracy && challenger.brier > control.brier && challenger.logLoss > control.logLoss) return 'REJECT FOR PROMOTION';
  return 'INCONCLUSIVE';
}

async function main() {
  console.log('\nEXP-011 — Dynamic Prior-Season Shrinkage');
  console.log('=========================================');
  console.log('Hypothesis: regressed prior-season offense/defense efficiency can stabilize early-season estimates without damaging the rest of the year.');
  console.log('Protocol: 2024 discovery -> lock K_offense/K_defense/retention/weight -> untouched 2025 -> frozen 2026 observation -> ablation/robustness -> survive/kill.');
  console.log('No market, astrology, Lettrology, current roster leakage, or target-game stats are used.');

  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());
  const stats = await loadStats([2023, 2024, 2025, 2026]);
  const base2024 = await loadBaseGames(games, 2024);
  const base2025 = await loadBaseGames(games, 2025);
  const base2026 = await loadBaseGames(games, 2026);
  console.log(`Coverage: 2024=${base2024.length}, 2025=${base2025.length}, 2026=${base2026.length}`);

  const control2024 = controlMetrics(buildFeatureRows(base2024, stats, 4, 6, 0.75));
  printMetrics('2024 CONTROL', control2024);

  console.log(`\n2024 DISCOVERY — ${OFFENSE_K.length * DEFENSE_K.length * PRIOR_RETENTION.length * LOGIT_WEIGHTS.length} preregistered variants; select by Brier then log loss`);
  const candidates: Candidate[] = [];
  const discoveryCache = new Map<string, FeatureRow[]>();
  for (const offenseK of OFFENSE_K) {
    for (const defenseK of DEFENSE_K) {
      for (const retention of PRIOR_RETENTION) {
        const key = `${offenseK}:${defenseK}:${retention}`;
        const rows = buildFeatureRows(base2024, stats, offenseK, defenseK, retention);
        discoveryCache.set(key, rows);
        for (const weight of LOGIT_WEIGHTS) {
          const metrics = evaluate(rows, weight).metrics;
          candidates.push({ offenseK, defenseK, retention, weight, metrics });
          console.log(`Ko=${offenseK} Kd=${defenseK} retention=${retention.toFixed(2)} weight=${weight.toFixed(2)} | ${metrics.correct}/${metrics.n} ${fmtPct(metrics.accuracy)} | Brier ${metrics.brier.toFixed(4)} | LogLoss ${metrics.logLoss.toFixed(4)}`);
        }
      }
    }
  }

  const selected = candidates.reduce((best, candidate) => {
    if (candidate.metrics.brier < best.metrics.brier - 1e-9) return candidate;
    if (Math.abs(candidate.metrics.brier - best.metrics.brier) <= 1e-9 && candidate.metrics.logLoss < best.metrics.logLoss) return candidate;
    return best;
  });
  console.log(`\nLOCKED AFTER 2024: offenseK=${selected.offenseK}, defenseK=${selected.defenseK}, priorRetention=${selected.retention.toFixed(2)}, weight=${selected.weight.toFixed(2)}.`);
  console.log('No 2025 result may reselect these parameters.');

  const feature2025 = buildFeatureRows(base2025, stats, selected.offenseK, selected.defenseK, selected.retention);
  const confirmation = evaluate(feature2025, selected.weight);
  const control2025 = controlMetrics(feature2025);
  console.log('\nUNTOUCHED 2025 CONFIRMATION');
  printMetrics('CONTROL v2.2', control2025);
  printMetrics('EXP-011', confirmation.metrics);
  console.log(`Δaccuracy ${((confirmation.metrics.accuracy - control2025.accuracy) * 100).toFixed(2)} points | ΔBrier ${(confirmation.metrics.brier - control2025.brier).toFixed(4)} | ΔLogLoss ${(confirmation.metrics.logLoss - control2025.logLoss).toFixed(4)}`);

  const challengerOnly = confirmation.rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = confirmation.rows.filter(row => row.controlHit && !row.challengerHit).length;
  const pValue = exactMcNemarP(challengerOnly, controlOnly);
  console.log(`Paired flips: challenger-only=${challengerOnly}, control-only=${controlOnly}, exact p=${pValue.toFixed(4)}`);

  console.log('\n2025 SPLITS');
  printSplit('Week 1', confirmation.rows.filter(row => row.week === 1));
  printSplit('Week 2', confirmation.rows.filter(row => row.week === 2));
  printSplit('Week 3', confirmation.rows.filter(row => row.week === 3));
  printSplit('Week 4', confirmation.rows.filter(row => row.week === 4));
  printSplit('Weeks 1-4', confirmation.rows.filter(row => row.week <= 4));
  printSplit('Weeks 5-9', confirmation.rows.filter(row => row.week >= 5 && row.week <= 9));
  printSplit('Weeks 10-18', confirmation.rows.filter(row => row.week >= 10));
  printSplit('One-score <=8', confirmation.rows.filter(row => Math.abs(row.actualMargin) <= 8));
  printSplit('Blowout >=14', confirmation.rows.filter(row => Math.abs(row.actualMargin) >= 14));
  printSplit('Neutral site', confirmation.rows.filter(row => row.neutralSite));

  console.log('\nCOMPONENT ABLATION — diagnostic only; cannot rewrite the locked experiment');
  const ablations: Array<{ label: string; sides: Side[]; components: Component[] }> = [
    { label: 'OFFENSE ONLY', sides: ['offense'], components: ['pass', 'rush'] },
    { label: 'DEFENSE ONLY', sides: ['defense'], components: ['pass', 'rush'] },
    { label: 'PASS ONLY', sides: ['offense', 'defense'], components: ['pass'] },
    { label: 'RUSH ONLY', sides: ['offense', 'defense'], components: ['rush'] }
  ];
  const ablationResults: Record<string, Metrics> = {};
  for (const ablation of ablations) {
    const rows = buildFeatureRows(base2025, stats, selected.offenseK, selected.defenseK, selected.retention, ablation.sides, ablation.components);
    const metrics = evaluate(rows, selected.weight).metrics;
    ablationResults[ablation.label] = metrics;
    printMetrics(ablation.label, metrics);
  }

  console.log('\nNEIGHBORING PARAMETERS — 2025 diagnostics only, never reselect');
  const robustness: Array<{ label: string; metrics: Metrics }> = [];
  const neighborConfigs = [
    { label: `Ko=${Math.max(1, selected.offenseK - 2)}`, offenseK: Math.max(1, selected.offenseK - 2), defenseK: selected.defenseK, retention: selected.retention, weight: selected.weight },
    { label: `Ko=${selected.offenseK + 2}`, offenseK: selected.offenseK + 2, defenseK: selected.defenseK, retention: selected.retention, weight: selected.weight },
    { label: `Kd=${Math.max(1, selected.defenseK - 3)}`, offenseK: selected.offenseK, defenseK: Math.max(1, selected.defenseK - 3), retention: selected.retention, weight: selected.weight },
    { label: `Kd=${selected.defenseK + 3}`, offenseK: selected.offenseK, defenseK: selected.defenseK + 3, retention: selected.retention, weight: selected.weight },
    { label: `retention=${Math.max(0, selected.retention - 0.25).toFixed(2)}`, offenseK: selected.offenseK, defenseK: selected.defenseK, retention: Math.max(0, selected.retention - 0.25), weight: selected.weight },
    { label: `retention=${Math.min(1, selected.retention + 0.25).toFixed(2)}`, offenseK: selected.offenseK, defenseK: selected.defenseK, retention: Math.min(1, selected.retention + 0.25), weight: selected.weight },
    { label: `weight=${Math.max(0, selected.weight - 0.05).toFixed(2)}`, offenseK: selected.offenseK, defenseK: selected.defenseK, retention: selected.retention, weight: Math.max(0, selected.weight - 0.05) },
    { label: `weight=${Math.min(0.30, selected.weight + 0.05).toFixed(2)}`, offenseK: selected.offenseK, defenseK: selected.defenseK, retention: selected.retention, weight: Math.min(0.30, selected.weight + 0.05) }
  ];
  const seen = new Set<string>();
  for (const config of neighborConfigs) {
    const key = `${config.offenseK}:${config.defenseK}:${config.retention}:${config.weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = buildFeatureRows(base2025, stats, config.offenseK, config.defenseK, config.retention);
    const metrics = evaluate(rows, config.weight).metrics;
    robustness.push({ label: config.label, metrics });
    printMetrics(config.label, metrics);
  }

  const feature2026 = buildFeatureRows(base2026, stats, selected.offenseK, selected.defenseK, selected.retention);
  const observation = evaluate(feature2026, selected.weight);
  const control2026 = controlMetrics(feature2026);
  console.log('\n2026 OBSERVATIONAL CHECK — frozen 2024 parameters');
  printMetrics('CONTROL v2.2', control2026);
  printMetrics('EXP-011', observation.metrics);

  const decision = verdict(control2025, confirmation.metrics, pValue);
  console.log(`\nVERDICT: ${decision}`);
  console.log('Production v2.2 remains unchanged. 2025 diagnostics and 2026 observations may not be used to retune this locked experiment.');

  const result = {
    experiment: 'EXP-011',
    title: 'Dynamic Prior-Season Shrinkage',
    generatedAt: new Date().toISOString(),
    hypothesis: 'Regressed prior-season offense/defense efficiency can stabilize early-season estimates without damaging later-season forecasting.',
    discoveryVariants: candidates.length,
    selected: {
      offenseK: selected.offenseK,
      defenseK: selected.defenseK,
      priorRetention: selected.retention,
      logitWeight: selected.weight,
      discoveryMetrics: selected.metrics
    },
    untouched2025: {
      control: control2025,
      challenger: confirmation.metrics,
      challengerOnlyCorrect: challengerOnly,
      controlOnlyCorrect: controlOnly,
      pairedPValue: pValue
    },
    observational2026: {
      control: control2026,
      challenger: observation.metrics
    },
    ablations: ablationResults,
    robustness,
    decision
  };

  const report = `# EXP-011 — Dynamic Prior-Season Shrinkage\n\nGenerated: ${result.generatedAt}\n\n## Locked 2024 specification\n\n- offense K: **${selected.offenseK}**\n- defense K: **${selected.defenseK}**\n- prior-season retention: **${selected.retention.toFixed(2)}**\n- logit weight: **${selected.weight.toFixed(2)}**\n- discovery variants: **${candidates.length}**\n\n## Untouched 2025\n\n| Model | Accuracy | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|\n| v2.2 control | ${fmtPct(control2025.accuracy)} | ${control2025.brier.toFixed(4)} | ${control2025.logLoss.toFixed(4)} | ${control2025.ece.toFixed(4)} |\n| EXP-011 | ${fmtPct(confirmation.metrics.accuracy)} | ${confirmation.metrics.brier.toFixed(4)} | ${confirmation.metrics.logLoss.toFixed(4)} | ${confirmation.metrics.ece.toFixed(4)} |\n\nPaired flips: ${challengerOnly} challenger-only vs ${controlOnly} control-only; exact p=${pValue.toFixed(4)}.\n\n## 2026 observational\n\n- control: ${control2026.correct}/${control2026.n} = ${fmtPct(control2026.accuracy)}, Brier ${control2026.brier.toFixed(4)}\n- EXP-011: ${observation.metrics.correct}/${observation.metrics.n} = ${fmtPct(observation.metrics.accuracy)}, Brier ${observation.metrics.brier.toFixed(4)}\n\n## Decision\n\n**${decision}**\n\nProduction v2.2 remains unchanged.\n`;

  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  await writeFile('research/runtime/exp-011.json', JSON.stringify(result, null, 2));
  await writeFile('research/reports/exp-011.md', report);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
