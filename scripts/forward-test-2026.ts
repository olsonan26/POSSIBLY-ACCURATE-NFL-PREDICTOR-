import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
// Deliberately stop at Sept 14. On the audit date (Sept 18), Sept 17 is inside
// the live-personnel window and could accidentally use postgame/current injury data.
const SAFE_CUTOFF = '2026-09-14';

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);
  const games = parseGamesCsv(await response.text());
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));

  const sample = games.filter(game =>
    game.season === 2026 &&
    game.gameType === 'REG' &&
    game.gameday <= SAFE_CUTOFF &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );

  let correct = 0;
  let wrong = 0;
  let brier = 0;
  let homePicks = 0;
  let awayPicks = 0;
  let homeCorrect = 0;
  let awayCorrect = 0;
  let actualHomeWins = 0;

  console.log(`\nLocked v2.1 forward-style check — 2026 through ${SAFE_CUTOFF}`);
  console.log('=========================================================');

  for (const game of sample) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) throw new Error(`Missing registry team for ${game.awayTeam} @ ${game.homeTeam}`);

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
    const pHome = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : pickedHome ? result.confidence / 100 : 1 - result.confidence / 100;

    actualHomeWins += actualHome ? 1 : 0;
    if (pickedHome) {
      homePicks++;
      homeCorrect += hit ? 1 : 0;
    } else {
      awayPicks++;
      awayCorrect += hit ? 1 : 0;
    }
    hit ? correct++ : wrong++;
    brier += Math.pow(pHome - (actualHome ? 1 : 0), 2);

    const actualWinner = actualHome ? home.name : away.name;
    console.log(`${game.gameday} | ${away.name} @ ${home.name} | pick ${result.winner.name} ${result.confidence.toFixed(1)}% | actual ${actualWinner} | ${hit ? 'CORRECT' : 'WRONG'}`);
  }

  const n = correct + wrong;
  console.log('\nSummary');
  console.log(`Games tested: ${n}`);
  console.log(`Correct: ${correct}`);
  console.log(`Incorrect: ${wrong}`);
  console.log(`Accuracy: ${n ? (correct / n * 100).toFixed(2) : 'n/a'}%`);
  console.log(`Correct:incorrect ratio: ${wrong ? (correct / wrong).toFixed(3) : '∞'}`);
  console.log(`Always-home baseline: ${n ? (actualHomeWins / n * 100).toFixed(2) : 'n/a'}%`);
  console.log(`Home picks: ${homePicks}; accuracy ${homePicks ? (homeCorrect / homePicks * 100).toFixed(2) : 'n/a'}%`);
  console.log(`Away picks: ${awayPicks}; accuracy ${awayPicks ? (awayCorrect / awayPicks * 100).toFixed(2) : 'n/a'}%`);
  console.log(`Brier score: ${n ? (brier / n).toFixed(4) : 'n/a'}`);
  console.log('\nGovernance: these 2026 results are observational only. The model is not re-tuned from this output.');

  if (n < 10) throw new Error(`Too few 2026 games in safe forward sample: ${n}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
