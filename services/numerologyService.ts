import {
  Breakdown,
  DataFreshness,
  DecisionFactor,
  DisplayNumbers,
  HistoricalGame,
  ModelScores,
  NumerologyPatterns,
  PatternStats,
  Person,
  PersonnelSnapshot,
  PredictionResult,
  Role,
  Team
} from '../types';
import { TEAM_BY_ABBR, TEAM_REGISTRY, normalizeTeamAbbr } from '../data/teamRegistry';

const MODEL_VERSION = 'v2.0-verified-pregame';
const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const BAYES_PRIOR_GAMES = 16;
const HOME_ELO_ADVANTAGE = 55;
const ELO_K = 20;
const NUMEROLOGY_HISTORY_START = '2020-01-01';

interface NflGameRow {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameday: string;
  awayTeam: string;
  awayScore?: number;
  homeTeam: string;
  homeScore?: number;
  location: 'Home' | 'Neutral';
  awayRest?: number;
  homeRest?: number;
  awayQbName?: string;
  homeQbName?: string;
  awayCoach?: string;
  homeCoach?: string;
  stadium?: string;
}

interface LiveAthlete extends Person {
  id?: string;
  rank?: number;
}

interface LiveTeamContext {
  rosterLoaded: boolean;
  depthLoaded: boolean;
  injuriesLoaded: boolean;
  startingQb?: LiveAthlete;
  backupQb?: LiveAthlete;
  blindsideTackle?: LiveAthlete;
  kicker?: LiveAthlete;
  keyOffense: LiveAthlete[];
  keyDefense: LiveAthlete[];
  injuries: PersonnelSnapshot['injuries'];
}

interface PatternCounter {
  wins: number;
  losses: number;
}

interface PatternIndex {
  de: Map<string, PatternCounter>;
  day: Map<string, PatternCounter>;
  combo: Map<string, PatternCounter>;
}

interface TeamForm {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  avgPointDiff: number;
}

interface EloSnapshot {
  home: number;
  away: number;
  baseHomeProbability: number;
}

let gamesPromise: Promise<NflGameRow[]> | null = null;
const liveContextCache = new Map<string, Promise<LiveTeamContext>>();

export function parseTeamData(): Team[] {
  return TEAM_REGISTRY.map(team => ({
    ...team,
    birthday: new Date(team.birthday),
    coach: { ...team.coach, birthday: team.coach.birthday ? new Date(team.coach.birthday) : undefined },
    qb: { ...team.qb, birthday: team.qb.birthday ? new Date(team.qb.birthday) : undefined }
  }));
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

function reduceSequence(n: number): string {
  const sequence = [Math.abs(Math.trunc(n))];
  let current = sequence[0];
  while (current > 9) {
    current = String(current).split('').reduce((sum, digit) => sum + Number(digit), 0);
    sequence.push(current);
  }
  return sequence.join('/');
}

function reduceToSingleDigit(n: number): number {
  if (n === 0) return 9;
  let current = Math.abs(Math.trunc(n));
  while (current > 9) {
    current = String(current).split('').reduce((sum, digit) => sum + Number(digit), 0);
  }
  return current;
}

function getCycleString(name: string): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .map(char => char.repeat(getLetterValue(char)))
    .join('');
}

function calculateEssence(name: string, index: number): { e: number; raw: number } {
  let total = 0;
  const parts = String(name || '').split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const cycle = getCycleString(part);
    if (!cycle) continue;
    const safeIndex = Math.max(1, index);
    const char = cycle[(safeIndex - 1) % cycle.length];
    total += getLetterValue(char);
  }
  return { e: reduceToSingleDigit(total), raw: total };
}

function calculateAge(target: Date, birthday: Date): number {
  let age = target.getUTCFullYear() - birthday.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const birthMonth = birthday.getUTCMonth();
  if (targetMonth < birthMonth || (targetMonth === birthMonth && target.getUTCDate() < birthday.getUTCDate())) age--;
  return Math.max(1, age);
}

export function calculateAllPatterns(name: string, birthday: Date, gameDate: Date): NumerologyPatterns {
  const gameMonth = gameDate.getUTCMonth() + 1;
  const gameDay = gameDate.getUTCDate();
  const gameYear = gameDate.getUTCFullYear();
  const birthMonth = birthday.getUTCMonth() + 1;
  const birthDay = birthday.getUTCDate();
  const age = calculateAge(gameDate, birthday);
  const essence = calculateEssence(name, age);

  const pyRaw = birthDay + birthMonth + gameYear;
  const personalYear = reduceToSingleDigit(pyRaw);
  const pmRaw = personalYear + gameMonth;
  const personalMonth = reduceToSingleDigit(pmRaw);
  const pmeRaw = essence.e + personalMonth;
  const monthCombinerRaw = reduceToSingleDigit(pmeRaw) + personalMonth;
  const yearCombinerRaw = essence.e + personalYear;
  const dailyEssenceRaw = personalMonth + gameDay + essence.e;

  return {
    yrPersonalEss: reduceSequence(essence.raw),
    py: reduceSequence(pyRaw),
    pm: reduceSequence(pmRaw),
    pme: reduceSequence(pmeRaw),
    monCombiner: reduceSequence(monthCombinerRaw),
    yearCom: reduceSequence(yearCombinerRaw),
    dayNum: reduceSequence(gameDay),
    dailyEssenceFull: reduceSequence(dailyEssenceRaw)
  };
}

function toDisplayNumbers(patterns: NumerologyPatterns): DisplayNumbers {
  const tail = (value: string) => Number(value.split('/').pop() || 0);
  return {
    yearEssence: tail(patterns.yrPersonalEss),
    personalYear: tail(patterns.py),
    personalMonth: tail(patterns.pm),
    personalMonthEssence: tail(patterns.pme),
    dailyEssence: tail(patterns.dailyEssenceFull)
  };
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
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseGamesCsv(text: string): NflGameRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  const column = {
    gameId: idx('game_id'), season: idx('season'), gameType: idx('game_type'), week: idx('week'),
    gameday: idx('gameday'), awayTeam: idx('away_team'), awayScore: idx('away_score'),
    homeTeam: idx('home_team'), homeScore: idx('home_score'), location: idx('location'),
    awayRest: idx('away_rest'), homeRest: idx('home_rest'), awayQbName: idx('away_qb_name'),
    homeQbName: idx('home_qb_name'), awayCoach: idx('away_coach'), homeCoach: idx('home_coach'),
    stadium: idx('stadium')
  };

  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const get = (i: number) => i >= 0 ? (cells[i] ?? '').trim() : '';
    return {
      gameId: get(column.gameId),
      season: Number(get(column.season) || 0),
      gameType: get(column.gameType),
      week: Number(get(column.week) || 0),
      gameday: get(column.gameday),
      awayTeam: normalizeTeamAbbr(get(column.awayTeam)),
      awayScore: parseOptionalNumber(get(column.awayScore)),
      homeTeam: normalizeTeamAbbr(get(column.homeTeam)),
      homeScore: parseOptionalNumber(get(column.homeScore)),
      location: get(column.location) === 'Neutral' ? 'Neutral' : 'Home',
      awayRest: parseOptionalNumber(get(column.awayRest)),
      homeRest: parseOptionalNumber(get(column.homeRest)),
      awayQbName: get(column.awayQbName) || undefined,
      homeQbName: get(column.homeQbName) || undefined,
      awayCoach: get(column.awayCoach) || undefined,
      homeCoach: get(column.homeCoach) || undefined,
      stadium: get(column.stadium) || undefined
    } as NflGameRow;
  }).filter(game => game.gameday && game.homeTeam && game.awayTeam && game.season >= 1999);
}

async function fetchTextWithFallback(primary: string, fallback: string): Promise<string> {
  let firstError: unknown;
  try {
    const response = await fetch(primary);
    if (response.ok) return response.text();
    firstError = new Error(`${response.status} ${response.statusText}`);
  } catch (error) {
    firstError = error;
  }

  try {
    const response = await fetch(fallback);
    if (response.ok) return response.text();
    throw new Error(`${response.status} ${response.statusText}`);
  } catch (error) {
    throw new Error(`Verified NFL history unavailable. Proxy error: ${String(firstError)}. Direct error: ${String(error)}`);
  }
}

async function loadGames(): Promise<NflGameRow[]> {
  if (!gamesPromise) {
    gamesPromise = fetchTextWithFallback('/api/nfl-data?dataset=games', NFLVERSE_GAMES_URL)
      .then(parseGamesCsv)
      .then(games => {
        if (games.length < 1000) throw new Error(`NFL history feed returned only ${games.length} games`);
        return games;
      })
      .catch(error => {
        gamesPromise = null;
        throw error;
      });
  }
  return gamesPromise;
}

async function fetchJson(primary: string, fallback: string): Promise<any> {
  try {
    const response = await fetch(primary);
    if (response.ok) return response.json();
  } catch {
    // Direct source fallback below.
  }
  const response = await fetch(fallback);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function normalizeName(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseBirthDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function collectRosterAthletes(data: any): LiveAthlete[] {
  const athletes: LiveAthlete[] = [];
  const groups = Array.isArray(data?.athletes) ? data.athletes : [];
  for (const group of groups) {
    const items = Array.isArray(group?.items) ? group.items : [];
    for (const item of items) {
      const name = item?.fullName || item?.displayName || item?.name;
      if (!name) continue;
      athletes.push({
        id: String(item?.id ?? item?.uid ?? ''),
        name,
        birthday: parseBirthDate(item?.dateOfBirth || item?.birthDate),
        position: item?.position?.abbreviation || group?.position || group?.name,
        status: item?.status?.name || item?.status?.type || item?.status
      });
    }
  }
  return athletes;
}

function collectDepthAthletes(data: any): LiveAthlete[] {
  const athletes: LiveAthlete[] = [];
  const depthCharts = Array.isArray(data?.depthCharts) ? data.depthCharts : [];
  for (const chart of depthCharts) {
    const positions = chart?.positions && typeof chart.positions === 'object' ? Object.values(chart.positions) : [];
    for (const positionEntry of positions as any[]) {
      const position = positionEntry?.position?.abbreviation || positionEntry?.position?.name || '';
      const entries = Array.isArray(positionEntry?.athletes) ? positionEntry.athletes : [];
      for (const entry of entries) {
        const athlete = entry?.athlete || entry;
        const name = athlete?.displayName || athlete?.fullName || athlete?.name;
        if (!name) continue;
        athletes.push({
          id: String(athlete?.id ?? athlete?.uid ?? ''),
          name,
          position,
          rank: Number(entry?.rank ?? entry?.depth ?? 99)
        });
      }
    }
  }
  return athletes;
}

function injuryStatusFactor(status: string | undefined): number {
  const s = String(status || '').toLowerCase();
  if (s.includes('out') || s.includes('injured reserve')) return 1;
  if (s.includes('doubt')) return 0.8;
  if (s.includes('question')) return 0.35;
  if (s.includes('probable')) return 0.1;
  return 0.15;
}

function injuryPositionWeight(position: string | undefined): number {
  const p = String(position || '').toUpperCase();
  if (p === 'QB') return 10;
  if (['LT', 'RT', 'OT', 'T'].includes(p)) return 4;
  if (['DE', 'EDGE', 'OLB'].includes(p)) return 3;
  if (['CB', 'S', 'DB'].includes(p)) return 2.4;
  if (['WR', 'TE'].includes(p)) return 2.2;
  if (['DT', 'NT', 'LB', 'ILB'].includes(p)) return 1.8;
  if (['RB', 'C', 'G', 'OG'].includes(p)) return 1.5;
  if (p === 'K') return 0.8;
  return 1;
}

function collectInjuries(data: any): NonNullable<PersonnelSnapshot['injuries']> {
  const out: NonNullable<PersonnelSnapshot['injuries']> = [];
  const seen = new Set<string>();

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    const athlete = node.athlete || node.player;
    const name = athlete?.displayName || athlete?.fullName || athlete?.name || node?.displayName;
    const status = node?.status?.name || node?.status?.type?.name || node?.status || node?.designation;
    const injury = node?.type?.description || node?.details?.type || node?.injury?.description || node?.description;
    const position = athlete?.position?.abbreviation || node?.position?.abbreviation || node?.position;

    if (name && (status || injury)) {
      const key = `${normalizeName(name)}|${String(status || '')}|${String(injury || '')}`;
      if (!seen.has(key)) {
        seen.add(key);
        const impact = injuryStatusFactor(String(status || '')) * injuryPositionWeight(String(position || ''));
        out.push({ name, position: String(position || ''), status: String(status || ''), injury: String(injury || ''), impact });
      }
    }

    if (Array.isArray(node)) {
      node.forEach(walk);
    } else {
      Object.values(node).forEach(value => {
        if (value && typeof value === 'object') walk(value);
      });
    }
  };

  walk(data?.injuries ?? data);
  return out.sort((a, b) => b.impact - a.impact).slice(0, 25);
}

function mergeDepthWithRoster(depth: LiveAthlete[], roster: LiveAthlete[]): LiveAthlete[] {
  const byId = new Map(roster.filter(p => p.id).map(p => [p.id!, p]));
  const byName = new Map(roster.map(p => [normalizeName(p.name), p]));
  return depth.map(player => {
    const match = (player.id && byId.get(player.id)) || byName.get(normalizeName(player.name));
    return { ...match, ...player, birthday: match?.birthday, status: match?.status };
  });
}

function pickRankOne(players: LiveAthlete[], positions: string[]): LiveAthlete | undefined {
  const wanted = new Set(positions.map(v => v.toUpperCase()));
  return players
    .filter(player => wanted.has(String(player.position || '').toUpperCase()))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
}

async function loadLiveTeamContext(teamAbbr: string): Promise<LiveTeamContext> {
  const team = normalizeTeamAbbr(teamAbbr);
  if (liveContextCache.has(team)) return liveContextCache.get(team)!;

  const promise = (async () => {
    const base = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
    const espnIdMap: Record<string, string> = {
      ARI: '22', ATL: '1', BAL: '33', BUF: '2', CAR: '29', CHI: '3', CIN: '4', CLE: '5', DAL: '6', DEN: '7', DET: '8', GB: '9',
      HOU: '34', IND: '11', JAX: '30', KC: '12', LV: '13', LAC: '24', LA: '14', MIA: '15', MIN: '16', NE: '17', NO: '18', NYG: '19',
      NYJ: '20', PHI: '21', PIT: '23', SF: '25', SEA: '26', TB: '27', TEN: '10', WAS: '28'
    };
    const id = espnIdMap[team];
    if (!id) throw new Error(`No ESPN team id for ${team}`);

    const [rosterResult, depthResult, injuryResult] = await Promise.allSettled([
      fetchJson(`/api/nfl-data?dataset=roster&team=${team}`, `${base}/teams/${id}/roster`),
      fetchJson(`/api/nfl-data?dataset=depth&team=${team}`, `${base}/teams/${id}/depthcharts`),
      fetchJson(`/api/nfl-data?dataset=injuries&team=${team}`, `${base}/teams/${id}/injuries`)
    ]);

    const roster = rosterResult.status === 'fulfilled' ? collectRosterAthletes(rosterResult.value) : [];
    const rawDepth = depthResult.status === 'fulfilled' ? collectDepthAthletes(depthResult.value) : [];
    const depth = mergeDepthWithRoster(rawDepth, roster);
    const injuries = injuryResult.status === 'fulfilled' ? collectInjuries(injuryResult.value) : [];

    const qbPlayers = depth.filter(p => String(p.position || '').toUpperCase() === 'QB').sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    const startingQb = qbPlayers[0] || roster.find(p => String(p.position || '').toUpperCase() === 'QB');
    const backupQb = qbPlayers[1] || roster.filter(p => String(p.position || '').toUpperCase() === 'QB').find(p => normalizeName(p.name) !== normalizeName(startingQb?.name || ''));
    const blindsideTackle = pickRankOne(depth, ['LT']) || pickRankOne(depth, ['T', 'OT']);
    const kicker = pickRankOne(depth, ['K']) || roster.find(p => String(p.position || '').toUpperCase() === 'K');

    const keyOffensePositions = ['RB', 'WR', 'TE'];
    const keyDefensePositions = ['DE', 'EDGE', 'OLB', 'LB', 'CB', 'S', 'DT'];
    const keyOffense = keyOffensePositions.map(position => pickRankOne(depth, [position])).filter(Boolean) as LiveAthlete[];
    const keyDefense = keyDefensePositions.map(position => pickRankOne(depth, [position])).filter(Boolean).slice(0, 4) as LiveAthlete[];

    return {
      rosterLoaded: rosterResult.status === 'fulfilled' && roster.length > 0,
      depthLoaded: depthResult.status === 'fulfilled' && depth.length > 0,
      injuriesLoaded: injuryResult.status === 'fulfilled',
      startingQb,
      backupQb,
      blindsideTackle,
      kicker,
      keyOffense,
      keyDefense,
      injuries
    };
  })();

  liveContextCache.set(team, promise);
  promise.catch(() => liveContextCache.delete(team));
  return promise;
}

function completed(game: NflGameRow): boolean {
  return Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore);
}

function beforeDate(game: NflGameRow, targetIso: string): boolean {
  return game.gameday < targetIso;
}

function exactScheduledGame(games: NflGameRow[], targetIso: string, home: string, away: string): NflGameRow | undefined {
  return games.find(game => game.gameday === targetIso && game.homeTeam === home && game.awayTeam === away);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability: number): number {
  const p = clamp(probability, 0.01, 0.99);
  return Math.log(p / (1 - p));
}

function expectedHomeProbability(homeRating: number, awayRating: number, neutral: boolean): number {
  const homeAdjusted = homeRating + (neutral ? 0 : HOME_ELO_ADVANTAGE);
  return 1 / (1 + Math.pow(10, (awayRating - homeAdjusted) / 400));
}

function buildEloSnapshot(games: NflGameRow[], targetIso: string, home: string, away: string, neutral: boolean): EloSnapshot {
  const relevant = games.filter(game => completed(game) && beforeDate(game, targetIso)).sort((a, b) => a.gameday.localeCompare(b.gameday));
  const ratings = new Map<string, number>();
  let priorSeason = 0;

  const rating = (team: string) => ratings.get(team) ?? 1500;
  const setRating = (team: string, value: number) => ratings.set(team, value);

  for (const game of relevant) {
    if (priorSeason && game.season !== priorSeason) {
      for (const [team, value] of ratings.entries()) setRating(team, 1500 + (value - 1500) * 0.67);
    }
    priorSeason = game.season;

    const homeRating = rating(game.homeTeam);
    const awayRating = rating(game.awayTeam);
    const expected = expectedHomeProbability(homeRating, awayRating, game.location === 'Neutral');
    const homeScore = game.homeScore!;
    const awayScore = game.awayScore!;
    const actual = homeScore === awayScore ? 0.5 : homeScore > awayScore ? 1 : 0;
    const margin = Math.abs(homeScore - awayScore);
    const movMultiplier = clamp(Math.log(margin + 1) / Math.log(8), 0.75, 1.65);
    const change = ELO_K * movMultiplier * (actual - expected);
    setRating(game.homeTeam, homeRating + change);
    setRating(game.awayTeam, awayRating - change);
  }

  const homeRating = rating(home);
  const awayRating = rating(away);
  return {
    home: homeRating,
    away: awayRating,
    baseHomeProbability: expectedHomeProbability(homeRating, awayRating, neutral)
  };
}

function getTeamForm(games: NflGameRow[], team: string, targetIso: string, limit = 8, season?: number, venue?: 'home' | 'away'): TeamForm {
  const selected = games
    .filter(game => completed(game) && beforeDate(game, targetIso) && (game.homeTeam === team || game.awayTeam === team))
    .filter(game => season == null || game.season === season)
    .filter(game => venue == null || (venue === 'home' ? game.homeTeam === team && game.location !== 'Neutral' : game.awayTeam === team && game.location !== 'Neutral'))
    .sort((a, b) => b.gameday.localeCompare(a.gameday))
    .slice(0, limit);

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pointDiff = 0;
  selected.forEach((game, index) => {
    const isHome = game.homeTeam === team;
    const scored = isHome ? game.homeScore! : game.awayScore!;
    const allowed = isHome ? game.awayScore! : game.homeScore!;
    const recencyWeight = Math.pow(0.9, index);
    pointDiff += (scored - allowed) * recencyWeight;
    if (scored > allowed) wins++;
    else if (scored < allowed) losses++;
    else ties++;
  });

  const gamesPlayed = selected.length;
  const weightedDenominator = selected.reduce((sum, _game, index) => sum + Math.pow(0.9, index), 0) || 1;
  return {
    games: gamesPlayed,
    wins,
    losses,
    ties,
    winPct: gamesPlayed ? (wins + ties * 0.5) / gamesPlayed : 0.5,
    avgPointDiff: gamesPlayed ? pointDiff / weightedDenominator : 0
  };
}

function getRestDays(games: NflGameRow[], team: string, targetIso: string): number | undefined {
  const prior = games
    .filter(game => completed(game) && beforeDate(game, targetIso) && (game.homeTeam === team || game.awayTeam === team))
    .sort((a, b) => b.gameday.localeCompare(a.gameday))[0];
  if (!prior) return undefined;
  const ms = new Date(`${targetIso}T12:00:00Z`).getTime() - new Date(`${prior.gameday}T12:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

function buildPatternIndex(games: NflGameRow[], targetIso: string): PatternIndex {
  const index: PatternIndex = { de: new Map(), day: new Map(), combo: new Map() };
  const add = (map: Map<string, PatternCounter>, key: string, won: boolean) => {
    const value = map.get(key) || { wins: 0, losses: 0 };
    won ? value.wins++ : value.losses++;
    map.set(key, value);
  };

  const history = games.filter(game => completed(game) && beforeDate(game, targetIso) && game.gameday >= NUMEROLOGY_HISTORY_START);
  for (const game of history) {
    if (game.homeScore === game.awayScore) continue;
    const gameDate = new Date(`${game.gameday}T12:00:00Z`);
    for (const [abbr, score, oppScore] of [[game.homeTeam, game.homeScore!, game.awayScore!], [game.awayTeam, game.awayScore!, game.homeScore!]] as const) {
      const team = TEAM_BY_ABBR.get(abbr);
      if (!team) continue;
      const patterns = calculateAllPatterns(team.name, team.birthday, gameDate);
      const won = score > oppScore;
      add(index.de, patterns.dailyEssenceFull, won);
      add(index.day, patterns.dayNum, won);
      add(index.combo, `${patterns.dailyEssenceFull}|${patterns.dayNum}`, won);
    }
  }
  return index;
}

function statsFromCounter(pattern: string, counter?: PatternCounter): PatternStats {
  const wins = counter?.wins || 0;
  const losses = counter?.losses || 0;
  const total = wins + losses;
  const rawPct = total ? wins / total : 0.5;
  const smoothed = (wins + BAYES_PRIOR_GAMES * 0.5) / (total + BAYES_PRIOR_GAMES);
  return {
    pattern,
    wins,
    losses,
    total,
    winPct: Math.round(rawPct * 1000) / 10,
    smoothedWinPct: Math.round(smoothed * 1000) / 10
  };
}

function smoothedRate(stats: PatternStats | undefined): number {
  if (!stats) return 0.5;
  return (stats.smoothedWinPct ?? stats.winPct ?? 50) / 100;
}

function buildBreakdown(role: Role, person: Person | Team | undefined, gameDate: Date, patternIndex: PatternIndex, includedInScore: boolean, source: string): Breakdown | undefined {
  if (!person?.name || !person.birthday) return undefined;
  const patterns = calculateAllPatterns(person.name, person.birthday, gameDate);
  return {
    role,
    name: person.name,
    patterns,
    deStats: statsFromCounter(patterns.dailyEssenceFull, patternIndex.de.get(patterns.dailyEssenceFull)),
    includedInScore,
    source
  };
}

function getCoachPerson(team: Team, scheduledName?: string): Person {
  if (!scheduledName || normalizeName(scheduledName) === normalizeName(team.coach.name)) return team.coach;
  const registryMatch = TEAM_REGISTRY.map(t => t.coach).find(coach => normalizeName(coach.name) === normalizeName(scheduledName));
  return registryMatch ? { ...registryMatch, source: 'schedule + coach DOB registry' } : { name: scheduledName, source: 'schedule; DOB unavailable' };
}

function personWithFallback(live: Person | undefined, fallback: Person, scheduleName?: string): Person {
  if (live?.name) return { ...live, source: 'ESPN live roster/depth chart' };
  if (scheduleName) {
    if (normalizeName(scheduleName) === normalizeName(fallback.name)) return { ...fallback, source: 'NFLverse game row + fallback DOB registry' };
    return { name: scheduleName, source: 'NFLverse game row; DOB unavailable' };
  }
  return { ...fallback, source: '2026 fallback registry' };
}

function isLiveDate(gameDate: Date): boolean {
  const now = new Date();
  const diffDays = (gameDate.getTime() - now.getTime()) / 86400000;
  return diffDays >= -3 && diffDays <= 120;
}

function getInjuryImpact(injuries: PersonnelSnapshot['injuries']): number {
  return clamp((injuries || []).reduce((sum, injury) => sum + injury.impact, 0), 0, 18);
}

function buildPersonnelSnapshot(team: Team, coach: Person, qb: Person, live: LiveTeamContext | undefined): PersonnelSnapshot {
  const sourceStatus: PersonnelSnapshot['sourceStatus'] = live?.depthLoaded && live?.rosterLoaded ? 'live' : live?.rosterLoaded || live?.depthLoaded ? 'partial' : 'fallback';
  return {
    team: team.name,
    teamAbbr: team.abbr,
    coach,
    startingQb: qb,
    backupQb: live?.backupQb,
    blindsideTackle: live?.blindsideTackle,
    kicker: live?.kicker,
    keyOffense: live?.keyOffense || [],
    keyDefense: live?.keyDefense || [],
    injuries: live?.injuries || [],
    sourceStatus
  };
}

function computeHistoricalSeries(games: NflGameRow[], targetIso: string, home: Team, away: Team) {
  const sameVenue = games
    .filter(game => completed(game) && beforeDate(game, targetIso) && game.location !== 'Neutral' && game.homeTeam === home.abbr && game.awayTeam === away.abbr)
    .sort((a, b) => b.gameday.localeCompare(a.gameday));

  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;
  let weightedHome = 2;
  let weightedAway = 2;
  const targetMs = new Date(`${targetIso}T12:00:00Z`).getTime();
  let lastAwayWinDate: string | undefined;

  for (const game of sameVenue) {
    const ageYears = Math.max(0, (targetMs - new Date(`${game.gameday}T12:00:00Z`).getTime()) / 31557600000);
    const weight = Math.pow(0.5, ageYears / 5);
    if (game.homeScore! > game.awayScore!) {
      homeWins++;
      weightedHome += weight;
    } else if (game.awayScore! > game.homeScore!) {
      awayWins++;
      weightedAway += weight;
      if (!lastAwayWinDate) lastAwayWinDate = game.gameday;
    } else {
      ties++;
      weightedHome += weight * 0.5;
      weightedAway += weight * 0.5;
    }
  }

  const weightedPct = weightedHome / (weightedHome + weightedAway);
  const reliability = clamp(sameVenue.length / 8, 0, 1);
  const adjustment = clamp((weightedPct - 0.5) * 0.30 * reliability, -0.12, 0.12);
  const yearsSinceRoadWin = lastAwayWinDate ? Math.floor((targetMs - new Date(`${lastAwayWinDate}T12:00:00Z`).getTime()) / 31557600000) : undefined;
  const record = `${home.name} ${homeWins}-${awayWins}${ties ? `-${ties}` : ''} at home vs ${away.name} in available NFLverse history`;

  return {
    adjustment,
    sameVenue,
    info: {
      venueStreak: sameVenue.length ? record : 'No same-venue meetings in available history',
      allTimeRecord: record,
      streakYears: yearsSinceRoadWin,
      lastRoadWinDate: lastAwayWinDate,
      meetings: sameVenue.length,
      homeWins,
      awayWins,
      ties,
      recencyWeightedHomePct: Math.round(weightedPct * 1000) / 10,
      narrativeNotes: sameVenue.length
        ? `The venue series is automatically recency-weighted with a five-year half-life and Bayesian shrinkage. Old or tiny samples cannot dominate current-team strength.`
        : `No direct venue history was available, so no head-to-head venue adjustment was applied.`
    }
  };
}

function toHistoricalGame(game: NflGameRow, patternIndex: PatternIndex): HistoricalGame | undefined {
  if (!completed(game)) return undefined;
  const home = TEAM_BY_ABBR.get(game.homeTeam);
  const away = TEAM_BY_ABBR.get(game.awayTeam);
  if (!home || !away) return undefined;
  const date = new Date(`${game.gameday}T12:00:00Z`);
  const hp = calculateAllPatterns(home.name, home.birthday, date);
  const ap = calculateAllPatterns(away.name, away.birthday, date);
  const tie = game.homeScore === game.awayScore;
  const homeWon = game.homeScore! > game.awayScore!;
  const winner = tie ? home : homeWon ? home : away;
  const loser = tie ? away : homeWon ? away : home;
  const wp = tie ? hp : homeWon ? hp : ap;
  const lp = tie ? ap : homeWon ? ap : hp;
  void patternIndex;
  return {
    date: game.gameday,
    season: game.season,
    week: game.week,
    homeTeam: home.name,
    homeScore: game.homeScore!,
    awayTeam: away.name,
    awayScore: game.awayScore!,
    winnerTeam: tie ? 'Tie' : winner.name,
    loserTeam: tie ? 'Tie' : loser.name,
    winnerHomeAway: tie ? 'Tie' : homeWon ? 'Home' : 'Away',
    homeDE: hp.dailyEssenceFull,
    homeDay: hp.dayNum,
    awayDE: ap.dailyEssenceFull,
    awayDay: ap.dayNum,
    winnerDE: wp.dailyEssenceFull,
    winnerDay: wp.dayNum,
    loserDE: lp.dailyEssenceFull,
    loserDay: lp.dayNum,
    location: game.location,
    stadium: game.stadium
  };
}

function factorAdvantageFromHomeEdge(edge: number, isWinnerHome: boolean): DecisionFactor['advantage'] {
  if (Math.abs(edge) < 0.002) return 'neutral';
  const favorsHome = edge > 0;
  return favorsHome === isWinnerHome ? 'winner' : 'loser';
}

function addDecisionFactor(
  factors: DecisionFactor[],
  title: string,
  description: string,
  homeEdge: number,
  isWinnerHome: boolean,
  category: DecisionFactor['category'],
  includedInScore = true
) {
  factors.push({
    title,
    description,
    advantage: factorAdvantageFromHomeEdge(homeEdge, isWinnerHome),
    edgeScore: Math.round(Math.abs(homeEdge) * 1000) / 10,
    category,
    includedInScore
  });
}

export interface PredictionOptions {
  neutralSite?: boolean;
}

export async function predictWinner(
  homeTeam: Team,
  awayTeam: Team,
  gameDate: Date,
  _isTeamAHome = true,
  options: PredictionOptions = {}
): Promise<PredictionResult> {
  const games = await loadGames();
  const targetIso = gameDate.toISOString().slice(0, 10);
  const scheduled = exactScheduledGame(games, targetIso, homeTeam.abbr, awayTeam.abbr);
  const neutral = scheduled?.location === 'Neutral' || Boolean(options.neutralSite);
  const history = games.filter(game => completed(game) && beforeDate(game, targetIso));
  if (history.length < 500) throw new Error('Not enough pregame NFL history is available for a reliable calculation.');

  let homeLive: LiveTeamContext | undefined;
  let awayLive: LiveTeamContext | undefined;
  const warnings: string[] = [];
  if (isLiveDate(gameDate)) {
    const [homeLiveResult, awayLiveResult] = await Promise.allSettled([
      loadLiveTeamContext(homeTeam.abbr),
      loadLiveTeamContext(awayTeam.abbr)
    ]);
    if (homeLiveResult.status === 'fulfilled') homeLive = homeLiveResult.value;
    else warnings.push(`Live ${homeTeam.name} depth-chart/injury data could not be loaded; verified schedule/fallback personnel were used.`);
    if (awayLiveResult.status === 'fulfilled') awayLive = awayLiveResult.value;
    else warnings.push(`Live ${awayTeam.name} depth-chart/injury data could not be loaded; verified schedule/fallback personnel were used.`);
  }

  const homeCoach = getCoachPerson(homeTeam, scheduled?.homeCoach);
  const awayCoach = getCoachPerson(awayTeam, scheduled?.awayCoach);
  const homeQb = personWithFallback(homeLive?.startingQb, homeTeam.qb, scheduled?.homeQbName);
  const awayQb = personWithFallback(awayLive?.startingQb, awayTeam.qb, scheduled?.awayQbName);
  const homePersonnel = buildPersonnelSnapshot(homeTeam, homeCoach, homeQb, homeLive);
  const awayPersonnel = buildPersonnelSnapshot(awayTeam, awayCoach, awayQb, awayLive);

  const patternIndex = buildPatternIndex(games, targetIso);
  const homeTeamPatterns = calculateAllPatterns(homeTeam.name, homeTeam.birthday, gameDate);
  const awayTeamPatterns = calculateAllPatterns(awayTeam.name, awayTeam.birthday, gameDate);
  const homeTeamDEStats = statsFromCounter(homeTeamPatterns.dailyEssenceFull, patternIndex.de.get(homeTeamPatterns.dailyEssenceFull));
  const awayTeamDEStats = statsFromCounter(awayTeamPatterns.dailyEssenceFull, patternIndex.de.get(awayTeamPatterns.dailyEssenceFull));
  const homeDayStats = statsFromCounter(homeTeamPatterns.dayNum, patternIndex.day.get(homeTeamPatterns.dayNum));
  const awayDayStats = statsFromCounter(awayTeamPatterns.dayNum, patternIndex.day.get(awayTeamPatterns.dayNum));
  const homeComboStats = statsFromCounter(`${homeTeamPatterns.dailyEssenceFull}|${homeTeamPatterns.dayNum}`, patternIndex.combo.get(`${homeTeamPatterns.dailyEssenceFull}|${homeTeamPatterns.dayNum}`));
  const awayComboStats = statsFromCounter(`${awayTeamPatterns.dailyEssenceFull}|${awayTeamPatterns.dayNum}`, patternIndex.combo.get(`${awayTeamPatterns.dailyEssenceFull}|${awayTeamPatterns.dayNum}`));

  const homeBreakdown = [
    buildBreakdown('Team', homeTeam, gameDate, patternIndex, true, 'canonical franchise data'),
    buildBreakdown('Coach', homeCoach, gameDate, patternIndex, Boolean(homeCoach.birthday), homeCoach.source || 'coach registry'),
    buildBreakdown('Qb', homeQb, gameDate, patternIndex, Boolean(homeQb.birthday), homeQb.source || 'QB data'),
    buildBreakdown('Backup Qb', homeLive?.backupQb, gameDate, patternIndex, false, 'ESPN live depth chart'),
    buildBreakdown('Blindside Tackle', homeLive?.blindsideTackle, gameDate, patternIndex, false, 'ESPN live depth chart'),
    buildBreakdown('Kicker', homeLive?.kicker, gameDate, patternIndex, false, 'ESPN live depth chart')
  ].filter(Boolean) as Breakdown[];

  const awayBreakdown = [
    buildBreakdown('Team', awayTeam, gameDate, patternIndex, true, 'canonical franchise data'),
    buildBreakdown('Coach', awayCoach, gameDate, patternIndex, Boolean(awayCoach.birthday), awayCoach.source || 'coach registry'),
    buildBreakdown('Qb', awayQb, gameDate, patternIndex, Boolean(awayQb.birthday), awayQb.source || 'QB data'),
    buildBreakdown('Backup Qb', awayLive?.backupQb, gameDate, patternIndex, false, 'ESPN live depth chart'),
    buildBreakdown('Blindside Tackle', awayLive?.blindsideTackle, gameDate, patternIndex, false, 'ESPN live depth chart'),
    buildBreakdown('Kicker', awayLive?.kicker, gameDate, patternIndex, false, 'ESPN live depth chart')
  ].filter(Boolean) as Breakdown[];

  const elo = buildEloSnapshot(games, targetIso, homeTeam.abbr, awayTeam.abbr, neutral);
  let homeLogit = logit(elo.baseHomeProbability);

  const recentHome = getTeamForm(games, homeTeam.abbr, targetIso, 8);
  const recentAway = getTeamForm(games, awayTeam.abbr, targetIso, 8);
  const currentSeason = Number(targetIso.slice(0, 4));
  const seasonHome = getTeamForm(games, homeTeam.abbr, targetIso, 30, currentSeason);
  const seasonAway = getTeamForm(games, awayTeam.abbr, targetIso, 30, currentSeason);
  const homeVenue = getTeamForm(games, homeTeam.abbr, targetIso, 24, undefined, 'home');
  const awayVenue = getTeamForm(games, awayTeam.abbr, targetIso, 24, undefined, 'away');

  const recentEdge = clamp(((recentHome.winPct - recentAway.winPct) * 0.22) + ((recentHome.avgPointDiff - recentAway.avgPointDiff) / 100), -0.24, 0.24);
  const seasonEdge = seasonHome.games + seasonAway.games >= 4
    ? clamp(((seasonHome.winPct - seasonAway.winPct) * 0.14) + ((seasonHome.avgPointDiff - seasonAway.avgPointDiff) / 140), -0.16, 0.16)
    : 0;
  const footballEdge = recentEdge + seasonEdge;
  homeLogit += footballEdge;

  const venueEdge = neutral ? 0 : clamp(((homeVenue.winPct - 0.55) - (awayVenue.winPct - 0.45)) * 0.24, -0.12, 0.12);
  homeLogit += venueEdge;

  const series = computeHistoricalSeries(games, targetIso, homeTeam, awayTeam);
  const h2hEdge = neutral ? 0 : series.adjustment;
  homeLogit += h2hEdge;

  const homeRest = scheduled?.homeRest ?? getRestDays(games, homeTeam.abbr, targetIso);
  const awayRest = scheduled?.awayRest ?? getRestDays(games, awayTeam.abbr, targetIso);
  const restEdge = homeRest != null && awayRest != null ? clamp((homeRest - awayRest) * 0.015, -0.105, 0.105) : 0;
  homeLogit += restEdge;

  const homeInjuryImpact = isLiveDate(gameDate) ? getInjuryImpact(homePersonnel.injuries) : 0;
  const awayInjuryImpact = isLiveDate(gameDate) ? getInjuryImpact(awayPersonnel.injuries) : 0;
  const personnelEdge = clamp((awayInjuryImpact - homeInjuryImpact) * 0.025, -0.35, 0.35);
  homeLogit += personnelEdge;

  const homeCoachBreakdown = homeBreakdown.find(b => b.role === 'Coach');
  const awayCoachBreakdown = awayBreakdown.find(b => b.role === 'Coach');
  const homeQbBreakdown = homeBreakdown.find(b => b.role === 'Qb');
  const awayQbBreakdown = awayBreakdown.find(b => b.role === 'Qb');

  const teamDEEdge = (smoothedRate(homeTeamDEStats) - smoothedRate(awayTeamDEStats)) * 0.65;
  const dayEdge = (smoothedRate(homeDayStats) - smoothedRate(awayDayStats)) * 0.22;
  const comboEdge = (smoothedRate(homeComboStats) - smoothedRate(awayComboStats)) * 0.18;
  const coachEdge = (smoothedRate(homeCoachBreakdown?.deStats) - smoothedRate(awayCoachBreakdown?.deStats)) * 0.28;
  const qbEdge = (smoothedRate(homeQbBreakdown?.deStats) - smoothedRate(awayQbBreakdown?.deStats)) * 0.36;
  const numerologyEdge = clamp(teamDEEdge + dayEdge + comboEdge + coachEdge + qbEdge, -0.22, 0.22);
  homeLogit += numerologyEdge;

  const finalHomeProbability = logistic(homeLogit);
  const isHomeWinner = finalHomeProbability >= 0.5;
  const winner = isHomeWinner ? homeTeam : awayTeam;
  const loser = isHomeWinner ? awayTeam : homeTeam;
  const winnerBreakdown = isHomeWinner ? homeBreakdown : awayBreakdown;
  const loserBreakdown = isHomeWinner ? awayBreakdown : homeBreakdown;
  const winnerPatterns = isHomeWinner ? homeTeamPatterns : awayTeamPatterns;
  const loserPatterns = isHomeWinner ? awayTeamPatterns : homeTeamPatterns;
  const winnerDEStats = isHomeWinner ? homeTeamDEStats : awayTeamDEStats;
  const loserDEStats = isHomeWinner ? awayTeamDEStats : homeTeamDEStats;
  const winnerDayStats = isHomeWinner ? homeDayStats : awayDayStats;
  const loserDayStats = isHomeWinner ? awayDayStats : homeDayStats;
  const winnerComboStats = isHomeWinner ? homeComboStats : awayComboStats;
  const loserComboStats = isHomeWinner ? awayComboStats : homeComboStats;
  const winnerCoach = winnerBreakdown.find(b => b.role === 'Coach');
  const loserCoach = loserBreakdown.find(b => b.role === 'Coach');
  const winnerQb = winnerBreakdown.find(b => b.role === 'Qb');
  const loserQb = loserBreakdown.find(b => b.role === 'Qb');

  const decisionFactors: DecisionFactor[] = [];
  addDecisionFactor(decisionFactors, 'Pregame Elo Team Strength', `${homeTeam.name}: ${Math.round(elo.home)} Elo vs ${awayTeam.name}: ${Math.round(elo.away)} Elo. Only completed games before ${targetIso} were used.`, logit(elo.baseHomeProbability), isHomeWinner, 'football');
  addDecisionFactor(decisionFactors, 'Recent & Current-Season Form', `${homeTeam.name}: ${recentHome.wins}-${recentHome.losses}-${recentHome.ties}, ${recentHome.avgPointDiff >= 0 ? '+' : ''}${recentHome.avgPointDiff.toFixed(1)} recent point differential/game; ${awayTeam.name}: ${recentAway.wins}-${recentAway.losses}-${recentAway.ties}, ${recentAway.avgPointDiff >= 0 ? '+' : ''}${recentAway.avgPointDiff.toFixed(1)}. Current-season records are separately shrunk and only used when enough games exist.`, footballEdge, isHomeWinner, 'football');
  addDecisionFactor(decisionFactors, 'Home / Away Performance', neutral ? 'Neutral site: no home/road venue refinement applied.' : `${homeTeam.name} recent home win rate ${(homeVenue.winPct * 100).toFixed(1)}% across ${homeVenue.games} games; ${awayTeam.name} recent road win rate ${(awayVenue.winPct * 100).toFixed(1)}% across ${awayVenue.games} games. The adjustment is capped and shrunk.`, venueEdge, isHomeWinner, 'venue');
  addDecisionFactor(decisionFactors, 'Head-to-Head at This Home Venue', series.info.narrativeNotes || '', h2hEdge, isHomeWinner, 'venue');
  addDecisionFactor(decisionFactors, 'Rest Differential', homeRest != null && awayRest != null ? `${homeTeam.name}: ${homeRest} days rest; ${awayTeam.name}: ${awayRest} days rest.` : 'Rest data was incomplete, so no rest adjustment was applied.', restEdge, isHomeWinner, 'football');
  addDecisionFactor(decisionFactors, 'Live Injury / Availability Impact', isLiveDate(gameDate) ? `${homeTeam.name} weighted injury impact ${homeInjuryImpact.toFixed(1)} vs ${awayTeam.name} ${awayInjuryImpact.toFixed(1)}. QB and offensive tackle absences carry more weight than low-leverage positions; the total adjustment is capped.` : 'Historical prediction date: current injuries are deliberately not backfilled to avoid time leakage.', personnelEdge, isHomeWinner, 'personnel');
  addDecisionFactor(decisionFactors, 'Verified Numerology Layer', `Team DE, game-day number, DE/day combination, coach DE and starting-QB DE use Bayesian-smoothed rates derived only from verified games before ${targetIso}. Owner, backup QB, tackle, kicker and exact/subset archives are displayed only when available and do not affect the score until holdout validation proves value.`, numerologyEdge, isHomeWinner, 'numerology');

  const universalDay = reduceToSingleDigit(gameDate.getUTCDate() + (gameDate.getUTCMonth() + 1) + gameDate.getUTCFullYear());
  const isChaosDay = [4, 7].includes(universalDay);
  if (isChaosDay) warnings.push('A legacy 4/7 volatility marker is shown for research only. It is not included in the prediction score because it has not demonstrated independent holdout value.');

  const precedentGames = series.sameVenue.slice(0, 10).map(game => toHistoricalGame(game, patternIndex)).filter(Boolean) as HistoricalGame[];
  const probability = isHomeWinner ? finalHomeProbability : 1 - finalHomeProbability;
  const modelScores: ModelScores = {
    baseHomeProbability: Math.round(elo.baseHomeProbability * 1000) / 10,
    finalHomeProbability: Math.round(finalHomeProbability * 1000) / 10,
    eloHome: Math.round(elo.home),
    eloAway: Math.round(elo.away),
    footballLogitAdjustment: footballEdge,
    venueLogitAdjustment: venueEdge,
    personnelLogitAdjustment: personnelEdge,
    numerologyLogitAdjustment: numerologyEdge,
    restLogitAdjustment: restEdge,
    h2hLogitAdjustment: h2hEdge
  };

  const livePersonnelLoaded = Boolean(homeLive?.depthLoaded && awayLive?.depthLoaded);
  const injuryDataLoaded = Boolean(homeLive?.injuriesLoaded && awayLive?.injuriesLoaded);
  const freshness: DataFreshness = {
    historicalSource: 'nflverse/nfldata games.csv',
    livePersonnelSource: 'ESPN public NFL roster/depth-chart/injury endpoints',
    historicalGamesUsed: history.length,
    cutoffDate: targetIso,
    leakageGuard: true,
    livePersonnelLoaded,
    injuryDataLoaded,
    scheduleMatched: Boolean(scheduled),
    neutralSite: neutral,
    notes: [
      'All historical team-strength, recent-form, venue, head-to-head and numerology rates exclude the selected game date and all later games.',
      'Owner numerology and the old exact/subset archive are excluded from scoring pending independent validation.',
      isLiveDate(gameDate) ? 'Live personnel is used only for current/future prediction windows.' : 'Current live personnel/injury data is not applied to older historical dates.'
    ]
  };

  const reasoningParts = [
    `${winner.name} projects at ${(probability * 100).toFixed(1)}% in ${MODEL_VERSION}.`,
    `The football baseline starts from leakage-safe Elo (${Math.round(elo.home)} ${homeTeam.name} vs ${Math.round(elo.away)} ${awayTeam.name})`,
    `then applies capped recent-form, venue/H2H, rest and availability adjustments`,
    `with the verified numerology layer limited to ${Math.abs(numerologyEdge).toFixed(3)} log-odds so it cannot overwhelm current-team evidence.`
  ];

  return {
    winner,
    loser,
    confidence: Math.round(probability * 1000) / 10,
    reasoning: reasoningParts.join(' '),
    winnerStats: toDisplayNumbers(winnerPatterns),
    loserStats: toDisplayNumbers(loserPatterns),
    winnerBreakdown,
    loserBreakdown,
    winnerDE: winnerPatterns.dailyEssenceFull,
    loserDE: loserPatterns.dailyEssenceFull,
    winnerDay: winnerPatterns.dayNum,
    loserDay: loserPatterns.dayNum,
    winnerDEStats,
    loserDEStats,
    winnerCoachDE: winnerCoach?.patterns.dailyEssenceFull,
    loserCoachDE: loserCoach?.patterns.dailyEssenceFull,
    winnerCoachDEStats: winnerCoach?.deStats,
    loserCoachDEStats: loserCoach?.deStats,
    winnerQbDE: winnerQb?.patterns.dailyEssenceFull,
    loserQbDE: loserQb?.patterns.dailyEssenceFull,
    winnerQbDEStats: winnerQb?.deStats,
    loserQbDEStats: loserQb?.deStats,
    winnerDayStats,
    loserDayStats,
    winnerComboWins: winnerComboStats.wins,
    loserComboWins: loserComboStats.wins,
    winnerTotalPatternWins: winnerDEStats.wins,
    winnerTotalPatternLosses: winnerDEStats.losses,
    winnerTotalPatternPct: winnerDEStats.smoothedWinPct,
    loserTotalPatternWins: loserDEStats.wins,
    loserTotalPatternLosses: loserDEStats.losses,
    loserTotalPatternPct: loserDEStats.smoothedWinPct,
    isChaosDay,
    chaosType: isChaosDay ? `Experimental universal-day ${universalDay} marker` : undefined,
    chaosWarning: isChaosDay ? 'Research-only volatility flag. Not included in the final score until an untouched holdout test shows incremental predictive value.' : undefined,
    isWinnerHome: isHomeWinner,
    historicalSeries: series.info,
    decisionFactors,
    precedentGames,
    modelScores,
    dataFreshness: freshness,
    homePersonnel,
    awayPersonnel,
    warnings,
    modelVersion: MODEL_VERSION
  };
}
