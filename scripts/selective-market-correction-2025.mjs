import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService.ts';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const BETA_TUNE_SEASONS = new Set([2022, 2023]);
const GATE_TUNE_SEASON = 2024;
const TEST_SEASON = 2025;
const TEST_WEEKS = new Set([16, 17, 18]);
const FLIP_PROB = 0.501;

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
    const result = await predictWinner(
      home,
      away,
      new Date(`${game.gameday}T12:00:00Z`),
      true,
      { neutralSite: game.location === 'Neutral' }
    );
    const pHome = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : result.winner.abbr === game.homeTeam
        ? result.confidence / 100
        : 1 - result.confidence / 100;
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

function tuneBeta(rows, base) {
  const betas = [0, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2];
  let best = null;
  for (const beta of betas) {
    const probs = rows.map((game, i) => combinedProb(base[i], game.spreadLine, beta));
    const score = metrics(rows, probs);
    if (!best || score.brier < best.score.brier - 1e-12 || (Math.abs(score.brier - best.score.brier) < 1e-12 && score.logLoss < best.score.logLoss)) {
      best = { beta, score };
    }
  }
  return best;
}

function pick(p) {
  return p >= 0.5 ? 1 : 0;
}

function confidence(p) {
  return Math.max(p, 1 - p);
}

function candidateRules() {
  const maxBaseConf = [0.525, 0.55, 0.575, 0.6, 0.625];
  const maxCrossConf = [0.51, 0.525, 0.55, 0.575, 0.6];
  const minAbsSpread = [0, 1, 2, 3, 4];
  const rules = [];
  for (const base of maxBaseConf) {
    for (const cross of maxCrossConf) {
      for (const spread of minAbsSpread) {
        rules.push({ maxBaseConfidence: base, maxCrossConfidence: cross, minAbsSpread: spread });
      }
    }
  }
  return rules;
}

function shouldFlip(baseP, marketP, spreadLine, rule) {
  if (pick(baseP) === pick(marketP)) return false;
  if (confidence(baseP) > rule.maxBaseConfidence) return false;
  if (confidence(marketP) > rule.maxCrossConfidence) return false;
  if (Math.abs(spreadLine) < rule.minAbsSpread) return false;
  return true;
}

function applyGate(rows, base, market, rule) {
  let flips = 0;
  const probs = rows.map((game, i) => {
    if (!shouldFlip(base[i], market[i], game.spreadLine, rule)) return base[i];
    flips++;
    return pick(market[i]) === 1 ? FLIP_PROB : 1 - FLIP_PROB;
  });
  return { probs, flips, score: metrics(rows, probs) };
}

function tuneGate(rows, base, market) {
  const baseline = metrics(rows, base);
  let best = null;
  for (const rule of candidateRules()) {
    const result = applyGate(rows, base, market, rule);
    // Avoid tiny one-off rules. The gate has to demonstrate repeated use in the tuning year.
    if (result.flips < 8) continue;
    const improvement = result.score.correct - baseline.correct;
    if (improvement <= 0) continue;
    // We are designing a decision-correction layer, not a new probability model.
    // Reject candidates that materially damage probability quality on tuning data.
    if (result.score.brier > baseline.brier + 0.0025) continue;
    if (result.score.logLoss > baseline.logLoss + 0.005) continue;
    if (
      !best ||
      result.score.correct > best.result.score.correct ||
      (result.score.correct === best.result.score.correct && result.score.brier < best.result.score.brier - 1e-12) ||
      (result.score.correct === best.result.score.correct && Math.abs(result.score.brier - best.result.score.brier) < 1e-12 && result.flips < best.result.flips)
    ) {
      best = { rule, result };
    }
  }
  return { baseline, best };
}

function describeGame(game, baseP, marketP, correctedP, rule) {
  const y = game.homeScore > game.awayScore ? 1 : 0;
  const basePick = pick(baseP);
  const marketPick = pick(marketP);
  const finalPick = pick(correctedP);
  const triggered = basePick !== finalPick;
  const actual = y ? game.homeTeam : game.awayTeam;
  return {
    week: game.week,
    gameId: game.gameId,
    matchup: `${game.awayTeam} @ ${game.homeTeam}`,
    spreadLine: game.spreadLine,
    actual,
    baselinePick: basePick ? game.homeTeam : game.awayTeam,
    marketDirection: marketPick ? game.homeTeam : game.awayTeam,
    correctedPick: finalPick ? game.homeTeam : game.awayTeam,
    baselineCorrect: basePick === y,
    correctedCorrect: finalPick === y,
    gateTriggered: triggered,
    baselinePHome: Number(baseP.toFixed(4)),
    marketCombinedPHome: Number(marketP.toFixed(4)),
    correctedPHome: Number(correctedP.toFixed(4)),
    baselineConfidence: Number(confidence(baseP).toFixed(4)),
    marketCombinedConfidence: Number(confidence(marketP).toFixed(4)),
    gateReason: triggered
      ? `v2.2/market disagree; base confidence <= ${rule.maxBaseConfidence}; market-cross confidence <= ${rule.maxCrossConfidence}; |spread| >= ${rule.minAbsSpread}`
      : 'No override'
  };
}

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);
  const games = parseWithSpread(await response.text());
  const eligible = game =>
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore &&
    Number.isFinite(game.spreadLine);

  const betaTune = games.filter(game => BETA_TUNE_SEASONS.has(game.season) && eligible(game));
  const gateTune = games.filter(game => game.season === GATE_TUNE_SEASON && eligible(game));
  const test = games.filter(game => game.season === TEST_SEASON && TEST_WEEKS.has(game.week) && eligible(game));
  if (betaTune.length < 500 || gateTune.length < 250 || test.length < 40) {
    throw new Error(`Unexpected sample sizes: betaTune=${betaTune.length}, gateTune=${gateTune.length}, test=${test.length}`);
  }

  console.log(`Running v2.2 on ${betaTune.length} 2022-23 beta-tuning games...`);
  const betaTuneBase = await getBaseline(betaTune);
  const betaChoice = tuneBeta(betaTune, betaTuneBase);
  console.log(`Frozen market beta from 2022-23: ${betaChoice.beta}`);

  console.log(`Running v2.2 on ${gateTune.length} 2024 gate-tuning games...`);
  const gateTuneBase = await getBaseline(gateTune);
  const gateTuneMarket = gateTune.map((game, i) => combinedProb(gateTuneBase[i], game.spreadLine, betaChoice.beta));
  const gateChoice = tuneGate(gateTune, gateTuneBase, gateTuneMarket);

  if (!gateChoice.best) {
    const report = {
      source: 'nflverse games.csv closing spread',
      methodology: {
        betaTuneSeasons: [...BETA_TUNE_SEASONS],
        gateTuneSeason: GATE_TUNE_SEASON,
        heldout: { season: TEST_SEASON, weeks: [...TEST_WEEKS] },
        flipProbability: FLIP_PROB,
        productionMutation: false
      },
      beta: betaChoice,
      gateTuneBaseline: gateChoice.baseline,
      gate: null,
      conclusion: 'No selective correction gate improved 2024 accuracy while satisfying minimum-use and probability-quality constraints. No held-out rule was promoted or tested as a candidate correction.'
    };
    await Bun.write('research/selective-market-correction-2025-w16-18.json', JSON.stringify(report, null, 2));
    console.log(report.conclusion);
    return;
  }

  const frozenRule = gateChoice.best.rule;
  console.log(`Frozen selective gate from 2024: ${JSON.stringify(frozenRule)}`);
  console.log(`2024 gate result: ${gateChoice.best.result.score.correct}/${gateChoice.best.result.score.n}; flips=${gateChoice.best.result.flips}`);

  console.log(`Running untouched 2025 Weeks 16-18 (${test.length} games)...`);
  const testBase = await getBaseline(test);
  const testMarket = test.map((game, i) => combinedProb(testBase[i], game.spreadLine, betaChoice.beta));
  const testGate = applyGate(test, testBase, testMarket, frozenRule);
  const baseline = metrics(test, testBase);
  const corrected = testGate.score;
  const gameTable = test.map((game, i) => describeGame(game, testBase[i], testMarket[i], testGate.probs[i], frozenRule));
  const flips = gameTable.filter(row => row.gateTriggered);
  const fixed = flips.filter(row => !row.baselineCorrect && row.correctedCorrect).length;
  const broken = flips.filter(row => row.baselineCorrect && !row.correctedCorrect).length;
  const strictPromotionPass =
    corrected.accuracy > baseline.accuracy &&
    corrected.brier < baseline.brier &&
    corrected.logLoss < baseline.logLoss;

  const report = {
    source: 'nflverse games.csv closing spread',
    methodology: {
      betaTuneSeasons: [...BETA_TUNE_SEASONS],
      gateTuneSeason: GATE_TUNE_SEASON,
      heldout: { season: TEST_SEASON, weeks: [...TEST_WEEKS] },
      flipProbability: FLIP_PROB,
      gateWasChosenWithoutUsing2025Outcomes: true,
      productionMutation: false
    },
    beta: betaChoice,
    gateTuning: {
      baseline: gateChoice.baseline,
      selectedRule: frozenRule,
      selectedResult: gateChoice.best.result
    },
    heldout: {
      baseline,
      selectiveCorrection: corrected,
      flips: testGate.flips,
      fixed,
      broken,
      strictPromotionPass,
      gameTable
    },
    conclusion: strictPromotionPass
      ? 'Selective correction passed all three untouched metrics. This warrants a larger untouched validation before any production promotion.'
      : 'Selective correction failed at least one strict untouched metric. Production remains unchanged.'
  };

  await Bun.write('research/selective-market-correction-2025-w16-18.json', JSON.stringify(report, null, 2));

  const pct = x => `${(x * 100).toFixed(2)}%`;
  console.log('\nSelective market correction — untouched 2025 Weeks 16-18');
  console.log('==========================================================');
  console.log(`v2.2 baseline: ${baseline.correct}/${baseline.n} = ${pct(baseline.accuracy)}, Brier ${baseline.brier.toFixed(4)}, log loss ${baseline.logLoss.toFixed(4)}`);
  console.log(`Selective gate: ${corrected.correct}/${corrected.n} = ${pct(corrected.accuracy)}, Brier ${corrected.brier.toFixed(4)}, log loss ${corrected.logLoss.toFixed(4)}`);
  console.log(`Gate flips: ${testGate.flips}; fixed=${fixed}; broken=${broken}`);
  console.log(`Strict promotion gate: ${strictPromotionPass ? 'PASS' : 'FAIL'}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
