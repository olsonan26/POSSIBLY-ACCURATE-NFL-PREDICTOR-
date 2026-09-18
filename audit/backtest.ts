import { parseTeamData, predictWinner } from '../services/numerologyService';
import { HISTORICAL_GAMES } from '../data/historicalGames';

type RealGame = {
  date: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
};

const realGames: RealGame[] = [
  // 2025 Week 1
  { date:'2025-09-04', away:'Dallas Cowboys', home:'Philadelphia Eagles', awayScore:20, homeScore:24 },
  { date:'2025-09-05', away:'Kansas City Chiefs', home:'Los Angeles Chargers', awayScore:21, homeScore:27 },
  { date:'2025-09-07', away:'Tampa Bay Buccaneers', home:'Atlanta Falcons', awayScore:23, homeScore:20 },
  { date:'2025-09-07', away:'Cincinnati Bengals', home:'Cleveland Browns', awayScore:17, homeScore:16 },
  { date:'2025-09-07', away:'Miami Dolphins', home:'Indianapolis Colts', awayScore:8, homeScore:33 },
  { date:'2025-09-07', away:'Carolina Panthers', home:'Jacksonville Jaguars', awayScore:10, homeScore:26 },
  { date:'2025-09-07', away:'Las Vegas Raiders', home:'New England Patriots', awayScore:20, homeScore:13 },
  { date:'2025-09-07', away:'Arizona Cardinals', home:'New Orleans Saints', awayScore:20, homeScore:13 },
  { date:'2025-09-07', away:'Pittsburgh Steelers', home:'New York Jets', awayScore:34, homeScore:32 },
  { date:'2025-09-07', away:'New York Giants', home:'Washington Commanders', awayScore:6, homeScore:21 },
  { date:'2025-09-07', away:'Tennessee Titans', home:'Denver Broncos', awayScore:12, homeScore:20 },
  { date:'2025-09-07', away:'San Francisco 49ers', home:'Seattle Seahawks', awayScore:17, homeScore:13 },
  { date:'2025-09-07', away:'Detroit Lions', home:'Green Bay Packers', awayScore:13, homeScore:27 },
  { date:'2025-09-07', away:'Houston Texans', home:'Los Angeles Rams', awayScore:9, homeScore:14 },
  { date:'2025-09-07', away:'Baltimore Ravens', home:'Buffalo Bills', awayScore:40, homeScore:41 },
  { date:'2025-09-08', away:'Minnesota Vikings', home:'Chicago Bears', awayScore:27, homeScore:24 },

  // 2025 Week 2
  { date:'2025-09-11', away:'Washington Commanders', home:'Green Bay Packers', awayScore:18, homeScore:27 },
  { date:'2025-09-14', away:'Cleveland Browns', home:'Baltimore Ravens', awayScore:17, homeScore:41 },
  { date:'2025-09-14', away:'Jacksonville Jaguars', home:'Cincinnati Bengals', awayScore:27, homeScore:31 },
  { date:'2025-09-14', away:'New York Giants', home:'Dallas Cowboys', awayScore:37, homeScore:40 },
  { date:'2025-09-14', away:'Chicago Bears', home:'Detroit Lions', awayScore:21, homeScore:52 },
  { date:'2025-09-14', away:'New England Patriots', home:'Miami Dolphins', awayScore:33, homeScore:27 },
  { date:'2025-09-14', away:'San Francisco 49ers', home:'New Orleans Saints', awayScore:26, homeScore:21 },
  { date:'2025-09-14', away:'Buffalo Bills', home:'New York Jets', awayScore:30, homeScore:10 },
  { date:'2025-09-14', away:'Seattle Seahawks', home:'Pittsburgh Steelers', awayScore:31, homeScore:17 },
  { date:'2025-09-14', away:'Los Angeles Rams', home:'Tennessee Titans', awayScore:33, homeScore:19 },
  { date:'2025-09-14', away:'Carolina Panthers', home:'Arizona Cardinals', awayScore:22, homeScore:27 },
  { date:'2025-09-14', away:'Denver Broncos', home:'Indianapolis Colts', awayScore:28, homeScore:29 },
  { date:'2025-09-14', away:'Philadelphia Eagles', home:'Kansas City Chiefs', awayScore:20, homeScore:17 },
  { date:'2025-09-14', away:'Atlanta Falcons', home:'Minnesota Vikings', awayScore:22, homeScore:6 },
  { date:'2025-09-15', away:'Tampa Bay Buccaneers', home:'Houston Texans', awayScore:20, homeScore:19 },
  { date:'2025-09-15', away:'Los Angeles Chargers', home:'Las Vegas Raiders', awayScore:20, homeScore:9 },

  // 2025 Week 3
  { date:'2025-09-18', away:'Miami Dolphins', home:'Buffalo Bills', awayScore:21, homeScore:31 },
  { date:'2025-09-21', away:'Atlanta Falcons', home:'Carolina Panthers', awayScore:0, homeScore:30 },
  { date:'2025-09-21', away:'Green Bay Packers', home:'Cleveland Browns', awayScore:10, homeScore:13 },
  { date:'2025-09-21', away:'Houston Texans', home:'Jacksonville Jaguars', awayScore:10, homeScore:17 },
  { date:'2025-09-21', away:'Cincinnati Bengals', home:'Minnesota Vikings', awayScore:10, homeScore:48 },
  { date:'2025-09-21', away:'Pittsburgh Steelers', home:'New England Patriots', awayScore:21, homeScore:14 },
  { date:'2025-09-21', away:'Los Angeles Rams', home:'Philadelphia Eagles', awayScore:26, homeScore:33 },
  { date:'2025-09-21', away:'New York Jets', home:'Tampa Bay Buccaneers', awayScore:27, homeScore:29 },
  { date:'2025-09-21', away:'Indianapolis Colts', home:'Tennessee Titans', awayScore:41, homeScore:20 },
  { date:'2025-09-21', away:'Las Vegas Raiders', home:'Washington Commanders', awayScore:24, homeScore:41 },
  { date:'2025-09-21', away:'Denver Broncos', home:'Los Angeles Chargers', awayScore:20, homeScore:23 },
  { date:'2025-09-21', away:'New Orleans Saints', home:'Seattle Seahawks', awayScore:13, homeScore:44 },
  { date:'2025-09-21', away:'Dallas Cowboys', home:'Chicago Bears', awayScore:14, homeScore:31 },
  { date:'2025-09-21', away:'Arizona Cardinals', home:'San Francisco 49ers', awayScore:15, homeScore:16 },
  { date:'2025-09-21', away:'Kansas City Chiefs', home:'New York Giants', awayScore:22, homeScore:9 },
  { date:'2025-09-22', away:'Detroit Lions', home:'Baltimore Ravens', awayScore:38, homeScore:30 },

  // 2025 Week 4
  { date:'2025-09-25', away:'Seattle Seahawks', home:'Arizona Cardinals', awayScore:23, homeScore:20 },
  { date:'2025-09-28', away:'Minnesota Vikings', home:'Pittsburgh Steelers', awayScore:21, homeScore:24 },
  { date:'2025-09-28', away:'New Orleans Saints', home:'Buffalo Bills', awayScore:19, homeScore:31 },
  { date:'2025-09-28', away:'Tennessee Titans', home:'Houston Texans', awayScore:0, homeScore:26 },
  { date:'2025-09-28', away:'Cleveland Browns', home:'Detroit Lions', awayScore:10, homeScore:34 },
  { date:'2025-09-28', away:'Washington Commanders', home:'Atlanta Falcons', awayScore:27, homeScore:34 },
  { date:'2025-09-28', away:'Philadelphia Eagles', home:'Tampa Bay Buccaneers', awayScore:31, homeScore:25 },
  { date:'2025-09-28', away:'Carolina Panthers', home:'New England Patriots', awayScore:13, homeScore:42 },
  { date:'2025-09-28', away:'Los Angeles Chargers', home:'New York Giants', awayScore:18, homeScore:21 },
  { date:'2025-09-28', away:'Jacksonville Jaguars', home:'San Francisco 49ers', awayScore:26, homeScore:21 },
  { date:'2025-09-28', away:'Indianapolis Colts', home:'Los Angeles Rams', awayScore:20, homeScore:27 },
  { date:'2025-09-28', away:'Chicago Bears', home:'Las Vegas Raiders', awayScore:25, homeScore:24 },
  { date:'2025-09-28', away:'Baltimore Ravens', home:'Kansas City Chiefs', awayScore:20, homeScore:37 },
  { date:'2025-09-28', away:'Green Bay Packers', home:'Dallas Cowboys', awayScore:40, homeScore:40 },
  { date:'2025-09-29', away:'New York Jets', home:'Miami Dolphins', awayScore:21, homeScore:27 },
  { date:'2025-09-29', away:'Cincinnati Bengals', home:'Denver Broncos', awayScore:3, homeScore:28 },

  // 2026 Week 1 + first completed Week 2 game
  { date:'2026-09-09', away:'New England Patriots', home:'Seattle Seahawks', awayScore:10, homeScore:13 },
  { date:'2026-09-10', away:'San Francisco 49ers', home:'Los Angeles Rams', awayScore:27, homeScore:7 },
  { date:'2026-09-13', away:'Chicago Bears', home:'Carolina Panthers', awayScore:59, homeScore:37 },
  { date:'2026-09-13', away:'Baltimore Ravens', home:'Indianapolis Colts', awayScore:41, homeScore:23 },
  { date:'2026-09-13', away:'Atlanta Falcons', home:'Pittsburgh Steelers', awayScore:13, homeScore:20 },
  { date:'2026-09-13', away:'Cleveland Browns', home:'Jacksonville Jaguars', awayScore:10, homeScore:34 },
  { date:'2026-09-13', away:'Tampa Bay Buccaneers', home:'Cincinnati Bengals', awayScore:27, homeScore:33 },
  { date:'2026-09-13', away:'New York Jets', home:'Tennessee Titans', awayScore:23, homeScore:10 },
  { date:'2026-09-13', away:'New Orleans Saints', home:'Detroit Lions', awayScore:30, homeScore:31 },
  { date:'2026-09-13', away:'Buffalo Bills', home:'Houston Texans', awayScore:36, homeScore:31 },
  { date:'2026-09-13', away:'Arizona Cardinals', home:'Los Angeles Chargers', awayScore:26, homeScore:14 },
  { date:'2026-09-13', away:'Green Bay Packers', home:'Minnesota Vikings', awayScore:22, homeScore:39 },
  { date:'2026-09-13', away:'Miami Dolphins', home:'Las Vegas Raiders', awayScore:13, homeScore:27 },
  { date:'2026-09-13', away:'Washington Commanders', home:'Philadelphia Eagles', awayScore:22, homeScore:24 },
  { date:'2026-09-13', away:'Dallas Cowboys', home:'New York Giants', awayScore:20, homeScore:28 },
  { date:'2026-09-14', away:'Denver Broncos', home:'Kansas City Chiefs', awayScore:10, homeScore:31 },
  { date:'2026-09-17', away:'Detroit Lions', home:'Buffalo Bills', awayScore:31, homeScore:41 },
];

const teams = parseTeamData();
const byName = new Map(teams.map(t => [t.name, t]));

function pct(n:number, d:number) { return d ? +(100*n/d).toFixed(1) : 0; }

function runRealSample() {
  const rows:any[] = [];
  for (const g of realGames) {
    if (g.homeScore === g.awayScore) continue;
    const home = byName.get(g.home);
    const away = byName.get(g.away);
    if (!home || !away) throw new Error(`Missing team mapping: ${g.away} @ ${g.home}`);
    const r = predictWinner(home, away, g.date, true);
    const actual = g.homeScore > g.awayScore ? g.home : g.away;
    const actualLocation = actual === g.home ? 'Home' : 'Away';
    const predictedLocation = r.winner.name === g.home ? 'Home' : 'Away';
    rows.push({
      ...g,
      actual,
      actualLocation,
      predicted:r.winner.name,
      predictedLocation,
      correct:r.winner.name === actual,
      confidence:r.confidence,
      historicalSeries: r.historicalSeries,
    });
  }

  const correct = rows.filter(r=>r.correct).length;
  const incorrect = rows.length-correct;
  const actualHome = rows.filter(r=>r.actualLocation==='Home');
  const actualAway = rows.filter(r=>r.actualLocation==='Away');
  const predictedHome = rows.filter(r=>r.predictedLocation==='Home');
  const predictedAway = rows.filter(r=>r.predictedLocation==='Away');
  const y2025 = rows.filter(r=>r.date.startsWith('2025'));
  const y2026 = rows.filter(r=>r.date.startsWith('2026'));

  const summary = {
    sampleGames: rows.length,
    correct,
    incorrect,
    accuracyPct:pct(correct, rows.length),
    correctToIncorrectRatio: incorrect ? +(correct/incorrect).toFixed(3) : null,
    actualHomeWinnerAccuracyPct:pct(actualHome.filter(r=>r.correct).length, actualHome.length),
    actualAwayWinnerAccuracyPct:pct(actualAway.filter(r=>r.correct).length, actualAway.length),
    predictedHomePickAccuracyPct:pct(predictedHome.filter(r=>r.correct).length, predictedHome.length),
    predictedAwayPickAccuracyPct:pct(predictedAway.filter(r=>r.correct).length, predictedAway.length),
    predictedHomePickRatePct:pct(predictedHome.length, rows.length),
    predictedAwayPickRatePct:pct(predictedAway.length, rows.length),
    homeWinners:actualHome.length,
    awayWinners:actualAway.length,
    accuracy2025Pct:pct(y2025.filter(r=>r.correct).length, y2025.length),
    accuracy2026Pct:pct(y2026.filter(r=>r.correct).length, y2026.length),
    games2025:y2025.length,
    games2026:y2026.length,
  };

  console.log('=== REAL COMPLETED-GAME SAMPLE SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('=== MISSES ===');
  rows.filter(r=>!r.correct).forEach(r=>console.log(JSON.stringify(r)));
  console.log('=== ALL REAL SAMPLE RESULTS ===');
  rows.forEach(r=>console.log(`${r.date},${r.away},${r.home},${r.actual},${r.predicted},${r.correct?'CORRECT':'WRONG'},${r.confidence},${r.actualLocation},${r.predictedLocation}`));
  return rows;
}

function runInternalReplay() {
  const usable = HISTORICAL_GAMES.filter(g => g.winnerHomeAway !== 'Tie' && byName.has(g.homeTeam) && byName.has(g.awayTeam));
  let correct=0, homeCorrect=0, homeTotal=0, awayCorrect=0, awayTotal=0;
  let predictedHome=0;
  for (const g of usable) {
    const home = byName.get(g.homeTeam)!;
    const away = byName.get(g.awayTeam)!;
    const r = predictWinner(home, away, g.date, true);
    const isCorrect = r.winner.name === g.winnerTeam;
    if (isCorrect) correct++;
    if (g.winnerHomeAway === 'Home') { homeTotal++; if (isCorrect) homeCorrect++; }
    if (g.winnerHomeAway === 'Away') { awayTotal++; if (isCorrect) awayCorrect++; }
    if (r.winner.name === g.homeTeam) predictedHome++;
  }
  const seasons = usable.map(g=>g.season).filter((x):x is number=>typeof x==='number');
  console.log('=== INTERNAL DATABASE REPLAY (LEAKAGE-PRONE / NOT OUT-OF-SAMPLE) ===');
  console.log(JSON.stringify({
    records:HISTORICAL_GAMES.length,
    usable:usable.length,
    seasonMin:Math.min(...seasons),
    seasonMax:Math.max(...seasons),
    correct,
    incorrect:usable.length-correct,
    accuracyPct:pct(correct,usable.length),
    actualHomeWinnerAccuracyPct:pct(homeCorrect,homeTotal),
    actualAwayWinnerAccuracyPct:pct(awayCorrect,awayTotal),
    predictedHomePickRatePct:pct(predictedHome,usable.length),
    firstRecord:HISTORICAL_GAMES[0],
    lastRecord:HISTORICAL_GAMES[HISTORICAL_GAMES.length-1],
  }, null, 2));
}

runRealSample();
runInternalReplay();
