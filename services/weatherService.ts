import { getKickoffWeather, type GameVenue } from './gameWeather.js';
import { getGamesForDate } from './scheduleService.js';
import { gameWeatherContext } from './gameVenue.js';

export interface WeatherData {
  temperatureF: number | null;
  windSpeedMph: number | null;
  precipitation: number | null;
  isDome: boolean;
  weatherImpact: number;
  windGustMph?: number | null;
  snowfall?: number | null;
  humidity?: number | null;
  venue?: GameVenue;
  kickoffAt?: string;
  capturedAt?: string;
  evidenceMode?: string;
}
/** Exact venue and kickoff are required; unknown weather stays unavailable. */
export async function getWeatherForGame(homeAbbr: string, date: string, neutralSite: boolean,
  context?: { kickoffAt: string; venue: GameVenue }): Promise<WeatherData | null> {
  if(!context) {
    const game=(await getGamesForDate(date)).find(g=>g.homeTeam===homeAbbr&&g.neutralSite===neutralSite);
    context=game?gameWeatherContext(game):undefined;
  }
  if (!context) return null;
  const weather = await getKickoffWeather(context.kickoffAt, context.venue);
  if (!weather || (!weather.isDome && [weather.temperatureF,weather.windSpeedMph,weather.precipitation].some(v=>v===null))) return null;
  return weather;
}
