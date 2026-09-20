import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService.ts';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const TUNE_SEASON = 2024;
const TEST_SEASON = 2025;
const TEST_WEEKS = new Set([16, 17, 18]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const logistic = x => 1 / (1 + Math.exp(-clamp(x, -35, 35)));
const logit = p => Math.log(clamp(p, 0.001, 0.999) / (1 - clamp(p, 0.001, 0.999)));

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

function parseWithSpread(text) {
  const games = parseGamesCsv(text);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const gameIdIdx = headers.indexOf('game_id');
  const spreadIdx = headers.indexOf('spread_line');
  const spreadById = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const id = gameIdIdx >= 0 ? cells[gameIdIdx] : '';
    const spread = spreadIdx >= 0 ? Number(cells[spreadIdx]) : NaN;
    if (id && Number.isFinite(spread)) spreadById.set(id, spread);
  }
  return games.map(game => ({ ...game, spreadLine: spreadById.get(game.gameId) }));
}

async function getBaseline(rows) {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const out = [];
  for (const game of rows) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) throw new Error(`Team registry missing ${game.homeTeam} or ${game.awayTeam}`);
    const result = await predictWinner(home, away, new Date(`${game.gameday}T12:00:00Z`), true, { neutralSite: game.location === 'Neutral' });
    const pHome = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === game.homeTeam ? result.confidence / 100 : 1 - result.confidence / 100;
    out.push(pHome);
  }
  return out;
}

function metrics(rows, probs) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (let i = 0; i < rows.length; i++) {
    const y = rows[i].homeScore > rows[i].awayScore ? 1 : 0;
    const p = clamp(probs[i], 0.001, 0.999);
    if ((p >= 0.5 ? 1 : 0) === y) correct++;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  const n = rows.length;
  return { n, correct, accuracy: correct / n, brier: brier / n, logLoss: logLoss / n };
}

function combinedProb(baseP, spreadLine, beta) {
  return logistic(logit(baseP) + beta * (spreadLine / 7));
}

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);
  const games = parseWithSpread(await response.text());
  const eligible = game => game.gameType === 'REG' && Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore) && game.homeScore !== game.awayScore && Number.isFinite(game.spreadLine);
  const tune = games.filter(game => game.season === TUNE_SEASON && eligible(game));
  const test = games.filter(game => game.season === TEST_SEASON && TEST_WEEKS.has(game.week) && eligible(game));
  if (tune.length < 250 || test.length < 40) throw new Error(`Unexpected sample sizes: tune=${tune.length}, test=${test.length}`);

  console.log(`Running v2.2 across ${tune.length} 2024 tuning games...`);
  const tuneBase = await getBaseline(tune);
  const betas = [0, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2];
  let best = null;
  for (const beta of betas) {
    const score = metrics(tune, tune.map((game, i) => combinedProb(tuneBase[i], game.spreadLine, beta)));
    if (!best || score.brier < best.score.brier - 1e-12 || (Math.abs(score.brier - best.score.brier) < 1e-12 && score.logLoss < best.score.logLoss)) {
      best = { beta, score };
    }
  }

  console.log(`Frozen beta from 2024: ${best.beta}`);
  console.log(`Running held-out 2025 Weeks 16-18 (${test.length} games)...`);
  const testBase = await getBaseline(test);
  const testCombined = test.map((game, i) => combinedProb(testBase[i], game.spreadLine, best.beta));
  const baseline = metrics(test, testBase);
  const combined = metrics(test, testCombined);

  let marketCorrect = 0;
  for (const game of test) {
    const y = game.homeScore > game.awayScore ? 1 : 0;
    if (((game.spreadLine > 0) ? 1 : 0) === y) marketCorrect++;
  }

  const flips = [];
  for (let i = 0; i < test.length; i++) {
    const basePick = testBase[i] >= 0.5 ? 1 : 0;
    const newPick = testCombined[i] >= 0.5 ? 1 : 0;
    if (basePick === newPick) continue;
    const y = test[i].homeScore > test[i].awayScore ? 1 : 0;
    flips.push({
      gameId: test[i].gameId,
      matchup: `${test[i].awayTeam} @ ${test[i].homeTeam}`,
      spreadLine: test[i].spreadLine,
      actual: y ? test[i].homeTeam : test[i].awayTeam,
      baselinePick: basePick ? test[i].homeTeam : test[i].awayTeam,
      marketAssistedPick: newPick ? test[i].homeTeam : test[i].awayTeam,
      baselineCorrect: basePick === y,
      marketAssistedCorrect: newPick === y,
      baselinePHome: Number(testBase[i].toFixed(4)),
      marketAssistedPHome: Number(testCombined[i].toFixed(4))
    });
  }

  const fixed = flips.filter(x => !x.baselineCorrect && x.marketAssistedCorrect).length;
  const broken = flips.filter(x => x.baselineCorrect && !x.marketAssistedCorrect).length;
  const strictPromotionPass = combined.accuracy > baseline.accuracy && combined.brier < baseline.brier && combined.logLoss < baseline.logLoss;
  const pct = x => `${(x * 100).toFixed(2)}%`;

  console.log('\nMarket-assisted professional challenger');
  console.log('========================================');
  console.log(`2024 tuning: ${best.score.correct}/${best.score.n} = ${pct(best.score.accuracy)}, Brier ${best.score.brier.toFixed(4)}, log loss ${best.score.logLoss.toFixed(4)}`);
  console.log(`2025 W16-18 v2.2: ${baseline.correct}/${baseline.n} = ${pct(baseline.accuracy)}, Brier ${baseline.brier.toFixed(4)}, log loss ${baseline.logLoss.toFixed(4)}`);
  console.log(`2025 W16-18 v2.2 + market: ${combined.correct}/${combined.n} = ${pct(combined.accuracy)}, Brier ${combined.brier.toFixed(4)}, log loss ${combined.logLoss.toFixed(4)}`);
  console.log(`Closing-spread favorite: ${marketCorrect}/${test.length} = ${pct(marketCorrect / test.length)}`);
  console.log(`Flip audit: ${flips.length} changes; ${fixed} misses fixed; ${broken} hits broken.`);
  console.log(`Promotion gate: ${strictPromotionPass ? 'PASS — larger untouched validation warranted' : 'FAIL — production remains unchanged'}`);

  const report = {
    source: 'nflverse games.csv closing spread',
    tuning: { season: 2024, beta: best.beta, metrics: best.score },
    heldout: { season: 2025, weeks: [...TEST_WEEKS], baseline, marketAssisted: combined, marketFavorite: { n: test.length, correct: marketCorrect, accuracy: marketCorrect / test.length }, flips, fixed, broken, strictPromotionPass },
    note: 'Closing spread is pregame market consensus and is evaluated separately from the football-stat-only challenger. It should only be used when a current market line is available at prediction time.'
  };
  await Bun.write('research/market-challenger-2025-w16-18.json', JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
