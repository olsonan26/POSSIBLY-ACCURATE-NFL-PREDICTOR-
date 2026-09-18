import { parseTeamData, predictWinner } from '../services/numerologyService';

type CsvRow = Record<string,string>;

const TEAM_NAME: Record<string,string> = {
  ARI:'Arizona Cardinals', ATL:'Atlanta Falcons', BAL:'Baltimore Ravens', BUF:'Buffalo Bills',
  CAR:'Carolina Panthers', CHI:'Chicago Bears', CIN:'Cincinnati Bengals', CLE:'Cleveland Browns',
  DAL:'Dallas Cowboys', DEN:'Denver Broncos', DET:'Detroit Lions', GB:'Green Bay Packers',
  HOU:'Houston Texans', IND:'Indianapolis Colts', JAX:'Jacksonville Jaguars', KC:'Kansas City Chiefs',
  LV:'Las Vegas Raiders', LAC:'Los Angeles Chargers', LA:'Los Angeles Rams', MIA:'Miami Dolphins',
  MIN:'Minnesota Vikings', NE:'New England Patriots', NO:'New Orleans Saints', NYG:'New York Giants',
  NYJ:'New York Jets', PHI:'Philadelphia Eagles', PIT:'Pittsburgh Steelers', SF:'San Francisco 49ers',
  SEA:'Seattle Seahawks', TB:'Tampa Bay Buccaneers', TEN:'Tennessee Titans', WAS:'Washington Commanders',
};

function parseCsvLine(line:string): string[] {
  const out:string[]=[];
  let cur='';
  let quoted=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch==='"') {
      if (quoted && line[i+1]==='"') { cur+='"'; i++; }
      else quoted=!quoted;
    } else if (ch===',' && !quoted) {
      out.push(cur); cur='';
    } else cur+=ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text:string): CsvRow[] {
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  const headers=parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells=parseCsvLine(line);
    return Object.fromEntries(headers.map((h,i)=>[h,cells[i]??'']));
  });
}

function pct(n:number,d:number){ return d ? +(100*n/d).toFixed(2) : 0; }
function round(n:number,d=3){ const p=10**d; return Math.round(n*p)/p; }

const csvUrl='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const response=await fetch(csvUrl);
if (!response.ok) throw new Error(`Failed nflverse fetch: ${response.status}`);
const rows=parseCsv(await response.text());
const teams=parseTeamData();
const byName=new Map(teams.map(t=>[t.name,t]));

const completed = rows.filter(r =>
  r.game_type==='REG' &&
  (r.season==='2025' || r.season==='2026') &&
  r.home_score!=='' && r.away_score!=='' &&
  Number.isFinite(Number(r.home_score)) && Number.isFinite(Number(r.away_score)) &&
  TEAM_NAME[r.home_team] && TEAM_NAME[r.away_team]
);

const results:any[]=[];
for (const g of completed) {
  const homeName=TEAM_NAME[g.home_team];
  const awayName=TEAM_NAME[g.away_team];
  const home=byName.get(homeName)!;
  const away=byName.get(awayName)!;
  const hs=Number(g.home_score), as=Number(g.away_score);
  if (hs===as) continue;
  const pred=predictWinner(home,away,g.gameday,true);
  const actual=hs>as ? homeName : awayName;
  const actualLoc=hs>as ? 'Home':'Away';
  const predictedLoc=pred.winner.name===homeName ? 'Home':'Away';
  const confidence=pred.confidence;
  const yHome=actualLoc==='Home' ? 1:0;
  const pHome=(predictedLoc==='Home' ? confidence : 100-confidence)/100;
  results.push({
    season:Number(g.season), week:Number(g.week), date:g.gameday,
    away:awayName, home:homeName, awayScore:as, homeScore:hs,
    actual, actualLoc, predicted:pred.winner.name, predictedLoc,
    correct:pred.winner.name===actual, confidence,
    location:g.location, stadium:g.stadium,
    nflverseAwayQB:g.away_qb_name, nflverseHomeQB:g.home_qb_name,
    nflverseAwayCoach:g.away_coach, nflverseHomeCoach:g.home_coach,
    brier:(pHome-yHome)**2,
  });
}

function summarize(name:string, arr:any[]) {
  const correct=arr.filter(r=>r.correct).length;
  const wrong=arr.length-correct;
  const homeActual=arr.filter(r=>r.actualLoc==='Home');
  const awayActual=arr.filter(r=>r.actualLoc==='Away');
  const homePred=arr.filter(r=>r.predictedLoc==='Home');
  const awayPred=arr.filter(r=>r.predictedLoc==='Away');
  const neutral=arr.filter(r=>String(r.location).toLowerCase()==='neutral');
  const avgConf=arr.reduce((s,r)=>s+r.confidence,0)/(arr.length||1);
  const brier=arr.reduce((s,r)=>s+r.brier,0)/(arr.length||1);
  const bins = [
    {label:'52-59', rows:arr.filter(r=>r.confidence<60)},
    {label:'60-69', rows:arr.filter(r=>r.confidence>=60 && r.confidence<70)},
    {label:'70-78', rows:arr.filter(r=>r.confidence>=70)},
  ].map(b=>({bin:b.label,n:b.rows.length,accuracyPct:pct(b.rows.filter(r=>r.correct).length,b.rows.length),avgConfidence:round(b.rows.reduce((s,r)=>s+r.confidence,0)/(b.rows.length||1),1)}));
  return {
    name,games:arr.length,correct,incorrect:wrong,accuracyPct:pct(correct,arr.length),
    correctToIncorrectRatio:wrong?round(correct/wrong):null,
    actualHomeWinners:homeActual.length,actualAwayWinners:awayActual.length,
    homeWinnerAccuracyPct:pct(homeActual.filter(r=>r.correct).length,homeActual.length),
    awayWinnerAccuracyPct:pct(awayActual.filter(r=>r.correct).length,awayActual.length),
    predictedHomePicks:homePred.length,predictedAwayPicks:awayPred.length,
    predictedHomePickRatePct:pct(homePred.length,arr.length),
    predictedAwayPickRatePct:pct(awayPred.length,arr.length),
    predictedHomeAccuracyPct:pct(homePred.filter(r=>r.correct).length,homePred.length),
    predictedAwayAccuracyPct:pct(awayPred.filter(r=>r.correct).length,awayPred.length),
    alwaysHomeBaselinePct:pct(homeActual.length,arr.length),
    alwaysAwayBaselinePct:pct(awayActual.length,arr.length),
    liftVsAlwaysHomePctPoints:round(pct(correct,arr.length)-pct(homeActual.length,arr.length),2),
    meanClaimedConfidencePct:round(avgConf,1),
    meanBrierScore:round(brier,4),
    neutralGames:neutral.length,
    confidenceBins:bins,
  };
}

console.log('=== NFLVERSE FULL-SEASON HOLDOUT ===');
console.log(JSON.stringify(summarize('2025 regular season',results.filter(r=>r.season===2025)),null,2));
console.log(JSON.stringify(summarize('2026 completed regular season',results.filter(r=>r.season===2026)),null,2));
console.log(JSON.stringify(summarize('2025+2026 combined',results),null,2));

const teamStats = new Map<string,{games:number,correct:number,wrong:number}>();
for (const r of results) {
  for (const team of [r.home,r.away]) {
    const s=teamStats.get(team)||{games:0,correct:0,wrong:0};
    s.games++;
    if (r.correct) s.correct++; else s.wrong++;
    teamStats.set(team,s);
  }
}
const weakest=[...teamStats.entries()].map(([team,s])=>({team,...s,accuracyPct:pct(s.correct,s.games)})).sort((a,b)=>a.accuracyPct-b.accuracyPct || b.games-a.games).slice(0,12);
const strongest=[...teamStats.entries()].map(([team,s])=>({team,...s,accuracyPct:pct(s.correct,s.games)})).sort((a,b)=>b.accuracyPct-a.accuracyPct || b.games-a.games).slice(0,12);
console.log('=== LOWEST TEAM-INVOLVED ACCURACY ===');
console.log(JSON.stringify(weakest,null,2));
console.log('=== HIGHEST TEAM-INVOLVED ACCURACY ===');
console.log(JSON.stringify(strongest,null,2));

const wrongHigh=results.filter(r=>!r.correct && r.confidence>=70).sort((a,b)=>b.confidence-a.confidence);
console.log('=== WRONG AT >=70% CLAIMED CONFIDENCE ===');
console.log(JSON.stringify({count:wrongHigh.length,examples:wrongHigh.slice(0,25)},null,2));

const year2026=results.filter(r=>r.season===2026);
console.log('=== 2026 SOURCE QB/COACH SNAPSHOT ===');
console.log(JSON.stringify(year2026.map(r=>({date:r.date,away:r.away,awayQB:r.nflverseAwayQB,awayCoach:r.nflverseAwayCoach,home:r.home,homeQB:r.nflverseHomeQB,homeCoach:r.nflverseHomeCoach})),null,2));
