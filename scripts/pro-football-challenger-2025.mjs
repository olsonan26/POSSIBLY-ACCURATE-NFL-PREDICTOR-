import { gunzipSync } from 'node:zlib';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService.ts';

const PBP_SEASONS = [2022, 2023, 2024, 2025];
const TRAIN_SEASONS = new Set([2022, 2023]);
const VALIDATION_SEASON = 2024;
const TEST_SEASON = 2025;
const TEST_WEEKS = new Set([16, 17, 18]);
const WINDOW = 8;
const DECAY = 0.85;
const MIN_HISTORY = 4;

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PBP_URL = season => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

const FEATURE_NAMES = [
  'overall EPA matchup edge',
  'pass EPA matchup edge',
  'rush EPA matchup edge',
  'success-rate matchup edge',
  'explosive-play matchup edge',
  'turnover margin-rate edge',
  'sack-rate matchup edge',
  'special-teams EPA/play edge'
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const logistic = x => 1 / (1 + Math.exp(-clamp(x, -35, 35)));

function parseCsvLine(line) {
  const cells = [];
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

function toNumber(value) {
  if (value == null || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}

async function fetchGzipText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
}

function emptyTeamGame() {
  return {
    offPlays: 0, offEpa: 0, passPlays: 0, passEpa: 0, rushPlays: 0, rushEpa: 0,
    successes: 0, explosives: 0, giveaways: 0, sacksAllowed: 0,
    defPlays: 0, defEpaAllowed: 0, passDefPlays: 0, passDefEpaAllowed: 0,
    rushDefPlays: 0, rushDefEpaAllowed: 0, defSuccessAllowed: 0,
    defExplosivesAllowed: 0, takeaways: 0, sacksMade: 0,
    specialPlays: 0, specialEpa: 0
  };
}

function getAgg(game, team) {
  let value = game.get(team);
  if (!value) {
    value = emptyTeamGame();
    game.set(team, value);
  }
  return value;
}

function finalizeTeamGame(a) {
  const safe = (sum, count) => count ? sum / count : 0;
  return {
    offEpa: safe(a.offEpa, a.offPlays),
    passOffEpa: safe(a.passEpa, a.passPlays),
    rushOffEpa: safe(a.rushEpa, a.rushPlays),
    offSuccess: safe(a.successes, a.offPlays),
    offExplosive: safe(a.explosives, a.offPlays),
    giveawayRate: safe(a.giveaways, a.offPlays),
    sacksAllowedRate: safe(a.sacksAllowed, a.passPlays),
    defEpaAllowed: safe(a.defEpaAllowed, a.defPlays),
    passDefEpaAllowed: safe(a.passDefEpaAllowed, a.passDefPlays),
    rushDefEpaAllowed: safe(a.rushDefEpaAllowed, a.rushDefPlays),
    defSuccessAllowed: safe(a.defSuccessAllowed, a.defPlays),
    defExplosiveAllowed: safe(a.defExplosivesAllowed, a.defPlays),
    takeawayRate: safe(a.takeaways, a.defPlays),
    sackRate: safe(a.sacksMade, a.passDefPlays),
    specialEpa: safe(a.specialEpa, a.specialPlays),
    plays: a.offPlays
  };
}

function aggregatePbp(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();
  const headers = parseCsvLine(lines[0]);
  const idx = name => headers.indexOf(name);
  const col = {
    gameId: idx('game_id'), seasonType: idx('season_type'), posteam: idx('posteam'), defteam: idx('defteam'),
    pass: idx('pass'), rush: idx('rush'), epa: idx('epa'), success: idx('success'), yards: idx('yards_gained'),
    special: idx('special_teams_play'), interception: idx('interception'), fumbleLost: idx('fumble_lost'),
    sack: idx('sack'), kneel: idx('qb_kneel'), spike: idx('qb_spike')
  };
  for (const required of ['gameId', 'posteam', 'defteam', 'epa']) {
    if (col[required] < 0) throw new Error(`nflverse PBP is missing required column: ${required}`);
  }

  const games = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = index => index >= 0 ? (cells[index] ?? '') : '';
    if (col.seasonType >= 0 && get(col.seasonType) !== 'REG') continue;
    const gameId = get(col.gameId);
    const posteam = get(col.posteam);
    const defteam = get(col.defteam);
    if (!gameId || !posteam || !defteam) continue;
    const epa = toNumber(get(col.epa));
    if (!Number.isFinite(epa)) continue;

    const isPass = toNumber(get(col.pass)) === 1;
    const isRush = toNumber(get(col.rush)) === 1;
    const isScrimmage = (isPass || isRush) && toNumber(get(col.kneel)) !== 1 && toNumber(get(col.spike)) !== 1;
    const isSpecial = toNumber(get(col.special)) === 1;
    let game = games.get(gameId);
    if (!game) {
      game = new Map();
      games.set(gameId, game);
    }

    if (isScrimmage) {
      const offense = getAgg(game, posteam);
      const defense = getAgg(game, defteam);
      const success = toNumber(get(col.success)) === 1 ? 1 : 0;
      const yards = toNumber(get(col.yards));
      const explosive = isPass ? (yards >= 20 ? 1 : 0) : (yards >= 10 ? 1 : 0);
      const turnover = (toNumber(get(col.interception)) === 1 || toNumber(get(col.fumbleLost)) === 1) ? 1 : 0;
      const sack = toNumber(get(col.sack)) === 1 ? 1 : 0;

      offense.offPlays++;
      offense.offEpa += epa;
      offense.successes += success;
      offense.explosives += explosive;
      offense.giveaways += turnover;
      if (isPass) {
        offense.passPlays++;
        offense.passEpa += epa;
        offense.sacksAllowed += sack;
      }
      if (isRush) {
        offense.rushPlays++;
        offense.rushEpa += epa;
      }

      defense.defPlays++;
      defense.defEpaAllowed += epa;
      defense.defSuccessAllowed += success;
      defense.defExplosivesAllowed += explosive;
      defense.takeaways += turnover;
      if (isPass) {
        defense.passDefPlays++;
        defense.passDefEpaAllowed += epa;
        defense.sacksMade += sack;
      }
      if (isRush) {
        defense.rushDefPlays++;
        defense.rushDefEpaAllowed += epa;
      }
    }

    if (isSpecial) {
      const special = getAgg(game, posteam);
      special.specialPlays++;
      special.specialEpa += epa;
    }
  }

  const finalized = new Map();
  for (const [gameId, teamMap] of games) {
    const out = new Map();
    for (const [team, agg] of teamMap) out.set(team, finalizeTeamGame(agg));
    finalized.set(gameId, out);
  }
  return finalized;
}

const STAT_KEYS = [
  'offEpa', 'passOffEpa', 'rushOffEpa', 'offSuccess', 'offExplosive', 'giveawayRate', 'sacksAllowedRate',
  'defEpaAllowed', 'passDefEpaAllowed', 'rushDefEpaAllowed', 'defSuccessAllowed', 'defExplosiveAllowed',
  'takeawayRate', 'sackRate', 'specialEpa'
];

function rollingAverage(history) {
  const selected = history.slice(-WINDOW).reverse();
  const totals = Object.fromEntries(STAT_KEYS.map(key => [key, 0]));
  let weightTotal = 0;
  selected.forEach((row, index) => {
    const weight = Math.pow(DECAY, index);
    weightTotal += weight;
    for (const key of STAT_KEYS) totals[key] += row[key] * weight;
  });
  for (const key of STAT_KEYS) totals[key] /= weightTotal || 1;
  return totals;
}

function matchupFeatures(home, away) {
  const matchup = (homeOff, awayDefAllowed, awayOff, homeDefAllowed) =>
    (homeOff - awayDefAllowed) - (awayOff - homeDefAllowed);
  return [
    matchup(home.offEpa, away.defEpaAllowed, away.offEpa, home.defEpaAllowed),
    matchup(home.passOffEpa, away.passDefEpaAllowed, away.passOffEpa, home.passDefEpaAllowed),
    matchup(home.rushOffEpa, away.rushDefEpaAllowed, away.rushOffEpa, home.rushDefEpaAllowed),
    matchup(home.offSuccess, away.defSuccessAllowed, away.offSuccess, home.defSuccessAllowed),
    matchup(home.offExplosive, away.defExplosiveAllowed, away.offExplosive, home.defExplosiveAllowed),
    (home.takeawayRate - home.giveawayRate) - (away.takeawayRate - away.giveawayRate),
    matchup(home.sackRate, away.sacksAllowedRate, away.sackRate, home.sacksAllowedRate),
    home.specialEpa - away.specialEpa
  ];
}

function buildExamples(schedule, pbpBySeason) {
  const all = [];
  for (const season of PBP_SEASONS) {
    const history = new Map();
    const seasonGames = schedule
      .filter(game => game.season === season && game.gameType === 'REG' && Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore) && game.homeScore !== game.awayScore)
      .sort((a, b) => a.gameday.localeCompare(b.gameday) || a.gameId.localeCompare(b.gameId));
    const gameMetrics = pbpBySeason.get(season);

    for (const game of seasonGames) {
      const homeHistory = history.get(game.homeTeam) || [];
      const awayHistory = history.get(game.awayTeam) || [];
      const teamMetrics = gameMetrics?.get(game.gameId);
      const homeCurrent = teamMetrics?.get(game.homeTeam);
      const awayCurrent = teamMetrics?.get(game.awayTeam);

      if (homeHistory.length >= MIN_HISTORY && awayHistory.length >= MIN_HISTORY) {
        all.push({
          season: game.season,
          week: game.week,
          gameId: game.gameId,
          gameday: game.gameday,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          neutral: game.location === 'Neutral',
          spreadLine: game.spreadLine,
          x: matchupFeatures(rollingAverage(homeHistory), rollingAverage(awayHistory)),
          y: game.homeScore > game.awayScore ? 1 : 0
        });
      }

      if (homeCurrent && homeCurrent.plays >= 20) history.set(game.homeTeam, [...homeHistory, homeCurrent]);
      if (awayCurrent && awayCurrent.plays >= 20) history.set(game.awayTeam, [...awayHistory, awayCurrent]);
    }
  }
  return all;
}

function parseSchedule(text) {
  const base = parseGamesCsv(text);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const spreadIndex = headers.indexOf('spread_line');
  const gameIndex = headers.indexOf('game_id');
  const spreadById = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const id = gameIndex >= 0 ? cells[gameIndex] : '';
    const spread = spreadIndex >= 0 ? toNumber(cells[spreadIndex]) : NaN;
    if (id) spreadById.set(id, spread);
  }
  return base.map(game => ({ ...game, spreadLine: spreadById.get(game.gameId) }));
}

function fitStandardizer(examples) {
  const dim = FEATURE_NAMES.length;
  const mean = Array(dim).fill(0);
  const std = Array(dim).fill(0);
  for (const row of examples) row.x.forEach((value, i) => { mean[i] += value; });
  mean.forEach((_, i) => { mean[i] /= examples.length || 1; });
  for (const row of examples) row.x.forEach((value, i) => { std[i] += (value - mean[i]) ** 2; });
  std.forEach((_, i) => { std[i] = Math.sqrt(std[i] / Math.max(1, examples.length - 1)) || 1; });
  return { mean, std };
}

const transform = (x, scaler) => x.map((value, i) => (value - scaler.mean[i]) / scaler.std[i]);

function fitLogistic(examples, scaler, lambda, iterations = 4000, learningRate = 0.04) {
  const dim = FEATURE_NAMES.length;
  const weights = Array(dim).fill(0);
  let intercept = 0;
  const n = Math.max(1, examples.length);
  for (let step = 0; step < iterations; step++) {
    const grad = Array(dim).fill(0);
    let gradIntercept = 0;
    for (const row of examples) {
      const x = transform(row.x, scaler);
      let z = intercept;
      for (let i = 0; i < dim; i++) z += weights[i] * x[i];
      const error = logistic(z) - row.y;
      gradIntercept += error;
      for (let i = 0; i < dim; i++) grad[i] += error * x[i];
    }
    intercept -= learningRate * (gradIntercept / n);
    for (let i = 0; i < dim; i++) weights[i] -= learningRate * ((grad[i] / n) + lambda * weights[i]);
  }
  return { weights, intercept, scaler, lambda };
}

function modelProbability(model, x, calibrationScale = 1) {
  const xs = transform(x, model.scaler);
  let z = model.intercept;
  for (let i = 0; i < xs.length; i++) z += model.weights[i] * xs[i];
  return logistic(z * calibrationScale);
}

function metrics(rows, probabilities) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  rows.forEach((row, i) => {
    const p = clamp(probabilities[i], 0.001, 0.999);
    const y = row.y;
    if ((p >= 0.5 ? 1 : 0) === y) correct++;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  });
  const n = rows.length;
  return { n, correct, accuracy: n ? correct / n : 0, brier: n ? brier / n : NaN, logLoss: n ? logLoss / n : NaN };
}

function pickHyperparameters(train, validation) {
  const scaler = fitStandardizer(train);
  const lambdas = [0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3];
  const calibrationScales = [0.65, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
  let best = null;
  for (const lambda of lambdas) {
    const model = fitLogistic(train, scaler, lambda);
    for (const calibrationScale of calibrationScales) {
      const score = metrics(validation, validation.map(row => modelProbability(model, row.x, calibrationScale)));
      const candidate = { lambda, calibrationScale, score };
      if (!best || score.brier < best.score.brier - 1e-12 ||
        (Math.abs(score.brier - best.score.brier) < 1e-12 && score.logLoss < best.score.logLoss)) best = candidate;
    }
  }
  return best;
}

async function baselineProbabilities(rows) {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const probabilities = [];
  for (const row of rows) {
    const home = byAbbr.get(row.homeTeam);
    const away = byAbbr.get(row.awayTeam);
    if (!home || !away) throw new Error(`Team registry missing ${row.homeTeam} or ${row.awayTeam}`);
    const result = await predictWinner(home, away, new Date(`${row.gameday}T12:00:00Z`), true, { neutralSite: row.neutral });
    probabilities.push(result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === row.homeTeam ? result.confidence / 100 : 1 - result.confidence / 100);
  }
  return probabilities;
}

function marketFavoriteMetrics(rows) {
  let n = 0;
  let correct = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.spreadLine) || row.spreadLine === 0) continue;
    n++;
    const pickedHome = row.spreadLine > 0;
    if ((pickedHome ? 1 : 0) === row.y) correct++;
  }
  return { n, correct, accuracy: n ? correct / n : NaN };
}

const pct = value => `${(value * 100).toFixed(2)}%`;
const fixed = value => Number.isFinite(value) ? value.toFixed(4) : 'n/a';

async function main() {
  console.log('Downloading free nflverse schedule + play-by-play data...');
  const [gamesText, ...pbpTexts] = await Promise.all([
    fetchText(GAMES_URL),
    ...PBP_SEASONS.map(season => fetchGzipText(PBP_URL(season)))
  ]);
  const schedule = parseSchedule(gamesText);
  const pbpBySeason = new Map(PBP_SEASONS.map((season, i) => [season, aggregatePbp(pbpTexts[i])]));
  const examples = buildExamples(schedule, pbpBySeason);
  const training = examples.filter(row => TRAIN_SEASONS.has(row.season));
  const validation = examples.filter(row => row.season === VALIDATION_SEASON);
  const test = examples.filter(row => row.season === TEST_SEASON && TEST_WEEKS.has(row.week));

  if (training.length < 400) throw new Error(`Training sample unexpectedly small: ${training.length}`);
  if (validation.length < 200) throw new Error(`Validation sample unexpectedly small: ${validation.length}`);
  if (test.length < 40) throw new Error(`2025 W16-18 test sample unexpectedly small: ${test.length}`);

  const selected = pickHyperparameters(training, validation);
  if (!selected) throw new Error('Hyperparameter selection failed');
  const finalTraining = examples.filter(row => row.season >= 2022 && row.season <= 2024);
  const finalScaler = fitStandardizer(finalTraining);
  const finalModel = fitLogistic(finalTraining, finalScaler, selected.lambda);
  const challengerProbs = test.map(row => modelProbability(finalModel, row.x, selected.calibrationScale));
  const challenger = metrics(test, challengerProbs);

  console.log('Running locked production v2.2 on the exact same held-out games...');
  const baselineProbs = await baselineProbabilities(test);
  const baseline = metrics(test, baselineProbs);
  const market = marketFavoriteMetrics(test);

  const flips = [];
  for (let i = 0; i < test.length; i++) {
    const basePick = baselineProbs[i] >= 0.5 ? 1 : 0;
    const challengerPick = challengerProbs[i] >= 0.5 ? 1 : 0;
    if (basePick !== challengerPick) {
      flips.push({
        gameId: test[i].gameId,
        matchup: `${test[i].awayTeam} @ ${test[i].homeTeam}`,
        actual: test[i].y ? test[i].homeTeam : test[i].awayTeam,
        baselinePick: basePick ? test[i].homeTeam : test[i].awayTeam,
        challengerPick: challengerPick ? test[i].homeTeam : test[i].awayTeam,
        baselineCorrect: basePick === test[i].y,
        challengerCorrect: challengerPick === test[i].y,
        baselinePHome: Number(baselineProbs[i].toFixed(4)),
        challengerPHome: Number(challengerProbs[i].toFixed(4))
      });
    }
  }

  const fixedByChallenger = flips.filter(row => !row.baselineCorrect && row.challengerCorrect).length;
  const brokenByChallenger = flips.filter(row => row.baselineCorrect && !row.challengerCorrect).length;
  const strictPromotionPass = challenger.accuracy > baseline.accuracy && challenger.brier < baseline.brier && challenger.logLoss < baseline.logLoss;

  console.log('\nProfessional Football Challenger — leakage-safe held-out test');
  console.log('=========================================================');
  console.log('Source: nflverse free/open schedule + play-by-play data');
  console.log(`Features: ${FEATURE_NAMES.join('; ')}`);
  console.log(`Train: 2022-2023 (${training.length} games)`);
  console.log(`Tune only: 2024 (${validation.length} games)`);
  console.log(`Frozen test: 2025 Weeks 16-18 (${test.length} games)`);
  console.log(`Selected on 2024 only: L2=${selected.lambda}, calibration scale=${selected.calibrationScale}`);
  console.log(`2024 selected-model Brier=${fixed(selected.score.brier)}, log loss=${fixed(selected.score.logLoss)}, accuracy=${pct(selected.score.accuracy)}`);
  console.log('\nHeld-out 2025 Weeks 16-18');
  console.log(`v2.2 production: ${baseline.correct}/${baseline.n} = ${pct(baseline.accuracy)}, Brier ${fixed(baseline.brier)}, log loss ${fixed(baseline.logLoss)}`);
  console.log(`Advanced-stat challenger: ${challenger.correct}/${challenger.n} = ${pct(challenger.accuracy)}, Brier ${fixed(challenger.brier)}, log loss ${fixed(challenger.logLoss)}`);
  console.log(`Closing-spread favorite benchmark: ${market.correct}/${market.n} = ${pct(market.accuracy)}`);
  console.log(`Flip audit: ${flips.length} changed picks; ${fixedByChallenger} baseline misses fixed; ${brokenByChallenger} baseline hits broken.`);
  console.log(`Promotion gate: ${strictPromotionPass ? 'PASS — candidate earned a larger untouched validation test' : 'FAIL — keep production v2.2 unchanged'}`);

  console.log('\nFeature coefficients (standardized scale; descriptive, not causal):');
  finalModel.weights
    .map((weight, i) => ({ feature: FEATURE_NAMES[i], weight }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .forEach(row => console.log(`  ${row.feature}: ${row.weight >= 0 ? '+' : ''}${row.weight.toFixed(4)}`));

  console.log('\nChanged picks');
  if (!flips.length) console.log('  none');
  for (const row of flips) {
    console.log(`  ${row.gameId} ${row.matchup}: actual ${row.actual}; v2.2 ${row.baselinePick} (${row.baselineCorrect ? 'correct' : 'wrong'}); challenger ${row.challengerPick} (${row.challengerCorrect ? 'correct' : 'wrong'})`);
  }

  const report = {
    source: 'nflverse',
    sourceUrls: { games: GAMES_URL, pbpTemplate: PBP_URL('{season}') },
    methodology: {
      features: FEATURE_NAMES,
      rollingWindow: WINDOW,
      decay: DECAY,
      minimumPriorGames: MIN_HISTORY,
      trainSeasons: [...TRAIN_SEASONS],
      tuningSeason: VALIDATION_SEASON,
      frozenTest: { season: TEST_SEASON, weeks: [...TEST_WEEKS] },
      selectedL2: selected.lambda,
      selectedCalibrationScale: selected.calibrationScale,
      selectionMetric: '2024 Brier score, log-loss tiebreaker',
      productionMutation: false
    },
    validation2024: selected.score,
    heldout2025Weeks16to18: { baseline, challenger, market, flips, fixedByChallenger, brokenByChallenger, strictPromotionPass },
    coefficients: FEATURE_NAMES.map((feature, i) => ({ feature, weight: finalModel.weights[i] }))
  };
  await Bun.write('research/pro-football-challenger-2025-w16-18.json', JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
