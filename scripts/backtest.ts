import { parseGamesCsv, parseTeamData, predictWinner } from '../services/numerologyService';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);
  const games = parseGamesCsv(await response.text());
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));

  const sample = games.filter(game =>
    game.season === 2025 &&
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );

  let correct = 0;
  let incorrect = 0;
  let homePicks = 0;
  let awayPicks = 0;
  let homePickCorrect = 0;
  let awayPickCorrect = 0;
  let actualHomeWins = 0;
  let skipped = 0;
  let brier = 0;
  const confidenceBuckets = new Map<string, { n: number; correct: number; confidence: number }>();

  for (const game of sample) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) {
      skipped++;
      continue;
    }

    const result = await predictWinner(
      home,
      away,
      new Date(`${game.gameday}T12:00:00Z`),
      true,
      { neutralSite: game.location === 'Neutral' }
    );

    const actualHome = game.homeScore! > game.awayScore!;
    const pickedHome = result.winner.abbr === home.abbr;
    const hit = pickedHome === actualHome;
    const pHome = result.modelScores ? result.modelScores.finalHomeProbability / 100 : pickedHome ? result.confidence / 100 : 1 - result.confidence / 100;

    if (actualHome) actualHomeWins++;
    if (pickedHome) {
      homePicks++;
      if (hit) homePickCorrect++;
    } else {
      awayPicks++;
      if (hit) awayPickCorrect++;
    }

    if (hit) correct++;
    else incorrect++;

    brier += Math.pow(pHome - (actualHome ? 1 : 0), 2);
    const c = result.confidence;
    const key = c < 55 ? '50-54.9' : c < 60 ? '55-59.9' : c < 65 ? '60-64.9' : c < 70 ? '65-69.9' : '70+';
    const bucket = confidenceBuckets.get(key) || { n: 0, correct: 0, confidence: 0 };
    bucket.n++;
    bucket.correct += hit ? 1 : 0;
    bucket.confidence += c;
    confidenceBuckets.set(key, bucket);
  }

  const tested = correct + incorrect;
  const accuracy = tested ? correct / tested : 0;
  const alwaysHome = tested ? actualHomeWins / tested : 0;
  const homeAccuracy = homePicks ? homePickCorrect / homePicks : 0;
  const awayAccuracy = awayPicks ? awayPickCorrect / awayPicks : 0;

  console.log('\nNFL Predictor v2.0 — 2025 Regular-Season Backtest');
  console.log('================================================');
  console.log(`Games available: ${sample.length}`);
  console.log(`Games tested: ${tested}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Correct: ${correct}`);
  console.log(`Incorrect: ${incorrect}`);
  console.log(`Accuracy: ${(accuracy * 100).toFixed(2)}%`);
  console.log(`Correct:incorrect ratio: ${incorrect ? (correct / incorrect).toFixed(3) : '∞'}`);
  console.log(`Always-home baseline: ${(alwaysHome * 100).toFixed(2)}%`);
  console.log(`Lift vs always-home: ${((accuracy - alwaysHome) * 100).toFixed(2)} points`);
  console.log(`Home picks: ${homePicks}; accuracy ${(homeAccuracy * 100).toFixed(2)}%`);
  console.log(`Away picks: ${awayPicks}; accuracy ${(awayAccuracy * 100).toFixed(2)}%`);
  console.log(`Brier score: ${tested ? (brier / tested).toFixed(4) : 'n/a'}`);
  console.log('\nConfidence calibration:');
  for (const [key, value] of confidenceBuckets.entries()) {
    console.log(`  ${key}: ${value.n} picks, ${(value.correct / value.n * 100).toFixed(2)}% correct, ${(value.confidence / value.n).toFixed(1)}% mean model probability`);
  }

  if (tested < 260) throw new Error(`Backtest coverage too small: ${tested}`);
  if (skipped > 5) throw new Error(`Too many games skipped: ${skipped}`);
  if (!Number.isFinite(accuracy) || !Number.isFinite(brier)) throw new Error('Backtest produced invalid metrics');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
