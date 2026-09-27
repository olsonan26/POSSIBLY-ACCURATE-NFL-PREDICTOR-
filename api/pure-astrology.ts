const NFL_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const MAX_BODY_BYTES = 64 * 1024;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells;
}

async function resolveScheduleMetadata(matchup: any) {
  if (matchup?.gameTime && matchup?.stadium) return matchup;
  try {
    const response = await fetch(NFL_GAMES_URL, {
      headers: { 'User-Agent': 'NFL-Predictor-PURE-Gateway/1.0' }
    });
    if (!response.ok) return matchup;
    const text = await response.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines[0]);
    const ix = (name: string) => headers.indexOf(name);
    const columns = {
      gameId: ix('game_id'),
      gameday: ix('gameday'),
      gametime: ix('gametime'),
      home: ix('home_team'),
      away: ix('away_team'),
      stadium: ix('stadium'),
      location: ix('location')
    };
    const normalize = (value: string) => {
      const v = value.toUpperCase();
      if (v === 'LAR' || v === 'STL') return 'LA';
      if (v === 'OAK') return 'LV';
      if (v === 'SD') return 'LAC';
      if (v === 'JAC') return 'JAX';
      return v;
    };
    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      const get = (index: number) => index >= 0 ? String(cells[index] ?? '').trim() : '';
      if (
        get(columns.gameday) === matchup?.gameDate &&
        normalize(get(columns.home)) === normalize(asString(matchup?.homeTeam)) &&
        normalize(get(columns.away)) === normalize(asString(matchup?.awayTeam))
      ) {
        return {
          ...matchup,
          gameId: matchup.gameId || get(columns.gameId) || undefined,
          gameTime: matchup.gameTime || get(columns.gametime) || undefined,
          stadium: matchup.stadium || get(columns.stadium) || undefined,
          neutralSite: matchup.neutralSite || get(columns.location) === 'Neutral'
        };
      }
    }
  } catch {
    // The private engine has its own fail-closed schedule/venue gate.
  }
  return matchup;
}

function finitePercent(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function safeStrings(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map(item => item.slice(0, 400));
}

function sanitizePureResult(raw: any) {
  const statuses = new Set(['available', 'limited', 'unavailable', 'source_incomplete']);
  const decisions = new Set(['decisive', 'lean', 'unresolved']);
  const status = statuses.has(raw?.status) ? raw.status : 'source_incomplete';
  const decisionStatus = decisions.has(raw?.decisionStatus) ? raw.decisionStatus : 'unresolved';
  const coverage = raw?.coverage || {};
  const winnerAbbr = /^[A-Z]{2,4}$/.test(asString(raw?.winnerAbbr)) ? raw.winnerAbbr : undefined;
  const winnerName = asString(raw?.winnerName).slice(0, 80) || undefined;

  return {
    status,
    methodVersion: asString(raw?.methodVersion).slice(0, 80) || 'pure-private-source-authoritative',
    decisionStatus,
    winnerAbbr,
    winnerName,
    pickStabilityPct: finitePercent(raw?.pickStabilityPct),
    sourceSafe: raw?.sourceSafe === true,
    coverage: {
      homeRoles: Math.max(0, Math.min(20, Number(coverage.homeRoles) || 0)),
      awayRoles: Math.max(0, Math.min(20, Number(coverage.awayRoles) || 0)),
      kickoffExact: coverage.kickoffExact === true,
      venueExact: coverage.venueExact === true,
      unknownTimeRoles: Math.max(0, Math.min(40, Number(coverage.unknownTimeRoles) || 0)),
      omittedTimeSensitiveClaims: Math.max(0, Math.min(500, Number(coverage.omittedTimeSensitiveClaims) || 0))
    },
    rationale: safeStrings(raw?.rationale),
    warnings: safeStrings(raw?.warnings)
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const engineUrl = process.env.PURE_ASTROLOGY_ENGINE_URL;
  const engineToken = process.env.PURE_ASTROLOGY_ENGINE_TOKEN;
  if (!engineUrl || !engineToken) {
    return res.status(503).json({
      error: 'PURE Astrology engine unavailable',
      reason: 'private_engine_not_configured'
    });
  }

  const serialized = JSON.stringify(req.body || {});
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large' });
  }

  const body = req.body || {};
  const matchup = body.matchup || {};
  const homeTeam = asString(matchup.homeTeam).toUpperCase();
  const awayTeam = asString(matchup.awayTeam).toUpperCase();
  const gameDate = asString(matchup.gameDate);
  if (!/^[A-Z]{2,4}$/.test(homeTeam) || !/^[A-Z]{2,4}$/.test(awayTeam) || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
    return res.status(400).json({ error: 'Invalid matchup payload' });
  }

  const resolvedMatchup = await resolveScheduleMetadata({ ...matchup, homeTeam, awayTeam, gameDate });
  const upstreamPayload = {
    matchup: resolvedMatchup,
    homeParticipants: Array.isArray(body.homeParticipants) ? body.homeParticipants.slice(0, 20) : [],
    awayParticipants: Array.isArray(body.awayParticipants) ? body.awayParticipants.slice(0, 20) : []
  };

  try {
    const upstream = await fetch(`${engineUrl.replace(/\/$/, '')}/api/nfl-pure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${engineToken}`,
        'X-Client': 'nfl-predictor-public-gateway'
      },
      body: JSON.stringify(upstreamPayload)
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data) {
      console.error('PURE private engine error', { status: upstream.status, code: data?.code || data?.error });
      return res.status(502).json({
        error: 'PURE Astrology private engine failed',
        reason: data?.code || 'upstream_failure'
      });
    }

    // Strict allow-list: raw evidence, source text, calculation registry, OOI
    // values and internal reasoning are never forwarded to the public client.
    return res.status(200).json(sanitizePureResult(data));
  } catch (error) {
    console.error('PURE private engine request failed', error);
    return res.status(502).json({ error: 'Unable to reach PURE Astrology private engine', reason: 'network_failure' });
  }
}
