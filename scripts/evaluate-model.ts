import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

interface ScoredGame {
  week: number;
  neutral: boolean;
  pickedHome: boolean;
  actualHome: boolean;
  pHome: number;
  confidence: number;
  hit: boolean;
  margin: number;
}

interface Aggregate {
  n: number;
  correct: number;
  brier: number;
  logLoss: number;
}

const clampProbability = (p: number) => Math.max(0.001, Math.min(0.999, p));

function score(rows: ScoredGame[]): Aggregate {
  return rows.reduce<Aggregate>((acc, row) => {
    const y = row.actualHome ? 1 : 0;
    const p = clampProbability(row.pHome);
    acc.n += 1;
    acc.correct += row.hit ? 1 : 0;
    acc.brier += Math.pow(p - y, 2);
    acc.logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    return acc;
  }, { n: 0, correct: 0, brier: 0, logLoss: 0 });
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function printAggregate(label: string, rows: ScoredGame[]) {
  const a = score(rows);
  if (!a.n) return;
  console.log(
    `${label.padEnd(26)} ${String(a.n).padStart(3)} games | ` +
    `${a.correct}/${a.n} ${pct(a.correct / a.n)} | ` +
    `Brier ${(a.brier / a.n).toFixed(4)} | ` +
    `LogLoss ${(a.logLoss / a.n).toFixed(4)}`
  );
}

function calibration(rows: ScoredGame[]) {
  const edges = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 1.01];
  let weightedError = 0;
  console.log('\nCalibration (selected-team confidence)');
  for (let i = 0; i < edges.length - 1; i++) {
    const low = edges[i];
    const high = edges[i + 1];
    const bucket = rows.filter(r => r.confidence >= low && r.confidence < high);
    if (!bucket.length) continue;
    const meanConfidence = bucket.reduce((sum, r) => sum + r.confidence, 0) / bucket.length;
    const actual = bucket.filter(r => r.hit).length / bucket.length;
    weightedError += Math.abs(meanConfidence - actual) * bucket.length / rows.length;
    console.log(
      `${Math.round(low * 100)}-${Math.round(Math.min(high, 1) * 100)}%`.padEnd(10) +
      ` ${String(bucket.length).padStart(3)} picks | mean ${pct(meanConfidence)} | actual ${pct(actual)}`
    );
  }
  console.log(`ECE: ${weightedError.toFixed(4)}`);
}

async function main() {
  const seasonArg = process.argv.find(arg => arg.startsWith('--season='));
  const season = Number(seasonArg?.split('=')[1] || 2025);
  if (!Number.isInteger(season) || season < 1999) throw new Error(`Invalid season: ${season}`);

  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);

  const games = parseGamesCsv(await response.text());
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const sample = games.filter(game =>
    game.season === season &&
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );

  const rows: ScoredGame[] = [];
  for (const game of sample) {
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;

    const result = await predictWinner(
      home,
      away,
      new Date(`${game.gameday}T12:00:00Z`),
      true,
      { neutralSite: game.location === 'Neutral' }
    );

    const actualHome = game.homeScore! > game.awayScore!;
    const pickedHome = result.winner.abbr === home.abbr;
    const pHome = result.modelScores?.finalHomeProbability != null
      ? result.modelScores.finalHomeProbability / 100
      : pickedHome ? result.confidence / 100 : 1 - result.confidence / 100;

    rows.push({
      week: game.week,
      neutral: game.location === 'Neutral',
      pickedHome,
      actualHome,
      pHome,
      confidence: pickedHome ? pHome : 1 - pHome,
      hit: pickedHome === actualHome,
      margin: Math.abs(game.homeScore! - game.awayScore!)
    });
  }

  console.log(`\nChronological evaluation — season ${season}`);
  console.log('============================================================');
  printAggregate('ALL', rows);
  printAggregate('Weeks 1-4', rows.filter(r => r.week >= 1 && r.week <= 4));
  printAggregate('Weeks 5-9', rows.filter(r => r.week >= 5 && r.week <= 9));
  printAggregate('Weeks 10-18', rows.filter(r => r.week >= 10 && r.week <= 18));
  printAggregate('Home picks', rows.filter(r => r.pickedHome));
  printAggregate('Away picks', rows.filter(r => !r.pickedHome));
  printAggregate('Neutral site', rows.filter(r => r.neutral));
  printAggregate('One-score results <=8', rows.filter(r => r.margin <= 8));
  printAggregate('Blowouts >=14', rows.filter(r => r.margin >= 14));
  printAggregate('Low conf <60%', rows.filter(r => r.confidence < 0.60));
  printAggregate('Medium 60-67%', rows.filter(r => r.confidence >= 0.60 && r.confidence < 0.67));
  printAggregate('High >=67%', rows.filter(r => r.confidence >= 0.67));
  calibration(rows);

  console.log('\nGovernance');
  console.log('- This script evaluates the existing production/control code; it does not mutate model weights.');
  console.log('- Historical live personnel remain blocked by the predictor retrospective guard.');
  console.log('- Market/favorite and injury-status splits are intentionally omitted until point-in-time historical sources are available.');
  console.log('- Do not use the evaluated season to tune parameters and then describe it as untouched validation.');

  if (rows.length < 200) throw new Error(`Evaluation coverage too small for a full regular season: ${rows.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
