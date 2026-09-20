import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const FACTORS=[0.30,0.40,0.50,0.60,0.67,0.75,0.85,1.00];
const HOME_ADV=55, K=20;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const logistic=(x:number)=>1/(1+Math.exp(-x));
const logit=(p:number)=>{const q=clamp(p,.001,.999);return Math.log(q/(1-q));};
const expected=(h:number,a:number,neutral:boolean)=>1/(1+Math.pow(10,(a-(h+(neutral?0:HOME_ADV)))/400));

type G=ReturnType<typeof parseGamesCsv>[number];
type Rec={season:number,id:string,y:boolean,currentP:number,nonElo:number};
type Score={n:number,correct:number,brier:number,logloss:number};
function score(rows:Rec[],base:Map<string,number>|null):Score{const s={n:0,correct:0,brier:0,logloss:0};for(const r of rows){const p=base?logistic(logit(base.get(r.id)??r.currentP)+r.nonElo):r.currentP,y=r.y?1:0;s.n++;s.correct+=(p>=.5)===r.y?1:0;s.brier+=(p-y)**2;s.logloss-=Math.log(clamp(r.y?p:1-p,1e-6,1-1e-6));}if(s.n){s.brier/=s.n;s.logloss/=s.n;}return s;}
function fmt(s:Score){return `${s.correct}/${s.n} = ${(100*s.correct/s.n).toFixed(2)}%, Brier ${s.brier.toFixed(4)}, LogLoss ${s.logloss.toFixed(4)}`;}
function eloBases(games:G[],factor:number){
 const ratings=new Map<string,number>(),out=new Map<string,number>();const rating=(t:string)=>ratings.get(t)??1500;let priorSeason=0;
 const completed=games.filter(g=>Number.isFinite(g.homeScore)&&Number.isFinite(g.awayScore)).sort((a,b)=>a.gameday.localeCompare(b.gameday)||a.gameId.localeCompare(b.gameId));
 for(let i=0;i<completed.length;){const date=completed[i].gameday;const day:G[]=[];while(i<completed.length&&completed[i].gameday===date)day.push(completed[i++]);const season=day[0]?.season??priorSeason;if(priorSeason&&season!==priorSeason){for(const [t,v] of ratings)ratings.set(t,1500+(v-1500)*factor);}priorSeason=season;
   for(const g of day)out.set(g.gameId,expected(rating(g.homeTeam),rating(g.awayTeam),g.location==='Neutral'));
   for(const g of day){const hr=rating(g.homeTeam),ar=rating(g.awayTeam),p=expected(hr,ar,g.location==='Neutral'),hs=g.homeScore!,as=g.awayScore!,actual=hs===as?0.5:hs>as?1:0,margin=Math.abs(hs-as),mov=clamp(Math.log(margin+1)/Math.log(8),.75,1.65),delta=K*mov*(actual-p);ratings.set(g.homeTeam,hr+delta);ratings.set(g.awayTeam,ar-delta);}
 }
 return out;
}
async function main(){
 const res=await fetch(SOURCE);if(!res.ok)throw new Error(String(res.status));const games=parseGamesCsv(await res.text());const teams=parseTeamData(),by=new Map(teams.map(t=>[t.abbr,t]));const rows:Rec[]=[];
 for(const g of games.filter(x=>[2024,2025,2026].includes(x.season)&&x.gameType==='REG'&&Number.isFinite(x.homeScore)&&Number.isFinite(x.awayScore)&&x.homeScore!==x.awayScore&&!(x.season===2026&&x.gameday>'2026-09-14'))){const h=by.get(g.homeTeam),a=by.get(g.awayTeam);if(!h||!a)continue;const o=await predictWinner(h,a,new Date(`${g.gameday}T12:00:00Z`),true,{neutralSite:g.location==='Neutral'}),s=o.modelScores;if(!s)continue;rows.push({season:g.season,id:g.gameId,y:g.homeScore!>g.awayScore!,currentP:s.finalHomeProbability/100,nonElo:s.footballLogitAdjustment+s.venueLogitAdjustment+s.h2hLogitAdjustment+s.personnelLogitAdjustment});}
 const ys=(y:number)=>rows.filter(r=>r.season===y),bases=new Map<number,Map<string,number>>();for(const f of FACTORS)bases.set(f,eloBases(games,f));let best=.67,bestB=Infinity;
 console.log('2024 offseason Elo regression selection (includes correcting season-opener regression timing)');console.log(`current v2.2 baseline ${fmt(score(ys(2024),null))}`);for(const f of FACTORS){const s=score(ys(2024),bases.get(f)!);console.log(`factor=${f.toFixed(2)} ${fmt(s)}`);if(s.brier<bestB){bestB=s.brier;best=f;}}
 console.log(`SELECTED factor=${best.toFixed(2)} on 2024 only`);console.log('\n2025 confirmation');console.log(`current baseline ${fmt(score(ys(2025),null))}`);console.log(`frozen factor=${best.toFixed(2)} ${fmt(score(ys(2025),bases.get(best)!))}`);console.log('\n2026 observation');console.log(`current baseline ${fmt(score(ys(2026),null))}`);console.log(`frozen factor=${best.toFixed(2)} ${fmt(score(ys(2026),bases.get(best)!))}`);
}
main().catch(e=>{console.error(e);process.exit(1)});
