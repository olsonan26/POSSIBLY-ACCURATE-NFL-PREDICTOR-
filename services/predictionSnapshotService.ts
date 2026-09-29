import { PredictionResult, Team } from '../types';

const STORAGE_KEY = 'nfl-predictor-immutable-snapshots-v1';

export interface BrowserPredictionSnapshot {
  snapshotId: string;
  gameKey: string;
  modelVersion: string;
  predictionTimestamp: string;
  dataCutoffTimestamp: string;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  neutralSite: boolean;
  predictedWinner: string;
  homeWinProbability: number;
  awayWinProbability: number;
  featureSnapshot?: {
    baseHomeProbability: number;
    eloHome: number;
    eloAway: number;
    footballLogitAdjustment: number;
    venueLogitAdjustment: number;
    h2hLogitAdjustment: number;
    personnelLogitAdjustment: number;
    restLogitAdjustment: number;
  };
  actualWinner?: string;
  homeScore?: number;
  awayScore?: number;
  correct?: boolean;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readAll(): BrowserPredictionSnapshot[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as BrowserPredictionSnapshot[] : [];
  } catch {
    return [];
  }
}

function writeAll(rows: BrowserPredictionSnapshot[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function persistImmutablePredictionSnapshot(input: {
  result: PredictionResult;
  home: Team;
  away: Team;
  gameDate: string;
  neutralSite: boolean;
  gameKey?: string;
}): BrowserPredictionSnapshot | null {
  if (!canUseStorage()) return null;
  const modelVersion = input.result.modelVersion || 'unknown-model';
  const gameKey = input.gameKey || `${input.gameDate}:${input.away.abbr}@${input.home.abbr}:${input.neutralSite ? 'N' : 'H'}`;
  const snapshotId = `${modelVersion}:${gameKey}`;
  const existing = readAll().find(row => row.snapshotId === snapshotId);
  if (existing) return existing;

  const scores = input.result.modelScores;
  const homeProbability = scores?.finalHomeProbability != null
    ? scores.finalHomeProbability / 100
    : input.result.winner.abbr === input.home.abbr
      ? input.result.confidence / 100
      : 1 - input.result.confidence / 100;
  const created: BrowserPredictionSnapshot = {
    snapshotId,
    gameKey,
    modelVersion,
    predictionTimestamp: new Date().toISOString(),
    dataCutoffTimestamp: new Date().toISOString(),
    gameDate: input.gameDate,
    homeTeam: input.home.abbr,
    awayTeam: input.away.abbr,
    neutralSite: input.neutralSite,
    predictedWinner: input.result.winner.abbr,
    homeWinProbability: homeProbability,
    awayWinProbability: 1 - homeProbability,
    featureSnapshot: scores ? {
      baseHomeProbability: scores.baseHomeProbability,
      eloHome: scores.eloHome,
      eloAway: scores.eloAway,
      footballLogitAdjustment: scores.footballLogitAdjustment,
      venueLogitAdjustment: scores.venueLogitAdjustment,
      h2hLogitAdjustment: scores.h2hLogitAdjustment,
      personnelLogitAdjustment: scores.personnelLogitAdjustment,
      restLogitAdjustment: scores.restLogitAdjustment
    } : undefined
  };
  writeAll([...readAll(), created]);
  return created;
}

export function appendPredictionOutcome(input: {
  snapshotId: string;
  actualWinner: string;
  homeScore: number;
  awayScore: number;
}) {
  if (!canUseStorage()) return;
  const rows = readAll();
  const index = rows.findIndex(row => row.snapshotId === input.snapshotId);
  if (index < 0) return;
  const original = rows[index];
  // Append result fields only. Never recompute or replace the pregame feature snapshot.
  rows[index] = {
    ...original,
    actualWinner: input.actualWinner,
    homeScore: input.homeScore,
    awayScore: input.awayScore,
    correct: original.predictedWinner === input.actualWinner
  };
  writeAll(rows);
}

export function listImmutablePredictionSnapshots(): BrowserPredictionSnapshot[] {
  return readAll();
}
