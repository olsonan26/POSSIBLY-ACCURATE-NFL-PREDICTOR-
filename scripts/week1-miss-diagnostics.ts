import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const logistic=(x:number)=>1/(1+Math.exp(-x));
const logit=(p:number)=>{const q=Math.max(.001,Math.min(.999,p));return Math.log(q/(1-q));};
const pct=(p:number)=>(100*p).toFixed(1)+'%';

async function main(){
 const res=await fetch(SOURCE); if(!res.ok)throw new Error(String(res.status));
 const games=parseGamesCsv(await res.text()); const teams=parseTeamData(); const by=new Map(teams.map(t=>[t.abbr,t]));
 const sample=games.filter(g=>g.season===2026&&g.gameType==='REG'&&g.gameday<='2026-09-14'&&Number.isFinite(g.homeScore)&&Number.isFinite(g.awayScore)&&g.homeScore!==g.awayScore);
 for(const g of sample){
  const h=by.get(g.homeTeam),a=by.get(g.awayTeam); if(!h||!a)continue;
  const out=await predictWinner(h,a,new Date(`${g.gameday}T12:00:00Z`),true,{neutralSite:g.location==='Neutral'}); const s=out.modelScores;if(!s)continue;
  const actualHome=g.homeScore!>g.awayScore!, pickedHome=s.finalHomeProbability>=50; if(actualHome===pickedHome)continue;
  const base=logit(s.baseHomeProbability/100);
  const pElo=logistic(base);
  const pForm=logistic(base+s.footballLogitAdjustment);
  const pVenue=logistic(base+s.footballLogitAdjustment+s.venueLogitAdjustment);
  const pH2h=logistic(base+s.footballLogitAdjustment+s.venueLogitAdjustment+s.h2hLogitAdjustment);
  const pPersonnel=logistic(base+s.footballLogitAdjustment+s.venueLogitAdjustment+s.h2hLogitAdjustment+s.personnelLogitAdjustment);
  console.log(`${g.gameId} ${a.name} @ ${h.name} actual=${actualHome?'HOME':'AWAY'} pick=${pickedHome?'HOME':'AWAY'}`);
  console.log(`  Elo ${pct(pElo)} | +form ${pct(pForm)} [${s.footballLogitAdjustment.toFixed(3)}] | +venue ${pct(pVenue)} [${s.venueLogitAdjustment.toFixed(3)}] | +H2H ${pct(pH2h)} [${s.h2hLogitAdjustment.toFixed(3)}] | +personnel ${pct(pPersonnel)} [${s.personnelLogitAdjustment.toFixed(3)}] | final ${(s.finalHomeProbability).toFixed(1)}%`);
 }
}
main().catch(e=>{console.error(e);process.exit(1)});
