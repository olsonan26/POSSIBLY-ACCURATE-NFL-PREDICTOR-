import { Team } from '../types';
import {
  parseTeamData,
  predictWinner as predictValidated,
  PredictionOptions
} from './validatedPredictionService';
import { persistImmutablePredictionSnapshot } from './predictionSnapshotService';

export { parseTeamData };

/**
 * Browser/UI prediction gateway. The validated predictor remains unchanged;
 * this wrapper appends an immutable pre-outcome feature snapshot locally so
 * future failure analysis never needs to reconstruct the original inputs.
 */
export async function predictWinner(
  homeTeam: Team,
  awayTeam: Team,
  gameDate: Date,
  isTeamAHome = true,
  options: PredictionOptions = {}
) {
  const result = await predictValidated(homeTeam, awayTeam, gameDate, isTeamAHome, options);
  persistImmutablePredictionSnapshot({
    result,
    home: homeTeam,
    away: awayTeam,
    gameDate: gameDate.toISOString().slice(0, 10),
    neutralSite: Boolean(options.neutralSite)
  });
  return result;
}
