import { stadiumCoordinates } from '../data/stadiumCoordinates.js';
import type { ScheduledGame } from './scheduleService.js';
import { easternKickoffIso } from './kickoff.js';
import type { GameVenue } from './gameWeather.js';
// Venue IDs + names verified against nflverse's 2024 schedule. Team keys only locate existing coordinate constants;
// the game's actual ID AND venue name must match, including for neutral-site games.
const venues:Record<string,[string,string]>={
  KAN00:['KC','GEHA Field at Arrowhead Stadium'],ATL97:['ATL','Mercedes-Benz Stadium'],BUF00:['BUF','New Era Field'],
  CHI98:['CHI','Soldier Field'],CIN00:['CIN','Paycor Stadium'],IND00:['IND','Lucas Oil Stadium'],MIA00:['MIA','Hard Rock Stadium'],
  NOR00:['NO','Mercedes-Benz Superdome'],NYC01:['NYG','MetLife Stadium'],LAX01:['LA','SoFi Stadium'],SEA00:['SEA','Lumen Field'],
  CLE00:['CLE','FirstEnergy Stadium'],TAM00:['TB','Raymond James Stadium'],DET00:['DET','Ford Field'],SFO01:['SF',"Levi's Stadium"],
  BAL00:['BAL','M&T Bank Stadium'],CAR00:['CAR','Bank of America Stadium'],DAL00:['DAL','AT&T Stadium'],GNB00:['GB','Lambeau Field'],
  JAX00:['JAX','TIAA Bank Stadium'],MIN01:['MIN','U.S. Bank Stadium'],BOS00:['NE','Gillette Stadium'],NAS00:['TEN','Nissan Stadium'],
  WAS00:['WAS','FedExField'],PHO00:['ARI','State Farm Stadium'],DEN00:['DEN','Empower Field at Mile High'],HOU00:['HOU','NRG Stadium'],
  PHI00:['PHI','Lincoln Financial Field'],PIT00:['PIT','Acrisure Stadium'],VEG00:['LV','Allegiant Stadium']
};
export function gameWeatherContext(game:ScheduledGame):{kickoffAt:string;venue:GameVenue}|undefined {
  const kickoffAt=easternKickoffIso(game.gameday,game.gametime||'');
  if(!kickoffAt||!game.stadiumId||!game.stadium) return;
  if(game.stadiumId==='LON00'&&game.stadium==='Wembley Stadium') return {kickoffAt,venue:{id:'LON00',latitude:51.556,longitude:-.2796,roof:'outdoor',surface:game.surface}};
  const registered=venues[game.stadiumId];
  if(!registered||game.stadium!==registered[1]) return;
  const coordinates=stadiumCoordinates[registered[0]];
  if(!coordinates) return;
  // A retractable building is not necessarily closed. Historical actual roof status is descriptive reconstruction only.
  const roof=coordinates.roof==='retractable'?(game.completed&&['open','closed'].includes(game.roof||'')?game.roof as 'open'|'closed':'unknown'):coordinates.roof;
  return {kickoffAt,venue:{id:game.stadiumId,latitude:coordinates.lat,longitude:coordinates.lon,roof,surface:game.surface}};
}
