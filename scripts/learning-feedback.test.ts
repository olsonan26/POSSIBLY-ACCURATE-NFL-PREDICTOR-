import assert from 'node:assert/strict';
import { buildLearningFeedback, eligibleLearningExamples, scaledEvidenceProbability, type LearningExample } from '../services/learningFeedback';
import { freezeLearningForecast, learningStorageConfigured, verifyLearningMatchup } from '../server/learningStore';

function fixture(i: number): LearningExample {
  const kickoff = Date.UTC(2025, 0, 1 + i, 18);
  return { gameId: `game-${i}`, capturedAt: new Date(kickoff - 6 * 3600_000).toISOString(),
    kickoffAt: new Date(kickoff).toISOString(), outcomeObservedAt: new Date(kickoff + 5 * 3600_000).toISOString(),
    baseHomeProbability: 0.5, rawHomeProbability: 0.9, learnedHomeProbability: 0.9,
    homeScore: i % 2 === 0 ? 28 : 14, awayScore: i % 2 === 0 ? 14 : 28, categories: ['qb'] };
}
const asOf = '2026-01-01T00:00:00Z';
const rows = Array.from({ length: 120 }, (_, i) => fixture(i));
assert.equal(scaledEvidenceProbability(0.6, 0.8, 0), 0.6);
assert.ok(Math.abs(scaledEvidenceProbability(0.6, 0.8, 1) - 0.8) < 1e-12);
const learned = buildLearningFeedback(rows, asOf);
assert.equal(learned.games, 120);
assert.equal(learned.forward.games, 80);
assert.equal(learned.gatePassed, true, 'Known harmful news must be reduced only after forward checks.');
assert.equal(learned.scale, 0);
assert.equal(buildLearningFeedback(rows.slice(0, 79), asOf).gatePassed, false);
const duplicated = [...rows, { ...rows[0], capturedAt: '2025-01-01T17:00:00Z', rawHomeProbability: 0.1 }];
assert.deepEqual(buildLearningFeedback(duplicated, asOf), learned, 'Reruns must not inflate evidence or replace the first forecast.');
assert.deepEqual(buildLearningFeedback([...rows].reverse(), asOf), learned);
assert.equal(eligibleLearningExamples([{ ...rows[0], capturedAt: rows[0].kickoffAt }], asOf).length, 0);
assert.equal(eligibleLearningExamples([{ ...rows[0], homeScore: rows[0].awayScore }], asOf).length, 0);
assert.equal(eligibleLearningExamples([{ ...rows[0], rawHomeProbability: NaN }], asOf).length, 0);
assert.equal(eligibleLearningExamples([{ ...rows[0], outcomeObservedAt: asOf }], asOf).length, 0);
assert.equal(eligibleLearningExamples([{ ...rows[0], outcomeObservedAt: rows[0].capturedAt }], asOf).length, 0);
const overlapping = rows.map(r => ({ ...r, outcomeObservedAt: '2025-12-31T00:00:00Z' }));
assert.equal(buildLearningFeedback(overlapping, asOf).forward.games, 0, 'Late recorded labels cannot train earlier forecasts.');
const prefixTime = rows[61].capturedAt;
assert.deepEqual(buildLearningFeedback(rows, prefixTime), buildLearningFeedback(rows.slice(0, 61), prefixTime), 'Future labels must not change past feedback.');
const helpful = rows.map((r, i) => ({ ...r, rawHomeProbability: i % 2 === 0 ? 0.7 : 0.3 }));
assert.equal(buildLearningFeedback(helpful, asOf).suggestedScale, 1, 'Helpful evidence should retain its original size.');
assert.ok(!learned.prompt.includes('game-'), 'Only aggregates may enter the hosted model prompt.');

const game = { gameId: '2026_06_DEN_KC', season: 2026, gameType: 'REG', week: 6, gameday: '2026-10-11', gametime: '13:00', homeTeam: 'KC', awayTeam: 'DEN', neutralSite: false, completed: false };
assert.equal(verifyLearningMatchup([game], { gameId: game.gameId, homeTeam: 'KC', awayTeam: 'DEN', kickoffUtc: '2026-10-11T17:00:00.000Z' }).gameId, game.gameId);
assert.throws(() => verifyLearningMatchup([game], { homeTeam: 'KC', awayTeam: 'DEN', kickoffUtc: '2026-10-11T19:00:00.000Z' }));
assert.throws(() => verifyLearningMatchup([{ ...game, completed: true }], { homeTeam: 'KC', awayTeam: 'DEN', kickoffUtc: '2026-10-11T17:00:00.000Z' }));

const oldUrl = process.env.NFL_LEARNING_SUPABASE_URL;
const oldKey = process.env.NFL_LEARNING_SUPABASE_KEY;
try {
  delete process.env.NFL_LEARNING_SUPABASE_URL;
  delete process.env.NFL_LEARNING_SUPABASE_KEY;
  assert.equal(learningStorageConfigured(), false);
  assert.equal((await freezeLearningForecast({} as any)).status, 'not-configured');
  process.env.NFL_LEARNING_SUPABASE_URL = 'https://learning.test';
  process.env.NFL_LEARNING_SUPABASE_KEY = 'test-only';
  assert.equal((await freezeLearningForecast({ kickoff_at: '2000-01-01T00:00:00Z' } as any)).status, 'kickoff-passed');
} finally {
  if (oldUrl == null) delete process.env.NFL_LEARNING_SUPABASE_URL; else process.env.NFL_LEARNING_SUPABASE_URL = oldUrl;
  if (oldKey == null) delete process.env.NFL_LEARNING_SUPABASE_KEY; else process.env.NFL_LEARNING_SUPABASE_KEY = oldKey;
}
console.log('Learning feedback: chronology, deduplication, calibration and fallback checks passed.');
