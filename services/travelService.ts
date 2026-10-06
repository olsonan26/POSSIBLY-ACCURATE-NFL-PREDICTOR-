// Travel service: calculates great-circle distance and timezone change
// between the away team's home city and the game city.

import { stadiumCoordinates } from '../data/stadiumCoordinates.js';

const EARTH_RADIUS_MILES = 3958.8;

/**
 * Calculate great-circle distance between two points using the Haversine formula.
 * Returns distance in miles.
 */
export function calculateTravelMiles(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): number {
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_MILES * c;
}

/**
 * Calculate the timezone change between two offsets.
 * Positive value = traveling eastward (losing sleep / body clock advances).
 * Negative value = traveling westward (gaining time / body clock retreats).
 */
export function calculateTimeZoneChange(
  fromTzOffset: number,
  toTzOffset: number
): number {
  // If traveling east (toTz is less negative, e.g., from -7 to -4), the change is positive.
  // fromTzOffset = -7 (PDT), toTzOffset = -4 (EDT) => 3 hours eastward.
  return toTzOffset - fromTzOffset;
}

/**
 * Get the full travel context for a game.
 * @param awayAbbr - Away team abbreviation
 * @param homeAbbr - Home team abbreviation
 * @param neutralSite - Whether the game is at a neutral site
 * @returns Travel metrics for the away team
 */
export function getTravelContext(
  awayAbbr: string,
  homeAbbr: string,
  neutralSite: boolean
): { travelMiles: number; logTravel: number; tzChange: number; isShortRest: boolean } {
  const awayStadium = stadiumCoordinates[awayAbbr];
  const homeStadium = stadiumCoordinates[homeAbbr];

  if (!awayStadium || !homeStadium) {
    return { travelMiles: 0, logTravel: 0, tzChange: 0, isShortRest: false };
  }

  // For neutral site games, the away team still travels but to a different venue.
  // We approximate using the home team's city as the game location.
  // (Neutral site games like international series still use the home team's stadium coords as fallback.)
  const gameStadium = homeStadium;

  const travelMiles = neutralSite
    ? 0
    : calculateTravelMiles(
        awayStadium.lat,
        awayStadium.lon,
        gameStadium.lat,
        gameStadium.lon
      );

  const logTravel = Math.log1p(travelMiles);
  const tzChange = neutralSite
    ? 0
    : calculateTimeZoneChange(awayStadium.tzOffset, gameStadium.tzOffset);

  // Short rest: Thursday games or similar situations would be flagged externally,
  // but we set a heuristic based on timezone change magnitude.
  const isShortRest = Math.abs(tzChange) >= 3;

  return { travelMiles, logTravel, tzChange, isShortRest };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
