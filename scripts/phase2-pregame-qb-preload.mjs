// PURE v3.2 Phase 2B preloader.
// Replaces nflverse games.csv starting-QB IDs with IDs selected from archived
// depth charts knowable before the game. This lets the existing Phase 2 runner
// retest QB astrology without relying on postgame play-by-play passer usage.
//
// 2021-2024: nflverse's legacy weekly depth-chart schema. For each game, use the
// matching season/team/week REG chart and select the QB on depth_team 1.
// 2025+: timestamped ESPN depth charts. Use the latest snapshot whose calendar
// date is STRICTLY BEFORE gameday, then select QB pos_rank 1. Excluding same-day
// snapshots is intentionally conservative and prevents a postgame refresh from
// contaminating the research identity.

const upstreamFetch = globalThis.fetch.bind(globalThis);
const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const DEPTH_BASE = 'https://github.com/nflverse/nflverse-data/releases/download/depth_charts';
const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];

const normalizeTeam = value => {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'LAR' || v === 'STL') return 'LA';
  if (v === 'OAK') return 'LV';
  if (v === 'SD') return 'LAC';
  if (v === 'JAC') return 'JAX';
  if (v === 'WSH') return 'WAS';
  return v;
};

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      cells.push(cell); cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function rowsFromCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  return { headers: parseCsvLine(lines[0]), rows: lines.slice(1).map(parseCsvLine) };
}

function value(row, headers, name) {
  const i = headers.indexOf(name);
  return i >= 0 ? String(row[i] ?? '').trim() : '';
}

function indexLegacyDepth(text, season) {
  const { headers, rows } = rowsFromCsv(text);
  const out = new Map();
  for (const row of rows) {
    const rowSeason = Number(value(row, headers, 'season') || season);
    if (rowSeason !== season) continue;
    const gameType = value(row, headers, 'game_type');
    if (gameType && gameType !== 'REG') continue;
    const team = normalizeTeam(value(row, headers, 'club_code'));
    const week = Number(value(row, headers, 'week'));
    const pos = value(row, headers, 'position').toUpperCase();
    const depthPosition = value(row, headers, 'depth_position').toUpperCase();
    const depthTeamRaw = value(row, headers, 'depth_team');
    const depthTeam = Number(depthTeamRaw);
    const id = value(row, headers, 'gsis_id');
    if (!team || !week || !id) continue;
    if (!(pos === 'QB' || depthPosition === 'QB' || depthPosition.startsWith('QB'))) continue;
    const rank = Number.isFinite(depthTeam) && depthTeam > 0 ? depthTeam : 99;
    const key = `${season}|${week}|${team}`;
    const prior = out.get(key);
    if (!prior || rank < prior.rank) out.set(key, { id, rank });
  }
  return out;
}

function indexTimestampDepth(text, season) {
  const { headers, rows } = rowsFromCsv(text);
  const teamSnapshots = new Map();
  for (const row of rows) {
    const team = normalizeTeam(value(row, headers, 'team'));
    const dt = value(row, headers, 'dt');
    const id = value(row, headers, 'gsis_id');
    const pos = value(row, headers, 'pos_abb').toUpperCase();
    const rankRaw = Number(value(row, headers, 'pos_rank'));
    const slotRaw = Number(value(row, headers, 'pos_slot'));
    if (!team || !dt || !id || pos !== 'QB') continue;
    const date = dt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rank = Number.isFinite(rankRaw) ? rankRaw : 99;
    const slot = Number.isFinite(slotRaw) ? slotRaw : 99;
    const key = `${season}|${team}`;
    const arr = teamSnapshots.get(key) || [];
    arr.push({ date, dt, id, rank, slot });
    teamSnapshots.set(key, arr);
  }
  for (const arr of teamSnapshots.values()) {
    arr.sort((a, b) => a.dt.localeCompare(b.dt) || a.rank - b.rank || a.slot - b.slot);
  }
  return teamSnapshots;
}

async function loadDepthIndexes() {
  const legacy = new Map();
  const timestamped = new Map();
  let legacyRows = 0;
  let timestampRows = 0;

  for (const season of SEASONS) {
    const url = `${DEPTH_BASE}/depth_charts_${season}.csv`;
    const response = await upstreamFetch(url);
    if (!response.ok) {
      console.warn(`[Phase2B] depth chart ${season} unavailable: ${response.status}`);
      continue;
    }
    const text = await response.text();
    if (season <= 2024) {
      const idx = indexLegacyDepth(text, season);
      legacyRows += idx.size;
      for (const [key, row] of idx) legacy.set(key, row);
    } else {
      const idx = indexTimestampDepth(text, season);
      for (const [key, rows] of idx) {
        timestampRows += rows.length;
        timestamped.set(key, rows);
      }
    }
  }

  console.log(`[Phase2B] archived depth QB index: ${legacyRows} legacy team-weeks; ${timestampRows} timestamped QB rows`);
  return { legacy, timestamped };
}

let depthPromise;
function getDepthIndexes() {
  if (!depthPromise) depthPromise = loadDepthIndexes();
  return depthPromise;
}

function pre2025Qb(indexes, season, week, team) {
  return indexes.legacy.get(`${season}|${week}|${normalizeTeam(team)}`)?.id || '';
}

function timestampQb(indexes, season, gameday, team) {
  const rows = indexes.timestamped.get(`${season}|${normalizeTeam(team)}`) || [];
  // latest snapshot STRICTLY before game day; then best depth rank within that snapshot
  let latestDate = '';
  for (const row of rows) {
    if (row.date < gameday && row.date > latestDate) latestDate = row.date;
  }
  if (!latestDate) return '';
  const candidates = rows.filter(row => row.date === latestDate)
    .sort((a, b) => a.rank - b.rank || a.slot - b.slot || a.id.localeCompare(b.id));
  return candidates[0]?.id || '';
}

async function rewriteGamesWithPregameQbs(text) {
  const indexes = await getDepthIndexes();
  const { headers, rows } = rowsFromCsv(text);
  const col = name => headers.indexOf(name);
  const seasonIx = col('season');
  const weekIx = col('week');
  const gamedayIx = col('gameday');
  const homeIx = col('home_team');
  const awayIx = col('away_team');
  const homeQbIx = col('home_qb_id');
  const awayQbIx = col('away_qb_id');
  if ([seasonIx, weekIx, gamedayIx, homeIx, awayIx, homeQbIx, awayQbIx].some(i => i < 0)) {
    throw new Error('[Phase2B] games.csv schema missing QB rewrite columns');
  }

  let eligible = 0;
  let bothCovered = 0;
  let homeCovered = 0;
  let awayCovered = 0;
  let changedHome = 0;
  let changedAway = 0;

  for (const row of rows) {
    const season = Number(row[seasonIx]);
    if (!SEASONS.includes(season)) continue;
    const week = Number(row[weekIx]);
    const gameday = String(row[gamedayIx] || '');
    const home = normalizeTeam(row[homeIx]);
    const away = normalizeTeam(row[awayIx]);
    const originalHome = String(row[homeQbIx] || '');
    const originalAway = String(row[awayQbIx] || '');
    const homeId = season <= 2024
      ? pre2025Qb(indexes, season, week, home)
      : timestampQb(indexes, season, gameday, home);
    const awayId = season <= 2024
      ? pre2025Qb(indexes, season, week, away)
      : timestampQb(indexes, season, gameday, away);

    eligible++;
    if (homeId) { homeCovered++; if (homeId !== originalHome) changedHome++; }
    if (awayId) { awayCovered++; if (awayId !== originalAway) changedAway++; }
    if (homeId && awayId) bothCovered++;

    // IMPORTANT: blank means unavailable pregame identity. Do not fall back to
    // the postgame-derived QB from games.csv because that would reintroduce leakage.
    row[homeQbIx] = homeId;
    row[awayQbIx] = awayId;
  }

  console.log(`[Phase2B] pregame QB coverage: both ${bothCovered}/${eligible} (${eligible ? (100 * bothCovered / eligible).toFixed(1) : '0.0'}%); home ${homeCovered}; away ${awayCovered}`);
  console.log(`[Phase2B] depth identity differs from postgame passer identity: home ${changedHome}, away ${changedAway}`);

  return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
}

globalThis.fetch = async (input, init) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (rawUrl !== GAMES_URL) return upstreamFetch(input, init);
  const response = await upstreamFetch(input, init);
  if (!response.ok) return response;
  const rewritten = await rewriteGamesWithPregameQbs(await response.text());
  return new Response(rewritten, {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8' }
  });
};
