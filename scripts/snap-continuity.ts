import { mkdir, writeFile } from 'node:fs/promises';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const SNAP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;

const TRANSITION_WINDOWS = [1, 3] as const;
const WEIGHTS = [0, 0.05, 0.10, 0.15, 0.20] as const;
const UNIT_MODES = ['combined', 'offense', 'defense'] as const;
const SCHEMES = ['unweighted', 'core'] as const;

type UnitMode = typeof UNIT_MODES[number];
type Scheme = typeof SCHEMES[number];
type Game = ReturnType<typeof parseGamesCsv>[number];

interface SnapRow {
  gameId: string;
  season: number;
  week: number;
  player: string;
  playerId: string;
  position: string;
  team: string;
  offensePct: number;
  defensePct: number;
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

interface ContinuityProfile {
  offense: number;
  defense: number;
  combined: number;
  usable: boolean;
  transitions: number;
}

interface FeatureRow extends BaseGame {
  homeContinuity: number;
  awayContinuity: number;
  continuityEdge: number;
  rawHomeContinuity: number;
  rawAwayContinuity: number;
  usableContinuity: boolean;
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
  transitions: number;
  unit: UnitMode;
  scheme: Scheme;
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

function normalizeTeam(team: string): string {
  const value = String(team || '').trim().toUpperCase();
  if (value === 'LAR') return 'LA';
  if (value === 'OAK') return 'LV';
  if (value === 'SD') return 'LAC';
  if (value === 'STL') return 'LA';
  return value;
}

function normalizePct(value: string | undefined): number {
  const raw = String(value ?? '').replace('%', '').trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return clamp(n > 1 ? n / 100 : n, 0, 1);
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

function parseSnapCounts(text: string): SnapRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const required = ['game_id', 'season', 'week', 'player', 'position', 'team', 'offense_pct', 'defense_pct'];
  for (const field of required) {
    if (!index.has(field)) throw new Error(`Snap counts missing required column: ${field}`);
  }
  const get = (cells: string[], name: string) => {
    const i = index.get(name);
    return i == null ? '' : (cells[i] ?? '').trim();
  };

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return {
      gameId: get(cells, 'game_id'),
      season: safeNumber(get(cells, 'season')),
      week: safeNumber(get(cells, 'week')),
      player: get(cells, 'player'),
      playerId: get(cells, 'pfr_player_id') || get(cells, 'player'),
      position: get(cells, 'position').toUpperCase(),
      team: normalizeTeam(get(cells, 'team')),
      offensePct: normalizePct(get(cells, 'offense_pct')),
      defensePct: normalizePct(get(cells, 'defense_pct'))
    };
  }).filter(row => row.season > 0 && row.week > 0 && row.team && row.playerId);
}

function positionWeight(position: string, scheme: Scheme): number {
  if (scheme === 'unweighted') return 1;
  const p = position.toUpperCase();
  if (p === 'QB') return 1.6;
  if (['C', 'G', 'OG', 'T', 'OT', 'OL'].includes(p)) return 1.25;
  return 1;
}

function transitionContinuity(older: SnapRow[], newer: SnapRow[], unit: 'offense' | 'defense', scheme: Scheme): number {
  const pctKey = unit === 'offense' ? 'offensePct' : 'defensePct';
  const oldMap = new Map<string, { share: number; position: string }>();
  for (const row of older) {
    const share = row[pctKey];
    if (share <= 0) continue;
    oldMap.set(row.playerId, { share, position: row.position });
  }
  let denominator = 0;
  let overlap = 0;
  for (const row of newer) {
    const share = row[pctKey];
    if (share <= 0) continue;
    const w = positionWeight(row.position, scheme);
    denominator += share * w;
    const prior = oldMap.get(row.playerId);
    if (prior) overlap += Math.min(share, prior.share) * w;
  }
  return denominator > 0 ? clamp(overlap / denominator, 0, 1) : 0.5;
}

const profileCache = new Map<string, ContinuityProfile>();
function teamContinuity(
  snaps: SnapRow[],
  season: number,
  week: number,
  team: string,
  transitions: number,
  scheme: Scheme
): ContinuityProfile {
  const normalizedTeam = normalizeTeam(team);
  const key = `${season}:${week}:${normalizedTeam}:${transitions}:${scheme}`;
  const cached = profileCache.get(key);
  if (cached) return cached;

  const priorRows = snaps.filter(row => row.season === season && row.week < week && row.team === normalizedTeam);
  const gameIds = [...new Set(priorRows.map(row => row.gameId))]
    .map(gameId => ({ gameId, week: Math.max(...priorRows.filter(row => row.gameId === gameId).map(row => row.week)) }))
    .sort((a, b) => b.week - a.week)
    .slice(0, transitions + 1)
    .reverse();

  if (gameIds.length < 2) {
    const empty = { offense: 0.5, defense: 0.5, combined: 0.5, usable: false, transitions: 0 };
    profileCache.set(key, empty);
    return empty;
  }

  const offense: number[] = [];
  const defense: number[] = [];
  for (let i = 1; i < gameIds.length; i++) {
    const older = priorRows.filter(row => row.gameId === gameIds[i - 1].gameId);
    const newer = priorRows.filter(row => row.gameId === gameIds[i].gameId);
    offense.push(transitionContinuity(older, newer, 'offense', scheme));
    defense.push(transitionContinuity(older, newer, 'defense', scheme));
  }
  const profile = {
    offense: mean(offense),
    defense: mean(defense),
    combined: (mean(offense) + mean(defense)) / 2,
    usable: true,
    transitions: offense.length
  };
  profileCache.set(key, profile);
  return profile;
}

function modeValue(profile: ContinuityProfile, unit: UnitMode): number {
  return unit === 'offense' ? profile.offense : unit === 'defense' ? profile.defense : profile.combined;
}

function zContext(snaps: SnapRow[], season: number, week: number, transitions: number, scheme: Scheme, unit: UnitMode) {
  const teams = [...new Set(snaps.filter(row => row.season === season && row.week < week).map(row => row.team))];
  const values = teams.map(team => teamContinuity(snaps, season, week, team, transitions, scheme))
    .filter(profile => profile.usable)
    .map(profile => modeValue(profile, unit));
  const center = values.length ? mean(values) : 0.5;
  const spread = Math.max(0.02, sd(values, center));
  return { center, spread };
}

function buildFeatureRows(base: BaseGame[], snaps: SnapRow[], transitions: number, scheme: Scheme, unit: UnitMode): FeatureRow[] {
  return base.map(game => {
    const home = teamContinuity(snaps, game.season, game.week, game.homeTeam, transitions, scheme);
    const away = teamContinuity(snaps, game.season, game.week, game.awayTeam, transitions, scheme);
    const context = zContext(snaps, game.season, game.week, transitions, scheme, unit);
    const homeRaw = modeValue(home, unit);
    const awayRaw = modeValue(away, unit);
    const usable = home.usable && away.usable;
    const homeZ = usable ? clamp((homeRaw - context.center) / context.spread, -3, 3) : 0;
    const awayZ = usable ? clamp((awayRaw - context.center) / context.spread, -3, 3) : 0;
    return {
      ...game,
      homeContinuity: homeZ,
      awayContinuity: awayZ,
      continuityEdge: usable ? clamp(homeZ - awayZ, -4, 4) : 0,
      rawHomeContinuity: homeRaw,
      rawAwayContinuity: awayRaw,
      usableContinuity: usable
    };
  });
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

function evaluate(rows: FeatureRow[], weight: number): { metrics: Metrics; rows: EvalRow[] } {
  const out = rows.map(row => {
    const challengerPHome = logistic(logit(row.controlPHome) + weight * row.continuityEdge);
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
  return {
    metrics: {
      n: out.length,
      correct,
      accuracy: out.length ? correct / out.length : 0,
      brier: out.length ? brier / out.length : 0,
      logLoss: out.length ? logLoss / out.length : 0,
      ece: expectedCalibrationError(out.map(row => ({ p: row.challengerPHome, actual: row.actualHomeWin })))
    },
    rows: out
  };
}

function controlMetrics(rows: FeatureRow[]): Metrics {
  return evaluate(rows.map(row => ({ ...row, continuityEdge: 0 })), 0).metrics;
}

function metricsFor(rows: EvalRow[], control: boolean): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, ece: 0 };
  let correct = 0, brier = 0, logLoss = 0;
  const calibration: Array<{ p: number; actual: boolean }> = [];
  for (const row of rows) {
    const p = clamp(control ? row.controlPHome : row.challengerPHome, 0.001, 0.999);
    const y = row.actualHomeWin ? 1 : 0;
    correct += (p >= 0.5) === row.actualHomeWin ? 1 : 0;
    brier += Math.pow(p - y, 2);
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    calibration.push({ p, actual: row.actualHomeWin });
  }
  return { n: rows.length, correct, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length, ece: expectedCalibrationError(calibration) };
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

const fmtPct = (value: number) => `${(100 * value).toFixed(2)}%`;
function printMetrics(label: string, m: Metrics) {
  console.log(`${label}: ${m.correct}/${m.n} = ${fmtPct(m.accuracy)} | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logLoss.toFixed(4)} | ECE ${m.ece.toFixed(4)}`);
}
function printSplit(label: string, rows: EvalRow[]) {
  if (!rows.length) return;
  const c = metricsFor(rows, true);
  const x = metricsFor(rows, false);
  console.log(`${label.padEnd(22)} n=${rows.length} | control ${fmtPct(c.accuracy)} | EXP-013A ${fmtPct(x.accuracy)} | Δacc ${((x.accuracy - c.accuracy) * 100).toFixed(2)} | ΔBrier ${(x.brier - c.brier).toFixed(4)}`);
}

async function loadBaseGames(games: Game[], season: number): Promise<BaseGame[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const eligible = games.filter(game =>
    game.season === season && game.gameType === 'REG' && game.gameday < todayIso &&
    Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore) && game.homeScore !== game.awayScore
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
      homeTeam: normalizeTeam(game.homeTeam),
      awayTeam: normalizeTeam(game.awayTeam),
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

async function loadSnaps(seasons: number[]): Promise<SnapRow[]> {
  const all: SnapRow[] = [];
  for (const season of seasons) {
    const response = await fetch(SNAP_URL(season));
    if (!response.ok) throw new Error(`Could not load nflverse snap counts ${season}: ${response.status}`);
    const rows = parseSnapCounts(await response.text());
    console.log(`snap counts ${season}: ${rows.length} player-game rows`);
    all.push(...rows);
  }
  return all;
}

function verdict(control: Metrics, challenger: Metrics, pValue: number): string {
  const improved = [challenger.accuracy > control.accuracy, challenger.brier < control.brier, challenger.logLoss < control.logLoss].filter(Boolean).length;
  if (improved === 3 && pValue <= 0.10) return 'SURVIVES FOR REPLICATION';
  if (improved >= 2) return 'KEEP FOR RESEARCH';
  if (challenger.accuracy < control.accuracy && challenger.brier > control.brier && challenger.logLoss > control.logLoss) return 'REJECT FOR PROMOTION';
  return 'INCONCLUSIVE';
}

async function main() {
  console.log('\nEXP-013A — Snap-Weighted Personnel Continuity');
  console.log('=============================================');
  console.log('Hypothesis: trailing lineup continuity, measured only from completed prior-game snap distributions, adds leakage-safe signal beyond v2.2.');
  console.log('This does NOT claim target-game injury knowledge. Target-game snap counts are never used. Same-week snap rows are excluded.');
  console.log('Protocol: 2024 discovery -> lock transitions/unit/weighting/weight -> untouched 2025 -> frozen 2026 observation -> diagnostics -> survive/kill.');

  const gamesResponse = await fetch(GAMES_URL);
  if (!gamesResponse.ok) throw new Error(`Could not load games: ${gamesResponse.status}`);
  const games = parseGamesCsv(await gamesResponse.text());
  const snaps = await loadSnaps([2024, 2025, 2026]);
  const base2024 = await loadBaseGames(games, 2024);
  const base2025 = await loadBaseGames(games, 2025);
  const base2026 = await loadBaseGames(games, 2026);
  console.log(`Coverage: 2024=${base2024.length}, 2025=${base2025.length}, 2026=${base2026.length}`);

  const candidates: Candidate[] = [];
  const featureCache = new Map<string, FeatureRow[]>();
  console.log('\n2024 DISCOVERY — 60 preregistered variants; select by Brier then log loss');
  for (const transitions of TRANSITION_WINDOWS) {
    for (const scheme of SCHEMES) {
      for (const unit of UNIT_MODES) {
        const key = `${transitions}:${scheme}:${unit}`;
        const rows = buildFeatureRows(base2024, snaps, transitions, scheme, unit);
        featureCache.set(key, rows);
        for (const weight of WEIGHTS) {
          const metrics = evaluate(rows, weight).metrics;
          candidates.push({ transitions, unit, scheme, weight, metrics });
          console.log(`T=${transitions} ${scheme.padEnd(10)} ${unit.padEnd(8)} weight=${weight.toFixed(2)} | ${metrics.correct}/${metrics.n} ${fmtPct(metrics.accuracy)} | Brier ${metrics.brier.toFixed(4)} | LogLoss ${metrics.logLoss.toFixed(4)}`);
        }
      }
    }
  }

  const selected = candidates.reduce((best, candidate) => {
    if (candidate.metrics.brier < best.metrics.brier - 1e-9) return candidate;
    if (Math.abs(candidate.metrics.brier - best.metrics.brier) <= 1e-9 && candidate.metrics.logLoss < best.metrics.logLoss) return candidate;
    return best;
  });
  console.log(`\nLOCKED AFTER 2024: transitions=${selected.transitions}, scheme=${selected.scheme}, unit=${selected.unit}, weight=${selected.weight.toFixed(2)}.`);
  console.log('No 2025 result may reselect these parameters.');

  const feature2025 = buildFeatureRows(base2025, snaps, selected.transitions, selected.scheme, selected.unit);
  const control2025 = controlMetrics(feature2025);
  const confirmation = evaluate(feature2025, selected.weight);
  console.log('\nUNTOUCHED 2025 CONFIRMATION');
  printMetrics('CONTROL v2.2', control2025);
  printMetrics('EXP-013A', confirmation.metrics);
  console.log(`Δaccuracy ${((confirmation.metrics.accuracy - control2025.accuracy) * 100).toFixed(2)} points | ΔBrier ${(confirmation.metrics.brier - control2025.brier).toFixed(4)} | ΔLogLoss ${(confirmation.metrics.logLoss - control2025.logLoss).toFixed(4)}`);
  const challengerOnly = confirmation.rows.filter(row => row.challengerHit && !row.controlHit).length;
  const controlOnly = confirmation.rows.filter(row => row.controlHit && !row.challengerHit).length;
  const pValue = exactMcNemarP(challengerOnly, controlOnly);
  console.log(`Paired flips: challenger-only=${challengerOnly}, control-only=${controlOnly}, exact p=${pValue.toFixed(4)}`);
  console.log(`Usable continuity games: ${confirmation.rows.filter(row => row.usableContinuity).length}/${confirmation.rows.length}`);

  console.log('\n2025 SPLITS');
  printSplit('Weeks 1-4', confirmation.rows.filter(row => row.week <= 4));
  printSplit('Weeks 5-9', confirmation.rows.filter(row => row.week >= 5 && row.week <= 9));
  printSplit('Weeks 10-18', confirmation.rows.filter(row => row.week >= 10));
  printSplit('Usable continuity', confirmation.rows.filter(row => row.usableContinuity));
  printSplit('One-score <=8', confirmation.rows.filter(row => Math.abs(row.actualMargin) <= 8));
  printSplit('Blowout >=14', confirmation.rows.filter(row => Math.abs(row.actualMargin) >= 14));
  printSplit('Neutral site', confirmation.rows.filter(row => row.neutralSite));

  console.log('\nPOST-CONFIRMATION DIAGNOSTICS — never reselect on 2025');
  const robustness: Array<Record<string, unknown>> = [];
  for (const weight of WEIGHTS.filter(weight => Math.abs(weight - selected.weight) <= 0.05 + 1e-9)) {
    const m = evaluate(feature2025, weight).metrics;
    robustness.push({ kind: 'weight', value: weight, metrics: m });
    printMetrics(`weight=${weight.toFixed(2)}`, m);
  }
  for (const unit of UNIT_MODES.filter(unit => unit !== selected.unit)) {
    const rows = buildFeatureRows(base2025, snaps, selected.transitions, selected.scheme, unit);
    const m = evaluate(rows, selected.weight).metrics;
    robustness.push({ kind: 'unit', value: unit, metrics: m });
    printMetrics(`unit=${unit}`, m);
  }
  for (const scheme of SCHEMES.filter(scheme => scheme !== selected.scheme)) {
    const rows = buildFeatureRows(base2025, snaps, selected.transitions, scheme, selected.unit);
    const m = evaluate(rows, selected.weight).metrics;
    robustness.push({ kind: 'scheme', value: scheme, metrics: m });
    printMetrics(`scheme=${scheme}`, m);
  }

  const feature2026 = buildFeatureRows(base2026, snaps, selected.transitions, selected.scheme, selected.unit);
  const control2026 = controlMetrics(feature2026);
  const observation2026 = evaluate(feature2026, selected.weight);
  console.log('\n2026 OBSERVATIONAL CHECK — frozen 2024 parameters');
  printMetrics('CONTROL v2.2', control2026);
  printMetrics('EXP-013A', observation2026.metrics);
  console.log(`Usable continuity games: ${observation2026.rows.filter(row => row.usableContinuity).length}/${observation2026.rows.length}`);
  console.log('\n2026 WEEKLY OBSERVATION');
  for (const week of [...new Set(observation2026.rows.map(row => row.week))].sort((a, b) => a - b)) {
    const rows = observation2026.rows.filter(row => row.week === week);
    const c = metricsFor(rows, true);
    const x = metricsFor(rows, false);
    console.log(`Week ${week}: n=${rows.length} | control ${fmtPct(c.accuracy)} | EXP-013A ${fmtPct(x.accuracy)} | control Brier ${c.brier.toFixed(4)} | EXP-013A Brier ${x.brier.toFixed(4)} | usable ${rows.filter(row => row.usableContinuity).length}`);
  }

  const finalVerdict = verdict(control2025, confirmation.metrics, pValue);
  console.log(`\nVERDICT: ${finalVerdict}`);
  console.log('Production v2.2 remains unchanged. This experiment measures trailing continuity only; target-game injury/availability remains a separate data-gated EXP-013B.');

  const result = {
    generatedAt: new Date().toISOString(),
    experiment: 'EXP-013A',
    hypothesis: 'Trailing prior-game snap-weighted personnel continuity adds predictive value beyond v2.2.',
    governance: {
      discoverySeason: 2024,
      untouchedSeason: 2025,
      liveForwardSeason: 2026,
      variantsTried: candidates.length,
      targetGameSnapCountsUsed: false,
      sameWeekSnapCountsUsed: false,
      injuryAvailabilityClaimed: false,
      source: 'nflverse snap_counts release'
    },
    selected: { transitions: selected.transitions, scheme: selected.scheme, unit: selected.unit, weight: selected.weight },
    control2025,
    challenger2025: confirmation.metrics,
    paired: { challengerOnly, controlOnly, pValue },
    robustness,
    control2026,
    challenger2026: observation2026.metrics,
    coverage: { games2024: base2024.length, games2025: base2025.length, games2026: base2026.length },
    verdict: finalVerdict
  };

  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  await writeFile('research/runtime/exp-013a.json', JSON.stringify(result, null, 2));
  const markdown = `# EXP-013A — Snap-Weighted Personnel Continuity\n\nGenerated: ${result.generatedAt}\n\n## Method\n\nUses only completed prior-game snap distributions. Target-game and same-week snap counts are excluded. This is a trailing continuity signal, not an injury report.\n\n## Locked 2024 parameters\n\n- Prior transitions: ${selected.transitions}\n- Position scheme: ${selected.scheme}\n- Unit: ${selected.unit}\n- Logit weight: ${selected.weight.toFixed(2)}\n- Variants tried: ${candidates.length}\n\n## Untouched 2025\n\n| Model | Accuracy | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|\n| v2.2 | ${fmtPct(control2025.accuracy)} | ${control2025.brier.toFixed(4)} | ${control2025.logLoss.toFixed(4)} | ${control2025.ece.toFixed(4)} |\n| EXP-013A | ${fmtPct(confirmation.metrics.accuracy)} | ${confirmation.metrics.brier.toFixed(4)} | ${confirmation.metrics.logLoss.toFixed(4)} | ${confirmation.metrics.ece.toFixed(4)} |\n\nPaired flips: EXP-013A-only ${challengerOnly}, control-only ${controlOnly}, exact p=${pValue.toFixed(4)}.\n\n## 2026 observational\n\n- Control: ${fmtPct(control2026.accuracy)}, Brier ${control2026.brier.toFixed(4)}\n- EXP-013A: ${fmtPct(observation2026.metrics.accuracy)}, Brier ${observation2026.metrics.brier.toFixed(4)}\n\n## Verdict\n\n**${finalVerdict}**\n\nProduction remains unchanged. EXP-013B remains separately gated on legitimate point-in-time injury/availability data.\n`;
  await writeFile('research/reports/exp-013a.md', markdown);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
