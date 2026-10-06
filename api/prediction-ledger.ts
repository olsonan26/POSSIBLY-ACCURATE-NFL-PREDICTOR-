import { createHash } from 'node:crypto';

const MAX_PAYLOAD_BYTES = 96_000;
const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LV', 'LAC', 'LA', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS'
]);

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonBody(req: any): JsonRecord {
  const body = req?.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as JsonRecord;
  if (typeof body === 'string') {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonRecord;
  }
  throw new Error('JSON object body required.');
}

function datePartsInZone(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === 'literal') continue;
    const n = Number(part.value);
    if (Number.isFinite(n)) out[part.type] = n;
  }
  return out;
}

export function easternKickoffIso(gameday: string, gametime: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameday) || !/^\d{1,2}:\d{2}$/.test(gametime)) return null;
  const [year, month, day] = gameday.split('-').map(Number);
  const [hour, minute] = gametime.split(':').map(Number);
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    !Number.isInteger(hour) || !Number.isInteger(minute) ||
    month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) return null;

  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guessMs = targetLocalMs;
  for (let i = 0; i < 3; i++) {
    const parts = datePartsInZone(new Date(guessMs), 'America/New_York');
    if (!parts.year || !parts.month || !parts.day || parts.hour == null || parts.minute == null) return null;
    const representedLocalMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second || 0
    );
    guessMs += targetLocalMs - representedLocalMs;
  }

  const resolved = new Date(guessMs);
  return Number.isFinite(resolved.getTime()) ? resolved.toISOString() : null;
}

export function payloadSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function snapshotWindowStatus(kickoffAt: string, nowMs = Date.now()): 'eligible' | 'kickoff_passed' | 'invalid' {
  const kickoffMs = Date.parse(kickoffAt);
  if (!Number.isFinite(kickoffMs)) return 'invalid';
  return nowMs < kickoffMs ? 'eligible' : 'kickoff_passed';
}

function storageConfig() {
  const url = process.env.NFL_LEDGER_SUPABASE_URL?.trim();
  const key = process.env.NFL_LEDGER_SUPABASE_KEY?.trim();
  const secret = process.env.NFL_LEDGER_SECRET?.trim();
  if (!url || !key || !secret) return null;
  return { url: url.replace(/\/$/, ''), key, secret };
}

function storageHeaders(config: NonNullable<ReturnType<typeof storageConfig>>, prefer?: string) {
  const headers: Record<string, string> = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    'Content-Type': 'application/json',
    'x-ledger-secret': config.secret
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function storageJson(
  path: string,
  init: RequestInit,
  expected: number[] = [200, 201]
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const config = storageConfig();
  if (!config) return { ok: false, status: 503, body: { error: 'ledger_not_configured' } };
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...storageHeaders(config),
      ...(init.headers || {})
    }
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: expected.includes(response.status), status: response.status, body };
}

async function existingSnapshotForGame(gameId: string): Promise<boolean> {
  const config = storageConfig();
  if (!config) return false;
  const response = await fetch(
    `${config.url}/rest/v1/nfl_prediction_snapshots?game_id=eq.${encodeURIComponent(gameId)}&select=id&limit=1`,
    { headers: storageHeaders(config) }
  );
  if (!response.ok) return false;
  const rows = await response.json() as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

function validTeam(abbr: string): boolean {
  return NFL_TEAMS.has(abbr);
}

function buildGame(body: JsonRecord) {
  const game = body.game && typeof body.game === 'object' && !Array.isArray(body.game)
    ? body.game as JsonRecord
    : {};
  return {
    gameId: text(game.gameId),
    season: finiteNumber(game.season),
    week: finiteNumber(game.week),
    gameday: text(game.gameday),
    gametime: text(game.gametime),
    homeTeam: text(game.homeTeam).toUpperCase(),
    awayTeam: text(game.awayTeam).toUpperCase(),
    neutralSite: Boolean(game.neutralSite),
    completed: Boolean(game.completed),
    homeScore: finiteNumber(game.homeScore),
    awayScore: finiteNumber(game.awayScore)
  };
}

function validateGame(game: ReturnType<typeof buildGame>): string | null {
  if (!game.gameId || game.gameId.length > 180) return 'Valid gameId is required.';
  if (!Number.isInteger(game.season) || game.season! < 1999 || game.season! > 2100) return 'Valid season is required.';
  if (!Number.isInteger(game.week) || game.week! < 1 || game.week! > 25) return 'Valid week is required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(game.gameday)) return 'Valid gameday is required.';
  if (!validTeam(game.homeTeam) || !validTeam(game.awayTeam) || game.homeTeam === game.awayTeam) return 'Valid distinct NFL teams are required.';
  return null;
}

async function recordSnapshot(body: JsonRecord, res: any) {
  const game = buildGame(body);
  const gameError = validateGame(game);
  if (gameError) return res.status(400).json({ error: gameError });
  if (!game.gametime) return res.status(400).json({ error: 'Official kickoff time is required before a prediction can be frozen.' });

  const kickoffAt = easternKickoffIso(game.gameday, game.gametime);
  if (!kickoffAt) return res.status(400).json({ error: 'Kickoff time could not be resolved.' });
  const window = snapshotWindowStatus(kickoffAt);
  if (window !== 'eligible') {
    return res.status(409).json({
      code: 'KICKOFF_PASSED',
      error: 'Prediction was not frozen because the official kickoff has already passed.',
      kickoffAt
    });
  }

  const prediction = body.prediction && typeof body.prediction === 'object' && !Array.isArray(body.prediction)
    ? body.prediction as JsonRecord
    : {};
  const runId = text(body.runId);
  const captureToken = text(body.captureToken);
  const modelVersion = text(prediction.modelVersion);
  const predictedWinner = text(prediction.predictedWinner).toUpperCase();
  const homeWinProbability = finiteNumber(prediction.homeWinProbability);
  const generatedAt = text(prediction.generatedAt);
  const featureSnapshot = prediction.featureSnapshot && typeof prediction.featureSnapshot === 'object'
    ? prediction.featureSnapshot
    : {};

  if (!runId || runId.length > 180 || !captureToken || captureToken.length > 300) {
    return res.status(400).json({ error: 'runId and captureToken are required.' });
  }
  if (!modelVersion || !validTeam(predictedWinner) || (predictedWinner !== game.homeTeam && predictedWinner !== game.awayTeam)) {
    return res.status(400).json({ error: 'Valid model version and predicted winner are required.' });
  }
  if (homeWinProbability == null || homeWinProbability <= 0 || homeWinProbability >= 1) {
    return res.status(400).json({ error: 'homeWinProbability must be between 0 and 1.' });
  }
  const generatedMs = Date.parse(generatedAt);
  if (generatedAt && (!Number.isFinite(generatedMs) || generatedMs >= Date.parse(kickoffAt))) {
    return res.status(409).json({ code: 'INVALID_PREGAME_TIMESTAMP', error: 'Prediction timestamp is not pre-kickoff.' });
  }

  const market = body.market && typeof body.market === 'object' && !Array.isArray(body.market)
    ? body.market as JsonRecord
    : {};
  const marketHomeProbability = finiteNumber(market.homeProbability);
  const blendedHomeProbability = finiteNumber(market.blendedHomeProbability);
  const marketWinner = text(market.winner).toUpperCase() || null;
  const marketSnapshotAt = text(market.snapshotAt) || null;
  const marketSource = text(market.source) || null;

  const sourceMetadata = {
    schedule_gametime_et: game.gametime,
    prediction_generated_at: generatedAt || null,
    request_received_at: new Date().toISOString(),
    market_home_moneyline: finiteNumber(market.homeMoneyline),
    market_away_moneyline: finiteNumber(market.awayMoneyline)
  };

  const rowWithoutHash = {
    capture_token: captureToken,
    run_id: runId,
    game_id: game.gameId,
    season: game.season,
    week: game.week,
    game_date: game.gameday,
    kickoff_at: kickoffAt,
    home_team: game.homeTeam,
    away_team: game.awayTeam,
    neutral_site: game.neutralSite,
    model_version: modelVersion,
    predicted_winner: predictedWinner,
    home_win_probability: homeWinProbability,
    away_win_probability: 1 - homeWinProbability,
    market_home_probability: marketHomeProbability != null && marketHomeProbability > 0 && marketHomeProbability < 1 ? marketHomeProbability : null,
    market_blended_home_probability: blendedHomeProbability != null && blendedHomeProbability > 0 && blendedHomeProbability < 1 ? blendedHomeProbability : null,
    market_winner: marketWinner && validTeam(marketWinner) ? marketWinner : null,
    market_snapshot_at: marketSnapshotAt,
    market_source: marketSource,
    feature_snapshot: featureSnapshot,
    source_metadata: sourceMetadata,
    git_sha: process.env.VERCEL_GIT_COMMIT_SHA || null
  };

  const encoded = JSON.stringify(rowWithoutHash);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: 'Prediction snapshot is too large.' });
  }

  const row = { ...rowWithoutHash, payload_sha256: payloadSha256(rowWithoutHash) };
  const config = storageConfig();
  if (!config) return res.status(503).json({ error: 'Prediction ledger is not configured.' });

  const insert = await fetch(
    `${config.url}/rest/v1/nfl_prediction_snapshots?on_conflict=capture_token`,
    {
      method: 'POST',
      headers: storageHeaders(config, 'resolution=ignore-duplicates,return=representation'),
      body: JSON.stringify(row)
    }
  );

  let rows: any[] = [];
  try {
    rows = await insert.json();
  } catch {
    rows = [];
  }

  if (!insert.ok) {
    return res.status(502).json({ error: 'Immutable ledger rejected the prediction snapshot.', storageStatus: insert.status });
  }

  if (Array.isArray(rows) && rows.length > 0) {
    return res.status(201).json({
      status: 'frozen',
      snapshotId: rows[0].id,
      capturedAt: rows[0].captured_at,
      kickoffAt: rows[0].kickoff_at,
      payloadSha256: rows[0].payload_sha256
    });
  }

  const lookup = await fetch(
    `${config.url}/rest/v1/nfl_prediction_snapshots?capture_token=eq.${encodeURIComponent(captureToken)}&select=id,captured_at,kickoff_at,payload_sha256&limit=1`,
    { headers: storageHeaders(config) }
  );
  const existing = lookup.ok ? await lookup.json() as any[] : [];
  if (existing.length > 0) {
    return res.status(200).json({
      status: 'frozen',
      duplicate: true,
      snapshotId: existing[0].id,
      capturedAt: existing[0].captured_at,
      kickoffAt: existing[0].kickoff_at,
      payloadSha256: existing[0].payload_sha256
    });
  }

  return res.status(502).json({ error: 'Ledger insert returned no durable row.' });
}

async function recordOutcome(body: JsonRecord, res: any) {
  const game = buildGame(body);
  const gameError = validateGame(game);
  if (gameError) return res.status(400).json({ error: gameError });
  if (!game.completed || game.homeScore == null || game.awayScore == null || game.homeScore < 0 || game.awayScore < 0) {
    return res.status(400).json({ error: 'Completed final scores are required.' });
  }

  const hasSnapshot = await existingSnapshotForGame(game.gameId);
  if (!hasSnapshot) {
    return res.status(200).json({
      status: 'skipped',
      reason: 'no_pregame_snapshot',
      message: 'No prospective pregame snapshot exists for this game, so no outcome was attached.'
    });
  }

  const actualWinner = game.homeScore === game.awayScore
    ? 'TIE'
    : game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
  const outcomeKey = `${game.gameId}:${game.awayScore}-${game.homeScore}`;
  const rowWithoutHash = {
    outcome_key: outcomeKey,
    game_id: game.gameId,
    season: game.season,
    week: game.week,
    game_date: game.gameday,
    home_team: game.homeTeam,
    away_team: game.awayTeam,
    home_score: game.homeScore,
    away_score: game.awayScore,
    actual_winner: actualWinner,
    source: 'nflverse games.csv schedule result',
    source_metadata: {
      recorded_via: 'prediction-ledger-api',
      schedule_completed: true,
      git_sha: process.env.VERCEL_GIT_COMMIT_SHA || null
    }
  };
  const row = { ...rowWithoutHash, payload_sha256: payloadSha256(rowWithoutHash) };
  const config = storageConfig();
  if (!config) return res.status(503).json({ error: 'Prediction ledger is not configured.' });

  const insert = await fetch(
    `${config.url}/rest/v1/nfl_prediction_outcomes?on_conflict=outcome_key`,
    {
      method: 'POST',
      headers: storageHeaders(config, 'resolution=ignore-duplicates,return=representation'),
      body: JSON.stringify(row)
    }
  );
  let rows: any[] = [];
  try {
    rows = await insert.json();
  } catch {
    rows = [];
  }
  if (!insert.ok) {
    return res.status(502).json({ error: 'Immutable ledger rejected the outcome event.', storageStatus: insert.status });
  }
  return res.status(rows.length ? 201 : 200).json({
    status: 'outcome_recorded',
    duplicate: rows.length === 0,
    outcomeId: rows[0]?.id || null,
    actualWinner
  });
}

async function health(res: any) {
  const config = storageConfig();
  if (!config) return res.status(503).json({ healthy: false, configured: false });
  const response = await fetch(
    `${config.url}/rest/v1/nfl_prediction_snapshots?select=id&limit=1`,
    { headers: storageHeaders(config) }
  );
  return res.status(response.ok ? 200 : 503).json({
    healthy: response.ok,
    configured: true,
    storageStatus: response.status,
    mode: 'append-only-prekickoff-ledger'
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return health(res);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body: JsonRecord;
  try {
    body = parseJsonBody(req);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid JSON body.' });
  }

  const action = text(body.action);
  try {
    if (action === 'snapshot') return await recordSnapshot(body, res);
    if (action === 'outcome') return await recordOutcome(body, res);
    return res.status(400).json({ error: 'action must be snapshot or outcome.' });
  } catch (error) {
    console.error('prediction-ledger error', error);
    return res.status(500).json({ error: 'Prediction ledger operation failed.' });
  }
}
