import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeTeamAbbr } from '../data/teamRegistry';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv`;
const PLAYER_STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

const RATING_START_SEASON = Number(process.env.ARCH_RATING_START ?? 2000);
const MODEL_START_SEASON = 2012;
const VALIDATION_START = 2019;
const HOLDOUT_START = 2023;
const LIVE_SEASON = 2026;
const CARRYOVER_LAST_TARGET_SEASON = 2022;
const PRIOR_GAMES_EQUIV = 6;
const TEAM_RIDGE_ALPHA = 400;
const QB_WINDOW = 16;
const MARGIN_ALPHAS = [30, 100, 300, 1000, 3000, 10000] as const;
const EXPLOSIVE_EPA = 1.0;

const METRICS = ['epa', 'passEpa', 'rushEpa', 'success', 'explosive', 'pressure'] as const;
type MetricName = typeof METRICS[number];
type Side = 'off' | 'def';
type Game = ReturnType<typeof parseGamesCsv>[number];

interface PlayLite {
  week: number;
  offense: string;
  defense: string;
  type: 'pass' | 'rush';
  epa: number;
  success: number;
  explosive: number;
  dropback: boolean;
  pressure: number;
}

interface MetricSnapshot {
  rawOff: number[];
  rawDef: number[];
  adjOff: number[];
  adjDef: number[];
  n: number;
}

type RatingFrame = Record<MetricName, MetricSnapshot>;

interface CarryoverStat {
  slope: number;
  r: number;
  n: number;
}

interface QbWeek {
  season: number;
  week: number;
  name: string;
  normalizedName: string;
  attempts: number;
  passingEpa: number;
  cpoe?: number;
  sacks: number;
}

interface QbProfile {
  epaPerDropback: number;
  cpoe: number;
  sackAvoidance: number;
  dropbacks: number;
  games: number;
  known: boolean;
}

interface FeatureRow {
  gameId: string;
  season: number;
  week: number;
  gameday: string;
  home: string;
  away: string;
  actualMargin: number;
  actualHomeWin: boolean;
  homeGamesPlayed: number;
  awayGamesPlayed: number;
  homeCurrentWeight: number;
  awayCurrentWeight: number;
  homeQb: string;
  awayQb: string;
  homeQbKnown: boolean;
  awayQbKnown: boolean;
  features: Record<string, number>;
}

interface Standardizer {
  mean: number[];
  sd: number[];
}

interface RidgeModel {
  alpha: number;
  features: string[];
  standardizer: Standardizer;
  coefficients: number[];
}

interface ScoredRow extends FeatureRow {
  predictedMargin: number;
  rawPHome: number;
  pHome: number;
}

interface Metrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  ece: number;
  mae: number;
  rmse: number;
}

interface ControlRow {
  gameId: string;
  pHome: number;
  actualHomeWin: boolean;
  actualMargin: number;
  season: number;
  week: number;
}

const teams = parseTeamData().map(team => team.abbr).sort();
const teamIndex = new Map(teams.map((team, i) => [team, i]));
const N_TEAMS = teams.length;
const RATING_P = 1 + 2 * N_TEAMS;

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const sd = (values: number[], center = mean(values)) => {
  if (values.length < 2) return 1;
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length;
  return Math.sqrt(variance) || 1;
};
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  return Math.log(q / (1 - q));
};
const fmtPct = (x: number) => `${(x * 100).toFixed(2)}%`;

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
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

function numberOrNull(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchText(url: string, label: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 750 * attempt));
    }
  }
  throw new Error(`Failed to load ${label}: ${String(lastError)}`);
}

function solveSpd(matrix: Float64Array, rhs: Float64Array, n: number): number[] {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let value = matrix[i * n + j];
      for (let k = 0; k < j; k++) value -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        l[i * n + j] = Math.sqrt(Math.max(value, 1e-9));
      } else {
        l[i * n + j] = value / Math.max(l[j * n + j], 1e-12);
      }
    }
  }

  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let value = rhs[i];
    for (let k = 0; k < i; k++) value -= l[i * n + k] * y[k];
    y[i] = value / Math.max(l[i * n + i], 1e-12);
  }

  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let value = y[i];
    for (let k = i + 1; k < n; k++) value -= l[k * n + i] * x[k];
    x[i] = value / Math.max(l[i * n + i], 1e-12);
  }
  return Array.from(x);
}

class MetricAccumulator {
  readonly xtx = new Float64Array(RATING_P * RATING_P);
  readonly xty = new Float64Array(RATING_P);
  readonly offSum = new Float64Array(N_TEAMS);
  readonly offCount = new Float64Array(N_TEAMS);
  readonly defSum = new Float64Array(N_TEAMS);
  readonly defCount = new Float64Array(N_TEAMS);
  totalSum = 0;
  n = 0;

  add(offense: string, defense: string, y: number) {
    const oi = teamIndex.get(offense);
    const di = teamIndex.get(defense);
    if (oi == null || di == null || !Number.isFinite(y)) return;
    const indices = [0, 1 + oi, 1 + N_TEAMS + di];
    for (const a of indices) {
      this.xty[a] += y;
      for (const b of indices) this.xtx[a * RATING_P + b] += 1;
    }
    this.offSum[oi] += y;
    this.offCount[oi] += 1;
    this.defSum[di] += y;
    this.defCount[di] += 1;
    this.totalSum += y;
    this.n++;
  }

  snapshot(alpha = TEAM_RIDGE_ALPHA): MetricSnapshot {
    if (this.n < 50) {
      const zero = Array(N_TEAMS).fill(0);
      return { rawOff: [...zero], rawDef: [...zero], adjOff: [...zero], adjDef: [...zero], n: this.n };
    }
    const grand = this.totalSum / this.n;
    const rawOff = teams.map((_, i) => this.offCount[i] ? this.offSum[i] / this.offCount[i] - grand : 0);
    const rawDef = teams.map((_, i) => this.defCount[i] ? this.defSum[i] / this.defCount[i] - grand : 0);
    const a = this.xtx.slice();
    a[0] += 1e-8;
    for (let i = 1; i < RATING_P; i++) a[i * RATING_P + i] += alpha;
    const beta = solveSpd(a, this.xty, RATING_P);
    return {
      rawOff,
      rawDef,
      adjOff: teams.map((_, i) => beta[1 + i] ?? 0),
      adjDef: teams.map((_, i) => beta[1 + N_TEAMS + i] ?? 0),
      n: this.n
    };
  }
}

function emptyAccumulators(): Record<MetricName, MetricAccumulator> {
  return {
    epa: new MetricAccumulator(),
    passEpa: new MetricAccumulator(),
    rushEpa: new MetricAccumulator(),
    success: new MetricAccumulator(),
    explosive: new MetricAccumulator(),
    pressure: new MetricAccumulator()
  };
}

function snapshotFrame(acc: Record<MetricName, MetricAccumulator>): RatingFrame {
  return {
    epa: acc.epa.snapshot(),
    passEpa: acc.passEpa.snapshot(),
    rushEpa: acc.rushEpa.snapshot(),
    success: acc.success.snapshot(),
    explosive: acc.explosive.snapshot(),
    pressure: acc.pressure.snapshot()
  };
}

function addPlay(acc: Record<MetricName, MetricAccumulator>, play: PlayLite) {
  acc.epa.add(play.offense, play.defense, play.epa);
  acc.success.add(play.offense, play.defense, play.success);
  acc.explosive.add(play.offense, play.defense, play.explosive);
  if (play.type === 'pass') acc.passEpa.add(play.offense, play.defense, play.epa);
  else acc.rushEpa.add(play.offense, play.defense, play.epa);
  if (play.dropback) acc.pressure.add(play.offense, play.defense, play.pressure);
}

function parsePbp(text: string): { byWeek: Map<number, PlayLite[]>; eligible: number } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { byWeek: new Map(), eligible: 0 };
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const required = ['week', 'season_type', 'posteam', 'defteam', 'play_type', 'epa', 'success', 'qb_dropback', 'sack', 'qb_hit'];
  for (const field of required) if (!index.has(field)) throw new Error(`PBP missing required column: ${field}`);
  const get = (cells: string[], field: string) => {
    const i = index.get(field);
    return i == null ? '' : (cells[i] ?? '').trim();
  };
  const byWeek = new Map<number, PlayLite[]>();
  let eligible = 0;
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const cells = parseCsvLine(lines[lineIndex]);
    if (get(cells, 'season_type') !== 'REG') continue;
    if (get(cells, 'no_play') === '1') continue;
    if (get(cells, 'qb_kneel') === '1' || get(cells, 'qb_spike') === '1') continue;
    const playType = get(cells, 'play_type');
    const type: PlayLite['type'] | null = playType === 'pass' ? 'pass' : playType === 'run' ? 'rush' : null;
    if (!type) continue;
    const week = numberOrNull(get(cells, 'week'));
    const epa = numberOrNull(get(cells, 'epa'));
    const offense = normalizeTeamAbbr(get(cells, 'posteam'));
    const defense = normalizeTeamAbbr(get(cells, 'defteam'));
    if (week == null || epa == null || !teamIndex.has(offense) || !teamIndex.has(defense)) continue;
    const successValue = numberOrNull(get(cells, 'success'));
    const dropback = get(cells, 'qb_dropback') === '1';
    const pressure = dropback && (get(cells, 'sack') === '1' || get(cells, 'qb_hit') === '1') ? 1 : 0;
    const row: PlayLite = {
      week,
      offense,
      defense,
      type,
      epa,
      success: successValue ?? (epa > 0 ? 1 : 0),
      explosive: epa > EXPLOSIVE_EPA ? 1 : 0,
      dropback,
      pressure
    };
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(row);
    eligible++;
  }
  return { byWeek, eligible };
}

function ratingValue(snapshot: MetricSnapshot, side: Side, team: string, week: number): number {
  const idx = teamIndex.get(team);
  if (idx == null) return 0;
  const raw = side === 'off' ? snapshot.rawOff[idx] : snapshot.rawDef[idx];
  const adjusted = side === 'off' ? snapshot.adjOff[idx] : snapshot.adjDef[idx];
  if (week <= 3) return raw;
  if (week === 4) return 0.5 * raw + 0.5 * adjusted;
  return adjusted;
}

async function buildRatings(seasons: number[]) {
  const weekRatings = new Map<string, RatingFrame>();
  const seasonRatings = new Map<number, RatingFrame>();
  let playCount = 0;

  for (const season of seasons) {
    const text = await fetchText(PBP_URL(season), `nflverse PBP ${season}`);
    const parsed = parsePbp(text);
    playCount += parsed.eligible;
    const acc = emptyAccumulators();
    const weeks = [...parsed.byWeek.keys()].sort((a, b) => a - b);
    if (!weeks.length) throw new Error(`No eligible regular-season plays for ${season}`);

    for (const week of weeks) {
      if (season >= MODEL_START_SEASON) weekRatings.set(`${season}:${week}`, snapshotFrame(acc));
      for (const play of parsed.byWeek.get(week) ?? []) addPlay(acc, play);
    }
    seasonRatings.set(season, snapshotFrame(acc));
    console.log(`ratings ${season}: ${parsed.eligible.toLocaleString()} eligible plays, weeks ${weeks[0]}-${weeks[weeks.length - 1]}`);
  }

  return { weekRatings, seasonRatings, playCount };
}

function correlation(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function fitCarryover(seasonRatings: Map<number, RatingFrame>): Record<string, CarryoverStat> {
  const out: Record<string, CarryoverStat> = {};
  for (const metric of METRICS) {
    for (const side of ['off', 'def'] as const) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let targetSeason = RATING_START_SEASON + 1; targetSeason <= CARRYOVER_LAST_TARGET_SEASON; targetSeason++) {
        const prior = seasonRatings.get(targetSeason - 1)?.[metric];
        const current = seasonRatings.get(targetSeason)?.[metric];
        if (!prior || !current) continue;
        const xValues = side === 'off' ? prior.adjOff : prior.adjDef;
        const yValues = side === 'off' ? current.adjOff : current.adjDef;
        for (let i = 0; i < N_TEAMS; i++) {
          if (!Number.isFinite(xValues[i]) || !Number.isFinite(yValues[i])) continue;
          xs.push(xValues[i]);
          ys.push(yValues[i]);
        }
      }
      const mx = mean(xs);
      const my = mean(ys);
      let cov = 0;
      let variance = 0;
      for (let i = 0; i < xs.length; i++) {
        cov += (xs[i] - mx) * (ys[i] - my);
        variance += (xs[i] - mx) ** 2;
      }
      const slope = variance > 0 ? cov / variance : 0;
      out[`${metric}:${side}`] = { slope, r: correlation(xs, ys), n: xs.length };
    }
  }
  return out;
}

function normalizeName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseQbStats(text: string): QbWeek[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, i) => [header, i]));
  const get = (cells: string[], field: string) => {
    const i = index.get(field);
    return i == null ? '' : (cells[i] ?? '').trim();
  };
  const required = ['season', 'week', 'season_type', 'player_display_name', 'position', 'attempts', 'passing_epa', 'sacks_suffered'];
  for (const field of required) if (!index.has(field)) throw new Error(`QB stats missing required column: ${field}`);

  const rows: QbWeek[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (get(cells, 'season_type') !== 'REG' || get(cells, 'position') !== 'QB') continue;
    const season = numberOrNull(get(cells, 'season'));
    const week = numberOrNull(get(cells, 'week'));
    const name = get(cells, 'player_display_name') || get(cells, 'player_name');
    if (season == null || week == null || !name) continue;
    rows.push({
      season,
      week,
      name,
      normalizedName: normalizeName(name),
      attempts: numberOrNull(get(cells, 'attempts')) ?? 0,
      passingEpa: numberOrNull(get(cells, 'passing_epa')) ?? 0,
      cpoe: numberOrNull(get(cells, 'passing_cpoe')) ?? undefined,
      sacks: numberOrNull(get(cells, 'sacks_suffered')) ?? 0
    });
  }
  return rows;
}

async function loadQbHistory(startSeason: number, endSeason: number): Promise<Map<string, QbWeek[]>> {
  const index = new Map<string, QbWeek[]>();
  for (let season = startSeason; season <= endSeason; season++) {
    try {
      const text = await fetchText(PLAYER_STATS_URL(season), `QB weekly stats ${season}`);
      const rows = parseQbStats(text);
      for (const row of rows) {
        if (!index.has(row.normalizedName)) index.set(row.normalizedName, []);
        index.get(row.normalizedName)!.push(row);
      }
      console.log(`QB stats ${season}: ${rows.length} QB-weeks`);
    } catch (error) {
      console.warn(`QB stats ${season} unavailable: ${String(error)}`);
    }
  }
  for (const rows of index.values()) rows.sort((a, b) => (a.season - b.season) || (a.week - b.week));
  return index;
}

function qbProfile(history: Map<string, QbWeek[]>, qbName: string, season: number, week: number): QbProfile {
  const rows = history.get(normalizeName(qbName)) ?? [];
  const prior: QbWeek[] = [];
  for (let i = rows.length - 1; i >= 0 && prior.length < QB_WINDOW; i--) {
    const row = rows[i];
    if (row.season < season || (row.season === season && row.week < week)) prior.push(row);
  }
  if (!prior.length) return { epaPerDropback: 0, cpoe: 0, sackAvoidance: 0, dropbacks: 0, games: 0, known: false };
  let attempts = 0;
  let sacks = 0;
  let epa = 0;
  let cpoeWeighted = 0;
  let cpoeAttempts = 0;
  for (const row of prior) {
    attempts += row.attempts;
    sacks += row.sacks;
    epa += row.passingEpa;
    if (row.cpoe != null && row.attempts > 0) {
      cpoeWeighted += row.cpoe * row.attempts;
      cpoeAttempts += row.attempts;
    }
  }
  const dropbacks = attempts + sacks;
  return {
    epaPerDropback: dropbacks ? epa / dropbacks : 0,
    cpoe: cpoeAttempts ? cpoeWeighted / cpoeAttempts : 0,
    sackAvoidance: dropbacks ? -(sacks / dropbacks) : 0,
    dropbacks,
    games: prior.length,
    known: dropbacks >= 10
  };
}

function countPriorGames(games: Game[]): Map<string, { home: number; away: number }> {
  const out = new Map<string, { home: number; away: number }>();
  const bySeason = new Map<number, Game[]>();
  for (const game of games) {
    if (game.gameType !== 'REG') continue;
    if (!bySeason.has(game.season)) bySeason.set(game.season, []);
    bySeason.get(game.season)!.push(game);
  }
  for (const [season, seasonGames] of bySeason.entries()) {
    const counts = new Map<string, number>();
    const ordered = [...seasonGames].sort((a, b) => (a.week - b.week) || a.gameday.localeCompare(b.gameday));
    for (const game of ordered) {
      const id = String(game.gameId || `${season}:${game.week}:${game.awayTeam}@${game.homeTeam}`);
      out.set(id, { home: counts.get(game.homeTeam) ?? 0, away: counts.get(game.awayTeam) ?? 0 });
      if (Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore)) {
        counts.set(game.homeTeam, (counts.get(game.homeTeam) ?? 0) + 1);
        counts.set(game.awayTeam, (counts.get(game.awayTeam) ?? 0) + 1);
      }
    }
  }
  return out;
}

function blendedTeamRating(
  weekRatings: Map<string, RatingFrame>,
  seasonRatings: Map<number, RatingFrame>,
  carryover: Record<string, CarryoverStat>,
  season: number,
  week: number,
  team: string,
  gamesPlayed: number,
  metric: MetricName,
  side: Side
): number {
  const weekFrame = weekRatings.get(`${season}:${week}`)?.[metric];
  const current = weekFrame ? ratingValue(weekFrame, side, team, week) : 0;
  const priorFrame = seasonRatings.get(season - 1)?.[metric];
  const idx = teamIndex.get(team);
  const priorRaw = idx == null || !priorFrame ? 0 : (side === 'off' ? priorFrame.adjOff[idx] : priorFrame.adjDef[idx]);
  const slope = carryover[`${metric}:${side}`]?.slope ?? 0;
  const prior = priorRaw * slope;
  const w = gamesPlayed / (gamesPlayed + PRIOR_GAMES_EQUIV);
  if (!priorFrame) return current;
  if (!weekFrame || gamesPlayed === 0) return prior;
  return w * current + (1 - w) * prior;
}

const FEATURE_NAMES = [
  ...METRICS.flatMap(metric => [`${metric}_off_diff`, `${metric}_def_diff`]),
  'qb_epa_diff',
  'qb_cpoe_diff',
  'qb_sack_avoid_diff',
  'rest_diff',
  'neutral',
  'week'
];

function buildFeatureRows(
  games: Game[],
  weekRatings: Map<string, RatingFrame>,
  seasonRatings: Map<number, RatingFrame>,
  carryover: Record<string, CarryoverStat>,
  qbHistory: Map<string, QbWeek[]>
): FeatureRow[] {
  const priorCounts = countPriorGames(games);
  const rows: FeatureRow[] = [];
  for (const game of games) {
    if (game.season < MODEL_START_SEASON || game.season > LIVE_SEASON || game.gameType !== 'REG') continue;
    if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore) || game.homeScore === game.awayScore) continue;
    const id = String(game.gameId || `${game.season}:${game.week}:${game.awayTeam}@${game.homeTeam}`);
    const counts = priorCounts.get(id) ?? { home: Math.max(0, game.week - 1), away: Math.max(0, game.week - 1) };
    const features: Record<string, number> = {};
    for (const metric of METRICS) {
      for (const side of ['off', 'def'] as const) {
        const home = blendedTeamRating(weekRatings, seasonRatings, carryover, game.season, game.week, game.homeTeam, counts.home, metric, side);
        const away = blendedTeamRating(weekRatings, seasonRatings, carryover, game.season, game.week, game.awayTeam, counts.away, metric, side);
        features[`${metric}_${side}_diff`] = home - away;
      }
    }

    const homeQbName = game.homeQbName ?? '';
    const awayQbName = game.awayQbName ?? '';
    const homeQb = qbProfile(qbHistory, homeQbName, game.season, game.week);
    const awayQb = qbProfile(qbHistory, awayQbName, game.season, game.week);
    features.qb_epa_diff = homeQb.epaPerDropback - awayQb.epaPerDropback;
    features.qb_cpoe_diff = homeQb.cpoe - awayQb.cpoe;
    features.qb_sack_avoid_diff = homeQb.sackAvoidance - awayQb.sackAvoidance;
    features.rest_diff = clamp((game.homeRest ?? 7) - (game.awayRest ?? 7), -10, 10);
    features.neutral = game.location === 'Neutral' ? 1 : 0;
    features.week = game.week;

    rows.push({
      gameId: id,
      season: game.season,
      week: game.week,
      gameday: game.gameday,
      home: game.homeTeam,
      away: game.awayTeam,
      actualMargin: Number(game.homeScore) - Number(game.awayScore),
      actualHomeWin: Number(game.homeScore) > Number(game.awayScore),
      homeGamesPlayed: counts.home,
      awayGamesPlayed: counts.away,
      homeCurrentWeight: counts.home / (counts.home + PRIOR_GAMES_EQUIV),
      awayCurrentWeight: counts.away / (counts.away + PRIOR_GAMES_EQUIV),
      homeQb: homeQbName,
      awayQb: awayQbName,
      homeQbKnown: homeQb.known,
      awayQbKnown: awayQb.known,
      features
    });
  }
  return rows.sort((a, b) => a.gameday.localeCompare(b.gameday) || a.gameId.localeCompare(b.gameId));
}

function fitRidge(rows: FeatureRow[], alpha: number, features = FEATURE_NAMES): RidgeModel {
  if (rows.length < features.length + 50) throw new Error(`Too few rows for margin ridge: ${rows.length}`);
  const means = features.map(name => mean(rows.map(row => row.features[name] ?? 0)));
  const sds = features.map((name, j) => sd(rows.map(row => row.features[name] ?? 0), means[j]));
  const p = features.length + 1;
  const xtx = new Float64Array(p * p);
  const xty = new Float64Array(p);
  for (const row of rows) {
    const x = [1, ...features.map((name, j) => ((row.features[name] ?? 0) - means[j]) / sds[j])];
    for (let a = 0; a < p; a++) {
      xty[a] += x[a] * row.actualMargin;
      for (let b = 0; b < p; b++) xtx[a * p + b] += x[a] * x[b];
    }
  }
  xtx[0] += 1e-8;
  for (let i = 1; i < p; i++) xtx[i * p + i] += alpha;
  const coefficients = solveSpd(xtx, xty, p);
  return { alpha, features: [...features], standardizer: { mean: means, sd: sds }, coefficients };
}

function predictMargin(model: RidgeModel, row: FeatureRow): number {
  let value = model.coefficients[0] ?? 0;
  for (let j = 0; j < model.features.length; j++) {
    const raw = row.features[model.features[j]] ?? 0;
    const z = (raw - model.standardizer.mean[j]) / model.standardizer.sd[j];
    value += z * (model.coefficients[j + 1] ?? 0);
  }
  return value;
}

function marginErrors(model: RidgeModel, rows: FeatureRow[]) {
  const errors = rows.map(row => row.actualMargin - predictMargin(model, row));
  return {
    mae: mean(errors.map(error => Math.abs(error))),
    rmse: Math.sqrt(mean(errors.map(error => error * error))),
    sigma: Math.max(6, sd(errors))
  };
}

function fitCalibrationSlope(rawProbabilities: number[], outcomes: number[]): number {
  if (rawProbabilities.length < 100) return 1;
  const xs = rawProbabilities.map(logit);
  let beta = 1;
  for (let iter = 0; iter < 50; iter++) {
    let grad = 0;
    let hess = 0;
    for (let i = 0; i < xs.length; i++) {
      const p = logistic(beta * xs[i]);
      grad += (p - outcomes[i]) * xs[i];
      hess += p * (1 - p) * xs[i] * xs[i];
    }
    if (hess < 1e-9) break;
    const next = clamp(beta - grad / hess, 0.1, 3);
    if (Math.abs(next - beta) < 1e-7) {
      beta = next;
      break;
    }
    beta = next;
  }
  return beta;
}

function buildCalibration(rows: FeatureRow[], alpha: number): { beta: number; n: number } {
  const probabilities: number[] = [];
  const outcomes: number[] = [];
  for (let season = 2014; season < HOLDOUT_START; season++) {
    const train = rows.filter(row => row.season < season);
    const test = rows.filter(row => row.season === season);
    if (train.length < 400 || test.length < 100) continue;
    const model = fitRidge(train, alpha);
    const sigma = marginErrors(model, train).sigma;
    for (const row of test) {
      probabilities.push(clamp(normalCdf(predictMargin(model, row) / sigma), 0.001, 0.999));
      outcomes.push(row.actualHomeWin ? 1 : 0);
    }
  }
  return { beta: fitCalibrationSlope(probabilities, outcomes), n: outcomes.length };
}

function score(model: RidgeModel, rows: FeatureRow[], sigma: number, beta: number): ScoredRow[] {
  return rows.map(row => {
    const predictedMargin = predictMargin(model, row);
    const rawPHome = clamp(normalCdf(predictedMargin / sigma), 0.001, 0.999);
    const pHome = clamp(logistic(beta * logit(rawPHome)), 0.001, 0.999);
    return { ...row, predictedMargin, rawPHome, pHome };
  });
}

function expectedCalibrationError(rows: Array<{ pHome: number; actualHomeWin: boolean }>): number {
  if (!rows.length) return 0;
  let ece = 0;
  for (let bin = 0; bin < 10; bin++) {
    const lo = bin / 10;
    const hi = (bin + 1) / 10;
    const bucket = rows.filter(row => row.pHome >= lo && (bin === 9 ? row.pHome <= hi : row.pHome < hi));
    if (!bucket.length) continue;
    const avgP = mean(bucket.map(row => row.pHome));
    const actual = mean(bucket.map(row => row.actualHomeWin ? 1 : 0));
    ece += bucket.length / rows.length * Math.abs(avgP - actual);
  }
  return ece;
}

function scoredMetrics(rows: ScoredRow[]): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, ece: 0, mae: 0, rmse: 0 };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const errors: number[] = [];
  for (const row of rows) {
    const y = row.actualHomeWin ? 1 : 0;
    const p = clamp(row.pHome, 0.001, 0.999);
    correct += (p >= 0.5) === row.actualHomeWin ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    errors.push(row.predictedMargin - row.actualMargin);
  }
  return {
    n: rows.length,
    correct,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    ece: expectedCalibrationError(rows),
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map(error => error * error)))
  };
}

function controlMetrics(rows: ControlRow[]): Metrics {
  if (!rows.length) return { n: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, ece: 0, mae: 0, rmse: 0 };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const y = row.actualHomeWin ? 1 : 0;
    const p = clamp(row.pHome, 0.001, 0.999);
    correct += (p >= 0.5) === row.actualHomeWin ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return {
    n: rows.length,
    correct,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    ece: expectedCalibrationError(rows.map(row => ({ pHome: row.pHome, actualHomeWin: row.actualHomeWin }))),
    mae: 0,
    rmse: 0
  };
}

async function buildControlRows(featureRows: FeatureRow[], seasons: number[]): Promise<Map<string, ControlRow>> {
  const teamData = parseTeamData();
  const byAbbr = new Map(teamData.map(team => [team.abbr, team]));
  const wanted = featureRows.filter(row => seasons.includes(row.season));
  const out = new Map<string, ControlRow>();
  let done = 0;
  for (const row of wanted) {
    const home = byAbbr.get(row.home);
    const away = byAbbr.get(row.away);
    if (!home || !away) continue;
    const result = await predictWinner(home, away, new Date(`${row.gameday}T12:00:00Z`), true, { neutralSite: row.features.neutral === 1 });
    const pHome = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === row.home ? result.confidence / 100 : 1 - result.confidence / 100;
    out.set(row.gameId, {
      gameId: row.gameId,
      pHome: clamp(pHome, 0.001, 0.999),
      actualHomeWin: row.actualHomeWin,
      actualMargin: row.actualMargin,
      season: row.season,
      week: row.week
    });
    done++;
    if (done % 100 === 0) console.log(`v2.2 comparison snapshots: ${done}/${wanted.length}`);
  }
  return out;
}

function printMetrics(label: string, metric: Metrics) {
  console.log(`${label}: ${metric.correct}/${metric.n}=${fmtPct(metric.accuracy)} | Brier ${metric.brier.toFixed(4)} | LogLoss ${metric.logLoss.toFixed(4)} | ECE ${metric.ece.toFixed(4)} | MAE ${metric.mae.toFixed(3)} | RMSE ${metric.rmse.toFixed(3)}`);
}

function failureSummary(shadow: ScoredRow[], controls: Map<string, ControlRow>) {
  const misses = shadow.filter(row => (row.pHome >= 0.5) !== row.actualHomeWin);
  return {
    misses: misses.length,
    closeGame8OrLess: misses.filter(row => Math.abs(row.actualMargin) <= 8).length,
    highConfidence67Plus: misses.filter(row => Math.max(row.pHome, 1 - row.pHome) >= 0.67).length,
    qbHistoryMissingEither: misses.filter(row => !row.homeQbKnown || !row.awayQbKnown).length,
    priorDominantWeek1to3: misses.filter(row => row.week <= 3).length,
    shadowCorrectControlWrong: shadow.filter(row => {
      const control = controls.get(row.gameId);
      return control && ((row.pHome >= 0.5) === row.actualHomeWin) && ((control.pHome >= 0.5) !== row.actualHomeWin);
    }).length,
    controlCorrectShadowWrong: shadow.filter(row => {
      const control = controls.get(row.gameId);
      return control && ((row.pHome >= 0.5) !== row.actualHomeWin) && ((control.pHome >= 0.5) === row.actualHomeWin);
    }).length
  };
}

function decide(shadow2025: Metrics, control2025: Metrics, shadow2026: Metrics, control2026: Metrics): string {
  const 2025Good = shadow2025.accuracy >= control2025.accuracy && shadow2025.brier <= control2025.brier && shadow2025.logLoss <= control2025.logLoss;
  const 2026Good = shadow2026.accuracy >= control2026.accuracy;
  if (2025Good && 2026Good) return 'V3-SHADOW CANDIDATE';
  if (shadow2025.brier < control2025.brier || shadow2026.accuracy > control2026.accuracy) return 'KEEP FOR RESEARCH';
  return 'REJECT';
}

async function main() {
  console.log('EXP-016A — long-history play-by-play architecture benchmark');
  console.log(`Canonical teams: ${N_TEAMS}`);

  const gamesText = await fetchText(GAMES_URL, 'nflverse games');
  const games = parseGamesCsv(gamesText);
  const availableSeasons = [...new Set(games.filter(game => game.season >= RATING_START_SEASON && game.season <= LIVE_SEASON).map(game => game.season))].sort((a, b) => a - b);
  if (!availableSeasons.includes(2025) || !availableSeasons.includes(LIVE_SEASON)) throw new Error('Games feed is missing required 2025/2026 seasons.');

  const { weekRatings, seasonRatings, playCount } = await buildRatings(availableSeasons);
  console.log(`Total eligible pass/run PBP rows processed: ${playCount.toLocaleString()}`);

  const carryover = fitCarryover(seasonRatings);
  console.log('\nCarryover fitted without 2023-2026 targets:');
  for (const key of ['epa:off', 'epa:def', 'passEpa:off', 'passEpa:def', 'pressure:off', 'pressure:def']) {
    const stat = carryover[key];
    console.log(`  ${key.padEnd(18)} slope=${stat.slope.toFixed(3)} r=${stat.r.toFixed(3)} n=${stat.n}`);
  }

  const qbHistory = await loadQbHistory(Math.max(1999, MODEL_START_SEASON - 2), LIVE_SEASON);
  const rows = buildFeatureRows(games, weekRatings, seasonRatings, carryover, qbHistory);
  console.log(`Feature rows: ${rows.length} completed regular-season games ${rows[0]?.season}-${rows[rows.length - 1]?.season}`);

  const train = rows.filter(row => row.season >= MODEL_START_SEASON && row.season < VALIDATION_START);
  const validation = rows.filter(row => row.season >= VALIDATION_START && row.season < HOLDOUT_START);
  const holdout = rows.filter(row => row.season >= HOLDOUT_START && row.season <= 2025);
  const live = rows.filter(row => row.season === LIVE_SEASON);
  if (train.length < 1000 || validation.length < 700 || holdout.length < 700 || live.length < 30) {
    throw new Error(`Unexpected split sizes train=${train.length} validation=${validation.length} holdout=${holdout.length} live=${live.length}`);
  }

  console.log(`\nSplits: train ${train.length}, validation ${validation.length}, benchmark ${holdout.length}, 2026 obs ${live.length}`);
  const candidates: Array<{ alpha: number; mae: number; rmse: number }> = [];
  for (const alpha of MARGIN_ALPHAS) {
    const model = fitRidge(train, alpha);
    const errors = marginErrors(model, validation);
    candidates.push({ alpha, mae: errors.mae, rmse: errors.rmse });
    console.log(`alpha ${String(alpha).padStart(5)} | validation MAE ${errors.mae.toFixed(3)} | RMSE ${errors.rmse.toFixed(3)}`);
  }
  candidates.sort((a, b) => a.mae - b.mae || a.rmse - b.rmse || a.alpha - b.alpha);
  const lockedAlpha = candidates[0].alpha;
  console.log(`Locked alpha from 2019-2022 only: ${lockedAlpha}`);

  const calibration = buildCalibration(rows.filter(row => row.season < HOLDOUT_START), lockedAlpha);
  console.log(`Calibration slope ${calibration.beta.toFixed(3)} from ${calibration.n} pre-holdout OOS games`);

  const preHoldout = rows.filter(row => row.season < HOLDOUT_START);
  const holdoutModel = fitRidge(preHoldout, lockedAlpha);
  const holdoutSigma = marginErrors(holdoutModel, preHoldout).sigma;
  const holdoutScored = score(holdoutModel, holdout, holdoutSigma, calibration.beta);
  const holdoutMetric = scoredMetrics(holdoutScored);
  printMetrics('Architecture benchmark 2023-2025', holdoutMetric);
  for (const season of [2023, 2024, 2025]) printMetrics(`  ${season}`, scoredMetrics(holdoutScored.filter(row => row.season === season)));

  const through2025 = rows.filter(row => row.season <= 2025);
  const liveModel = fitRidge(through2025, lockedAlpha);
  const liveSigma = marginErrors(liveModel, through2025).sigma;
  const liveScored = score(liveModel, live, liveSigma, calibration.beta);

  const controls = await buildControlRows(rows, [2025, LIVE_SEASON]);
  const architecture2025 = scoredMetrics(holdoutScored.filter(row => row.season === 2025));
  const control2025 = controlMetrics([...controls.values()].filter(row => row.season === 2025));
  const architecture2026 = scoredMetrics(liveScored);
  const control2026 = controlMetrics([...controls.values()].filter(row => row.season === LIVE_SEASON));

  console.log('\n2025 side-by-side');
  printMetrics('v2.2 control', control2025);
  printMetrics('EXP-016A', architecture2025);
  console.log('\n2026 observational side-by-side');
  printMetrics('v2.2 control', control2026);
  printMetrics('EXP-016A', architecture2026);

  const weekly2026 = [1, 2, 3].map(week => ({
    week,
    shadow: scoredMetrics(liveScored.filter(row => row.week === week)),
    control: controlMetrics([...controls.values()].filter(row => row.season === LIVE_SEASON && row.week === week))
  }));
  for (const entry of weekly2026) {
    console.log(`Week ${entry.week}: v2.2 ${entry.control.correct}/${entry.control.n}=${fmtPct(entry.control.accuracy)} | EXP-016A ${entry.shadow.correct}/${entry.shadow.n}=${fmtPct(entry.shadow.accuracy)}`);
  }

  const failures = failureSummary(liveScored, controls);
  const decision = decide(architecture2025, control2025, architecture2026, control2026);
  console.log(`Decision: ${decision}`);

  const runtime = {
    experiment: 'EXP-016A',
    architectureSource: 'Damepivot/nfl-game-model concepts independently reproduced',
    data: {
      ratingStartSeason: RATING_START_SEASON,
      lastSeason: LIVE_SEASON,
      eligiblePlayRows: playCount,
      qbPlayers: qbHistory.size,
      featureRows: rows.length
    },
    firewall: {
      train: `${MODEL_START_SEASON}-${VALIDATION_START - 1}`,
      validation: `${VALIDATION_START}-${HOLDOUT_START - 1}`,
      retrospectiveBenchmark: `${HOLDOUT_START}-2025`,
      observational: `${LIVE_SEASON}`,
      note: '2025 and 2026 have been inspected elsewhere in this project; this experiment selects no parameters from them.'
    },
    fixedRules: {
      teamRidgeAlpha: TEAM_RIDGE_ALPHA,
      priorGamesEquivalent: PRIOR_GAMES_EQUIV,
      qbWindow: QB_WINDOW,
      opponentAdjustment: 'Weeks 1-3 raw; Week 4 50/50 raw+ridge; Week 5+ ridge',
      explosiveDefinition: `EPA > ${EXPLOSIVE_EPA}`
    },
    carryover,
    marginAlphaCandidates: candidates,
    lockedAlpha,
    calibration,
    holdout: holdoutMetric,
    holdoutBySeason: Object.fromEntries([2023, 2024, 2025].map(season => [season, scoredMetrics(holdoutScored.filter(row => row.season === season))])),
    comparison2025: { control: control2025, shadow: architecture2025 },
    comparison2026: { control: control2026, shadow: architecture2026, weekly: weekly2026 },
    failures2026: failures,
    decision,
    games2026: liveScored.map(row => {
      const control = controls.get(row.gameId);
      return {
        gameId: row.gameId,
        week: row.week,
        gameday: row.gameday,
        matchup: `${row.away}@${row.home}`,
        actualMargin: row.actualMargin,
        predictedMargin: row.predictedMargin,
        shadowPHome: row.pHome,
        shadowPick: row.pHome >= 0.5 ? row.home : row.away,
        shadowCorrect: (row.pHome >= 0.5) === row.actualHomeWin,
        controlPHome: control?.pHome,
        controlPick: control ? (control.pHome >= 0.5 ? row.home : row.away) : undefined,
        controlCorrect: control ? (control.pHome >= 0.5) === row.actualHomeWin : undefined,
        homeCurrentWeight: row.homeCurrentWeight,
        awayCurrentWeight: row.awayCurrentWeight,
        homeQb: row.homeQb,
        awayQb: row.awayQb,
        homeQbKnown: row.homeQbKnown,
        awayQbKnown: row.awayQbKnown
      };
    })
  };

  const md = `# EXP-016A — Long-History Play-by-Play Architecture Benchmark\n\n` +
    `Status: **${decision}**\n\n` +
    `Production v2.2 was not changed. This independently reproduces architecture concepts from Damepivot/nfl-game-model against this project's data and control.\n\n` +
    `## Data / firewall\n\n` +
    `- Eligible regular-season pass/run plays processed: **${playCount.toLocaleString()}** (${RATING_START_SEASON}-${LIVE_SEASON}).\n` +
    `- Model train: **${MODEL_START_SEASON}-${VALIDATION_START - 1}**.\n` +
    `- Model validation / alpha selection: **${VALIDATION_START}-${HOLDOUT_START - 1}**.\n` +
    `- Retrospective architecture benchmark: **${HOLDOUT_START}-2025**.\n` +
    `- 2026 is observational only and selects no parameter.\n` +
    `- Because this project has already inspected 2025 and 2026, neither is called a pristine research-process holdout.\n\n` +
    `## Locked architecture\n\n` +
    `- Play-level raw + ridge offense/defense ratings for EPA, pass EPA, rush EPA, success, explosive rate and pressure.\n` +
    `- Team-effect ridge penalty **${TEAM_RIDGE_ALPHA}**.\n` +
    `- Prior/current blend: **n/(n+${PRIOR_GAMES_EQUIV})** using actual games played.\n` +
    `- Separate empirical carryover slopes by metric and offense/defense, fitted only through target season ${CARRYOVER_LAST_TARGET_SEASON}.\n` +
    `- Weeks 1–3 use raw current-season ratings; Week 4 is 50/50 raw/ridge; Week 5+ uses ridge opponent adjustment.\n` +
    `- QB form: ${QB_WINDOW} prior games across season boundaries (EPA/dropback, CPOE, sack avoidance).\n` +
    `- Margin-first standardized ridge; locked alpha **${lockedAlpha}** selected only on 2019–2022.\n` +
    `- Win probability derived from margin; zero-intercept calibration slope **${calibration.beta.toFixed(3)}** from ${calibration.n} pre-holdout OOS games.\n\n` +
    `## Carryover examples\n\n` +
    `| rating | slope | year-to-year r | n |\n|---|---:|---:|---:|\n` +
    ['epa:off', 'epa:def', 'passEpa:off', 'passEpa:def', 'pressure:off', 'pressure:def'].map(key => {
      const stat = carryover[key];
      return `| ${key} | ${stat.slope.toFixed(3)} | ${stat.r.toFixed(3)} | ${stat.n} |`;
    }).join('\n') + `\n\n` +
    `## Margin-alpha validation (2019–2022 only)\n\n` +
    `| alpha | MAE | RMSE |\n|---:|---:|---:|\n` +
    candidates.map(candidate => `| ${candidate.alpha} | ${candidate.mae.toFixed(3)} | ${candidate.rmse.toFixed(3)} |`).join('\n') + `\n\n` +
    `## 2023–2025 architecture benchmark\n\n` +
    `Accuracy **${holdoutMetric.correct}/${holdoutMetric.n} = ${fmtPct(holdoutMetric.accuracy)}**, Brier **${holdoutMetric.brier.toFixed(4)}**, log loss **${holdoutMetric.logLoss.toFixed(4)}**, ECE **${holdoutMetric.ece.toFixed(4)}**, margin MAE **${holdoutMetric.mae.toFixed(3)}**, RMSE **${holdoutMetric.rmse.toFixed(3)}**.\n\n` +
    `## 2025 vs v2.2\n\n` +
    `| model | accuracy | Brier | log loss | ECE | margin MAE |\n|---|---:|---:|---:|---:|---:|\n` +
    `| v2.2 | ${fmtPct(control2025.accuracy)} (${control2025.correct}/${control2025.n}) | ${control2025.brier.toFixed(4)} | ${control2025.logLoss.toFixed(4)} | ${control2025.ece.toFixed(4)} | — |\n` +
    `| EXP-016A | ${fmtPct(architecture2025.accuracy)} (${architecture2025.correct}/${architecture2025.n}) | ${architecture2025.brier.toFixed(4)} | ${architecture2025.logLoss.toFixed(4)} | ${architecture2025.ece.toFixed(4)} | ${architecture2025.mae.toFixed(3)} |\n\n` +
    `## 2026 observational comparison\n\n` +
    `| model | accuracy | Brier | log loss | ECE |\n|---|---:|---:|---:|---:|\n` +
    `| v2.2 | ${fmtPct(control2026.accuracy)} (${control2026.correct}/${control2026.n}) | ${control2026.brier.toFixed(4)} | ${control2026.logLoss.toFixed(4)} | ${control2026.ece.toFixed(4)} |\n` +
    `| EXP-016A | ${fmtPct(architecture2026.accuracy)} (${architecture2026.correct}/${architecture2026.n}) | ${architecture2026.brier.toFixed(4)} | ${architecture2026.logLoss.toFixed(4)} | ${architecture2026.ece.toFixed(4)} |\n\n` +
    `### Weeks 1–3\n\n` +
    `| week | v2.2 | EXP-016A |\n|---:|---:|---:|\n` +
    weekly2026.map(entry => `| ${entry.week} | ${entry.control.correct}/${entry.control.n} = ${fmtPct(entry.control.accuracy)} | ${entry.shadow.correct}/${entry.shadow.n} = ${fmtPct(entry.shadow.accuracy)} |`).join('\n') + `\n\n` +
    `## 2026 failure summary\n\n` +
    `- Misses: **${failures.misses}**.\n` +
    `- One-score/8-point-or-less misses: **${failures.closeGame8OrLess}**.\n` +
    `- 67%+ confidence misses: **${failures.highConfidence67Plus}**.\n` +
    `- Misses with missing QB history on either side: **${failures.qbHistoryMissingEither}**.\n` +
    `- Week 1–3 prior-dominant misses: **${failures.priorDominantWeek1to3}**.\n` +
    `- Shadow correct / v2.2 wrong: **${failures.shadowCorrectControlWrong}**.\n` +
    `- v2.2 correct / shadow wrong: **${failures.controlCorrectShadowWrong}**.\n\n` +
    `## Decision\n\n**${decision}**. Even if this benchmark is strong, the maximum permitted action is a shadow model. Production requires prospective replication after freeze.\n`;

  await mkdir('research/runtime', { recursive: true });
  await mkdir('research/reports', { recursive: true });
  await writeFile('research/runtime/exp-016a.json', JSON.stringify(runtime, null, 2));
  await writeFile('research/reports/exp-016a.md', md);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
