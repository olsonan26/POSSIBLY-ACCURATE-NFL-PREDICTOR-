import type {ScheduledGame} from '../services/scheduleService.js';
import {easternKickoffIso} from '../services/kickoff.js';
import {digest} from '../scripts/research-cohorts.js';
import {storage,NFL_SCHEDULE_URL} from './learningStore.js';

export function completedGameResults(games:ScheduledGame[],now=Date.now()){
 return games.filter(g=>g.season>=1999&&g.completed&&g.homeTeam!==g.awayTeam&&
  Number.isInteger(g.homeScore)&&Number.isInteger(g.awayScore)&&g.homeScore!>=0&&g.homeScore!<=200&&g.awayScore!>=0&&g.awayScore!<=200&&
  (g.gametime?Date.parse(easternKickoffIso(g.gameday,g.gametime)||'')<now:g.gameday<new Date(now).toISOString().slice(0,10)))
  .map(game=>({result_key:digest({source:NFL_SCHEDULE_URL,game}),game_id:game.gameId,season:game.season,game_date:game.gameday,
   source:NFL_SCHEDULE_URL,payload:game}));
}
export async function syncGameResults(games:ScheduledGame[]){
 const expected=completedGameResults(games),known=new Set<string>();
 for(let offset=0;;offset+=1000){
  const rows=await storage<{result_key:string}[]>(`nfl_game_results?select=result_key&order=result_key.asc&limit=1000&offset=${offset}`);
  rows.forEach(r=>known.add(r.result_key));if(rows.length<1000)break;
 }
 const additions=expected.filter(r=>!known.has(r.result_key));let appended=0;
 for(let i=0;i<additions.length;i+=100){
  const rows=await storage<any[]>('nfl_game_results?on_conflict=result_key',{method:'POST',
   headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(additions.slice(i,i+100))});appended+=rows.length;
 }
 return {source:NFL_SCHEDULE_URL,eligibleCompletedGames:expected.length,uniqueGames:new Set(expected.map(r=>r.game_id)).size,
  appended,alreadyPresent:expected.length-additions.length,seasons:[...new Set(expected.map(r=>r.season))].sort(),
  includesPlayoffs:true,evidenceMode:'VERIFIED_POSTGAME_RESULT',prospectiveForecastsCreated:0};
}
export async function gameResultArchiveSummary(){
 const games=new Set<string>(),seasons=new Set<number>();let versions=0;
 for(let offset=0;;offset+=1000){
  const rows=await storage<{game_id:string;season:number}[]>(`nfl_game_results?select=game_id,season&order=result_key.asc&limit=1000&offset=${offset}`);
  rows.forEach(r=>{games.add(r.game_id);seasons.add(r.season);});versions+=rows.length;if(rows.length<1000)break;
 }
 return {status:'AVAILABLE',uniqueGames:games.size,resultVersions:versions,seasons:[...seasons].sort(),evidenceMode:'VERIFIED_POSTGAME_RESULT'};
}
