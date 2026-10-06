import type { PredictionResult } from '../types';
import type { MarketAwarePrediction } from './marketAwareService';
import type { ScheduledGame } from './scheduleService';

export type LedgerCaptureState = 'frozen' | 'outcome_recorded' | 'skipped' | 'rejected' | 'failed';

export interface LedgerCaptureStatus {
  state: LedgerCaptureState;
  message: string;
  snapshotId?: string;
  capturedAt?: string;
  kickoffAt?: string;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createLedgerRunId(prefix = 'run'): string {
  return `${prefix}-${randomId()}`;
}

function homeProbability(result: PredictionResult, homeAbbr: string): number {
  const scored = result.modelScores?.finalHomeProbability;
  if (Number.isFinite(scored)) return Math.max(0.001, Math.min(0.999, Number(scored) / 100));
  const winnerProbability = Math.max(0.001, Math.min(0.999, result.confidence / 100));
  return result.winner.abbr === homeAbbr ? winnerProbability : 1 - winnerProbability;
}

async function postLedger(payload: unknown): Promise<{ response: Response; body: any }> {
  const response = await fetch('/api/prediction-ledger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let body: any = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { response, body };
}

export async function freezePredictionToServer(input: {
  game: ScheduledGame;
  result: PredictionResult;
  marketAware?: MarketAwarePrediction;
  runId: string;
}): Promise<LedgerCaptureStatus> {
  const { game, result, marketAware, runId } = input;
  if (game.completed) {
    return { state: 'skipped', message: 'Completed games cannot be backfilled as prospective predictions.' };
  }
  if (!game.gametime) {
    return { state: 'rejected', message: 'Official kickoff time is unavailable, so the prediction was not frozen.' };
  }

  const modelVersion = result.modelVersion || 'unknown-model';
  const captureToken = `${runId}:${game.gameId}:${modelVersion}`;
  const pHome = homeProbability(result, game.homeTeam);
  const { response, body } = await postLedger({
    action: 'snapshot',
    runId,
    captureToken,
    game,
    prediction: {
      modelVersion,
      predictedWinner: result.winner.abbr,
      homeWinProbability: pHome,
      generatedAt: new Date().toISOString(),
      featureSnapshot: result.modelScores || {}
    },
    market: marketAware ? {
      homeProbability: marketAware.marketHomeProbability,
      blendedHomeProbability: marketAware.blendedHomeProbability,
      winner: marketAware.winnerAbbr,
      snapshotAt: marketAware.snapshotAt,
      source: marketAware.source,
      homeMoneyline: marketAware.homeMoneyline,
      awayMoneyline: marketAware.awayMoneyline
    } : null
  });

  if (response.ok && body.status === 'frozen') {
    return {
      state: 'frozen',
      message: body.duplicate ? 'Already frozen for this run.' : 'Frozen server-side before kickoff.',
      snapshotId: body.snapshotId,
      capturedAt: body.capturedAt,
      kickoffAt: body.kickoffAt
    };
  }
  if (response.status === 409) {
    return {
      state: 'rejected',
      message: body.error || 'Kickoff already passed; this prediction was not frozen.',
      kickoffAt: body.kickoffAt
    };
  }
  return {
    state: 'failed',
    message: body.error || `Ledger unavailable (HTTP ${response.status}). Prediction remains visible but is not prospectively frozen.`
  };
}

export async function recordPredictionOutcomeToServer(game: ScheduledGame): Promise<LedgerCaptureStatus> {
  if (!game.completed || !Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) {
    return { state: 'skipped', message: 'Final score is not available.' };
  }

  const { response, body } = await postLedger({ action: 'outcome', game });
  if (response.ok && body.status === 'outcome_recorded') {
    return {
      state: 'outcome_recorded',
      message: body.duplicate ? 'Final outcome was already recorded.' : 'Final outcome appended to the frozen pregame ledger.'
    };
  }
  if (response.ok && body.status === 'skipped') {
    return {
      state: 'skipped',
      message: body.message || 'No prospective pregame snapshot exists for this game.'
    };
  }
  return {
    state: 'failed',
    message: body.error || `Outcome ledger unavailable (HTTP ${response.status}).`
  };
}
