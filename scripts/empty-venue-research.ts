import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const logistic=(x:number)=>1/(1+Math.exp(-x));
const logit=(p:number)=>{const q=clamp(p,.001,.999);return Math.log(q/(1-q));};

type Score={n:number,correct:number,brier:number};
function add(s:Score,p:number,y:boolean){s.n++;s.correct+=(p>=.5)===y?1:0;s.brier+=(p-(y?1:0))**2;}
function fmt(s:Score){return `${s.correct}/${s.n} = ${(100*s.correct/s.n).toFixed(2)}%, Brier ${(s.brier/s.n).toFixed(4)}`;}

async function main(){
 const r=await fetch(SOURCE); if(!r.ok) throw new Error(String(r.status));
 const games=parseGamesCsv(await r.text()); const teams=parseTeamData(); const by=new Map(teams.map(t=>[t.abbr,t]));
 for(const season of [2024,2025,2026]){
  const base:Score={n:0,correct:0,brier:0}, zero:Score={n:0,correct:0,brier:0}; let changed=0;
  for(const g of games.filter(x=>x.season===season&&x.gameType==='REG'&&Number.isFinite(x.homeScore)&&Number.isFinite(x.awayScore)&&x.homeScore!==x.awayScore&&!(season===2026&&x.gameday>'2026-09-14'))){
   const h=by.get(g.homeTeam),a=by.get(g.awayTeam); if(!h||!a) continue;
   const out=await predictWinner(h,a,new Date(`${g.gameday}T12:00:00Z`),true,{neutralSite:g.location==='Neutral'}); const s=out.modelScores; if(!s) continue;
   const p=s.finalHomeProbability/100; const y=g.homeScore!>g.awayScore!;
   // Week 1 has zero target-season home/road observations for both teams. In that
   // state, venue evidence should be neutral rather than inheriting the default
   // 50% values through the 55%/45% home-road centering formula.
   const pZero=(g.week===1&&g.location!=='Neutral')?logistic(logit(p)-s.venueLogitAdjustment):p;
   add(base,p,y); add(zero,pZero,y); if((p>=.5)!==(pZero>=.5)) changed++;
  }
  console.log(`${season} current: ${fmt(base)}`); console.log(`${season} no-empty-venue-bias: ${fmt(zero)}; changed picks=${changed}`);
 }
}
main().catch(e=>{console.error(e);process.exit(1)});
