import { gunzipSync } from 'node:zlib';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService.ts';

const PBP_SEASONS = [2022, 2023, 2024, 2025];
const BUILD_SEASON = 2022;
const HYPERPARAM_SEASON = 2023;
const THRESHOLD_SEASON = 2024;
const TEST_SEASON = 2025;
const TEST_WEEKS = new Set([16, 17, 18]);
const WINDOW = 8;
const DECAY = 0.85;
const MIN_HISTORY = 4;

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PBP_URL = season => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

const STAT_FEATURE_NAMES = [
  'overall EPA support for v2.2 pick',
  'pass EPA support for v2.2 pick',
  'rush EPA support for v2.2 pick',
  'success-rate support for v2.2 pick',
  'explosive-play support for v2.2 pick',
  'turnover-margin support for v2.2 pick',
  'sack-rate support for v2.2 pick',
  'special-teams EPA/play support for v2.2 pick'
];

const FEATURE_NAMES = [
  'v2.2 confidence',
  'market support for v2.2 pick',
  'market disagrees with v2.2',
  'absolute closing spread',
  ...STAT_FEATURE_NAMES
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
    if (col[required] < 0) throw new Error(`nflverse PBP missing required column: ${required}`);
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

      if (homeHistory.length >= MIN_HISTORY && awayHistory.length >= MIN_HISTORY && Number.isFinite(game.spreadLine)) {
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
          statEdges: matchupFeatures(rollingAverage(homeHistory), rollingAverage(awayHistory)),
          actualHomeWin: game.homeScore > game.awayScore ? 1 : 0
        });
      }

      if (homeCurrent && homeCurrent.plays >= 20) history.set(game.homeTeam, [...homeHistory, homeCurrent]);
      if (awayCurrent && awayCurrent.plays >= 20) history.set(game.awayTeam, [...awayHistory, awayCurrent]);
    }
  }
  return all;
}

async function baselineProbabilities(rows) {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const probabilities = [];
  for (const row of rows) {
    const home = byAbbr.get(row.homeTeam);
    const away = byAbbr.get(row.awayTeam);
    if (!home || !away) throw new Error(`Team registry missing ${row.homeTeam} or ${row.awayTeam}`);
    const result = await predictWinner(
      home,
      away,
      new Date(`${row.gameday}T12:00:00Z`),
      true,
      { neutralSite: row.neutral }
    );
    probabilities.push(result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === row.homeTeam
        ? result.confidence / 100
        : 1 - result.confidence / 100);
  }
  return probabilities;
}

function makeMetaRows(rows, baseProbs) {
  return rows.map((row, i) => {
    const pHome = clamp(baseProbs[i], 0.001, 0.999);
    const basePickHome = pHome >= 0.5 ? 1 : 0;
    const pickSign = basePickHome ? 1 : -1;
    const wrong = basePickHome === row.actualHomeWin ? 0 : 1;
    const marketPickHome = row.spreadLine > 0 ? 1 : row.spreadLine < 0 ? 0 : basePickHome;
    const marketDisagrees = marketPickHome === basePickHome ? 0 : 1;
    const x = [
      Math.max(pHome, 1 - pHome),
      (row.spreadLine / 7) * pickSign,
      marketDisagrees,
      Math.abs(row.spreadLine) / 7,
      ...row.statEdges.map(value => value * pickSign)
    ];
    return {
      ...row,
      baselinePHome: pHome,
      baselinePickHome: basePickHome,
      baselinePick: basePickHome ? row.homeTeam : row.awayTeam,
      baselineCorrect: wrong === 0,
      errorY: wrong,
      x
    };
  });
}

function fitStandardizer(rows) {
  const dim = FEATURE_NAMES.length;
  const mean = Array(dim).fill(0);
  const std = Array(dim).fill(0);
  for (const row of rows) row.x.forEach((value, i) => { mean[i] += value; });
  mean.forEach((_, i) => { mean[i] /= rows.length || 1; });
  for (const row of rows) row.x.forEach((value, i) => { std[i] += (value - mean[i]) ** 2; });
  std.forEach((_, i) => { std[i] = Math.sqrt(std[i] / Math.max(1, rows.length - 1)) || 1; });
  return { mean, std };
}

const transform = (x, scaler) => x.map((value, i) => (value - scaler.mean[i]) / scaler.std[i]);

function fitLogistic(rows, scaler, lambda, iterations = 4500, learningRate = 0.035) {
  const dim = FEATURE_NAMES.length;
  const weights = Array(dim).fill(0);
  let intercept = 0;
  const n = Math.max(1, rows.length);
  for (let step = 0; step < iterations; step++) {
    const grad = Array(dim).fill(0);
    let gradIntercept = 0;
    for (const row of rows) {
      const x = transform(row.x, scaler);
      let z = intercept;
      for (let i = 0; i < dim; i++) z += weights[i] * x[i];
      const error = logistic(z) - row.errorY;
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

function probabilityMetrics(rows, probs) {
  let brier = 0;
  let logLoss = 0;
  for (let i = 0; i < rows.length; i++) {
    const p = clamp(probs[i], 0.001, 0.999);
    const y = rows[i].errorY;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  const n = rows.length;
  return { n, brier: n ? brier / n : NaN, logLoss: n ? logLoss / n : NaN };
}

function auc(rows, probs) {
  const pairs = rows.map((row, i) => ({ y: row.errorY, p: probs[i] })).sort((a, b) => a.p - b.p);
  let rankSum = 0;
  let positives = 0;
  let negatives = 0;
  let i = 0;
  while (i < pairs.length) {
    let j = i + 1;
    while (j < pairs.length && Math.abs(pairs[j].p - pairs[i].p) < 1e-12) j++;
    const averageRank = ((i + 1) + j) / 2;
    for (let k = i; k < j; k++) {
      if (pairs[k].y === 1) {
        rankSum += averageRank;
        positives++;
      } else negatives++;
    }
    i = j;
  }
  if (!positives || !negatives) return NaN;
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function chooseHyperparameters(buildRows, validationRows) {
  const scaler = fitStandardizer(buildRows);
  const lambdas = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1];
  const calibrationScales = [0.75, 0.9, 1, 1.1, 1.25];
  let best = null;
  for (const lambda of lambdas) {
    const model = fitLogistic(buildRows, scaler, lambda);
    for (const calibrationScale of calibrationScales) {
      const probs = validationRows.map(row => modelProbability(model, row.x, calibrationScale));
      const score = probabilityMetrics(validationRows, probs);
      const candidate = { lambda, calibrationScale, score, auc: auc(validationRows, probs) };
      if (!best || score.brier < best.score.brier - 1e-12 ||
        (Math.abs(score.brier - best.score.brier) < 1e-12 && score.logLoss < best.score.logLoss)) {
        best = candidate;
      }
    }
  }
  return best;
}

function flagStats(rows, probs, threshold) {
  const totalErrors = rows.reduce((sum, row) => sum + row.errorY, 0);
  const flaggedIndexes = [];
  let flaggedErrors = 0;
  for (let i = 0; i < rows.length; i++) {
    if (probs[i] >= threshold) {
      flaggedIndexes.push(i);
      flaggedErrors += rows[i].errorY;
    }
  }
  const flagged = flaggedIndexes.length;
  const unflagged = rows.length - flagged;
  const unflaggedErrors = totalErrors - flaggedErrors;
  const baseErrorRate = rows.length ? totalErrors / rows.length : NaN;
  const precision = flagged ? flaggedErrors / flagged : 0;
  const recall = totalErrors ? flaggedErrors / totalErrors : 0;
  const flagRate = rows.length ? flagged / rows.length : 0;
  const lift = baseErrorRate ? precision / baseErrorRate : NaN;
  const unflaggedErrorRate = unflagged ? unflaggedErrors / unflagged : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return {
    threshold,
    n: rows.length,
    totalErrors,
    baseErrorRate,
    flagged,
    flaggedErrors,
    falseAlarms: flagged - flaggedErrors,
    precision,
    recall,
    f1,
    flagRate,
    lift,
    unflagged,
    unflaggedErrors,
    unflaggedErrorRate,
    flaggedIndexes
  };
}

function chooseThreshold(rows, probs) {
  const candidates = [];
  for (let threshold = 0.2; threshold <= 0.8001; threshold += 0.025) {
    const stats = flagStats(rows, probs, Number(threshold.toFixed(3)));
    if (stats.flagged < Math.max(12, Math.ceil(rows.length * 0.08))) continue;
    if (stats.flagRate > 0.35) continue;
    candidates.push(stats);
  }
  if (!candidates.length) throw new Error('No threshold candidate satisfied minimum/maximum flag-rate constraints.');
  candidates.sort((a, b) =>
    b.f1 - a.f1 ||
    b.lift - a.lift ||
    b.precision - a.precision ||
    a.flagRate - b.flagRate
  );
  const selected = candidates[0];
  return {
    selected,
    tuningSignalPass: selected.lift >= 1.2 && selected.recall >= 0.2 && selected.precision > selected.baseErrorRate,
    candidates: candidates.map(({ flaggedIndexes, ...rest }) => rest)
  };
}

function topSignals(model, row, count = 3) {
  const xs = transform(row.x, model.scaler);
  return FEATURE_NAMES
    .map((feature, i) => ({ feature, contribution: model.weights[i] * xs[i], value: row.x[i] }))
    .filter(item => item.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, count)
    .map(item => ({
      feature: item.feature,
      contribution: Number(item.contribution.toFixed(4)),
      value: Number(item.value.toFixed(4))
    }));
}

function describeRows(rows, probs, threshold, model) {
  return rows.map((row, i) => ({
    week: row.week,
    gameId: row.gameId,
    matchup: `${row.awayTeam} @ ${row.homeTeam}`,
    actual: row.actualHomeWin ? row.homeTeam : row.awayTeam,
    baselinePick: row.baselinePick,
    baselineCorrect: row.baselineCorrect,
    baselinePHome: Number(row.baselinePHome.toFixed(4)),
    baselineConfidence: Number(Math.max(row.baselinePHome, 1 - row.baselinePHome).toFixed(4)),
    spreadLine: row.spreadLine,
    vulnerabilityProbability: Number(probs[i].toFixed(4)),
    flaggedVulnerable: probs[i] >= threshold,
    topRiskSignals: topSignals(model, row)
  }));
}

const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
const fixed = value => Number.isFinite(value) ? value.toFixed(4) : 'n/a';

async function main() {
  console.log('Downloading nflverse schedule + play-by-play for baseline-error meta-model...');
  const [gamesText, ...pbpTexts] = await Promise.all([
    fetchText(GAMES_URL),
    ...PBP_SEASONS.map(season => fetchGzipText(PBP_URL(season)))
  ]);
  const schedule = parseSchedule(gamesText);
  const pbpBySeason = new Map(PBP_SEASONS.map((season, i) => [season, aggregatePbp(pbpTexts[i])]));
  const examples = buildExamples(schedule, pbpBySeason);

  const build = examples.filter(row => row.season === BUILD_SEASON);
  const hyperparam = examples.filter(row => row.season === HYPERPARAM_SEASON);
  const thresholdTune = examples.filter(row => row.season === THRESHOLD_SEASON);
  const test = examples.filter(row => row.season === TEST_SEASON && TEST_WEEKS.has(row.week));

  if (build.length < 180 || hyperparam.length < 180 || thresholdTune.length < 180 || test.length < 40) {
    throw new Error(`Unexpected sample sizes: build=${build.length}, hyperparam=${hyperparam.length}, thresholdTune=${thresholdTune.length}, test=${test.length}`);
  }

  console.log(`Running locked v2.2 on ${build.length + hyperparam.length + thresholdTune.length + test.length} chronological games...`);
  const [buildBase, hyperparamBase, thresholdBase, testBase] = await Promise.all([
    baselineProbabilities(build),
    baselineProbabilities(hyperparam),
    baselineProbabilities(thresholdTune),
    baselineProbabilities(test)
  ]);

  const buildMeta = makeMetaRows(build, buildBase);
  const hyperparamMeta = makeMetaRows(hyperparam, hyperparamBase);
  const thresholdMeta = makeMetaRows(thresholdTune, thresholdBase);
  const testMeta = makeMetaRows(test, testBase);

  const selected = chooseHyperparameters(buildMeta, hyperparamMeta);
  if (!selected) throw new Error('Hyperparameter selection failed.');

  const trainingMeta = [...buildMeta, ...hyperparamMeta];
  const finalScaler = fitStandardizer(trainingMeta);
  const finalModel = fitLogistic(trainingMeta, finalScaler, selected.lambda);

  const thresholdProbs = thresholdMeta.map(row => modelProbability(finalModel, row.x, selected.calibrationScale));
  const thresholdProbabilityScore = probabilityMetrics(thresholdMeta, thresholdProbs);
  const thresholdAuc = auc(thresholdMeta, thresholdProbs);
  const thresholdChoice = chooseThreshold(thresholdMeta, thresholdProbs);
  const frozenThreshold = thresholdChoice.selected.threshold;

  const testProbs = testMeta.map(row => modelProbability(finalModel, row.x, selected.calibrationScale));
  const testProbabilityScore = probabilityMetrics(testMeta, testProbs);
  const testAuc = auc(testMeta, testProbs);
  const testFlags = flagStats(testMeta, testProbs, frozenThreshold);
  const heldoutSignalPass =
    testFlags.flagged >= 5 &&
    testFlags.precision > testFlags.baseErrorRate &&
    testFlags.lift >= 1.2 &&
    testFlags.recall >= 0.2;

  const gameTable = describeRows(testMeta, testProbs, frozenThreshold, finalModel);
  const flaggedGames = gameTable.filter(row => row.flaggedVulnerable);

  console.log('\nBaseline-error meta-model — frozen vulnerability test');
  console.log('=====================================================');
  console.log(`Build coefficients: ${BUILD_SEASON} (${buildMeta.length} games)`);
  console.log(`Choose L2/calibration: ${HYPERPARAM_SEASON} (${hyperparamMeta.length} games)`);
  console.log(`Choose vulnerability threshold: ${THRESHOLD_SEASON} (${thresholdMeta.length} games)`);
  console.log(`Untouched test: ${TEST_SEASON} Weeks 16-18 (${testMeta.length} games)`);
  console.log(`Selected L2=${selected.lambda}, calibration=${selected.calibrationScale}, threshold=${frozenThreshold}`);
  console.log(`2024 error rate=${pct(thresholdChoice.selected.baseErrorRate)}; flagged=${thresholdChoice.selected.flagged}; precision=${pct(thresholdChoice.selected.precision)}; recall=${pct(thresholdChoice.selected.recall)}; lift=${fixed(thresholdChoice.selected.lift)}x`);
  console.log(`2025 held-out error rate=${pct(testFlags.baseErrorRate)}; flagged=${testFlags.flagged}; flagged misses=${testFlags.flaggedErrors}; precision=${pct(testFlags.precision)}; recall=${pct(testFlags.recall)}; lift=${fixed(testFlags.lift)}x`);
  console.log(`Held-out vulnerability signal: ${heldoutSignalPass ? 'PASS for larger research validation' : 'FAIL / insufficient stability'}`);
  console.log('Production action: NONE. This model only flags vulnerability; it never changes the winner.');

  console.log('\nFlagged held-out games');
  if (!flaggedGames.length) console.log('  none');
  for (const row of flaggedGames) {
    console.log(`  ${row.gameId} ${row.matchup}: v2.2 ${row.baselinePick} (${row.baselineCorrect ? 'correct' : 'wrong'}), vulnerability=${pct(row.vulnerabilityProbability)}, signals=${row.topRiskSignals.map(s => s.feature).join('; ') || 'none'}`);
  }

  const coefficients = FEATURE_NAMES.map((feature, i) => ({
    feature,
    weight: finalModel.weights[i],
    direction: finalModel.weights[i] > 0 ? 'higher increases predicted v2.2 error risk' : finalModel.weights[i] < 0 ? 'higher decreases predicted v2.2 error risk' : 'neutral'
  })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  const report = {
    source: 'nflverse games.csv + play-by-play; v2.2 production probabilities',
    methodology: {
      target: 'Whether locked production v2.2 picked the game winner incorrectly',
      featureNames: FEATURE_NAMES,
      rollingWindow: WINDOW,
      decay: DECAY,
      minimumPriorGames: MIN_HISTORY,
      buildSeason: BUILD_SEASON,
      hyperparameterSeason: HYPERPARAM_SEASON,
      thresholdTuneSeason: THRESHOLD_SEASON,
      frozenTest: { season: TEST_SEASON, weeks: [...TEST_WEEKS] },
      selectedL2: selected.lambda,
      selectedCalibrationScale: selected.calibrationScale,
      frozenVulnerabilityThreshold: frozenThreshold,
      thresholdSelection: 'Maximize F1 on 2024 among rules flagging at least 8%/12 games and no more than 35% of games',
      no2025OutcomeUsedForModelOrThreshold: true,
      productionMutation: false,
      winnerOverrideAllowed: false
    },
    hyperparameterValidation2023: {
      probability: selected.score,
      auc: selected.auc
    },
    thresholdTuning2024: {
      probability: thresholdProbabilityScore,
      auc: thresholdAuc,
      selected: Object.fromEntries(Object.entries(thresholdChoice.selected).filter(([key]) => key !== 'flaggedIndexes')),
      tuningSignalPass: thresholdChoice.tuningSignalPass
    },
    heldout2025Weeks16to18: {
      probability: testProbabilityScore,
      auc: testAuc,
      flags: Object.fromEntries(Object.entries(testFlags).filter(([key]) => key !== 'flaggedIndexes')),
      heldoutSignalPass,
      gameTable
    },
    coefficients,
    conclusion: heldoutSignalPass
      ? 'The frozen meta-model concentrated v2.2 misses above the overall miss rate on the untouched sample. This warrants a larger walk-forward validation, not a production override.'
      : 'The frozen meta-model did not show sufficient held-out concentration of v2.2 misses. Do not use it to alter production picks.'
  };

  await Bun.write('research/baseline-error-meta-model-2025-w16-18.json', JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
