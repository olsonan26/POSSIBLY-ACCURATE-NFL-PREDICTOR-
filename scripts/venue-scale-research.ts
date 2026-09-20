import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const SCALES=[0,0.25,0.5,0.75,1,1.25];
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const logistic=(x:number)=>1/(1+Math.exp(-x));
const logit=(p:number)=>{const q=clamp(p,.001,.999);return Math.log(q/(1-q));};
type Rec={season:number,base:number,form:number,venue:number,h2h:number,personnel:number,y:boolean};
type Score={n:number,correct:number,brier:number,logloss:number};
function score(rows:Rec[],scale:number):Score{const s={n:0,correct:0,brier:0,logloss:0};for(const r of rows){const p=logistic(r.base+r.form+scale*(r.venue+r.h2h)+r.personnel),y=r.y?1:0;s.n++;s.correct+=(p>=.5)===r.y?1:0;s.brier+=(p-y)**2;s.logloss-=Math.log(clamp(r.y?p:1-p,1e-6,1-1e-6));}if(s.n){s.brier/=s.n;s.logloss/=s.n;}return s;}
function fmt(s:Score){return `${s.correct}/${s.n} = ${(100*s.correct/s.n).toFixed(2)}%, Brier ${s.brier.toFixed(4)}, LogLoss ${s.logloss.toFixed(4)}`;}
async function main(){
 const res=await fetch(SOURCE);if(!res.ok)throw new Error(String(res.status));const games=parseGamesCsv(await res.text());const teams=parseTeamData(),by=new Map(teams.map(t=>[t.abbr,t]));const rows:Rec[]=[];
 for(const g of games.filter(x=>[2024,2025,2026].includes(x.season)&&x.gameType==='REG'&&Number.isFinite(x.homeScore)&&Number.isFinite(x.awayScore)&&x.homeScore!==x.awayScore&&!(x.season===2026&&x.gameday>'2026-09-14'))){const h=by.get(g.homeTeam),a=by.get(g.awayTeam);if(!h||!a)continue;const out=await predictWinner(h,a,new Date(`${g.gameday}T12:00:00Z`),true,{neutralSite:g.location==='Neutral'}),s=out.modelScores;if(!s)continue;rows.push({season:g.season,base:logit(s.baseHomeProbability/100),form:s.footballLogitAdjustment,venue:s.venueLogitAdjustment,h2h:s.h2hLogitAdjustment,personnel:s.personnelLogitAdjustment,y:g.homeScore!>g.awayScore!});}
 const ys=(y:number)=>rows.filter(r=>r.season===y);let best=1,bestB=Infinity;
 console.log('2024 venue/H2H scale selection (Brier)');for(const scale of SCALES){const s=score(ys(2024),scale);console.log(`scale=${scale.toFixed(2)} ${fmt(s)}`);if(s.brier<bestB){bestB=s.brier;best=scale;}}
 console.log(`SELECTED scale=${best.toFixed(2)} on 2024 only`);console.log('\n2025 confirmation');console.log(`baseline scale=1 ${fmt(score(ys(2025),1))}`);console.log(`frozen scale=${best.toFixed(2)} ${fmt(score(ys(2025),best))}`);console.log('\n2026 observation');console.log(`baseline ${fmt(score(ys(2026),1))}`);console.log(`frozen ${fmt(score(ys(2026),best))}`);
}
main().catch(e=>{console.error(e);process.exit(1)});
