import { Body, Ecliptic, GeoVector, SiderealTime } from 'astronomy-engine';
import { TEAM_REGISTRY } from '../data/teamRegistry.ts';

const GAMES_SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PLAYERS_SOURCE = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';
const SAFE_2026_CUTOFF = '2026-09-14';
const PURE_ASPECTS = [
  ['conjunction', 0], ['semisextile', 30], ['sextile', 60], ['square', 90],
  ['trine', 120], ['quincunx', 150], ['opposition', 180]
];
const EVENT_BODIES = [
  Body.Sun, Body.Moon, Body.Mercury, Body.Venus, Body.Mars,
  Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune, Body.Pluto
];
const DATE_SAFE_NATAL_BODIES = [
  Body.Sun, Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter,
  Body.Saturn, Body.Uranus, Body.Neptune, Body.Pluto
];
const ORB_DEG = 4;
const HOME_ELO_ADVANTAGE = 55;
const ELO_K = 20;
const LAMBDAS = [0.01, 0.02, 0.05, 0.1, 0.2];
const CROSS_SEASON_WEIGHTS = [0, 0.25, 0.5, 0.75, 1];

const VENUES = {
  ARI: [33.5276, -112.2626], ATL: [33.7554, -84.4008], BAL: [39.2779, -76.6227],
  BUF: [42.7738, -78.7870], CAR: [35.2258, -80.8528], CHI: [41.8623, -87.6167],
  CIN: [39.0955, -84.5161], CLE: [41.5061, -81.6995], DAL: [32.7473, -97.0945],
  DEN: [39.7439, -105.0201], DET: [42.3400, -83.0456], GB: [44.5013, -88.0622],
  HOU: [29.6847, -95.4107], IND: [39.7601, -86.1639], JAX: [30.3239, -81.6373],
  KC: [39.0489, -94.4839], LV: [36.0908, -115.1830], LAC: [33.9535, -118.3392],
  LA: [33.9535, -118.3392], MIA: [25.9580, -80.2389], MIN: [44.9738, -93.2577],
  NE: [42.0909, -71.2643], NO: [29.9511, -90.0812], NYG: [40.8135, -74.0745],
  NYJ: [40.8135, -74.0745], PHI: [39.9008, -75.1675], PIT: [40.4468, -80.0158],
  SF: [37.4030, -121.9700], SEA: [47.5952, -122.3316], TB: [27.9759, -82.5033],
  TEN: [36.1665, -86.7713], WAS: [38.9078, -76.8645]
};

const teamByAbbr = new Map(TEAM_REGISTRY.map(t => [t.abbr, t]));
const natalCache = new Map();
const eventCache = new Map();

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

function normalizeTeam(value) {
  const v = String(value || '').toUpperCase();
  if (v === 'LAR' || v === 'STL') return 'LA';
  if (v === 'OAK') return 'LV';
  if (v === 'SD') return 'LAC';
  if (v === 'JAC') return 'JAX';
  return v;
}

function parseOptionalNumber(v) {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) ? n : undefined;
}

function parseGamesCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const ix = name => headers.indexOf(name);
  const c = {
    gameId: ix('game_id'), season: ix('season'), gameType: ix('game_type'), week: ix('week'),
    gameday: ix('gameday'), gametime: ix('gametime'), awayTeam: ix('away_team'),
    awayScore: ix('away_score'), homeTeam: ix('home_team'), homeScore: ix('home_score'),
    location: ix('location'), stadium: ix('stadium'), awayQbId: ix('away_qb_id'),
    homeQbId: ix('home_qb_id'), awayQbName: ix('away_qb_name'), homeQbName: ix('home_qb_name'),
    awayCoach: ix('away_coach'), homeCoach: ix('home_coach')
  };
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const get = i => i >= 0 ? String(cells[i] ?? '').trim() : '';
    return {
      gameId: get(c.gameId), season: Number(get(c.season) || 0), gameType: get(c.gameType),
      week: Number(get(c.week) || 0), gameday: get(c.gameday), gametime: get(c.gametime),
      awayTeam: normalizeTeam(get(c.awayTeam)), awayScore: parseOptionalNumber(get(c.awayScore)),
      homeTeam: normalizeTeam(get(c.homeTeam)), homeScore: parseOptionalNumber(get(c.homeScore)),
      location: get(c.location) === 'Neutral' ? 'Neutral' : 'Home', stadium: get(c.stadium),
      awayQbId: get(c.awayQbId), homeQbId: get(c.homeQbId),
      awayQbName: get(c.awayQbName), homeQbName: get(c.homeQbName),
      awayCoach: get(c.awayCoach), homeCoach: get(c.homeCoach)
    };
  }).filter(g => g.gameday && g.homeTeam && g.awayTeam && g.season >= 1999);
}

function parsePlayerBirthdays(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const idIx = headers.indexOf('gsis_id');
  const birthIx = ['birth_date', 'birthdate', 'birth_day'].map(x => headers.indexOf(x)).find(x => x >= 0);
  if (idIx < 0 || birthIx == null || birthIx < 0) throw new Error(`players.csv schema missing gsis_id/birth date: ${headers.slice(0, 20).join(',')}`);
  const map = new Map();
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const id = String(cells[idIx] ?? '').trim();
    const dob = String(cells[birthIx] ?? '').trim();
    if (id && /^\d{4}-\d{2}-\d{2}$/.test(dob)) map.set(id, dob);
  }
  return map;
}

function completed(g) { return Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(z) { return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }
function logit(p) { const q = clamp(p, 0.01, 0.99); return Math.log(q / (1 - q)); }
function signedAngle(deg) { let x = ((deg + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; }
function foldedSeparation(a, b) { return Math.abs(signedAngle(a - b)); }

function julianCenturies(date) { return (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525; }
function meanObliquityDeg(date) {
  const T = julianCenturies(date);
  return 23.4392911111 - 0.0130041667 * T - 0.0000001639 * T * T + 0.0000005036 * T * T * T;
}
function eclipticRaDec(lambdaDeg, epsilonDeg) {
  const lam = lambdaDeg * Math.PI / 180, eps = epsilonDeg * Math.PI / 180;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  return { raDeg: (ra * 180 / Math.PI + 360) % 360, decDeg: dec * 180 / Math.PI };
}
function altitudeAtEclipticLongitude(lambdaDeg, lstDeg, latitudeDeg, epsilonDeg) {
  const { raDeg, decDeg } = eclipticRaDec(lambdaDeg, epsilonDeg);
  const H = signedAngle(lstDeg - raDeg) * Math.PI / 180;
  const phi = latitudeDeg * Math.PI / 180, dec = decDeg * Math.PI / 180;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) * 180 / Math.PI;
}
function ascendantLongitude(date, latitudeDeg, longitudeDeg) {
  const lstDeg = (SiderealTime(date) * 15 + longitudeDeg + 360) % 360;
  const eps = meanObliquityDeg(date), roots = [];
  let prevLon = 0, prevAlt = altitudeAtEclipticLongitude(0, lstDeg, latitudeDeg, eps);
  for (let lon = 1; lon <= 360; lon++) {
    const alt = altitudeAtEclipticLongitude(lon % 360, lstDeg, latitudeDeg, eps);
    if (prevAlt === 0 || alt === 0 || prevAlt * alt < 0) {
      let lo = prevLon, hi = lon, fLo = prevAlt;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        const fm = altitudeAtEclipticLongitude(mid % 360, lstDeg, latitudeDeg, eps);
        if (fLo === 0 || fLo * fm <= 0) hi = mid; else { lo = mid; fLo = fm; }
      }
      const root = ((lo + hi) / 2) % 360;
      if (!roots.some(r => Math.abs(signedAngle(r - root)) < 0.1)) roots.push(root);
    }
    prevLon = lon; prevAlt = alt;
  }
  return roots.find(root => signedAngle(lstDeg - eclipticRaDec(root, eps).raDeg) < 0) ?? roots[0];
}
function mcLongitude(date, longitudeDeg) {
  const theta = ((SiderealTime(date) * 15 + longitudeDeg + 360) % 360) * Math.PI / 180;
  const eps = meanObliquityDeg(date) * Math.PI / 180;
  return (Math.atan2(Math.sin(theta), Math.cos(theta) * Math.cos(eps)) * 180 / Math.PI + 360) % 360;
}
function easternUtcOffsetHours(gameday) {
  const [year] = gameday.split('-').map(Number);
  const nthSunday = (m, n) => {
    const first = new Date(Date.UTC(year, m - 1, 1));
    return 1 + ((7 - first.getUTCDay()) % 7) + 7 * (n - 1);
  };
  const start = `${year}-03-${String(nthSunday(3, 2)).padStart(2, '0')}`;
  const end = `${year}-11-${String(nthSunday(11, 1)).padStart(2, '0')}`;
  return gameday >= start && gameday < end ? -4 : -5;
}
function kickoffUtc(game) {
  const time = /^\d{1,2}:\d{2}$/.test(game.gametime || '') ? game.gametime : '13:00';
  const [y, m, d] = game.gameday.split('-').map(Number), [h, min] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h - easternUtcOffsetHours(game.gameday), min, 0));
}
function bodyLongitude(body, date) { return Ecliptic(GeoVector(body, date, true)).elon; }
function eventBodyState(body, date) {
  const longitude = bodyLongitude(body, date);
  let retrograde = false;
  if (body !== Body.Sun && body !== Body.Moon) {
    const before = bodyLongitude(body, new Date(date.getTime() - 6 * 3600000));
    const after = bodyLongitude(body, new Date(date.getTime() + 6 * 3600000));
    retrograde = signedAngle(after - before) < 0;
  }
  return { body, longitude, retrograde };
}
function dateSafeNatalPositions(key, birthday) {
  if (!birthday) return null;
  const cacheKey = `${key}:${birthday}`;
  if (natalCache.has(cacheKey)) return natalCache.get(cacheKey);
  const [y, m, d] = birthday.split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const positions = DATE_SAFE_NATAL_BODIES.map(body => ({ body, longitude: bodyLongitude(body, anchor) }));
  natalCache.set(cacheKey, positions);
  return positions;
}
function nearestPureAspect(a, b) {
  const sep = foldedSeparation(a, b);
  let best = null;
  for (const [name, angle] of PURE_ASPECTS) {
    const orb = Math.abs(sep - angle);
    if (orb <= ORB_DEG && (!best || orb < best.orb)) best = { name, angle, orb };
  }
  return best;
}
function isApplying(transitBody, eventDate, natalLongitude, aspectAngle) {
  const now = bodyLongitude(transitBody, eventDate);
  const later = bodyLongitude(transitBody, new Date(eventDate.getTime() + 6 * 3600000));
  return Math.abs(foldedSeparation(later, natalLongitude) - aspectAngle) < Math.abs(foldedSeparation(now, natalLongitude) - aspectAngle);
}
function wholeSignHouse(longitude, ascendant) {
  const a = Math.floor(ascendant / 30), s = Math.floor(((longitude % 360) + 360) % 360 / 30);
  return ((s - a + 12) % 12) + 1;
}

const baseFeatureNames = [
  ...PURE_ASPECTS.map(([name]) => `aspect:${name}`), ...EVENT_BODIES.map(body => `transit:${body}`),
  'retrograde-activation', 'applying-activation', 'angle:ASC', 'angle:MC', 'angle:DSC', 'angle:IC',
  ...Array.from({ length: 12 }, (_, i) => `event-house:${i + 1}`)
];

function eventContext(game) {
  if (eventCache.has(game.gameId)) return eventCache.get(game.gameId);
  const date = kickoffUtc(game), states = EVENT_BODIES.map(body => eventBodyState(body, date));
  let angles = null;
  const venue = game.location === 'Neutral' ? null : VENUES[game.homeTeam];
  if (venue) {
    const [lat, lon] = venue, asc = ascendantLongitude(date, lat, lon);
    if (Number.isFinite(asc)) {
      const mc = mcLongitude(date, lon);
      angles = { asc, mc, dsc: (asc + 180) % 360, ic: (mc + 180) % 360 };
    }
  }
  const out = { date, states, angles };
  eventCache.set(game.gameId, out);
  return out;
}

function entityVector(key, birthday, context) {
  const v = new Array(baseFeatureNames.length).fill(0);
  const natal = dateSafeNatalPositions(key, birthday);
  if (!natal) return v;
  const aspectIndex = new Map(PURE_ASPECTS.map(([name], i) => [name, i]));
  const transitStart = PURE_ASPECTS.length;
  const bodyIndex = new Map(EVENT_BODIES.map((body, i) => [body, transitStart + i]));
  const retroIndex = transitStart + EVENT_BODIES.length, applyingIndex = retroIndex + 1;
  const angleStart = applyingIndex + 1, houseStart = angleStart + 4;
  for (const transit of context.states) {
    for (const n of natal) {
      const aspect = nearestPureAspect(transit.longitude, n.longitude);
      if (!aspect) continue;
      const tight = 1 - aspect.orb / ORB_DEG;
      v[aspectIndex.get(aspect.name)] += tight;
      v[bodyIndex.get(transit.body)] += tight;
      if (transit.retrograde) v[retroIndex] += tight;
      if (isApplying(transit.body, context.date, n.longitude, aspect.angle)) v[applyingIndex] += tight;
    }
  }
  if (context.angles) {
    [context.angles.asc, context.angles.mc, context.angles.dsc, context.angles.ic].forEach((a, k) => {
      for (const n of natal) {
        const aspect = nearestPureAspect(a, n.longitude);
        if (aspect) v[angleStart + k] += 1 - aspect.orb / ORB_DEG;
      }
    });
    for (const n of natal) v[houseStart + wholeSignHouse(n.longitude, context.angles.asc) - 1] += 1;
  }
  return v;
}
function subtract(a, b) { return a.map((x, i) => x - b[i]); }

function slugName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function sameName(a, b) { return slugName(a) === slugName(b); }
async function wikidataCoachBirthdate(name) {
  const q = new URLSearchParams({ action: 'wbsearchentities', search: name, language: 'en', format: 'json', limit: '10', origin: '*' });
  const search = await fetch(`https://www.wikidata.org/w/api.php?${q}`, { headers: { 'User-Agent': 'NFL-PURE-research/2.0 (GitHub Actions)' } });
  if (!search.ok) return null;
  const result = await search.json();
  const candidates = (result.search || []).filter(r => sameName(r.label || '', name));
  const preferred = candidates.find(r => /american football/i.test(r.description || '') && /(coach|player)/i.test(r.description || ''))
    || candidates.find(r => /football/i.test(r.description || '') && /coach/i.test(r.description || ''));
  if (!preferred) return null;
  const entityRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${preferred.id}.json`, { headers: { 'User-Agent': 'NFL-PURE-research/2.0 (GitHub Actions)' } });
  if (!entityRes.ok) return null;
  const entity = (await entityRes.json()).entities?.[preferred.id];
  const value = entity?.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time;
  const m = typeof value === 'string' ? value.match(/^\+?(\d{4})-(\d{2})-(\d{2})T/) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
async function resolveCoachBirthdays(games) {
  const names = [...new Set(games.flatMap(g => [g.homeCoach, g.awayCoach]).filter(Boolean))].sort();
  const map = new Map();
  const unresolved = [];
  let cursor = 0;
  async function worker() {
    while (cursor < names.length) {
      const name = names[cursor++];
      try {
        const dob = await wikidataCoachBirthdate(name);
        if (dob) map.set(name, dob); else unresolved.push(name);
      } catch { unresolved.push(name); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  return { map, unresolved, total: names.length };
}

function expectedHomeProbability(homeRating, awayRating, neutral) {
  return 1 / (1 + Math.pow(10, (awayRating - (homeRating + (neutral ? 0 : HOME_ELO_ADVANTAGE))) / 400));
}
function footballProbability(games, target, crossSeasonWeight = 1) {
  const prior = games.filter(g => completed(g) && g.gameday < target.gameday).sort((a, b) => a.gameday.localeCompare(b.gameday));
  const ratings = new Map();
  const rating = t => ratings.get(t) ?? 1500;
  let priorSeason = 0;
  for (const g of prior) {
    if (priorSeason && g.season !== priorSeason) {
      for (const [team, value] of ratings) ratings.set(team, 1500 + (value - 1500) * 0.67);
    }
    priorSeason = g.season;
    const hr = rating(g.homeTeam), ar = rating(g.awayTeam);
    const exp = expectedHomeProbability(hr, ar, g.location === 'Neutral');
    const actual = g.homeScore === g.awayScore ? 0.5 : g.homeScore > g.awayScore ? 1 : 0;
    const mov = clamp(Math.log(Math.abs(g.homeScore - g.awayScore) + 1) / Math.log(8), 0.75, 1.65);
    const change = ELO_K * mov * (actual - exp);
    ratings.set(g.homeTeam, hr + change); ratings.set(g.awayTeam, ar - change);
  }
  let z = logit(expectedHomeProbability(rating(target.homeTeam), rating(target.awayTeam), target.location === 'Neutral'));

  const form = (team, limit = 8, seasonOnly = false, venue = null) => {
    const selected = prior.filter(g => g.homeTeam === team || g.awayTeam === team)
      .filter(g => !seasonOnly || g.season === target.season)
      .filter(g => !venue || (venue === 'home' ? g.homeTeam === team && g.location !== 'Neutral' : g.awayTeam === team && g.location !== 'Neutral'))
      .sort((a, b) => b.gameday.localeCompare(a.gameday)).slice(0, limit);
    let winNum = 0, pdNum = 0, den = 0, gamesWeighted = 0;
    selected.forEach((g, i) => {
      const seasonWeight = g.season === target.season ? 1 : (g.season === target.season - 1 ? crossSeasonWeight : 0);
      const w = Math.pow(0.9, i) * seasonWeight;
      if (!w) return;
      const isHome = g.homeTeam === team, scored = isHome ? g.homeScore : g.awayScore, allowed = isHome ? g.awayScore : g.homeScore;
      winNum += (scored > allowed ? 1 : scored < allowed ? 0 : 0.5) * w;
      pdNum += (scored - allowed) * w; den += w; gamesWeighted += seasonWeight;
    });
    return { games: gamesWeighted, winPct: den ? winNum / den : 0.5, avgPointDiff: den ? pdNum / den : 0 };
  };
  const rh = form(target.homeTeam), ra = form(target.awayTeam);
  const sh = form(target.homeTeam, 30, true), sa = form(target.awayTeam, 30, true);
  const hv = form(target.homeTeam, 24, false, 'home'), av = form(target.awayTeam, 24, false, 'away');
  z += clamp(((rh.winPct - ra.winPct) * 0.22) + ((rh.avgPointDiff - ra.avgPointDiff) / 100), -0.24, 0.24);
  if (sh.games + sa.games >= 4) z += clamp(((sh.winPct - sa.winPct) * 0.14) + ((sh.avgPointDiff - sa.avgPointDiff) / 140), -0.16, 0.16);
  if (target.location !== 'Neutral') {
    z += clamp(((hv.winPct - 0.55) - (av.winPct - 0.45)) * 0.24, -0.12, 0.12);
    const same = prior.filter(g => g.location !== 'Neutral' && g.homeTeam === target.homeTeam && g.awayTeam === target.awayTeam).sort((a, b) => b.gameday.localeCompare(a.gameday));
    let wh = 2, wa = 2;
    const tm = new Date(`${target.gameday}T12:00:00Z`).getTime();
    for (const g of same) {
      const age = Math.max(0, (tm - new Date(`${g.gameday}T12:00:00Z`).getTime()) / 31557600000);
      const w = Math.pow(0.5, age / 5);
      if (g.homeScore > g.awayScore) wh += w; else if (g.awayScore > g.homeScore) wa += w; else { wh += w / 2; wa += w / 2; }
    }
    const pct = wh / (wh + wa), reliability = clamp(same.length / 8, 0, 1);
    z += clamp((pct - 0.5) * 0.30 * reliability, -0.12, 0.12);
  }
  return sigmoid(z);
}

function metrics(examples, predictor) {
  let correct = 0, brier = 0, logloss = 0, homeWins = 0;
  for (const e of examples) {
    const p = clamp(predictor(e), 0.001, 0.999), hit = (p >= 0.5) === Boolean(e.y);
    correct += hit ? 1 : 0; homeWins += e.y; brier += (p - e.y) ** 2;
    logloss += -(e.y * Math.log(p) + (1 - e.y) * Math.log(1 - p));
  }
  const n = examples.length;
  return { n, correct, accuracy: correct / n, brier: brier / n, logloss: logloss / n, homeBaseline: homeWins / n };
}
function fmt(label, m) { console.log(`${label.padEnd(29)} ${m.correct}/${m.n} = ${(m.accuracy * 100).toFixed(2)}% | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logloss.toFixed(4)}`); }

function chooseFootballWeight(games, tuneGames) {
  let best = null;
  console.log('\nCross-season recent-form weight selection on tuning season:');
  for (const w of CROSS_SEASON_WEIGHTS) {
    const rows = tuneGames.map(game => ({ y: game.homeScore > game.awayScore ? 1 : 0, p: footballProbability(games, game, w) }));
    const m = metrics(rows, r => r.p);
    console.log(`  previous-season weight ${String(w).padEnd(4)} -> ${(m.accuracy * 100).toFixed(2)}% | Brier ${m.brier.toFixed(4)}`);
    if (!best || m.brier < best.m.brier) best = { w, m };
  }
  return best.w;
}

function featureSet(e, roles) { return roles.flatMap(r => e[r]); }
function fitScaler(rows, roles) {
  const p = featureSet(rows[0], roles).length, mean = new Array(p).fill(0), sd = new Array(p).fill(0);
  for (const e of rows) featureSet(e, roles).forEach((v, j) => mean[j] += v);
  mean.forEach((_, j) => mean[j] /= rows.length);
  for (const e of rows) featureSet(e, roles).forEach((v, j) => sd[j] += (v - mean[j]) ** 2);
  sd.forEach((_, j) => sd[j] = Math.sqrt(sd[j] / rows.length) || 1);
  return { mean, sd };
}
function scaled(e, roles, s) { return featureSet(e, roles).map((v, j) => (v - s.mean[j]) / s.sd[j]); }
function trainModel(rows, roles, lambda, scaler, iterations = 800) {
  const p = featureSet(rows[0], roles).length, w = new Array(p + 1).fill(0), lr0 = 0.08;
  const data = rows.map(e => ({ x: scaled(e, roles, scaler), y: e.y, offset: logit(e.football) }));
  for (let iter = 0; iter < iterations; iter++) {
    const grad = new Array(p + 1).fill(0);
    for (const row of data) {
      let z = row.offset + w[0]; for (let j = 0; j < p; j++) z += w[j + 1] * row.x[j];
      const err = sigmoid(z) - row.y; grad[0] += err; for (let j = 0; j < p; j++) grad[j + 1] += err * row.x[j];
    }
    grad[0] /= data.length;
    for (let j = 1; j <= p; j++) grad[j] = grad[j] / data.length + lambda * w[j];
    const lr = lr0 / (1 + iter / 600); for (let j = 0; j <= p; j++) w[j] -= lr * grad[j];
  }
  return { w, roles, scaler };
}
function modelProbability(model, e) {
  const x = scaled(e, model.roles, model.scaler); let z = logit(e.football) + model.w[0];
  for (let j = 0; j < x.length; j++) z += model.w[j + 1] * x[j];
  return sigmoid(z);
}
function tuneLambda(train, tune, roles) {
  const scaler = fitScaler(train, roles); let best = null;
  for (const lambda of LAMBDAS) {
    const model = trainModel(train, roles, lambda, scaler, 650), m = metrics(tune, e => modelProbability(model, e));
    if (!best || m.brier < best.m.brier) best = { lambda, m };
  }
  return best;
}
function trainFinal(train, roles, lambda) { const scaler = fitScaler(train, roles); return trainModel(train, roles, lambda, scaler, 1000); }

async function buildExamples(games, playerBirthdays, coachBirthdays, crossSeasonWeight) {
  const sample = games.filter(g => g.gameType === 'REG' && g.season >= 2021 && g.season <= 2026 && completed(g) && g.homeScore !== g.awayScore && teamByAbbr.has(g.homeTeam) && teamByAbbr.has(g.awayTeam) && (g.season < 2026 || g.gameday <= SAFE_2026_CUTOFF));
  let coachCovered = 0, qbCovered = 0;
  const rows = [];
  for (let i = 0; i < sample.length; i++) {
    const g = sample[i], ctx = eventContext(g);
    const homeTeam = teamByAbbr.get(g.homeTeam), awayTeam = teamByAbbr.get(g.awayTeam);
    const homeCoachDob = coachBirthdays.get(g.homeCoach), awayCoachDob = coachBirthdays.get(g.awayCoach);
    const homeQbDob = playerBirthdays.get(g.homeQbId), awayQbDob = playerBirthdays.get(g.awayQbId);
    if (homeCoachDob && awayCoachDob) coachCovered++;
    if (homeQbDob && awayQbDob) qbCovered++;
    rows.push({
      game: g, y: g.homeScore > g.awayScore ? 1 : 0,
      football: footballProbability(games, g, crossSeasonWeight),
      franchise: subtract(entityVector(`team:${g.homeTeam}`, homeTeam.birthday, ctx), entityVector(`team:${g.awayTeam}`, awayTeam.birthday, ctx)),
      coach: subtract(entityVector(`coach:${g.homeCoach}`, homeCoachDob, ctx), entityVector(`coach:${g.awayCoach}`, awayCoachDob, ctx)),
      qb: subtract(entityVector(`qb:${g.homeQbId}`, homeQbDob, ctx), entityVector(`qb:${g.awayQbId}`, awayQbDob, ctx))
    });
    if ((i + 1) % 200 === 0) console.log(`  built ${i + 1}/${sample.length}`);
  }
  return { rows, coachCovered, qbCovered, total: sample.length };
}

function runWindow(label, rows, trainYears, tuneYear, testYear, roleSets) {
  const train = rows.filter(e => trainYears.includes(e.game.season));
  const tune = rows.filter(e => e.game.season === tuneYear);
  const test = rows.filter(e => e.game.season === testYear);
  console.log(`\n${label}: train ${trainYears.join(',')} | tune ${tuneYear} | test ${testYear}`);
  console.log('-'.repeat(78));
  fmt('Football only', metrics(test, e => e.football));
  const outputs = {};
  for (const [name, roles] of roleSets) {
    const selected = tuneLambda(train, tune, roles);
    const finalTrain = rows.filter(e => [...trainYears, tuneYear].includes(e.game.season));
    const model = trainFinal(finalTrain, roles, selected.lambda);
    const m = metrics(test, e => modelProbability(model, e));
    fmt(name, m);
    console.log(`  ${name}: lambda ${selected.lambda}; tune Brier ${selected.m.brier.toFixed(4)}`);
    outputs[name] = { model, metrics: m };
  }
  return outputs;
}

function permutationCheck(test, model, repeats = 500) {
  const baseLogit = test.map(e => logit(e.football));
  const residual = test.map((e, i) => logit(modelProbability(model, e)) - baseLogit[i]);
  const observed = metrics(test, e => modelProbability(model, e)).brier;
  let asGood = 0;
  let seed = 0x5eed1234;
  const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  for (let r = 0; r < repeats; r++) {
    const shuffled = residual.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    let brier = 0;
    test.forEach((e, i) => { const p = sigmoid(baseLogit[i] + shuffled[i]); brier += (p - e.y) ** 2; });
    if (brier / test.length <= observed) asGood++;
  }
  return { observed, p: (asGood + 1) / (repeats + 1) };
}

async function main() {
  console.log('PURE v3.2 Phase 2 — Coach + QB role ablation');
  console.log('================================================');
  const [gameRes, playerRes] = await Promise.all([fetch(GAMES_SOURCE), fetch(PLAYERS_SOURCE)]);
  if (!gameRes.ok) throw new Error(`games download failed ${gameRes.status}`);
  if (!playerRes.ok) throw new Error(`players download failed ${playerRes.status}`);
  const games = parseGamesCsv(await gameRes.text());
  const playerBirthdays = parsePlayerBirthdays(await playerRes.text());
  const researchGames = games.filter(g => g.gameType === 'REG' && g.season >= 2021 && g.season <= 2026 && (g.season < 2026 || g.gameday <= SAFE_2026_CUTOFF));
  console.log(`NFLverse player birthdays: ${playerBirthdays.size}`);
  console.log(`Resolving immutable coach birth dates for ${researchGames.length} game rows...`);
  const coaches = await resolveCoachBirthdays(researchGames);
  console.log(`Coach DOB coverage by unique identity: ${coaches.map.size}/${coaches.total}`);
  if (coaches.unresolved.length) console.log(`Unresolved coaches (${coaches.unresolved.length}): ${coaches.unresolved.join(', ')}`);

  // Early-season fix is selected ONLY on 2024, before the 2025 validation is read.
  const tune24Games = researchGames.filter(g => g.season === 2024 && completed(g) && g.homeScore !== g.awayScore);
  const crossSeasonWeight = chooseFootballWeight(games, tune24Games);
  console.log(`Selected previous-season form weight: ${crossSeasonWeight}`);

  console.log('\nBuilding point-in-time franchise/coach/QB astrology features...');
  const built = await buildExamples(games, playerBirthdays, coaches.map, crossSeasonWeight);
  console.log(`Game-level coach pair coverage: ${built.coachCovered}/${built.total} (${(built.coachCovered / built.total * 100).toFixed(1)}%)`);
  console.log(`Game-level QB pair DOB coverage: ${built.qbCovered}/${built.total} (${(built.qbCovered / built.total * 100).toFixed(1)}%)`);

  const roleSets = [
    ['Football + franchise PURE', ['franchise']],
    ['Football + coach PURE', ['coach']],
    ['Football + QB PURE', ['qb']],
    ['Football + coach + QB', ['coach', 'qb']],
    ['Football + franchise + coach', ['franchise', 'coach']],
    ['Football + franchise + QB', ['franchise', 'qb']],
    ['Football + full Phase 2 PURE', ['franchise', 'coach', 'qb']]
  ];

  // Earlier forward window gives a second temporal test instead of trusting one season.
  runWindow('FORWARD WINDOW A', built.rows, [2021, 2022], 2023, 2024, roleSets);
  const out25 = runWindow('FORWARD WINDOW B / PRIMARY VALIDATION', built.rows, [2021, 2022, 2023], 2024, 2025, roleSets);

  console.log(`\n2026 OBSERVATION through ${SAFE_2026_CUTOFF} — never used for tuning`);
  console.log('-'.repeat(78));
  const train14 = built.rows.filter(e => e.game.season >= 2021 && e.game.season <= 2023);
  const tune24 = built.rows.filter(e => e.game.season === 2024);
  const fitThrough24 = built.rows.filter(e => e.game.season >= 2021 && e.game.season <= 2024);
  const obs26 = built.rows.filter(e => e.game.season === 2026);
  fmt('Football only', metrics(obs26, e => e.football));
  for (const [name, roles] of roleSets) {
    const selected = tuneLambda(train14, tune24, roles);
    const model = trainFinal(fitThrough24, roles, selected.lambda);
    fmt(name, metrics(obs26, e => modelProbability(model, e)));
  }

  const full25 = out25['Football + full Phase 2 PURE'];
  const test25 = built.rows.filter(e => e.game.season === 2025);
  const perm = permutationCheck(test25, full25.model, 500);
  console.log(`\nPermutation falsification (2025 full Phase 2 residual): Brier ${perm.observed.toFixed(4)}, shuffled-residual p≈${perm.p.toFixed(3)} (500 permutations)`);

  console.log('\nPromotion gates / caveats:');
  console.log('- Coach identity comes directly from the historical game record; DOB is immutable public biographical data resolved by exact-name Wikidata matching.');
  console.log('- QB identity in nflverse games is reconstructed from play-by-play passer usage. This is acceptable for research screening but NOT promotion-safe pregame identity.');
  console.log('- QB astrology cannot enter production until the same finding survives archived pregame depth-chart identity.');
  console.log('- Unknown DOBs are zero-information: no birth date, Moon, houses or angles are invented.');
  console.log('- 2026 is observation only and must not be used to retune weights, aspects, or role selection.');
}

main().catch(err => { console.error(err); process.exit(1); });
