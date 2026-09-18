import { parseGamesCsv, parseTeamData, predictWinner } from '../services/numerologyService';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

type Variant = { n: number; correct: number; brier: number };

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const bounded = Math.max(0.001, Math.min(0.999, p));
  return Math.log(bounded / (1 - bounded));
};

function scoreVariant(variant: Variant, pHome: number, actualHome: boolean) {
  variant.n++;
  const pickedHome = pHome >= 0.5;
  if (pickedHome === actualHome) variant.correct++;
  variant.brier += Math.pow(pHome - (actualHome ? 1 : 0), 2);
}

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
  const variants: Record<string, Variant> = {
    'Elo only': { n: 0, correct: 0, brier: 0 },
    'Elo + recent/current form': { n: 0, correct: 0, brier: 0 },
    'Core + venue/H2H': { n: 0, correct: 0, brier: 0 },
    'Football context, no numerology': { n: 0, correct: 0, brier: 0 },
    'Football context, no numerology/rest': { n: 0, correct: 0, brier: 0 },
    'Football context, no numerology/venue/H2H': { n: 0, correct: 0, brier: 0 },
    'Football context, no numerology/rest/venue/H2H': { n: 0, correct: 0, brier: 0 },
    'Full v2': { n: 0, correct: 0, brier: 0 },
    'Full minus H2H': { n: 0, correct: 0, brier: 0 },
    'Full minus home/road refinement': { n: 0, correct: 0, brier: 0 },
    'Full minus recent/current-season form': { n: 0, correct: 0, brier: 0 },
    'Full minus rest': { n: 0, correct: 0, brier: 0 }
  };

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

    if (result.modelScores) {
      const s = result.modelScores;
      const base = logit(s.baseHomeProbability / 100);
      const form = s.footballLogitAdjustment;
      const venue = s.venueLogitAdjustment;
      const personnel = s.personnelLogitAdjustment;
      const rest = s.restLogitAdjustment;
      const h2h = s.h2hLogitAdjustment;
      const numerology = s.numerologyLogitAdjustment;
      const football = form + venue + personnel + rest + h2h;
      const full = football + numerology;

      scoreVariant(variants['Elo only'], logistic(base), actualHome);
      scoreVariant(variants['Elo + recent/current form'], logistic(base + form), actualHome);
      scoreVariant(variants['Core + venue/H2H'], logistic(base + form + venue + h2h), actualHome);
      scoreVariant(variants['Football context, no numerology'], logistic(base + football), actualHome);
      scoreVariant(variants['Football context, no numerology/rest'], logistic(base + football - rest), actualHome);
      scoreVariant(variants['Football context, no numerology/venue/H2H'], logistic(base + football - venue - h2h), actualHome);
      scoreVariant(variants['Football context, no numerology/rest/venue/H2H'], logistic(base + football - rest - venue - h2h), actualHome);
      scoreVariant(variants['Full v2'], logistic(base + full), actualHome);
      scoreVariant(variants['Full minus H2H'], logistic(base + full - h2h), actualHome);
      scoreVariant(variants['Full minus home/road refinement'], logistic(base + full - venue), actualHome);
      scoreVariant(variants['Full minus recent/current-season form'], logistic(base + full - form), actualHome);
      scoreVariant(variants['Full minus rest'], logistic(base + full - rest), actualHome);
    }
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

  console.log('\nAblation / incremental-value check:');
  for (const [name, value] of Object.entries(variants)) {
    const variantAccuracy = value.n ? value.correct / value.n : 0;
    const variantBrier = value.n ? value.brier / value.n : 0;
    console.log(`  ${name}: ${value.correct}/${value.n} = ${(variantAccuracy * 100).toFixed(2)}%, Brier ${variantBrier.toFixed(4)}`);
  }

  const withNumerology = variants['Full v2'];
  const withoutNumerology = variants['Football context, no numerology'];
  if (withNumerology.n && withoutNumerology.n) {
    const delta = ((withNumerology.correct / withNumerology.n) - (withoutNumerology.correct / withoutNumerology.n)) * 100;
    console.log(`  Numerology incremental accuracy at the LOCKED v2 weight: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} points`);
  }

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
