import { parseGamesCsv } from '../services/numerologyService.ts';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const SAFE_2026_CUTOFF = '2026-09-14';
const HOME_ELO_ADVANTAGE = 55;
const ELO_K = 20;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sigmoid = z => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
const logit = p => { const q = clamp(p, 0.01, 0.99); return Math.log(q / (1 - q)); };
const completed = g => Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore);

function expectedHomeProbability(homeRating, awayRating, neutral) {
  const homeAdjusted = homeRating + (neutral ? 0 : HOME_ELO_ADVANTAGE);
  return 1 / (1 + Math.pow(10, (awayRating - homeAdjusted) / 400));
}

function eloSnapshot(games, target) {
  const prior = games.filter(g => completed(g) && g.gameday < target.gameday)
    .sort((a, b) => a.gameday.localeCompare(b.gameday));
  const ratings = new Map();
  let priorSeason = 0;
  const rating = team => ratings.get(team) ?? 1500;
  for (const g of prior) {
    if (priorSeason && g.season !== priorSeason) {
      for (const [team, value] of ratings) ratings.set(team, 1500 + (value - 1500) * 0.67);
    }
    priorSeason = g.season;
    const hr = rating(g.homeTeam), ar = rating(g.awayTeam);
    const expected = expectedHomeProbability(hr, ar, g.location === 'Neutral');
    const actual = g.homeScore === g.awayScore ? 0.5 : g.homeScore > g.awayScore ? 1 : 0;
    const margin = Math.abs(g.homeScore - g.awayScore);
    const mov = clamp(Math.log(margin + 1) / Math.log(8), 0.75, 1.65);
    const change = ELO_K * mov * (actual - expected);
    ratings.set(g.homeTeam, hr + change);
    ratings.set(g.awayTeam, ar - change);
  }
  return expectedHomeProbability(rating(target.homeTeam), rating(target.awayTeam), target.location === 'Neutral');
}

// Exact v2.1 TeamForm math: unweighted W-L-T win percentage, recency-weighted point differential.
function teamForm(games, target, team, limit = 8, season, venue) {
  const selected = games
    .filter(g => completed(g) && g.gameday < target.gameday && (g.homeTeam === team || g.awayTeam === team))
    .filter(g => season == null || g.season === season)
    .filter(g => venue == null || (venue === 'home'
      ? g.homeTeam === team && g.location !== 'Neutral'
      : g.awayTeam === team && g.location !== 'Neutral'))
    .sort((a, b) => b.gameday.localeCompare(a.gameday))
    .slice(0, limit);
  let wins = 0, losses = 0, ties = 0, pd = 0, den = 0;
  selected.forEach((g, i) => {
    const isHome = g.homeTeam === team;
    const scored = isHome ? g.homeScore : g.awayScore;
    const allowed = isHome ? g.awayScore : g.homeScore;
    const w = Math.pow(0.9, i);
    pd += (scored - allowed) * w;
    den += w;
    if (scored > allowed) wins++; else if (scored < allowed) losses++; else ties++;
  });
  const n = selected.length;
  return {
    games: n,
    winPct: n ? (wins + ties * 0.5) / n : 0.5,
    avgPointDiff: n ? pd / (den || 1) : 0
  };
}

function h2hAdjustment(games, target) {
  if (target.location === 'Neutral') return 0;
  const same = games
    .filter(g => completed(g) && g.gameday < target.gameday && g.location !== 'Neutral')
    .filter(g => g.homeTeam === target.homeTeam && g.awayTeam === target.awayTeam)
    .sort((a, b) => b.gameday.localeCompare(a.gameday));
  let wh = 2, wa = 2;
  const targetMs = new Date(`${target.gameday}T12:00:00Z`).getTime();
  for (const g of same) {
    const ageYears = Math.max(0, (targetMs - new Date(`${g.gameday}T12:00:00Z`).getTime()) / 31557600000);
    const w = Math.pow(0.5, ageYears / 5);
    if (g.homeScore > g.awayScore) wh += w;
    else if (g.awayScore > g.homeScore) wa += w;
    else { wh += w * 0.5; wa += w * 0.5; }
  }
  const pct = wh / (wh + wa);
  const reliability = clamp(same.length / 8, 0, 1);
  return clamp((pct - 0.5) * 0.30 * reliability, -0.12, 0.12);
}

function probability(games, target, resetPriorSeason) {
  let z = logit(eloSnapshot(games, target));
  const recentSeason = resetPriorSeason ? target.season : undefined;
  const venueSeason = resetPriorSeason ? target.season : undefined;

  const rh = teamForm(games, target, target.homeTeam, 8, recentSeason);
  const ra = teamForm(games, target, target.awayTeam, 8, recentSeason);
  const sh = teamForm(games, target, target.homeTeam, 30, target.season);
  const sa = teamForm(games, target, target.awayTeam, 30, target.season);
  const hv = teamForm(games, target, target.homeTeam, 24, venueSeason, 'home');
  const av = teamForm(games, target, target.awayTeam, 24, venueSeason, 'away');

  const recentEdge = clamp(((rh.winPct - ra.winPct) * 0.22) + ((rh.avgPointDiff - ra.avgPointDiff) / 100), -0.24, 0.24);
  const seasonEdge = sh.games + sa.games >= 4
    ? clamp(((sh.winPct - sa.winPct) * 0.14) + ((sh.avgPointDiff - sa.avgPointDiff) / 140), -0.16, 0.16)
    : 0;
  z += recentEdge + seasonEdge;

  if (target.location !== 'Neutral') {
    z += clamp(((hv.winPct - 0.55) - (av.winPct - 0.45)) * 0.24, -0.12, 0.12);
    z += h2hAdjustment(games, target);
  }
  return sigmoid(z);
}

function metrics(rows, predictor) {
  let correct = 0, brier = 0, logloss = 0, homeWins = 0;
  for (const g of rows) {
    const y = g.homeScore > g.awayScore ? 1 : 0;
    const p = clamp(predictor(g), 0.001, 0.999);
    correct += (p >= 0.5) === Boolean(y) ? 1 : 0;
    homeWins += y;
    brier += (p - y) ** 2;
    logloss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return { n: rows.length, correct, accuracy: correct / rows.length, brier: brier / rows.length, logloss: logloss / rows.length, homeBaseline: homeWins / rows.length };
}

function print(label, m) {
  console.log(`${label.padEnd(32)} ${m.correct}/${m.n} = ${(m.accuracy * 100).toFixed(2)}% | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logloss.toFixed(4)}`);
}

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`NFLverse download failed ${response.status}`);
  const games = parseGamesCsv(await response.text());
  const eligible = games.filter(g => g.gameType === 'REG' && completed(g) && g.homeScore !== g.awayScore);
  const seasons = [2024, 2025, 2026];

  console.log('Isolated prior-season carryover ablation');
  console.log('========================================');
  console.log('Only one variable changes: recent-form/home-road rows from prior NFL seasons are either allowed (v2.1) or excluded (reset). Win-rate math remains exactly v2.1.');

  for (const season of seasons) {
    let rows = eligible.filter(g => g.season === season);
    if (season === 2026) rows = rows.filter(g => g.gameday <= SAFE_2026_CUTOFF);
    console.log(`\n${season}${season === 2024 ? ' SELECTION SEASON' : season === 2025 ? ' UNTOUCHED VALIDATION' : ` OBSERVATION THROUGH ${SAFE_2026_CUTOFF}`}`);
    console.log('-'.repeat(72));
    const original = metrics(rows, g => probability(games, g, false));
    const reset = metrics(rows, g => probability(games, g, true));
    print('v2.1 cross-season form', original);
    print('current-season reset only', reset);
    console.log(`Delta reset - v2.1: ${((reset.accuracy - original.accuracy) * 100).toFixed(2)} pp accuracy | ${(reset.brier - original.brier).toFixed(4)} Brier`);
  }

  console.log('\nDecision rule: promotion is eligible only if the current-season reset has lower Brier on 2024; 2025 is then confirmation, not a selector.');
}

main().catch(error => { console.error(error); process.exit(1); });
