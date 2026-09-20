import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const WEIGHTS = [0, 0.025, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50, 0.60, 0.75];

const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const logistic=(x:number)=>1/(1+Math.exp(-x));
const logit=(p:number)=>{const q=clamp(p,.001,.999);return Math.log(q/(1-q));};

function csvLine(line:string){
  const out:string[]=[]; let cell=''; let q=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){ if(q&&line[i+1]==='"'){cell+='"';i++;} else q=!q; }
    else if(c===','&&!q){out.push(cell);cell='';} else cell+=c;
  }
  out.push(cell); return out;
}

type Raw={id:string,season:number,type:string,week:number,date:string,home:string,away:string,homeScore:number,awayScore:number,homeQb:string,awayQb:string};
function rawRows(text:string):Raw[]{
  const lines=text.split(/\r?\n/).filter(Boolean); const h=csvLine(lines[0]); const ix=(n:string)=>h.indexOf(n);
  return lines.slice(1).map(line=>{const c=csvLine(line),g=(n:string)=>c[ix(n)]?.trim()||''; return {
    id:g('game_id'),season:Number(g('season')),type:g('game_type'),week:Number(g('week')),date:g('gameday'),home:g('home_team'),away:g('away_team'),homeScore:Number(g('home_score')),awayScore:Number(g('away_score')),homeQb:g('home_qb_id'),awayQb:g('away_qb_id')
  };}).filter(r=>r.id&&r.date&&r.home&&r.away);
}

type Rec={id:string,season:number,p:number,y:boolean,homeChanged:boolean,awayChanged:boolean};
type Score={n:number,correct:number,brier:number,logloss:number};
function score(rows:Rec[],w:number):Score{
 const s={n:0,correct:0,brier:0,logloss:0};
 for(const r of rows){
   const continuityEdge=w*((r.awayChanged?1:0)-(r.homeChanged?1:0));
   const p=logistic(logit(r.p)+continuityEdge); const y=r.y?1:0;
   s.n++; s.correct+=(p>=.5)===r.y?1:0; s.brier+=(p-y)**2; s.logloss-=Math.log(clamp(r.y?p:1-p,1e-6,1-1e-6));
 }
 if(s.n){s.brier/=s.n;s.logloss/=s.n;} return s;
}
function fmt(s:Score){return `${s.correct}/${s.n} = ${(100*s.correct/s.n).toFixed(2)}%, Brier ${s.brier.toFixed(4)}, LogLoss ${s.logloss.toFixed(4)}`;}
function choose(rows:Rec[]){let best=0,bestB=Infinity;for(const w of WEIGHTS){const s=score(rows,w);if(s.brier<bestB){bestB=s.brier;best=w;}}return best;}

async function main(){
 const res=await fetch(SOURCE); if(!res.ok) throw new Error(`games.csv ${res.status}`); const text=await res.text();
 const parsed=parseGamesCsv(text); const raw=rawRows(text).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const rawById=new Map(raw.map(r=>[r.id,r])); const teams=parseTeamData(); const by=new Map(teams.map(t=>[t.abbr,t]));
 const lastQb=new Map<string,string>(); const changeById=new Map<string,{homeChanged:boolean,awayChanged:boolean}>();
 for(const r of raw){
   const prevH=lastQb.get(r.home), prevA=lastQb.get(r.away);
   changeById.set(r.id,{homeChanged:Boolean(r.homeQb&&prevH&&r.homeQb!==prevH),awayChanged:Boolean(r.awayQb&&prevA&&r.awayQb!==prevA)});
   if(r.homeQb) lastQb.set(r.home,r.homeQb); if(r.awayQb) lastQb.set(r.away,r.awayQb);
 }
 const records:Rec[]=[];
 for(const g of parsed.filter(x=>[2022,2023,2024,2025,2026].includes(x.season)&&x.gameType==='REG'&&Number.isFinite(x.homeScore)&&Number.isFinite(x.awayScore)&&x.homeScore!==x.awayScore&&!(x.season===2026&&x.gameday>'2026-09-14'))){
   const r=rawById.get(g.gameId), h=by.get(g.homeTeam), a=by.get(g.awayTeam); if(!r||!h||!a||!r.homeQb||!r.awayQb) continue;
   const out=await predictWinner(h,a,new Date(`${g.gameday}T12:00:00Z`),true,{neutralSite:g.location==='Neutral'}); const p=(out.modelScores?.finalHomeProbability??50)/100; const ch=changeById.get(g.gameId)!;
   records.push({id:g.gameId,season:g.season,p,y:g.homeScore!>g.awayScore!,homeChanged:ch.homeChanged,awayChanged:ch.awayChanged});
 }
 const ys=(season:number)=>records.filter(r=>r.season===season);
 console.log(`Coverage: ${[2022,2023,2024,2025,2026].map(y=>`${y}=${ys(y).length}`).join(', ')}`);

 console.log('\nRolling walk-forward QB-change tests (weight chosen by prior season Brier only)');
 for(const [tune,test] of [[2022,2023],[2023,2024],[2024,2025]] as const){
   const w=choose(ys(tune));
   console.log(`${tune}->${test}: selected w=${w.toFixed(3)} | baseline ${fmt(score(ys(test),0))} | frozen ${fmt(score(ys(test),w))}`);
 }

 console.log('\n2024 weight grid (production-candidate selection season)');
 for(const w of WEIGHTS) console.log(`w=${w.toFixed(3)} ${fmt(score(ys(2024),w))}`);
 const best=choose(ys(2024));
 console.log(`SELECTED w=${best.toFixed(3)} on 2024 only`);
 console.log('\n2025 confirmation');console.log(`baseline ${fmt(score(ys(2025),0))}`);console.log(`frozen QB continuity ${fmt(score(ys(2025),best))}`);
 console.log('\n2026 observation through Sep 14');console.log(`baseline ${fmt(score(ys(2026),0))}`);console.log(`frozen QB continuity ${fmt(score(ys(2026),best))}`);
 console.log('\n2026 changed picks:');
 for(const r of ys(2026)){const p2=logistic(logit(r.p)+best*((r.awayChanged?1:0)-(r.homeChanged?1:0)));if((r.p>=.5)!==(p2>=.5))console.log(`${r.id} ${(100*r.p).toFixed(1)} -> ${(100*p2).toFixed(1)} actual=${r.y?'HOME':'AWAY'} homeChanged=${r.homeChanged} awayChanged=${r.awayChanged}`);}
}
main().catch(e=>{console.error(e);process.exit(1)});
