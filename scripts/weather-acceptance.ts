import assert from 'node:assert/strict';
import { writeFileSync,mkdirSync } from 'node:fs';
import { parseScheduleCsv } from '../services/scheduleService.js';
import { gameWeatherContext } from '../services/gameVenue.js';
import { getKickoffWeather } from '../services/gameWeather.js';
const response=await fetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv');
if(!response.ok) throw new Error('Official schedule unavailable.');
const games=parseScheduleCsv(await response.text());
const results=[];
for(const id of ['2024_07_TEN_BUF','2024_07_DET_MIN','2024_07_NE_JAX']) {
  const game=games.find(g=>g.gameId===id);assert.ok(game);
  const context=gameWeatherContext(game);assert.ok(context,`Missing venue for ${id}`);
  const weather=await getKickoffWeather(context.kickoffAt,context.venue);assert.ok(weather,`Weather unavailable for ${id}`);
  if(id.includes('MIN')) {assert.equal(weather.isDome,true);assert.equal(weather.temperatureF,null);}
  else assert.equal(typeof weather.temperatureF,'number');
  if(game.neutralSite) {assert.equal(weather.venue.id,'LON00');assert.ok(weather.venue.latitude>50);}
  results.push({gameId:id,stadium:game.stadium,neutral:game.neutralSite,weather});
}
mkdirSync('research/runtime',{recursive:true});
writeFileSync('research/runtime/weather-acceptance.json',JSON.stringify({status:'PASS',source:'Archived hourly reanalysis, not a prospective pregame forecast',results},null,2));
console.log(JSON.stringify(results,null,2));
