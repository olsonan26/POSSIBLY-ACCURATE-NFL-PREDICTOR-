import assert from 'node:assert/strict';
import handler from '../api/pregame-intelligence';
import { easternKickoffIso } from '../api/prediction-ledger';
import { NFL_SCHEDULE_URL, type LearningForecast } from '../server/learningStore';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const forecasts = new Map<string, LearningForecast>();
let paidCalls = 0;
let databaseWrites = 0;
let unavailable = false;
let forceLate = false;
let lastPrompt = '';
const originalNow = Date.now;
const gameday = new Date(originalNow() + 3 * 86400_000).toISOString().slice(0, 10);
const kickoffUtc = easternKickoffIso(gameday, '13:00')!;
const gameId = 'test-upcoming-KC-DEN';
const header = 'game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location';
const history = Array.from({ length: 1000 }, (_, i) => {
  const date = new Date(Date.UTC(1999, 0, 1 + i)).toISOString().slice(0, 10);
  return `past-${i},${date.slice(0, 4)},REG,1,${date},13:00,DEN,${i % 2 ? 28 : 14},KC,${i % 2 ? 14 : 28},Home`;
});
const csv = [header, ...history, `${gameId},${gameday.slice(0, 4)},REG,6,${gameday},13:00,DEN,,KC,,Home`].join('\n');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (input: any, init?: RequestInit) => {
  const url = String(input);
  if (url === NFL_SCHEDULE_URL || url.startsWith('/api/nfl-data?dataset=games')) return new Response(csv);
  if (url.startsWith('/api/nfl-data') || url.startsWith('https://site.api.espn.com/')) return json({ athletes: [], depthcharts: [], injuries: [] });
  if (url.startsWith('https://learning.test/rest/v1/')) {
    assert.equal(new Headers(init?.headers).has('Authorization'), false, 'New Supabase secret keys belong on apikey, not a JWT bearer header.');
    if (unavailable) return json({ error: 'test outage' }, 503);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/nfl_learning_outcomes')) return json([]);
    if (init?.method === 'POST') {
      databaseWrites++;
      const row = JSON.parse(String(init.body));
      if (forecasts.has(row.game_id)) return json([]);
      const frozen = { ...row, captured_at: new Date().toISOString() };
      forecasts.set(row.game_id, frozen);
      return json([frozen], 201);
    }
    const id = parsed.searchParams.get('game_id')?.slice(3);
    return json([...forecasts.values()].filter(r => !id || r.game_id === id));
  }
  if (url === 'https://openrouter.ai/api/v1/chat/completions') {
    paidCalls++;
    const request = JSON.parse(String(init?.body));
    lastPrompt = request.messages[0].content;
    const researchTimestamp = lastPrompt.match(/Research timestamp UTC: (\S+)/)[1];
    if (forceLate) Date.now = () => Date.parse(kickoffUtc) + 1;
    return json({ model: request.model, choices: [{ message: { content: JSON.stringify({ noMaterialUpdate: false, notes: [], facts: [{
      id: 'verified-qb-out', category: 'qb', team: 'KC', summary: 'Official source confirms the home starting quarterback is unavailable.',
      effect: 'negative', severity: 0.8, confidence: 0.9,
      sources: [{ url: 'https://nfl.com/news/verified-qb-report', retrievedAt: researchTimestamp }]
    }] }) } }] });
  }
  throw new Error(`Unexpected network request in offline API test: ${url}`);
};

async function request(changes: Record<string, unknown> = {}) {
  let status = 200, response: any;
  const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(body: unknown) { response = body; return this; } };
  await handler({ method: 'POST', body: { gameId, homeTeam: 'KC', awayTeam: 'DEN', kickoffUtc, baseHomeProbability: 0.01,
    homeScore: 99, awayScore: 0, ...changes } }, res);
  return { status, body: response };
}

try {
  process.env.OPENROUTER_API_KEY = 'offline-test-key';
  process.env.OPENROUTER_PREGAME_MODEL = 'deepseek/deepseek-v4.1-flash';
  process.env.NFL_LEARNING_SUPABASE_URL = 'https://learning.test';
  process.env.NFL_LEARNING_SUPABASE_KEY = 'sb_secret_offline-service-key';
  const invalid = await request({ gameId: 'fabricated-game' });
  assert.equal(invalid.status, 400);
  assert.equal(paidCalls, 0, 'Unverified matchups must be rejected before a paid call.');
  const first = await request();
  assert.equal(first.status, 200);
  assert.equal(first.body.learning.capture.status, 'frozen');
  assert.ok(first.body.shadow.baseHomeProbability > 0.1, 'Stored control must be recomputed server-side, not trust browser probability.');
  assert.equal(first.body.learning.games, 0, 'Browser-posted scores must not become feedback.');
  assert.match(lastPrompt, /OUTCOME FEEDBACK/);
  assert.match(lastPrompt, /audit each claim/);
  assert.equal(paidCalls, 1);
  const saved = forecasts.get(gameId)!;
  assert.equal(saved.base_home_probability, first.body.shadow.baseHomeProbability);
  assert.equal(saved.facts.length, 1);
  assert.equal(saved.feedback.controlSource, 'server-v2.2');
  const rerun = await request();
  assert.equal(rerun.body.learning.capture.status, 'already-frozen');
  assert.equal(forecasts.size, 1);
  assert.equal(forecasts.get(gameId), saved, 'Rerun must leave first frozen forecast intact.');
  unavailable = true;
  const failedStorage = await request();
  assert.equal(failedStorage.status, 200, 'Optional learning outage must not remove research.');
  assert.equal(failedStorage.body.learning.storageStatus, 'unavailable');
  assert.equal(failedStorage.body.learning.capture.status, 'failed');
  unavailable = false;
  forceLate = true;
  const writesBeforeLate = databaseWrites;
  const late = await request();
  assert.equal(late.body.learning.capture.status, 'kickoff-passed');
  assert.equal(databaseWrites, writesBeforeLate, 'Research completing after kickoff must not be saved.');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const key of ['OPENROUTER_API_KEY', 'OPENROUTER_PREGAME_MODEL', 'NFL_LEARNING_SUPABASE_URL', 'NFL_LEARNING_SUPABASE_KEY']) {
    if (originalEnv[key] == null) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
}
console.log('Offline learning API: verified schedule, server control, persistent capture, reruns, outages and kickoff race checks passed.');
