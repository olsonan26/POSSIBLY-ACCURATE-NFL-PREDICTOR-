import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const CANDIDATE_WEIGHTS = [0, 0.01, 0.02, 0.03, 0.04] as const;
const SRS_ITERATIONS = 8;
const SHRINKAGE_GAMES = 4;

type Game = ReturnType<typeof parseGamesCsv>[number];

interface Metrics {
  n: number;
  correct: number;
  brier: number;
  logLoss: number;
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const bounded = Math.max(0.001, Math.min(0.999, p));
  return Math.log(bounded / (1 - bounded));
};

function completedRegular(game: Game): boolean {
  return game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore;
}

function addMetric(metric: Metrics, pHome: number, actualHome: boolean) {
  const p = Math.max(0.001, Math.min(0.999, pHome));
  const y = actualHome ? 1 : 0;
  metric.n += 1;
  metric.correct += (p >= 0.5) === actualHome ? 1 : 0;
  metric.brier += Math.pow(p - y, 2);
  metric.logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

function computeOpponentAdjustedRatings(priorGames: Game[]): Map<string, number> {
  const teams = new Set<string>();
  const counts = new Map<string, number>();
  for (const game of priorGames) {
    teams.add(game.homeTeam);
    teams.add(game.awayTeam);
    counts.set(game.homeTeam, (counts.get(game.homeTeam) || 0) + 1);
    counts.set(game.awayTeam, (counts.get(game.awayTeam) || 0) + 1);
  }

  let ratings = new Map<string, number>([...teams].map(team => [team, 0]));
  for (let iteration = 0; iteration < SRS_ITERATIONS; iteration++) {
    const sums = new Map<string, number>();
    const n = new Map<string, number>();
    for (const game of priorGames) {
      const marginHome = game.homeScore! - game.awayScore!;
      const homeOpponent = ratings.get(game.awayTeam) || 0;
      const awayOpponent = ratings.get(game.homeTeam) || 0;
      sums.set(game.homeTeam, (sums.get(game.homeTeam) || 0) + marginHome + homeOpponent);
      sums.set(game.awayTeam, (sums.get(game.awayTeam) || 0) - marginHome + awayOpponent);
      n.set(game.homeTeam, (n.get(game.homeTeam) || 0) + 1);
      n.set(game.awayTeam, (n.get(game.awayTeam) || 0) + 1);
    }

    const next = new Map<string, number>();
    for (const team of teams) {
      const games = n.get(team) || 0;
      const raw = games ? (sums.get(team) || 0) / games : 0;
      const shrink = games / (games + SHRINKAGE_GAMES);
      next.set(team, Math.max(-20, Math.min(20, raw * shrink)));
    }

    const values = [...next.values()];
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    ratings = new Map([...next].map(([team, value]) => [team, value - mean]));
  }
  return ratings;
}

async function evaluateSeason(
  season: number,
  games: Game[],
  weight: number,
  controlCache: Map<string, number>
): Promise<Metrics> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const sample = games
    .filter(game => game.season === season && completedRegular(game))
    .sort((a, b) => a.gameday.localeCompare(b.gameday));

  const metrics: Metrics = { n: 0, correct: 0, brier: 0, logLoss: 0 };
  for (const game of sample) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;

    const cacheKey = `${season}:${game.gameId || `${game.gameday}:${game.awayTeam}@${game.homeTeam}`}`;
    let controlPHome = controlCache.get(cacheKey);
    if (controlPHome == null) {
      const result = await predictWinner(
        home,
        away,
        new Date(`${game.gameday}T12:00:00Z`),
        true,
        { neutralSite: game.location === 'Neutral' }
      );
      controlPHome = result.modelScores?.finalHomeProbability != null
        ? result.modelScores.finalHomeProbability / 100
        : result.winner.abbr === home.abbr ? result.confidence / 100 : 1 - result.confidence / 100;
      controlCache.set(cacheKey, controlPHome);
    }

    const prior = games.filter(priorGame =>
      priorGame.season === season &&
      completedRegular(priorGame) &&
      priorGame.gameday < game.gameday
    );
    const ratings = computeOpponentAdjustedRatings(prior);
    const edgePoints = (ratings.get(game.homeTeam) || 0) - (ratings.get(game.awayTeam) || 0);
    const challengerPHome = logistic(logit(controlPHome) + edgePoints * weight);
    addMetric(metrics, challengerPHome, game.homeScore! > game.awayScore!);
  }
  return metrics;
}

function report(label: string, metric: Metrics) {
  console.log(
    `${label}: ${metric.correct}/${metric.n} = ${(metric.correct / metric.n * 100).toFixed(2)}% | ` +
    `Brier ${(metric.brier / metric.n).toFixed(4)} | LogLoss ${(metric.logLoss / metric.n).toFixed(4)}`
  );
}

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);
  const games = parseGamesCsv(await response.text());
  const controlCache = new Map<string, number>();

  console.log('\nEXP-006 — Opponent-adjusted point-differential challenger');
  console.log('=========================================================');
  console.log('Method: point-in-time same-season iterative SRS-style opponent adjustment.');
  console.log(`Discovery weights: ${CANDIDATE_WEIGHTS.join(', ')} logit per opponent-adjusted point.`);
  console.log('2024 selects by Brier only. 2025 remains untouched until the weight is selected.');

  const discovery: Array<{ weight: number; metrics: Metrics }> = [];
  for (const weight of CANDIDATE_WEIGHTS) {
    const metrics = await evaluateSeason(2024, games, weight, controlCache);
    discovery.push({ weight, metrics });
    report(`2024 weight=${weight.toFixed(2)}`, metrics);
  }

  const selected = discovery.reduce((best, candidate) =>
    candidate.metrics.brier / candidate.metrics.n < best.metrics.brier / best.metrics.n ? candidate : best
  );
  console.log(`\nSelected on 2024 Brier: weight=${selected.weight.toFixed(2)}`);

  const control2025 = await evaluateSeason(2025, games, 0, controlCache);
  const challenger2025 = await evaluateSeason(2025, games, selected.weight, controlCache);
  console.log('\nUntouched 2025 confirmation');
  report('CONTROL v2.2', control2025);
  report(`CHALLENGER OAE weight=${selected.weight.toFixed(2)}`, challenger2025);

  const controlAcc = control2025.correct / control2025.n;
  const challengerAcc = challenger2025.correct / challenger2025.n;
  const controlBrier = control2025.brier / control2025.n;
  const challengerBrier = challenger2025.brier / challenger2025.n;
  const controlLog = control2025.logLoss / control2025.n;
  const challengerLog = challenger2025.logLoss / challenger2025.n;

  console.log('\nDelta challenger - control');
  console.log(`Accuracy: ${((challengerAcc - controlAcc) * 100).toFixed(2)} points`);
  console.log(`Brier: ${(challengerBrier - controlBrier).toFixed(4)} (negative is better)`);
  console.log(`LogLoss: ${(challengerLog - controlLog).toFixed(4)} (negative is better)`);

  const selectedWasControl = selected.weight === 0;
  const improvesAccuracy = challengerAcc > controlAcc;
  const improvesBrier = challengerBrier < controlBrier;
  const improvesLogLoss = challengerLog < controlLog;
  const verdict = selectedWasControl
    ? 'REJECT: discovery selected the zero-weight control.'
    : improvesAccuracy && improvesBrier && improvesLogLoss
      ? 'KEEP FOR RESEARCH: all three untouched 2025 metrics improved; robustness tests are still required before promotion.'
      : 'INCONCLUSIVE/REJECT FOR PROMOTION: the challenger did not improve all primary untouched metrics.';

  console.log(`\nVERDICT: ${verdict}`);
  console.log('Governance: no production weights are modified by this experiment.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
