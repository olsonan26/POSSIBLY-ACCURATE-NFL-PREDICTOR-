import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv`;

const WINDOWS = [4, 8, 99] as const;
const MODES = ['sacks', 'hits', 'combined'] as const;
const WEIGHTS = [0, 0.05, 0.10, 0.15, 0.20] as const;
const SHRINKAGE_DROPBACKS = 50;

type WindowSize = typeof WINDOWS[number];
type Mode = typeof MODES[number];
type Game = ReturnType<typeof parseGamesCsv>[number];

interface Dropback {
  week: number;
  offense: string;
  defense: string;
  sack: number;
  hit: number;
}

interface Totals {
  dropbacks: number;
  sacks: number;
  hits: number;
}

interface Rates {
  sackRate: number;
  hitRate: number;
}

interface WeekProfiles {
  offense: Map<string, Rates>;
  defense: Map<string, Rates>;
  offenseDist: { sackRate: Dist; hitRate: Dist };
  defenseDist: { sackRate: Dist; hitRate: Dist };
  league: Rates;
}

interface Dist {
  mean: number;
  sd: number;
}

interface BaseRow {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
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
  edge: number;
  homeRisk: number;
  awayRisk: number;
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
  metrics: Metrics;
  rows: EvalRow[];
}

interface Candidate {
  window: WindowSize;
  mode: Mode;
  weight: number;
  metrics: Metrics;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const bounded = clamp(p, 0.001, 0.999);
  return Math.log(bounded / (1 - bounded));
};
const fmtPct = (value: number) => `${(value * 100).toFixed(2)}%`;

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

function parsePbp(text: string): Dropback[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const required = ['week', 'season_type', 'posteam', 'defteam', 'qb_dropback', 'sack', 'qb_hit'];
  for (const field of required) {
    if (!index.has(field)) throw new Error(`PBP missing required column: ${field}`);
  }
  const get = (cells: string[], name: string) => {
    const i = index.get(name);
    return i == null ? '' : (cells[i] ?? '').trim();
  };

  const rows: Dropback[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (get(cells, 'season_type') !== 'REG') continue;
    if (get(cells, 'no_play') === '1') continue;
    if (get(cells, 'qb_kneel') === '1' || get(cells, 'qb_spike') === '1') continue;
    if (get(cells, 'qb_dropback') !== '1') continue;
    const week = numberOrNull(get(cells, 'week'));
    const offense = normalizeTeamAbbr(get(cells, 'posteam'));
    const defense = normalizeTeamAbbr(get(cells, 'defteam'));
    if (week == null || !offense || !defense) continue;
    const sack = get(cells, 'sack') === '1' ? 1 : 0;
    const hit = get(cells, 'qb_hit') === '1' || sack === 1 ? 1 : 0;
    rows.push({ week, offense, defense, sack, hit });
  }
  return rows;
}

function emptyTotals(): Totals {
  return { dropbacks: 0, sacks: 0, hits: 0 };
}

function add(totals: Totals, row: Dropback) {
  totals.dropbacks++;
  totals.sacks += row.sack;
  totals.hits += row.hit;
}

function meanSd(values: number[]): Dist {
  if (!values.length) return { mean: 0, sd: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) || 1 };
}

function z(value: number, dist: Dist): number {
  return (value - dist.mean) / dist.sd;
}

function rawRates(totals: Totals): Rates {
  if (!totals.dropbacks) return { sackRate: 0, hitRate: 0 };
  return {
    sackRate: totals.sacks / totals.dropbacks,
    hitRate: totals.hits / totals.dropbacks
  };
}

function shrunkRates(totals: Totals, league: Rates): Rates {
  const denom = totals.dropbacks + SHRINKAGE_DROPBACKS;
  if (!denom) return league;
  return {
    sackRate: (totals.sacks + SHRINKAGE_DROPBACKS * league.sackRate) / denom,
    hitRate: (totals.hits + SHRINKAGE_DROPBACKS * league.hitRate) / denom
  };
}

function buildWeekProfiles(dropbacks: Dropback[], week: number, window: WindowSize): WeekProfiles | null {
  if (week <= 1) return null;
  const startWeek = window >= 99 ? 1 : Math.max(1, week - window);
  const sample = dropbacks.filter(row => row.week >= startWeek && row.week < week);
  if (sample.length < 300) return null;

  const leagueTotals = emptyTotals();
  const offenseTotals = new Map<string, Totals>();
  const defenseTotals = new Map<string, Totals>();
  for (const row of sample) {
    add(leagueTotals, row);
    if (!offenseTotals.has(row.offense)) offenseTotals.set(row.offense, emptyTotals());
    if (!defenseTotals.has(row.defense)) defenseTotals.set(row.defense, emptyTotals());
    add(offenseTotals.get(row.offense)!, row);
    add(defenseTotals.get(row.defense)!, row);
  }

  const league = rawRates(leagueTotals);
  const teams = [...new Set([...offenseTotals.keys(), ...defenseTotals.keys()])].sort();
  if (teams.length < 20) return null;
  const offense = new Map<string, Rates>();
  const defense = new Map<string, Rates>();
  for (const team of teams) {
    offense.set(team, shrunkRates(offenseTotals.get(team) ?? emptyTotals(), league));
    defense.set(team, shrunkRates(defenseTotals.get(team) ?? emptyTotals(), league));
  }

  return {
    offense,
    defense,
    offenseDist: {
      sackRate: meanSd(teams.map(team => offense.get(team)!.sackRate)),
      hitRate: meanSd(teams.map(team => offense.get(team)!.hitRate))
    },
    defenseDist: {
      sackRate: meanSd(teams.map(team => defense.get(team)!.sackRate)),
      hitRate: meanSd(teams.map(team => defense.get(team)!.hitRate))
    },
    league
  };
}

function matchupRisk(profiles: WeekProfiles | null, offenseTeam: string, defenseTeam: string, mode: Mode): number {
  if (!profiles) return 0;
  const offense = profiles.offense.get(offenseTeam) ?? profiles.league;
  const defense = profiles.defense.get(defenseTeam) ?? profiles.league;
  const sackRisk = z(offense.sackRate, profiles.offenseDist.sackRate) + z(defense.sackRate, profiles.defenseDist.sackRate);
  const hitRisk = z(offense.hitRate, profiles.offenseDist.hitRate) + z(defense.hitRate, profiles.defenseDist.hitRate);
  if (mode === 'sacks') return clamp(sackRisk, -4, 4);
  if (mode === 'hits') return clamp(hitRisk, -4, 4);
  return clamp((sackRisk + hitRisk) / 2, -4, 4);
}

function expectedCalibrationError(rows: Array<{ p: number; actual: boolean }>, bins = 10): number {
  if (!rows.length) return 0;
  let ece = 0;
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const bucket = rows.filter(row => row.p >= lo && (i === bins - 1 ? row.p <= hi : row.p < hi));
    if (!bucket.length) continue;
    const avgP = bucket.reduce((sum, row) => sum + row.p, 0) / bucket.length;
    const actual = bucket.reduce((sum, row) => sum + (row.actual ? 1 : 0), 0) / bucket.length;
    ece += bucket.length / rows.length * Math.abs(avgP - actual);
  }
  return ece;
}

function metrics(rows: EvalRow[]): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, ece: 0 };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const p = clamp(row.challengerPHome, 0.001, 0.999);
    const y = row.actualHome ? 1 : 0;
    correct += (p >= 0.5) === row.actualHome ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return {
    n: rows.length,
    correct,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    ece: expectedCalibrationError(rows.map(row => ({ p: row.challengerPHome, actual: row.actualHome })))
  };
}

function controlMetrics(base: BaseRow[]): Metrics {
  return metrics(base.map(row => ({
    ...row,
    challengerPHome: row.controlPHome,
    challengerHit: row.controlHit,
    edge: 0,
    homeRisk: 0,
    awayRisk: 0
  })));
}

function evaluate(base: BaseRow[], dropbacks: Dropback[], window: WindowSize, mode: Mode, weight: number): Evaluation {
  const weekCache = new Map<number, WeekProfiles | null>();
  const rows = base.map(row => {
    if (!weekCache.has(row.week)) weekCache.set(row.week, buildWeekProfiles(dropbacks, row.week, window));
    const profiles = weekCache.get(row.week)!;
    const homeRisk = matchupRisk(profiles, row.home, row.away, mode);
    const awayRisk = matchupRisk(profiles, row.away, row.home, mode);
    // Lower pressure risk is favorable. Positive edge means the home offense has the cleaner protection matchup.
    const edge = clamp(awayRisk - homeRisk, -4, 4);
    const challengerPHome = logistic(logit(row.controlPHome) + edge * weight);
    return {
      ...row,
      challengerPHome,
      challengerHit: (challengerPHome >= 0.5) === row.actualHome,
      edge,
      homeRisk,
      awayRisk
    };
  });
  return { metrics: metrics(rows), rows };
}

async function loadPbp(season: number): Promise<Dropback[]> {
  const response = await fetch(PBP_URL(season));
  if (!response.ok) throw new Error(`Could not load nflverse PBP ${season}: ${response.status}`);
  const rows = parsePbp(await response.text());
  const minimum = season === 2026 ? 2000 : 10000;
  if (rows.length < minimum) throw new Error(`Too few eligible dropbacks for ${season}: ${rows.length}`);
  console.log(`PBP ${season}: ${rows.length} eligible QB dropbacks`);
  return rows;
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
      gameId: String(game.gameId || `${season}:${game.week}:${game.awayTeam}@${game.homeTeam}`),
      season,
      week: game.week,
      gameday: game.gameday,
      home: game.homeTeam,
      away: game.awayTeam,
      neutral: game.location === 'Neutral',
      actualHome,
      margin: Math.abs(game.homeScore! - game.awayScore!),
      controlPHome: clamp(controlPHome, 0.001, 0.999),
      controlHit: (controlPHome >= 0.5) === actualHome
    });
    if ((i + 1) % 100 === 0) console.log(`control snapshot ${season}: ${i + 1}/${sample.length}`);
  }
  return rows;
}

function printMetrics(label: string, metric: Metrics) {
  console.log(`${label}: ${metric.correct}/${metric.n} = ${fmtPct(metric.accuracy)} | Brier ${metric.brier.toFixed(4)} | LogLoss ${metric.logLoss.toFixed(4)} | ECE ${metric.ece.toFixed(4)}`);
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

function printSplit(label: string, rows: EvalRow[]) {
  if (!rows.length) return;
  const controlRows = rows.map(row => ({ ...row, challengerPHome: row.controlPHome, challengerHit: row.controlHit }));
  const control = metrics(controlRows);
  const challenger = metrics(rows);
  console.log(`${label.padEnd(22)} n=${rows.length} | control ${fmtPct(control.accuracy)} | EXP-015 ${fmtPct(challenger.accuracy)} | Δacc ${((challenger.accuracy - control.accuracy) * 100).toFixed(2)} | ΔBrier ${(challenger.brier - control.brier).toFixed(4)}`);
}

function verdict(control: Metrics, challenger: Metrics, pValue: number): string {
  const improved = [challenger.accuracy > control.accuracy, challenger.brier < control.brier, challenger.logLoss < control.logLoss].filter(Boolean).length;
  if (improved === 3 && pValue <= 0.10) return 'SURVIVES FOR REPLICATION';
  if (improved >= 2) return 'KEEP FOR RESEARCH';
  if (challenger.accuracy < control.accuracy && challenger.brier > control.brier && challenger.logLoss > control.logLoss) return 'REJECT FOR PROMOTION';
  return 'INCONCLUSIVE';
}

async function main() {
  console.log('\nEXP-015 — Offensive Line vs Pass Rush Matchup');
  console.log('===============================================');
  console.log('Hypothesis: prior-week pass-protection pressure allowed matched against opponent pressure generated adds leakage-safe predictive value beyond v2.2.');
  console.log('Signals: sack rate and QB-hit-or-sack rate per dropback, shrunk 50 dropbacks toward the contemporaneous league mean.');
  console.log('No target-game snaps, injury reports, future plays, market data, astrology, or Lettrology are used.');
  console.log('Protocol: 45 preregistered 2024 variants -> lock by Brier/log loss -> untouched 2025 -> frozen 2026 observation -> diagnostics.');

  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());
  const [pbp2024, pbp2025, pbp2026] = await Promise.all([loadPbp(2024), loadPbp(2025), loadPbp(2026)]);
  const base2024 = await buildBaseRows(2024, games);
  const base2025 = await buildBaseRows(2025, games);
  const base2026 = await buildBaseRows(2026, games);
  console.log(`Coverage: 2024=${base2024.length}, 2025=${base2025.length}, 2026=${base2026.length}`);

  console.log('\n2024 DISCOVERY — 45 preregistered variants; select by Brier then log loss');
  const candidates: Candidate[] = [];
  for (const window of WINDOWS) {
    for (const mode of MODES) {
      for (const weight of WEIGHTS) {
        const result = evaluate(base2024, pbp2024, window, mode, weight);
        candidates.push({ window, mode, weight, metrics: result.metrics });
        console.log(`window=${String(window).padStart(2)} mode=${mode.padEnd(8)} weight=${weight.toFixed(2)} | ${result.metrics.correct}/${result.metrics.n} ${fmtPct(result.metrics.accuracy)} | Brier ${result.metrics.brier.toFixed(4)} | LogLoss ${result.metrics.logLoss.toFixed(4)}`);
      }
    }
  }

  const selected = candidates.reduce((best, candidate) => {
    if (candidate.metrics.brier < best.metrics.brier - 1e-9) return candidate;
    if (Math.abs(candidate.metrics.brier - best.metrics.brier) <= 1e-9 && candidate.metrics.logLoss < best.metrics.logLoss) return candidate;
    return best;
  });
  console.log(`\nLOCKED AFTER 2024: window=${selected.window}, mode=${selected.mode}, weight=${selected.weight.toFixed(2)}.`);
  console.log('No 2025 result may reselect these parameters.');

  const confirmation = evaluate(base2025, pbp2025, selected.window, selected.mode, selected.weight);
  const control2025 = controlMetrics(base2025);
  console.log('\nUNTOUCHED 2025 CONFIRMATION');
  printMetrics('CONTROL v2.2', control2025);
  printMetrics('EXP-015 OL/PR', confirmation.metrics);
  console.log(`Δaccuracy ${((confirmation.metrics.accuracy - control2025.accuracy) * 100).toFixed(2)} points | ΔBrier ${(confirmation.metrics.brier - control2025.brier).toFixed(4)} | ΔLogLoss ${(confirmation.metrics.logLoss - control2025.logLoss).toFixed(4)}`);

  const challengerOnly = confirmation.rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = confirmation.rows.filter(row => row.controlHit && !row.challengerHit).length;
  const pValue = exactMcNemarP(challengerOnly, controlOnly);
  console.log(`Paired flips: challenger-only=${challengerOnly}, control-only=${controlOnly}, exact p=${pValue.toFixed(4)}`);

  console.log('\n2025 SPLITS');
  printSplit('Weeks 1-4', confirmation.rows.filter(row => row.week <= 4));
  printSplit('Weeks 5-9', confirmation.rows.filter(row => row.week >= 5 && row.week <= 9));
  printSplit('Weeks 10-18', confirmation.rows.filter(row => row.week >= 10));
  printSplit('Control home picks', confirmation.rows.filter(row => row.controlPHome >= 0.5));
  printSplit('Control away picks', confirmation.rows.filter(row => row.controlPHome < 0.5));
  printSplit('One-score <=8', confirmation.rows.filter(row => row.margin <= 8));
  printSplit('Blowout >=14', confirmation.rows.filter(row => row.margin >= 14));
  printSplit('Neutral site', confirmation.rows.filter(row => row.neutral));

  console.log('\nPOST-CONFIRMATION COMPONENT DIAGNOSTICS — never reselect on 2025');
  const alternateModes = MODES.filter(mode => mode !== selected.mode);
  const ablations = alternateModes.map(mode => {
    const result = evaluate(base2025, pbp2025, selected.window, mode, selected.weight);
    printMetrics(`mode=${mode}`, result.metrics);
    return { mode, metrics: result.metrics };
  });

  console.log('\nNEIGHBORING PARAMETERS — 2025 diagnostics only');
  const neighboringWeights = [...new Set([Math.max(0, selected.weight - 0.05), selected.weight, Math.min(0.25, selected.weight + 0.05)])];
  const robustness: Array<{ label: string; metrics: Metrics }> = [];
  for (const weight of neighboringWeights) {
    const result = evaluate(base2025, pbp2025, selected.window, selected.mode, weight);
    printMetrics(`weight=${weight.toFixed(2)}`, result.metrics);
    robustness.push({ label: `weight=${weight.toFixed(2)}`, metrics: result.metrics });
  }
  for (const window of WINDOWS.filter(window => window !== selected.window)) {
    const result = evaluate(base2025, pbp2025, window, selected.mode, selected.weight);
    printMetrics(`window=${window}`, result.metrics);
    robustness.push({ label: `window=${window}`, metrics: result.metrics });
  }

  const observation2026 = evaluate(base2026, pbp2026, selected.window, selected.mode, selected.weight);
  const control2026 = controlMetrics(base2026);
  console.log('\n2026 OBSERVATIONAL CHECK — frozen 2024 parameters');
  printMetrics('CONTROL v2.2', control2026);
  printMetrics('EXP-015 OL/PR', observation2026.metrics);
  console.log('\n2026 WEEKLY OBSERVATION');
  for (const week of [...new Set(observation2026.rows.map(row => row.week))].sort((a, b) => a - b)) {
    printSplit(`Week ${week}`, observation2026.rows.filter(row => row.week === week));
  }

  const finalVerdict = verdict(control2025, confirmation.metrics, pValue);
  console.log(`\nVERDICT: ${finalVerdict}`);
  console.log('Production v2.2 remains unchanged. 2025 diagnostics and 2026 observations cannot be used to retune this locked experiment.');

  const result = {
    experiment: 'EXP-015',
    generatedAt: new Date().toISOString(),
    hypothesis: 'Prior-week pass-protection pressure allowed matched against opponent pressure generated adds leakage-safe predictive information beyond v2.2.',
    protocol: {
      discoverySeason: 2024,
      untouchedSeason: 2025,
      liveForwardSeason: 2026,
      variantsTried: candidates.length,
      windows: WINDOWS,
      modes: MODES,
      weights: WEIGHTS,
      shrinkageDropbacks: SHRINKAGE_DROPBACKS,
      targetGameDataUsed: false,
      sameWeekDataUsed: false
    },
    selected: { window: selected.window, mode: selected.mode, weight: selected.weight },
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
  await writeFile('research/runtime/exp-015.json', JSON.stringify(result, null, 2));
  const markdown = `# EXP-015 — Offensive Line vs Pass Rush Matchup\n\nGenerated: ${result.generatedAt}\n\n## Hypothesis\n\nPrior-week pass-protection pressure allowed matched against opponent pressure generated may add leakage-safe predictive information beyond v2.2.\n\n## Protocol\n\n- Discovery: 2024\n- Untouched confirmation: 2025\n- Frozen observation: 2026\n- 45 preregistered variants\n- Windows: 4 weeks, 8 weeks, full same-season history\n- Modes: sacks, QB-hit-or-sack rate, combined\n- Fixed shrinkage: ${SHRINKAGE_DROPBACKS} dropbacks toward contemporaneous league mean\n- Target-game and same-week play data are excluded\n\n## Locked after 2024\n\n- Window: **${selected.window}**\n- Mode: **${selected.mode}**\n- Logit weight: **${selected.weight.toFixed(2)}**\n\n## Untouched 2025\n\n| Model | Accuracy | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|\n| v2.2 | ${fmtPct(control2025.accuracy)} | ${control2025.brier.toFixed(4)} | ${control2025.logLoss.toFixed(4)} | ${control2025.ece.toFixed(4)} |\n| EXP-015 | ${fmtPct(confirmation.metrics.accuracy)} | ${confirmation.metrics.brier.toFixed(4)} | ${confirmation.metrics.logLoss.toFixed(4)} | ${confirmation.metrics.ece.toFixed(4)} |\n\nPaired flips: EXP-015-only ${challengerOnly}, control-only ${controlOnly}, exact p=${pValue.toFixed(4)}.\n\n## 2026 observational\n\n- Control: ${fmtPct(control2026.accuracy)}, Brier ${control2026.brier.toFixed(4)}\n- EXP-015: ${fmtPct(observation2026.metrics.accuracy)}, Brier ${observation2026.metrics.brier.toFixed(4)}\n\n## Verdict\n\n**${finalVerdict}**\n\nProduction remains unchanged. Post-confirmation diagnostics and 2026 observations cannot be used to reselect the locked specification.\n`;
  await writeFile('research/reports/exp-015.md', markdown);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
