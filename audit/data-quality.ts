import { HISTORICAL_GAMES } from '../data/historicalGames';

const weekdayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const weekdayCounts: Record<string, number> = Object.fromEntries(weekdayNames.map(d => [d, 0]));
let scoreWinnerMismatch = 0;
let tiedScoreWithDeclaredWinner = 0;
let winnerLocationMismatch = 0;
let loserMismatch = 0;
let malformedPatternWhitespace = 0;
let declaredHome = 0;
let declaredAway = 0;
let declaredTie = 0;
let scoreHome = 0;
let scoreAway = 0;
let scoreTie = 0;
const mismatchExamples:any[] = [];
const tieExamples:any[] = [];
const sameDateTeamUse = new Map<string, number>();
const teamDates = new Map<string, number[]>();

for (const g of HISTORICAL_GAMES) {
  const parts = g.date.split('/').map(Number);
  const dt = new Date(Date.UTC(parts[2], parts[0]-1, parts[1]));
  weekdayCounts[weekdayNames[dt.getUTCDay()]]++;

  if (g.winnerHomeAway === 'Home') declaredHome++;
  else if (g.winnerHomeAway === 'Away') declaredAway++;
  else declaredTie++;

  const scoreLoc = g.homeScore > g.awayScore ? 'Home' : g.awayScore > g.homeScore ? 'Away' : 'Tie';
  if (scoreLoc === 'Home') scoreHome++;
  else if (scoreLoc === 'Away') scoreAway++;
  else scoreTie++;

  const scoreWinner = scoreLoc === 'Home' ? g.homeTeam : scoreLoc === 'Away' ? g.awayTeam : null;
  const scoreLoser = scoreLoc === 'Home' ? g.awayTeam : scoreLoc === 'Away' ? g.homeTeam : null;

  if (scoreWinner && scoreWinner !== g.winnerTeam) {
    scoreWinnerMismatch++;
    if (mismatchExamples.length < 12) mismatchExamples.push(g);
  }
  if (!scoreWinner) {
    tiedScoreWithDeclaredWinner++;
    if (tieExamples.length < 8) tieExamples.push(g);
  }
  if (g.winnerHomeAway !== scoreLoc) winnerLocationMismatch++;
  if (scoreLoser && scoreLoser !== g.loserTeam) loserMismatch++;

  if ([g.homeDE,g.homeDay,g.awayDE,g.awayDay,g.winnerDE,g.winnerDay,g.loserDE,g.loserDay].some(v => v !== v.trim() || /\\n|\\r/.test(v))) {
    malformedPatternWhitespace++;
  }

  for (const team of [g.homeTeam, g.awayTeam]) {
    const k = `${g.date}|${team}`;
    sameDateTeamUse.set(k, (sameDateTeamUse.get(k) || 0) + 1);
    const arr = teamDates.get(team) || [];
    arr.push(dt.getTime());
    teamDates.set(team, arr);
  }
}

let duplicateSameDayTeamAppearances = 0;
for (const n of sameDateTeamUse.values()) if (n > 1) duplicateSameDayTeamAppearances += n - 1;

let restUnder3Days = 0;
let restUnder4Days = 0;
for (const dates of teamDates.values()) {
  dates.sort((a,b)=>a-b);
  for (let i=1;i<dates.length;i++) {
    const deltaDays = (dates[i]-dates[i-1]) / 86400000;
    if (deltaDays < 3) restUnder3Days++;
    if (deltaDays < 4) restUnder4Days++;
  }
}

const suspiciousWeekdayGames = weekdayCounts.Tue + weekdayCounts.Wed + weekdayCounts.Fri;
const firstDate = HISTORICAL_GAMES[0]?.date;
const lastDate = HISTORICAL_GAMES[HISTORICAL_GAMES.length-1]?.date;

console.log('=== HISTORICAL DATA QUALITY ===');
console.log(JSON.stringify({
  records: HISTORICAL_GAMES.length,
  firstDate,
  lastDate,
  declaredOutcomeCounts:{home:declaredHome,away:declaredAway,tie:declaredTie},
  scoreImpliedOutcomeCounts:{home:scoreHome,away:scoreAway,tie:scoreTie},
  scoreWinnerMismatch,
  scoreWinnerMismatchPct:+(100*scoreWinnerMismatch/HISTORICAL_GAMES.length).toFixed(1),
  tiedScoreWithDeclaredWinner,
  tiedScorePct:+(100*tiedScoreWithDeclaredWinner/HISTORICAL_GAMES.length).toFixed(1),
  winnerLocationMismatch,
  winnerLocationMismatchPct:+(100*winnerLocationMismatch/HISTORICAL_GAMES.length).toFixed(1),
  loserMismatch,
  malformedPatternWhitespace,
  weekdayCounts,
  suspiciousTueWedFriGames:suspiciousWeekdayGames,
  suspiciousTueWedFriPct:+(100*suspiciousWeekdayGames/HISTORICAL_GAMES.length).toFixed(1),
  duplicateSameDayTeamAppearances,
  restUnder3Days,
  restUnder4Days,
}, null, 2));
console.log('=== SCORE/WINNER MISMATCH EXAMPLES ===');
for (const g of mismatchExamples) console.log(JSON.stringify(g));
console.log('=== TIED SCORE WITH DECLARED WINNER EXAMPLES ===');
for (const g of tieExamples) console.log(JSON.stringify(g));
