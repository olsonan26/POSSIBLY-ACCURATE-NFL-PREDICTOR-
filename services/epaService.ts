import { normalizeTeamAbbr } from '../data/teamRegistry.js';

/**
 * EPA Service
 * ------------
 * Fetches nflverse play-by-play data (CSV) and derives opponent-adjusted
 * Expected Points Added (EPA) efficiency metrics for each NFL team.
 *
 * All plays are filtered to remove "garbage time" — moments when the win
 * probability is extreme and the outcome is largely decided — using a
 * piecewise linear weight that ramps from 0 to 1 between WP thresholds.
 *
 * Pregame-only guarantee: only plays from games that occurred strictly before
 * the target ISO date are included, so a prediction for a given game never
 * ingests information from that game or any game played the same day.
 *
 * Opponent adjustment uses a standard iterative net-rating algorithm: each
 * team's raw per-play EPA is regressed toward league average and corrected by
 * the (similarly-adjusted) strength of the opponents it has faced, repeated
 * for a fixed number of iterations until the ratings converge.
 */

const NFLVERSE_PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv`;

/** Logit weight for the matchup efficiency layer (EXP-007). */
export const EPA_LOGIT_WEIGHT = 0.15;

/** Iterative net-rating tuning constants. */
const ITERATIONS = 15;
const REGRESSION_WEIGHT = 0.2;

/** Module-level cache so the heavy parse runs at most once per season. */
const pbpCacheBySeason = new Map<number, Promise<PbpPlay[]>>();

export interface EpaTeamStats {
  /** Mean EPA per play on offense (positive = above average). */
  offEpaPerPlay: number;
  /** Mean EPA per play allowed on defense (negative = strong defense). */
  defEpaPerPlay: number;
  /** Fraction of offensive plays with positive EPA (success rate). */
  offSuccessRate: number;
  /** Fraction of defensive plays with negative EPA for the offense. */
  defSuccessRate: number;
  /** Fraction of offensive plays with EPA >= 0.5 (explosive gains). */
  offExplosiveRate: number;
  /** Fraction of defensive plays allowing EPA >= 0.5. */
  defExplosiveRate: number;
  /** EPA per play on 1st/2nd down (early-down efficiency, offense). */
  offEarlyDownEpa: number;
  /** EPA per play allowed on 1st/2nd down (defense). */
  defEarlyDownEpa: number;
  /** Opponent-adjusted offensive EPA per play. */
  adjOffEpa: number;
  /** Opponent-adjusted defensive EPA per play. */
  adjDefEpa: number;
  /** Net opponent-adjusted EPA per play (offense minus defense). */
  adjNetEpa: number;
  /** Number of games contributing to the sample. */
  games: number;
}

interface PbpPlay {
  season: number;
  week: number;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  /** Team on offense (normalized abbreviation). */
  posteam: string;
  /** Team on defense (normalized abbreviation). */
  defteam: string;
  /** EPA value for the play (nflverse-provided, may be null/NaN). */
  epa: number | null;
  /** Win probability of the team with the ball (0..1). */
  wp: number | null;
  /** Down number (1..4), or null for special/non-standard plays. */
  down: number | null;
}

/* ------------------------------------------------------------------ *
 * CSV parsing
 * ------------------------------------------------------------------ */

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

function parseOptionalNumber(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parse the nflverse play-by-play CSV text into typed play rows. */
function parsePbpCsv(text: string): PbpPlay[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  const column = {
    season: idx('season'),
    week: idx('week'),
    gameday: idx('gameday'),
    homeTeam: idx('home_team'),
    awayTeam: idx('away_team'),
    posteam: idx('posteam'),
    defteam: idx('defteam'),
    epa: idx('epa'),
    wp: idx('wp'),
    down: idx('down')
  };

  const plays: PbpPlay[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (c: number) => (c >= 0 ? (cells[c] ?? '').trim() : '');

    const posteam = normalizeTeamAbbr(get(column.posteam));
    const defteam = normalizeTeamAbbr(get(column.defteam));
    const homeTeam = normalizeTeamAbbr(get(column.homeTeam));
    const awayTeam = normalizeTeamAbbr(get(column.awayTeam));
    const gameday = get(column.gameday);

    // Skip rows that aren't real offensive snaps (e.g. kickoff/penalty rows
    // where nflverse leaves posteam/defteam blank).
    if (!posteam || !defteam || !homeTeam || !awayTeam || !gameday) continue;

    plays.push({
      season: Number(get(column.season) || 0),
      week: Number(get(column.week) || 0),
      gameday,
      homeTeam,
      awayTeam,
      posteam,
      defteam,
      epa: parseOptionalNumber(get(column.epa)),
      wp: parseOptionalNumber(get(column.wp)),
      down: parseOptionalNumber(get(column.down))
    });
  }

  return plays;
}

/* ------------------------------------------------------------------ *
 * Garbage-time weighting
 * ------------------------------------------------------------------ */

/**
 * Piecewise-linear garbage-time weight based on win probability.
 *
 *  weight = 1.0  when 0.10 <= wp <= 0.90  (competitive game)
 *  weight = 0.0  when wp < 0.05 or wp > 0.95  (blowout)
 *  linear ramp between the thresholds so the transition is smooth.
 *
 * Plays with a missing/null win probability are treated as fully
 * competitive (weight 1.0) rather than discarded, since nflverse
 * occasionally leaves WP null on early-season or special-teams plays.
 */
function garbageTimeWeight(wp: number | null): number {
  if (wp == null || !Number.isFinite(wp)) return 1.0;

  const LOWER_DECIDE = 0.05;
  const LOWER_COMP = 0.10;
  const UPPER_COMP = 0.90;
  const UPPER_DECIDE = 0.95;

  if (wp < LOWER_DECIDE) return 0.0;
  if (wp < LOWER_COMP) return (wp - LOWER_DECIDE) / (LOWER_COMP - LOWER_DECIDE);
  if (wp <= UPPER_COMP) return 1.0;
  if (wp < UPPER_DECIDE) return (UPPER_DECIDE - wp) / (UPPER_DECIDE - UPPER_COMP);
  return 0.0;
}

/* ------------------------------------------------------------------ *
 * Fetch + cache
 * ------------------------------------------------------------------ */

async function fetchTextMuted(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (response.ok) return response.text();
    return '';
  } catch {
    // Muted per requirement: a failed/empty season just contributes nothing.
    return '';
  }
}

async function loadPbpForSeason(season: number): Promise<PbpPlay[]> {
  let promise = pbpCacheBySeason.get(season);
  if (!promise) {
    promise = fetchTextMuted(NFLVERSE_PBP_URL(season))
      .then(text => (text ? parsePbpCsv(text) : []))
      .catch(() => [] as PbpPlay[]);
    pbpCacheBySeason.set(season, promise);
  }
  return promise;
}

/* ------------------------------------------------------------------ *
 * EPA aggregation
 * ------------------------------------------------------------------ */

interface RawTeamSeason {
  team: string;
  /** Weighted sum of offensive EPA. */
  offEpaSum: number;
  /** Weighted play count on offense. */
  offWeightSum: number;
  /** Weighted sum of EPA allowed on defense (from the defense's perspective). */
  defEpaSum: number;
  /** Weighted play count on defense. */
  defWeightSum: number;
  /** Weighted count of successful offensive plays (EPA > 0). */
  offSuccessWeight: number;
  /** Weighted count of successful defensive plays (EPA < 0 for offense). */
  defSuccessWeight: number;
  /** Weighted count of explosive offensive plays (EPA >= 0.5). */
  offExplosiveWeight: number;
  /** Weighted count of explosive defensive plays allowed (EPA >= 0.5). */
  defExplosiveWeight: number;
  /** Weighted EPA on early downs (1st/2nd), offense. */
  offEarlyDownEpaSum: number;
  offEarlyDownWeight: number;
  /** Weighted EPA on early downs, defense. */
  defEarlyDownEpaSum: number;
  defEarlyDownWeight: number;
  /** Set of game IDs seen (approximated via week+opponent for dedup). */
  gameKeys: Set<string>;
}

interface LeagueContext {
  /** Mean EPA per play across all weighted plays (league baseline). */
  leagueAverage: number;
  /** Map from team abbreviation to its RawTeamSeason. */
  byTeam: Map<string, RawTeamSeason>;
  /**
   * For each team, the list of opponent teams faced weighted by play count,
   * used to compute opponent strength during iterative adjustment.
   */
  opponents: Map<string, Map<string, number>>;
}

function buildLeagueContext(plays: PbpPlay[]): LeagueContext {
  const byTeam = new Map<string, RawTeamSeason>();
  const opponents = new Map<string, Map<string, number>>();

  let totalEpa = 0;
  let totalWeight = 0;

  const ensure = (team: string): RawTeamSeason => {
    let entry = byTeam.get(team);
    if (!entry) {
      entry = {
        team,
        offEpaSum: 0,
        offWeightSum: 0,
        defEpaSum: 0,
        defWeightSum: 0,
        offSuccessWeight: 0,
        defSuccessWeight: 0,
        offExplosiveWeight: 0,
        defExplosiveWeight: 0,
        offEarlyDownEpaSum: 0,
        offEarlyDownWeight: 0,
        defEarlyDownEpaSum: 0,
        defEarlyDownWeight: 0,
        gameKeys: new Set<string>()
      };
      byTeam.set(team, entry);
    }
    return entry;
  };

  const addOpponent = (team: string, opp: string, weight: number) => {
    let map = opponents.get(team);
    if (!map) {
      map = new Map<string, number>();
      opponents.set(team, map);
    }
    map.set(opp, (map.get(opp) ?? 0) + weight);
  };

  for (const play of plays) {
    if (play.epa == null || !Number.isFinite(play.epa)) continue;

    const weight = garbageTimeWeight(play.wp);
    if (weight <= 0) continue;

    const epa = play.epa;
    const offense = ensure(play.posteam);
    const defense = ensure(play.defteam);

    offense.offEpaSum += epa * weight;
    offense.offWeightSum += weight;
    defense.defEpaSum += epa * weight;
    defense.defWeightSum += weight;

    if (epa > 0) offense.offSuccessWeight += weight;
    if (epa < 0) defense.defSuccessWeight += weight;
    if (epa >= 0.5) offense.offExplosiveWeight += weight;
    if (epa >= 0.5) defense.defExplosiveWeight += weight;

    const isEarlyDown = play.down === 1 || play.down === 2;
    if (isEarlyDown) {
      offense.offEarlyDownEpaSum += epa * weight;
      offense.offEarlyDownWeight += weight;
      defense.defEarlyDownEpaSum += epa * weight;
      defense.defEarlyDownWeight += weight;
    }

    // Track games played (dedup by week + opponent pairing).
    const gameKey = `${play.season}-${play.week}-${play.posteam}-${play.defteam}`;
    offense.gameKeys.add(gameKey);
    defense.gameKeys.add(`${play.season}-${play.week}-${play.defteam}-${play.posteam}`);

    // Track opponent exposure weighted by offensive play count, so a team
    // that ran 70 plays against an opponent is influenced more than one
    // that ran 40.
    addOpponent(play.posteam, play.defteam, weight);
    // Symmetric: the defense faced that opponent's offense.
    addOpponent(play.defteam, play.posteam, weight);

    totalEpa += epa * weight;
    totalWeight += weight;
  }

  return {
    leagueAverage: totalWeight > 0 ? totalEpa / totalWeight : 0,
    byTeam,
    opponents
  };
}

/**
 * Iterative opponent adjustment.
 *
 * For each iteration, a team's adjusted offensive EPA is:
 *
 *   adjOff = (1 - R) * rawOff + R * (leagueAvg + avgOpponentAdjDef)
 *
 * and symmetrically for defense. `R` is the regression-to-mean weight.
 * Opponent strength is the play-weighted average of the opponents'
 * current adjusted ratings. Repeated iterations let strength-of-schedule
 * corrections propagate through the league graph.
 */
function iterativeAdjustment(ctx: LeagueContext): {
  adjOff: Map<string, number>;
  adjDef: Map<string, number>;
} {
  const R = REGRESSION_WEIGHT;
  const leagueAvg = ctx.leagueAverage;

  // Raw per-play rates.
  const rawOff = new Map<string, number>();
  const rawDef = new Map<string, number>();
  for (const [team, entry] of ctx.byTeam) {
    rawOff.set(
      team,
      entry.offWeightSum > 0 ? entry.offEpaSum / entry.offWeightSum : leagueAvg
    );
    rawDef.set(
      team,
      entry.defWeightSum > 0 ? entry.defEpaSum / entry.defWeightSum : leagueAvg
    );
  }

  // Initialize adjusted ratings at the raw values.
  let adjOff = new Map<string, number>(rawOff);
  let adjDef = new Map<string, number>(rawDef);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const nextOff = new Map<string, number>();
    const nextDef = new Map<string, number>();

    for (const team of ctx.byTeam.keys()) {
      // Average adjusted defensive rating of this team's opponents,
      // weighted by play exposure.
      const oppMap = ctx.opponents.get(team);
      let oppDefWeightedSum = 0;
      let oppDefWeight = 0;
      let oppOffWeightedSum = 0;
      let oppOffWeight = 0;
      if (oppMap) {
        for (const [opp, weight] of oppMap) {
          oppDefWeightedSum += (adjDef.get(opp) ?? leagueAvg) * weight;
          oppDefWeight += weight;
          oppOffWeightedSum += (adjOff.get(opp) ?? leagueAvg) * weight;
          oppOffWeight += weight;
        }
      }
      const avgOppDef = oppDefWeight > 0 ? oppDefWeightedSum / oppDefWeight : leagueAvg;
      const avgOppOff = oppOffWeight > 0 ? oppOffWeightedSum / oppOffWeight : leagueAvg;

      // Offensive strength = raw rate adjusted for opponent defense.
      // A tough opponent (low adjDef) makes a given raw EPA look better, so
      // we add (leagueAvg - avgOppDef): when opponents are stingy (below
      // average), this term is positive, lifting the offense's rating.
      const offStrength = (1 - R) * (rawOff.get(team) ?? leagueAvg) + R * (leagueAvg + (leagueAvg - avgOppDef));
      // Defensive strength = raw rate adjusted for opponent offense.
      // Facing potent offenses (high adjOff) should soften a defense's raw
      // allowance, so we subtract the opponent's above-average offense.
      const defStrength = (1 - R) * (rawDef.get(team) ?? leagueAvg) + R * (leagueAvg + (avgOppOff - leagueAvg));

      nextOff.set(team, offStrength);
      nextDef.set(team, defStrength);
    }

    adjOff = nextOff;
    adjDef = nextDef;
  }

  return { adjOff, adjDef };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Returns opponent-adjusted EPA efficiency stats for a single team, using
 * only plays from games played strictly before `targetIso`.
 *
 * Returns null when the team has no qualifying plays in the data window
 * (e.g. a bye-week team before its first game, or an unrecognized
 * abbreviation).
 */
export async function getEpaStats(
  teamAbbr: string,
  targetIso: string,
  currentSeason: number
): Promise<EpaTeamStats | null> {
  const team = normalizeTeamAbbr(teamAbbr);
  if (!team) return null;

  // Pull the current season plus the prior season so early-season games
  // still have a meaningful sample. The target date filter guarantees we
  // never look ahead.
  const seasons = [currentSeason, currentSeason - 1];
  const allPlays: PbpPlay[] = [];
  for (const season of seasons) {
    if (season < 2000) continue; // nflverse pbp starts ~1999; keep a sane floor.
    const plays = await loadPbpForSeason(season);
    for (const play of plays) {
      if (play.gameday && play.gameday < targetIso) {
        allPlays.push(play);
      }
    }
  }

  if (allPlays.length === 0) return null;

  const ctx = buildLeagueContext(allPlays);
  const entry = ctx.byTeam.get(team);
  if (!entry || entry.offWeightSum === 0) return null;

  const { adjOff, adjDef } = iterativeAdjustment(ctx);
  const adjOffEpa = adjOff.get(team) ?? 0;
  const adjDefEpa = adjDef.get(team) ?? 0;

  const offEpaPerPlay = entry.offWeightSum > 0 ? entry.offEpaSum / entry.offWeightSum : 0;
  const defEpaPerPlay = entry.defWeightSum > 0 ? entry.defEpaSum / entry.defWeightSum : 0;
  const offSuccessRate = entry.offWeightSum > 0 ? entry.offSuccessWeight / entry.offWeightSum : 0;
  const defSuccessRate = entry.defWeightSum > 0 ? entry.defSuccessWeight / entry.defWeightSum : 0;
  const offExplosiveRate = entry.offWeightSum > 0 ? entry.offExplosiveWeight / entry.offWeightSum : 0;
  const defExplosiveRate = entry.defWeightSum > 0 ? entry.defExplosiveWeight / entry.defWeightSum : 0;
  const offEarlyDownEpa = entry.offEarlyDownWeight > 0 ? entry.offEarlyDownEpaSum / entry.offEarlyDownWeight : 0;
  const defEarlyDownEpa = entry.defEarlyDownWeight > 0 ? entry.defEarlyDownEpaSum / entry.defEarlyDownWeight : 0;

  return {
    offEpaPerPlay,
    defEpaPerPlay,
    offSuccessRate,
    defSuccessRate,
    offExplosiveRate,
    defExplosiveRate,
    offEarlyDownEpa,
    defEarlyDownEpa,
    adjOffEpa,
    adjDefEpa,
    adjNetEpa: adjOffEpa - adjDefEpa,
    games: entry.gameKeys.size
  };
}

export interface MatchupEpaContext {
  home: EpaTeamStats | null;
  away: EpaTeamStats | null;
  /**
   * Logit-space edge for the home team, derived from the difference in
   * net adjusted EPA and scaled by the EXP-007 locked weight.
   */
  homeLogitEdge: number;
  /** Logit-space edge for the away team (the negation of home's edge). */
  awayLogitEdge: number;
}

/**
 * Computes EPA context for both teams in a matchup and the resulting
 * logit-space edge.
 *
 * The edge is:
 *
 *   (home.adjNetEpa - away.adjNetEpa) * EPA_LOGIT_WEIGHT
 *
 * clamped to [-0.5, 0.5] so a single efficiency layer can never
 * overwhelm the rest of the model. When either team lacks qualifying
 * data, both edges are zero (treated as no information).
 */
export async function getMatchupEpaContext(
  homeAbbr: string,
  awayAbbr: string,
  targetIso: string,
  currentSeason: number
): Promise<MatchupEpaContext> {
  const [home, away] = await Promise.all([
    getEpaStats(homeAbbr, targetIso, currentSeason),
    getEpaStats(awayAbbr, targetIso, currentSeason)
  ]);

  let homeLogitEdge = 0;
  let awayLogitEdge = 0;

  if (home && away) {
    const raw = (home.adjNetEpa - away.adjNetEpa) * EPA_LOGIT_WEIGHT;
    const clamped = Math.max(-0.5, Math.min(0.5, raw));
    homeLogitEdge = clamped;
    awayLogitEdge = -clamped;
  }

  return { home, away, homeLogitEdge, awayLogitEdge };
}
