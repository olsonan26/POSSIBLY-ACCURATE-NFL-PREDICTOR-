import { Breakdown, DecisionFactor, NumerologyPatterns, PredictionResult, Team } from '../types';
import { TEAM_BY_ABBR, normalizeTeamAbbr } from '../data/teamRegistry';

const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const HISTORY_START = '2020-01-01';
const PRIOR_WINS = 8;
const PRIOR_LOSSES = 8;
const MONTE_CARLO_ITERATIONS = 20000;

interface GameRow {
  gameId: string;
  season: number;
  gameType: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
}

interface Counter {
  wins: number;
  losses: number;
}

interface ResearchIndex {
  signature: Map<string, Counter>;
  directed: Map<string, number>;
  teamWith: Map<string, Counter>;
  teamAgainst: Map<string, Counter>;
  teamMatchup: Map<string, Counter>;
  gamesUsed: number;
}

let gamesPromise: Promise<GameRow[]> | null = null;

function reduceToSingleDigit(n: number): number {
  if (n === 0) return 9;
  let current = Math.abs(Math.trunc(n));
  while (current > 9) current = String(current).split('').reduce((sum, digit) => sum + Number(digit), 0);
  return current;
}

function reduceSequence(n: number): string {
  const sequence = [Math.abs(Math.trunc(n))];
  let current = sequence[0];
  while (current > 9) {
    current = String(current).split('').reduce((sum, digit) => sum + Number(digit), 0);
    sequence.push(current);
  }
  return sequence.join('/');
}

function tail(value: string | undefined): number {
  const valueTail = String(value || '').split('/').pop();
  const n = Number(valueTail);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Canonical daily relationship supplied by the user:
 *   PM = PY + calendar month
 *   Daily Environment = PM + calendar day
 *   PME = Year ESS + PM
 *   Daily ESS = PME + Daily Environment
 *
 * `calculateAllPatterns` already gives us PM and PME. This function repairs only
 * the daily layer so production football logic remains untouched.
 */
export function correctDailyLettrology(patterns: NumerologyPatterns, gameDate: Date): NumerologyPatterns {
  const pm = tail(patterns.pm);
  const pme = tail(patterns.pme);
  const dailyEnvironmentRaw = pm + gameDate.getUTCDate();
  const dailyEnvironment = reduceToSingleDigit(dailyEnvironmentRaw);
  const dailyEssenceRaw = pme + dailyEnvironment;

  return {
    ...patterns,
    dailyEnvironmentFull: reduceSequence(dailyEnvironmentRaw),
    dailyEssenceFull: reduceSequence(dailyEssenceRaw)
  };
}

function correctedBreakdown(breakdown: Breakdown, gameDate: Date): Breakdown {
  return {
    ...breakdown,
    patterns: correctDailyLettrology(breakdown.patterns, gameDate),
    // Historical rates produced by the legacy calendar-Day pairing are not reused.
    deStats: undefined
  };
}

function teamBreakdown(items: Breakdown[]): Breakdown | undefined {
  return items.find(item => item.role === 'Team');
}

function roleBreakdown(items: Breakdown[], role: Breakdown['role']): Breakdown | undefined {
  return items.find(item => item.role === role);
}

export function applyCanonicalDailyFormula(result: PredictionResult, gameDate: Date): PredictionResult {
  const winnerBreakdown = result.winnerBreakdown.map(item => correctedBreakdown(item, gameDate));
  const loserBreakdown = result.loserBreakdown.map(item => correctedBreakdown(item, gameDate));
  const winnerTeam = teamBreakdown(winnerBreakdown);
  const loserTeam = teamBreakdown(loserBreakdown);
  const winnerCoach = roleBreakdown(winnerBreakdown, 'Coach');
  const loserCoach = roleBreakdown(loserBreakdown, 'Coach');
  const winnerQb = roleBreakdown(winnerBreakdown, 'Qb');
  const loserQb = roleBreakdown(loserBreakdown, 'Qb');
  const winnerOwner = roleBreakdown(winnerBreakdown, 'Owner');
  const loserOwner = roleBreakdown(loserBreakdown, 'Owner');

  const winnerPatterns = winnerTeam?.patterns;
  const loserPatterns = loserTeam?.patterns;

  return {
    ...result,
    winnerBreakdown,
    loserBreakdown,
    winnerStats: winnerPatterns
      ? { ...result.winnerStats, dailyEssence: tail(winnerPatterns.dailyEssenceFull) }
      : result.winnerStats,
    loserStats: loserPatterns
      ? { ...result.loserStats, dailyEssence: tail(loserPatterns.dailyEssenceFull) }
      : result.loserStats,
    winnerDE: winnerPatterns?.dailyEssenceFull || result.winnerDE,
    loserDE: loserPatterns?.dailyEssenceFull || result.loserDE,
    // Legacy field names are preserved for compatibility. They now carry the
    // canonical Daily Environment, not the raw calendar Day Number.
    winnerDay: winnerPatterns?.dailyEnvironmentFull || result.winnerDay,
    loserDay: loserPatterns?.dailyEnvironmentFull || result.loserDay,
    winnerDEStats: undefined,
    loserDEStats: undefined,
    winnerDayStats: undefined,
    loserDayStats: undefined,
    winnerComboWins: undefined,
    loserComboWins: undefined,
    winnerTotalPatternWins: undefined,
    winnerTotalPatternLosses: undefined,
    winnerTotalPatternPct: undefined,
    loserTotalPatternWins: undefined,
    loserTotalPatternLosses: undefined,
    loserTotalPatternPct: undefined,
    winnerCoachDE: winnerCoach?.patterns.dailyEssenceFull,
    loserCoachDE: loserCoach?.patterns.dailyEssenceFull,
    winnerCoachDEStats: undefined,
    loserCoachDEStats: undefined,
    winnerQbDE: winnerQb?.patterns.dailyEssenceFull,
    loserQbDE: loserQb?.patterns.dailyEssenceFull,
    winnerQbDEStats: undefined,
    loserQbDEStats: undefined,
    winnerOwnerDE: winnerOwner?.patterns.dailyEssenceFull,
    loserOwnerDE: loserOwner?.patterns.dailyEssenceFull,
    winnerOwnerDEStats: undefined,
    loserOwnerDEStats: undefined
  };
}

function getLetterValue(value: string): number {
  const letter = String(value || '').toUpperCase();
  const values: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9,
    J: 1, K: 2, L: 3, M: 4, N: 5, O: 6, P: 7, Q: 8, R: 9,
    S: 1, T: 2, U: 3, V: 4, W: 5, X: 6, Y: 7, Z: 8
  };
  return values[letter] || 0;
}

function getCycleString(name: string): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .map(char => char.repeat(getLetterValue(char)))
    .join('');
}

function calculateEssence(name: string, index: number): number {
  let total = 0;
  for (const part of String(name || '').split(/\s+/).filter(Boolean)) {
    const cycle = getCycleString(part);
    if (!cycle) continue;
    const char = cycle[(Math.max(1, index) - 1) % cycle.length];
    total += getLetterValue(char);
  }
  return reduceToSingleDigit(total);
}

function calculateAge(target: Date, birthday: Date): number {
  let age = target.getUTCFullYear() - birthday.getUTCFullYear();
  if (
    target.getUTCMonth() < birthday.getUTCMonth() ||
    (target.getUTCMonth() === birthday.getUTCMonth() && target.getUTCDate() < birthday.getUTCDate())
  ) age--;
  return Math.max(1, age);
}

function calculateTeamDailySignature(team: Team, gameDate: Date): { de: string; environment: string; signature: string } {
  const gameMonth = gameDate.getUTCMonth() + 1;
  const gameDay = gameDate.getUTCDate();
  const gameYear = gameDate.getUTCFullYear();
  const birthMonth = team.birthday.getUTCMonth() + 1;
  const birthDay = team.birthday.getUTCDate();
  const yearEssence = calculateEssence(team.name, calculateAge(gameDate, team.birthday));

  const py = reduceToSingleDigit(birthDay + birthMonth + gameYear);
  const pmRaw = py + gameMonth;
  const pm = reduceToSingleDigit(pmRaw);
  const pmeRaw = yearEssence + pm;
  const pme = reduceToSingleDigit(pmeRaw);
  const environmentRaw = pm + gameDay;
  const environment = reduceToSingleDigit(environmentRaw);
  const deRaw = pme + environment;

  const de = reduceSequence(deRaw);
  const environmentFull = reduceSequence(environmentRaw);
  return { de, environment: environmentFull, signature: `${de} over ${environmentFull}` };
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

function parseOptionalNumber(value: string): number | undefined {
  const n = Number(value);
  return value !== '' && Number.isFinite(n) ? n : undefined;
}

function parseGames(text: string): GameRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);
  const columns = {
    gameId: idx('game_id'), season: idx('season'), gameType: idx('game_type'), gameday: idx('gameday'),
    homeTeam: idx('home_team'), awayTeam: idx('away_team'), homeScore: idx('home_score'), awayScore: idx('away_score')
  };

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const get = (i: number) => i >= 0 ? String(cells[i] ?? '').trim() : '';
    return {
      gameId: get(columns.gameId),
      season: Number(get(columns.season) || 0),
      gameType: get(columns.gameType),
      gameday: get(columns.gameday),
      homeTeam: normalizeTeamAbbr(get(columns.homeTeam)),
      awayTeam: normalizeTeamAbbr(get(columns.awayTeam)),
      homeScore: parseOptionalNumber(get(columns.homeScore)),
      awayScore: parseOptionalNumber(get(columns.awayScore))
    };
  }).filter(game => game.gameday && game.homeTeam && game.awayTeam);
}

async function fetchTextWithFallback(primary: string, fallback: string): Promise<string> {
  try {
    const response = await fetch(primary);
    if (response.ok) return response.text();
  } catch {
    // direct fallback below
  }
  const response = await fetch(fallback);
  if (!response.ok) throw new Error(`Lettrology research history unavailable: ${response.status} ${response.statusText}`);
  return response.text();
}

async function loadGames(): Promise<GameRow[]> {
  if (!gamesPromise) {
    gamesPromise = fetchTextWithFallback('/api/nfl-data?dataset=games', NFLVERSE_GAMES_URL)
      .then(parseGames)
      .then(games => {
        if (games.length < 1000) throw new Error(`Lettrology history feed returned only ${games.length} games`);
        return games;
      })
      .catch(error => {
        gamesPromise = null;
        throw error;
      });
  }
  return gamesPromise;
}

function addCounter(map: Map<string, Counter>, key: string, won: boolean) {
  const value = map.get(key) || { wins: 0, losses: 0 };
  if (won) value.wins++;
  else value.losses++;
  map.set(key, value);
}

function directedKey(winnerSignature: string, loserSignature: string): string {
  return `${winnerSignature} >>> ${loserSignature}`;
}

function teamKey(team: string, signature: string): string {
  return `${team} || ${signature}`;
}

function teamMatchupKey(team: string, ownSignature: string, opponentSignature: string): string {
  return `${team} || ${ownSignature} >>> ${opponentSignature}`;
}

function buildResearchIndex(games: GameRow[], targetIso: string): ResearchIndex {
  const index: ResearchIndex = {
    signature: new Map(),
    directed: new Map(),
    teamWith: new Map(),
    teamAgainst: new Map(),
    teamMatchup: new Map(),
    gamesUsed: 0
  };

  for (const game of games) {
    if (game.gameType !== 'REG' || game.gameday < HISTORY_START || game.gameday >= targetIso) continue;
    if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) continue;
    if (game.homeScore === game.awayScore || game.homeTeam === game.awayTeam) continue;
    const home = TEAM_BY_ABBR.get(game.homeTeam);
    const away = TEAM_BY_ABBR.get(game.awayTeam);
    if (!home || !away) continue;

    const date = new Date(`${game.gameday}T12:00:00Z`);
    const homePattern = calculateTeamDailySignature(home, date);
    const awayPattern = calculateTeamDailySignature(away, date);
    const homeWon = game.homeScore! > game.awayScore!;
    const winnerPattern = homeWon ? homePattern : awayPattern;
    const loserPattern = homeWon ? awayPattern : homePattern;
    const winnerTeam = homeWon ? home : away;
    const loserTeam = homeWon ? away : home;

    index.gamesUsed++;
    addCounter(index.signature, homePattern.signature, homeWon);
    addCounter(index.signature, awayPattern.signature, !homeWon);
    index.directed.set(
      directedKey(winnerPattern.signature, loserPattern.signature),
      (index.directed.get(directedKey(winnerPattern.signature, loserPattern.signature)) || 0) + 1
    );

    addCounter(index.teamWith, teamKey(home.abbr, homePattern.signature), homeWon);
    addCounter(index.teamWith, teamKey(away.abbr, awayPattern.signature), !homeWon);
    addCounter(index.teamAgainst, teamKey(home.abbr, awayPattern.signature), homeWon);
    addCounter(index.teamAgainst, teamKey(away.abbr, homePattern.signature), !homeWon);
    addCounter(index.teamMatchup, teamMatchupKey(home.abbr, homePattern.signature, awayPattern.signature), homeWon);
    addCounter(index.teamMatchup, teamMatchupKey(away.abbr, awayPattern.signature, homePattern.signature), !homeWon);

    void winnerTeam;
    void loserTeam;
  }
  return index;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(random: () => number): number {
  const u1 = Math.max(random(), 1e-12);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gammaSample(shape: number, random: () => number): number {
  if (shape < 1) return gammaSample(shape + 1, random) * Math.pow(Math.max(random(), 1e-12), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = normalSample(random);
    const v0 = 1 + c * x;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    const u = random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(alpha: number, beta: number, random: () => number): number {
  const x = gammaSample(alpha, random);
  const y = gammaSample(beta, random);
  return x / (x + y);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0.5;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function monteCarloPair(homeWins: number, awayWins: number, seedText: string) {
  const random = mulberry32(hashSeed(seedText));
  const samples = new Array<number>(MONTE_CARLO_ITERATIONS);
  let aboveHalf = 0;
  let sum = 0;
  for (let i = 0; i < MONTE_CARLO_ITERATIONS; i++) {
    const sample = betaSample(homeWins + PRIOR_WINS, awayWins + PRIOR_LOSSES, random);
    samples[i] = sample;
    sum += sample;
    if (sample > 0.5) aboveHalf++;
  }
  samples.sort((a, b) => a - b);
  return {
    mean: sum / MONTE_CARLO_ITERATIONS,
    edgeProbability: aboveHalf / MONTE_CARLO_ITERATIONS,
    low80: quantile(samples, 0.10),
    high80: quantile(samples, 0.90)
  };
}

function record(counter: Counter | undefined): string {
  const wins = counter?.wins || 0;
  const losses = counter?.losses || 0;
  return `${wins}-${losses} (n=${wins + losses})`;
}

export async function buildLettrologyResearchFactor(
  homeTeam: Team,
  awayTeam: Team,
  gameDate: Date,
  productionWinnerIsHome: boolean
): Promise<DecisionFactor> {
  const games = await loadGames();
  const targetIso = gameDate.toISOString().slice(0, 10);
  const index = buildResearchIndex(games, targetIso);
  const homePattern = calculateTeamDailySignature(homeTeam, gameDate);
  const awayPattern = calculateTeamDailySignature(awayTeam, gameDate);

  const homeDirectWins = index.directed.get(directedKey(homePattern.signature, awayPattern.signature)) || 0;
  const awayDirectWins = index.directed.get(directedKey(awayPattern.signature, homePattern.signature)) || 0;
  const meetings = homeDirectWins + awayDirectWins;
  const mc = monteCarloPair(homeDirectWins, awayDirectWins, `${targetIso}|${homeTeam.abbr}|${awayTeam.abbr}|${homePattern.signature}|${awayPattern.signature}`);

  const homeMarginal = index.signature.get(homePattern.signature);
  const awayMarginal = index.signature.get(awayPattern.signature);
  const homeWith = index.teamWith.get(teamKey(homeTeam.abbr, homePattern.signature));
  const awayWith = index.teamWith.get(teamKey(awayTeam.abbr, awayPattern.signature));
  const homeAgainst = index.teamAgainst.get(teamKey(homeTeam.abbr, awayPattern.signature));
  const awayAgainst = index.teamAgainst.get(teamKey(awayTeam.abbr, homePattern.signature));
  const homeSpecific = index.teamMatchup.get(teamMatchupKey(homeTeam.abbr, homePattern.signature, awayPattern.signature));
  const awaySpecific = index.teamMatchup.get(teamMatchupKey(awayTeam.abbr, awayPattern.signature, homePattern.signature));

  const directEdgeIsHome = meetings > 0 && mc.mean > 0.5;
  const directEdgeIsAway = meetings > 0 && mc.mean < 0.5;
  const advantage: DecisionFactor['advantage'] = meetings === 0
    ? 'neutral'
    : (directEdgeIsHome === productionWinnerIsHome ? 'winner' : directEdgeIsAway === productionWinnerIsHome ? 'loser' : 'neutral');

  const directText = meetings
    ? `${homeTeam.name} signature leads ${homeDirectWins}-${awayDirectWins} in exact pre-cutoff meetings.`
    : 'No exact full-signature meetings exist before this cutoff; the pair posterior remains prior-centered and must not be treated as evidence.';

  return {
    title: 'Lettrology Matchup + Monte Carlo',
    description: `${homeTeam.name}: ${homePattern.signature}; ${awayTeam.name}: ${awayPattern.signature}. ${directText} Beta(8,8) uncertainty propagation over ${MONTE_CARLO_ITERATIONS.toLocaleString()} simulations gives a ${(mc.mean * 100).toFixed(1)}% posterior mean for the home signature, ${(mc.edgeProbability * 100).toFixed(1)}% probability that its latent matchup rate is above 50%, and an 80% interval of ${(mc.low80 * 100).toFixed(1)}-${(mc.high80 * 100).toFixed(1)}%. Global signature records: ${homeTeam.name} pattern ${record(homeMarginal)}; ${awayTeam.name} pattern ${record(awayMarginal)}. Team-conditioned: ${homeTeam.name} WITH its signature ${record(homeWith)}, AGAINST ${awayPattern.signature} ${record(homeAgainst)}, exact team×signature matchup ${record(homeSpecific)}; ${awayTeam.name} WITH its signature ${record(awayWith)}, AGAINST ${homePattern.signature} ${record(awayAgainst)}, exact team×signature matchup ${record(awaySpecific)}. ${index.gamesUsed} prior regular-season games were eligible. Monte Carlo is downstream uncertainty propagation only; it creates no new evidence and has zero production weight.`,
    advantage,
    edgeScore: meetings ? Math.round(Math.abs(mc.mean - 0.5) * 1000) / 10 : 0,
    category: 'numerology',
    includedInScore: false
  };
}
