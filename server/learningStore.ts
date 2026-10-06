import { createHash } from 'node:crypto';
import { buildLearningFeedback, LEARNING_VERSION, type LearningExample } from '../services/learningFeedback';
import { parseScheduleCsv, type ScheduledGame } from '../services/scheduleService';
import { easternKickoffIso } from '../api/prediction-ledger';

export const NFL_SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
export interface LearningForecast {
  game_id: string;
  experiment_version: string;
  research_model: string;
  captured_at: string;
  completed_at: string;
  kickoff_at: string;
  home_team: string;
  away_team: string;
  base_home_probability: number;
  raw_home_probability: number;
  learned_home_probability: number;
  facts: any[];
  feedback: Record<string, unknown>;
  payload_sha256: string;
}
export interface LearningOutcome {
  game_id: string;
  observed_at: string;
  home_score: number;
  away_score: number;
  source: string;
}
export interface LearningCapture {
  status: 'frozen' | 'already-frozen' | 'not-configured' | 'failed' | 'kickoff-passed';
  message: string;
}

export function learningStorageConfigured(): boolean {
  return Boolean(process.env.NFL_LEARNING_SUPABASE_URL && process.env.NFL_LEARNING_SUPABASE_KEY);
}

async function storage<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = process.env.NFL_LEARNING_SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.NFL_LEARNING_SUPABASE_KEY?.trim();
  if (!url || !key) throw new Error('Learning storage is not configured.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: { apikey: key,
      // New sb_secret_ keys are not JWTs. Supabase maps the apikey to service_role.
      ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
      'Content-Type': 'application/json', ...init.headers }
  });
  // Do not include DB responses/credentials in public errors or logs.
  if (!response.ok) throw new Error(`Learning storage request failed (HTTP ${response.status}).`);
  return await response.json() as T;
}

async function allRows<T>(table: string, filter = ''): Promise<T[]> {
  const result: T[] = [];
  const started = Date.now();
  for (let offset = 0; offset < 20_000; offset += 500) {
    if (Date.now() - started > 12_000) throw new Error('Learning history read exceeded its time budget.');
    const page = await storage<T[]>(`${table}?select=*&order=game_id.asc&limit=500&offset=${offset}${filter}`);
    result.push(...page);
    if (page.length < 500) return result;
  }
  throw new Error('Learning history exceeds the read budget; archive or increase the budget explicitly.');
}

export async function verifiedSchedule(): Promise<ScheduledGame[]> {
  const response = await fetch(NFL_SCHEDULE_URL, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!response.ok) throw new Error('Verified NFL schedule is unavailable.');
  const rows = parseScheduleCsv(await response.text());
  if (rows.length < 1000) throw new Error('Verified NFL schedule is incomplete.');
  return rows;
}

export function verifyLearningMatchup(games: ScheduledGame[], input: { gameId?: string; homeTeam: string; awayTeam: string; kickoffUtc: string }): ScheduledGame {
  const game = games.find(g => (!input.gameId || g.gameId === input.gameId)
    && g.homeTeam === input.homeTeam && g.awayTeam === input.awayTeam
    && easternKickoffIso(g.gameday, g.gametime || '') === input.kickoffUtc);
  if (!game || game.completed) throw new Error('Matchup/kickoff does not match an upcoming verified NFL game.');
  return game;
}

/** Only this server-fetched feed may label a learning example. Never trust a POSTed score. */
export async function syncLearningOutcomes(games: ScheduledGame[], now = new Date().toISOString()) {
  const [forecasts, outcomes] = await Promise.all([
    allRows<LearningForecast>('nfl_learning_forecasts'), allRows<LearningOutcome>('nfl_learning_outcomes')
  ]);
  const known = new Set(outcomes.map(o => o.game_id));
  const schedule = new Map(games.map(g => [g.gameId, g]));
  const additions: LearningOutcome[] = [];
  for (const forecast of forecasts) {
    if (known.has(forecast.game_id) || Date.parse(forecast.kickoff_at) >= Date.parse(now)) continue;
    const game = schedule.get(forecast.game_id);
    if (!game?.completed || game.homeTeam !== forecast.home_team || game.awayTeam !== forecast.away_team) continue;
    if (![game.homeScore, game.awayScore].every(n => Number.isInteger(n) && n! >= 0)) continue;
    additions.push({ game_id: game.gameId, observed_at: now, home_score: game.homeScore!, away_score: game.awayScore!, source: NFL_SCHEDULE_URL });
  }
  if (additions.length) {
    const inserted = await storage<LearningOutcome[]>('nfl_learning_outcomes?on_conflict=game_id', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(additions)
    });
    return { forecasts: forecasts.length, appended: inserted.length };
  }
  return { forecasts: forecasts.length, appended: additions.length };
}

export async function loadLearningExamples(model: string): Promise<LearningExample[]> {
  const [forecasts, outcomes] = await Promise.all([
    allRows<LearningForecast>('nfl_learning_forecasts', `&experiment_version=eq.${LEARNING_VERSION}&research_model=eq.${encodeURIComponent(model)}`),
    allRows<LearningOutcome>('nfl_learning_outcomes')
  ]);
  const byGame = new Map(outcomes.map(o => [o.game_id, o]));
  return forecasts.flatMap(f => {
    const o = byGame.get(f.game_id);
    if (!o || o.source !== NFL_SCHEDULE_URL) return [];
    return [{ gameId: f.game_id, capturedAt: f.captured_at, kickoffAt: f.kickoff_at, outcomeObservedAt: o.observed_at,
      baseHomeProbability: f.base_home_probability, rawHomeProbability: f.raw_home_probability, learnedHomeProbability: f.learned_home_probability,
      homeScore: o.home_score, awayScore: o.away_score, categories: [...new Set(f.facts.filter(fact => fact.accepted).map(fact => String(fact.category)))] }];
  });
}

export async function prepareLearningFeedback(games: ScheduledGame[], model: string) {
  if (!learningStorageConfigured()) return { feedback: buildLearningFeedback([], new Date().toISOString()), storageStatus: 'not-configured' as const };
  try {
    await syncLearningOutcomes(games);
    const examples = await loadLearningExamples(model);
    return { feedback: buildLearningFeedback(examples, new Date().toISOString()), storageStatus: 'ready' as const };
  } catch {
    return { feedback: buildLearningFeedback([], new Date().toISOString()), storageStatus: 'unavailable' as const };
  }
}

export async function freezeLearningForecast(row: Omit<LearningForecast, 'captured_at' | 'payload_sha256'>): Promise<LearningCapture> {
  if (!learningStorageConfigured()) return { status: 'not-configured', message: 'Learning database is not configured; this forecast was not saved.' };
  if (Date.parse(row.kickoff_at) <= Date.now()) return { status: 'kickoff-passed', message: 'Research finished after kickoff; this forecast is not eligible for learning.' };
  try {
    const result = await storage<LearningForecast[]>('nfl_learning_forecasts?on_conflict=game_id', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ ...row, payload_sha256: createHash('sha256').update(JSON.stringify(row)).digest('hex') })
    });
    if (result.length) return { status: 'frozen', message: 'Saved before kickoff. The final score will be checked automatically.' };
    // Confirm durable duplicate instead of assuming an empty response means success.
    const existing = await storage<LearningForecast[]>(`nfl_learning_forecasts?game_id=eq.${encodeURIComponent(row.game_id)}&select=*&limit=1`);
    if (existing.length) return { status: 'already-frozen', message: 'The first saved forecast is the learning example; this rerun does not add a game.' };
    throw new Error('No durable forecast returned.');
  } catch {
    return { status: 'failed', message: 'Learning database did not save this forecast. The displayed research remains available.' };
  }
}

export async function exportLearningForecasts(model: string) {
  const [forecasts, outcomes] = await Promise.all([
    allRows<LearningForecast>('nfl_learning_forecasts', `&experiment_version=eq.${LEARNING_VERSION}&research_model=eq.${encodeURIComponent(model)}`),
    allRows<LearningOutcome>('nfl_learning_outcomes')
  ]);
  const byGame = new Map(outcomes.map(o => [o.game_id, o]));
  return forecasts.flatMap(f => {
    const o = byGame.get(f.game_id);
    return o ? [{ ...f, outcome: o }] : [];
  });
}
