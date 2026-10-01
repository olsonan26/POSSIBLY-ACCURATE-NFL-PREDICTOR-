/**
 * Weather Service
 * ----------
 * Fetches historical weather data for NFL games via the free Open-Meteo
 * Archive API (no API key required). Weather impacts are converted to
 * small logit-space adjustments that the model can consume.
 */

import { stadiumCoordinates, type StadiumInfo } from '../data/stadiumCoordinates';

export interface WeatherData {
  temperatureF: number;
  windSpeedMph: number;
  precipitation: number;
  isDome: boolean;
  weatherImpact: number;
}

const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

const DOMED_TEAMS = new Set<string>([
  'ATL',
  'ARI',
  'DET',
  'IND',
  'LA',
  'LV',
  'MIN',
  'NO',
  'DAL',
  'HOU',
]);

const cache = new Map<string, Promise<WeatherData | null>>();

function cacheKey(homeAbbr: string, gameDateIso: string): string {
  return `${homeAbbr}|${gameDateIso}`;
}

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

function computeWeatherImpact(windSpeedMph: number, precipitation: number): number {
  let impact = 0;
  if (windSpeedMph > 15) impact += 0.03;
  if (precipitation > 0.1) impact += 0.02;
  return Math.min(impact, 0.05);
}

function getStadium(homeAbbr: string): StadiumInfo | null {
  return stadiumCoordinates[homeAbbr] ?? null;
}

export async function getWeatherForGame(
  homeAbbr: string,
  gameDateIso: string,
  neutralSite: boolean,
): Promise<WeatherData | null> {
  void neutralSite;
  const key = cacheKey(homeAbbr, gameDateIso);
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<WeatherData | null> => {
    try {
      if (DOMED_TEAMS.has(homeAbbr)) {
        return {
          temperatureF: 72,
          windSpeedMph: 0,
          precipitation: 0,
          isDome: true,
          weatherImpact: 0,
        };
      }

      const stadium = getStadium(homeAbbr);
      if (!stadium) return null;

      const params = new URLSearchParams({
        latitude: String(stadium.lat),
        longitude: String(stadium.lon),
        start_date: gameDateIso,
        end_date: gameDateIso,
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',
        timezone: 'America/New_York',
      });

      const url = `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });

      if (!res.ok) {
        console.warn(`[weatherService] Open-Meteo returned ${res.status} for ${homeAbbr} @ ${gameDateIso}`);
        return null;
      }

      const json = (await res.json()) as {
        daily?: {
          temperature_2m_max?: number[];
          temperature_2m_min?: number[];
          precipitation_sum?: number[];
          windspeed_10m_max?: number[];
        };
      };

      const daily = json.daily;
      if (!daily) return null;

      const tempMaxC = daily.temperature_2m_max?.[0];
      const tempMinC = daily.temperature_2m_min?.[0];
      const precip = daily.precipitation_sum?.[0];
      const windMaxKmh = daily.windspeed_10m_max?.[0];

      if (
        tempMaxC === undefined ||
        tempMinC === undefined ||
        precip === undefined ||
        windMaxKmh === undefined
      ) {
        return null;
      }

      const tempF = celsiusToFahrenheit((tempMaxC + tempMinC) / 2);
      const windMph = kmhToMph(windMaxKmh);

      return {
        temperatureF: Math.round(tempF),
        windSpeedMph: Math.round(windMph * 10) / 10,
        precipitation: Math.round(precip * 100) / 100,
        isDome: false,
        weatherImpact: computeWeatherImpact(windMph, precip),
      };
    } catch (err) {
      console.warn(`[weatherService] Error fetching weather for ${homeAbbr} @ ${gameDateIso}:`, err);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
