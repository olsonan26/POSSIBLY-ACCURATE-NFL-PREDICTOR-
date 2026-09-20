import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const ALPHAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

const clamp = (x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const logistic = (x:number)=>1/(1+Math.exp(-x));
const logit = (p:number)=>{ const q=clamp(p,0.001,0.999); return Math.log(q/(1-q)); };

function csvLine(line:string){
  const out:string[]=[]; let cell=''; let quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"') { if(quoted && line[i+1]==='"'){ cell+='"'; i++; } else quoted=!quoted; }
    else if(c===',' && !quoted){ out.push(cell); cell=''; }
    else cell+=c;
  }
  out.push(cell); return out;
}

function lineData(text:string){
  const rows=text.split(/\r?\n/).filter(Boolean); const h=csvLine(rows[0]);
  const ix=(n:string)=>h.indexOf(n);
  const gi=ix('game_id'), si=ix('season'), gt=ix('game_type'), hs=ix('home_score'), as=ix('away_score'), sp=ix('spread_line');
  const map=new Map<string,number>();
  const train:{season:number,spread:number,homeWin:number}[]=[];
  for(const row of rows.slice(1)){
    const c=csvLine(row); const id=c[gi]?.trim(); const spread=Number(c[sp]); const home=Number(c[hs]); const away=Number(c[as]); const season=Number(c[si]);
    if(id && Number.isFinite(spread)) map.set(id,spread);
    if(c[gt]?.trim()==='REG' && season>=2000 && season<=2023 && Number.isFinite(spread) && Number.isFinite(home) && Number.isFinite(away) && home!==away)
      train.push({season,spread,homeWin:home>away?1:0});
  }
  return {map,train};
}

function fitMarket(rows:{spread:number,homeWin:number}[]){
  let b0=0,b1=0.14;
  for(let iter=0;iter<40;iter++){
    let g0=0,g1=0,h00=0,h01=0,h11=0;
    for(const r of rows){ const p=logistic(b0+b1*r.spread); const w=p*(1-p); const e=r.homeWin-p; g0+=e; g1+=e*r.spread; h00+=w; h01+=w*r.spread; h11+=w*r.spread*r.spread; }
    const det=h00*h11-h01*h01; if(Math.abs(det)<1e-12) break;
    b0+=(g0*h11-g1*h01)/det; b1+=(g1*h00-g0*h01)/det;
  }
  return {b0,b1};
}

type Rec={game:string,season:number,pFootball:number,pMarket:number,actualHome:boolean,spread:number};
type Score={n:number,correct:number,brier:number,logloss:number};
function score(rows:Rec[], alpha:number):Score{
  const s={n:0,correct:0,brier:0,logloss:0};
  for(const r of rows){
    const p=logistic((1-alpha)*logit(r.pFootball)+alpha*logit(r.pMarket));
    s.n++; s.correct+=(p>=0.5)===r.actualHome?1:0; s.brier+=(p-(r.actualHome?1:0))**2;
    const q=r.actualHome?p:1-p; s.logloss-=Math.log(clamp(q,1e-6,1-1e-6));
  }
  s.brier/=s.n||1; s.logloss/=s.n||1; return s;
}
function fmt(s:Score){return `${s.correct}/${s.n} = ${(100*s.correct/s.n).toFixed(2)}%, Brier ${s.brier.toFixed(4)}, LogLoss ${s.logloss.toFixed(4)}`;}

async function main(){
  const res=await fetch(SOURCE); if(!res.ok) throw new Error(`games.csv ${res.status}`); const text=await res.text();
  const games=parseGamesCsv(text); const {map:spreads,train}=lineData(text); const market=fitMarket(train);
  console.log(`Market calibration fit on 2000-2023 REG: logit(P(home win)) = ${market.b0.toFixed(5)} + ${market.b1.toFixed(5)} * spread_line`);
  const teams=parseTeamData(); const by=new Map(teams.map(t=>[t.abbr,t])); const all:Rec[]=[];
  for(const game of games.filter(g=>[2024,2025,2026].includes(g.season)&&g.gameType==='REG'&&Number.isFinite(g.homeScore)&&Number.isFinite(g.awayScore)&&g.homeScore!==g.awayScore)){
    if(game.season===2026 && game.gameday>'2026-09-14') continue;
    const spread=spreads.get(game.gameId); const home=by.get(game.homeTeam); const away=by.get(game.awayTeam); if(spread==null||!home||!away) continue;
    const out=await predictWinner(home,away,new Date(`${game.gameday}T12:00:00Z`),true,{neutralSite:game.location==='Neutral'});
    const pFootball=(out.modelScores?.finalHomeProbability ?? (out.isWinnerHome?out.confidence:100-out.confidence))/100;
    all.push({game:game.gameId,season:game.season,pFootball,pMarket:logistic(market.b0+market.b1*spread),actualHome:game.homeScore!>game.awayScore!,spread});
  }
  const y24=all.filter(r=>r.season===2024), y25=all.filter(r=>r.season===2025), y26=all.filter(r=>r.season===2026);
  console.log('\n2024 alpha selection (criterion: Brier; alpha=0 means current v2.2, alpha=1 means market only)');
  let best=0,bestB=Infinity;
  for(const a of ALPHAS){const s=score(y24,a); console.log(`alpha ${a.toFixed(1)}: ${fmt(s)}`); if(s.brier<bestB){bestB=s.brier;best=a;}}
  console.log(`SELECTED alpha=${best.toFixed(1)} from 2024 only`);
  console.log('\n2025 confirmation (alpha frozen)'); console.log(`v2.2: ${fmt(score(y25,0))}`); console.log(`market-only: ${fmt(score(y25,1))}`); console.log(`frozen blend: ${fmt(score(y25,best))}`);
  console.log('\n2026 observation through Sep 14 (never used for tuning)'); console.log(`v2.2: ${fmt(score(y26,0))}`); console.log(`market-only: ${fmt(score(y26,1))}`); console.log(`frozen blend: ${fmt(score(y26,best))}`);
  console.log('\n2026 changed picks under frozen blend:');
  for(const r of y26){ const pf=r.pFootball>=.5; const pb=logistic((1-best)*logit(r.pFootball)+best*logit(r.pMarket))>=.5; if(pf!==pb) console.log(`${r.game} spread=${r.spread} football=${(100*r.pFootball).toFixed(1)} market=${(100*r.pMarket).toFixed(1)} changed=${pf?'HOME->AWAY':'AWAY->HOME'} actual=${r.actualHome?'HOME':'AWAY'}`); }
}
main().catch(e=>{console.error(e);process.exit(1)});
