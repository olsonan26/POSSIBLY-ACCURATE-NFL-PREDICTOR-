/**
 * Weather Service
 * ----------
 * Fetches historical weather data for NFL games via the free Open-Meteo
 * Archive API (no API key required). Weather impacts are converted to
 * small logit-space adjustments that the model can consume.
 *
 * Key design decisions:
 * - Dome games short-circuit and never hit the network.
 * - Results are cached in a Map keyed by `${homeAbbr}|${gameDateIso}` so
 *   repeated lookups (e.g. ensemble models) avoid redundant API calls.
 * - On any error we return null so callers degrade gracefully.
 */

import { stadiumCoordinates, type StadiumCoordinate } from '../data/stadiumCoordinates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeatherData {
  /** Daily high temperature in Fahrenheit */
  temperatureF: number;
  /** Max wind speed in mph */
  windSpeedMph: number;
  /** Total precipitation in mm */
  precipitation: number;
  /** True if the game is played in a dome */
  isDome: boolean;
  /** Logit-space weather impact (0–0.05) applied to the home team */
  weatherImpact: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

// NFL stadiums that are domed or have closed roofs → weather is irrelevant.
const DOMED_TEAMS = new Set<string>([
  'ATL', // Mercedes-Benz Stadium (retractable, treated as dome)
  'ARI', // State Farm Stadium (retractable)
  'DET', // Ford Field
  'IND', // Lucas Oil Stadium (retractable)
  'LAR', // SoFi Stadium (fixed roof + curtains)
  'LV',  // Allegiant Stadium (dome)
  'MIN', // U.S. Bank Stadium
  'NO',  // Caesars Superdome
  'DAL', // AT&T Stadium (retractable)
  'HOU', // NRG Stadium (retractable)
]);

// ---------------------------------------------------------------------------
// In-memory cache (promise-based to dedupe concurrent requests)
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<WeatherData | null>>();

function cacheKey(homeAbbr: string, gameDateIso: string): string {
  return `${homeAbbr}|${gameDateIso}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Celsius to Fahrenheit. */
function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/** Convert km/h to mph. */
function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

/**
 * Compute the weather impact in logit space.
 *
 *   windSpeed > 15 mph   → +0.03  (high wind favors defenses / rushing)
 *   precipitation > 0.1mm → +0.02  (rain/snow reduces passing efficiency)
 *
 * Capped at 0.05 total.
 */
function computeWeatherImpact(windSpeedMph: number, precipitation: number): number {
  let impact = 0;
  if (windSpeedMph > 15) impact += 0.03;
  if (precipitation > 0.1) impact += 0.02;
  return Math.min(impact, 0.05);
}

/**
 * Look up stadium coordinates for a given home team abbreviation.
 * Returns null if the team is unknown (e.g. neutral-site game with
 * a non-NFL "home" team).
 */
function getStadium(homeAbbr: string): StadiumCoordinate | null {
  return stadiumCoordinates[homeAbbr] ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch weather data for a specific NFL game.
 *
 * @param homeAbbr     Home team abbreviation (e.g. "NE")
 * @param gameDateIso   ISO date string "YYYY-MM-DD"
 * @param neutralSite   If true the game is at a neutral site — still
 *                      resolved via the nominal home team's stadium
 *                      coordinates, but callers may treat HFA separately.
 * @returns WeatherData or null on error / unknown stadium
 */
export async function getWeatherForGame(
  homeAbbr: string,
  gameDateIso: string,
  neutralSite: boolean,
): Promise<WeatherData | null> {
  const key = cacheKey(homeAbbr, gameDateIso);

  // Return cached promise if one is already in flight
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<WeatherData | null> => {
    try {
      // Dome games: no weather impact, skip the API call entirely
      if (DOMED_TEAMS.has(homeAbbr)) {
        return {
          temperatureF: 72,        // nominal indoor temp
          windSpeedMph: 0,
          precipitation: 0,
          isDome: true,
          weatherImpact: 0,
        };
      }

      const stadium = getStadium(homeAbbr);
      if (!stadium) return null;

      // Build the Open-Meteo Archive API URL.
      // We request a single day (start_date === end_date) for the game.
      const params = new URLSearchParams({
        latitude: String(stadium.lat),
        longitude: String(stadium.lon),
        start_date: gameDateIso,
        end_date: gameDateIso,
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',
        timezone: 'America/New_York',
      });

      const url = `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`;

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        console.warn(
          `[weatherService] Open-Meteo returned ${res.status} for ${homeAbbr} @ ${gameDateIso}`,
        );
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

      // Average of high/low → approximate game-time temp
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
      console.warn(
        `[weatherService] Error fetching weather for ${homeAbbr} @ ${gameDateIso}:`,
        err,
      );
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
