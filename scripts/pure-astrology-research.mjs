import {
  Body,
  Ecliptic,
  GeoVector,
  SiderealTime
} from 'astronomy-engine';
import { TEAM_REGISTRY } from '../data/teamRegistry.ts';

const SOURCE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const SAFE_2026_CUTOFF = '2026-09-14';
const PURE_ASPECTS = [
  ['conjunction', 0],
  ['semisextile', 30],
  ['sextile', 60],
  ['square', 90],
  ['trine', 120],
  ['quincunx', 150],
  ['opposition', 180]
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

// Current home-stadium coordinates. Neutral-site games deliberately omit
// event-angle/house-overlay features unless an exact venue is added later.
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

function parseCsvLine(line) {
  const cells = [];
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
    location: ix('location'), stadium: ix('stadium')
  };
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const get = i => i >= 0 ? String(cells[i] ?? '').trim() : '';
    return {
      gameId: get(c.gameId),
      season: Number(get(c.season) || 0),
      gameType: get(c.gameType),
      week: Number(get(c.week) || 0),
      gameday: get(c.gameday),
      gametime: get(c.gametime),
      awayTeam: normalizeTeam(get(c.awayTeam)),
      awayScore: parseOptionalNumber(get(c.awayScore)),
      homeTeam: normalizeTeam(get(c.homeTeam)),
      homeScore: parseOptionalNumber(get(c.homeScore)),
      location: get(c.location) === 'Neutral' ? 'Neutral' : 'Home',
      stadium: get(c.stadium)
    };
  }).filter(g => g.gameday && g.homeTeam && g.awayTeam && g.season >= 1999);
}

function completed(game) {
  return Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function sigmoid(z) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function logit(p) {
  const q = clamp(p, 0.01, 0.99);
  return Math.log(q / (1 - q));
}

function signedAngle(deg) {
  let x = ((deg + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

function foldedSeparation(a, b) {
  const d = Math.abs(signedAngle(a - b));
  return d > 180 ? 360 - d : d;
}

function julianCenturies(date) {
  return (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
}

function meanObliquityDeg(date) {
  const T = julianCenturies(date);
  return 23.4392911111 - 0.0130041667 * T - 0.0000001639 * T * T + 0.0000005036 * T * T * T;
}

function eclipticRaDec(lambdaDeg, epsilonDeg) {
  const lam = lambdaDeg * Math.PI / 180;
  const eps = epsilonDeg * Math.PI / 180;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  return {
    raDeg: (ra * 180 / Math.PI + 360) % 360,
    decDeg: dec * 180 / Math.PI
  };
}

function altitudeAtEclipticLongitude(lambdaDeg, lstDeg, latitudeDeg, epsilonDeg) {
  const { raDeg, decDeg } = eclipticRaDec(lambdaDeg, epsilonDeg);
  const H = signedAngle(lstDeg - raDeg) * Math.PI / 180;
  const phi = latitudeDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  return Math.asin(
    Math.sin(phi) * Math.sin(dec) +
    Math.cos(phi) * Math.cos(dec) * Math.cos(H)
  ) * 180 / Math.PI;
}

function ascendantLongitude(date, latitudeDeg, longitudeDeg) {
  const lstDeg = (SiderealTime(date) * 15 + longitudeDeg + 360) % 360;
  const eps = meanObliquityDeg(date);
  const roots = [];
  let prevLon = 0;
  let prevAlt = altitudeAtEclipticLongitude(0, lstDeg, latitudeDeg, eps);

  for (let lon = 1; lon <= 360; lon++) {
    const wrapped = lon % 360;
    const alt = altitudeAtEclipticLongitude(wrapped, lstDeg, latitudeDeg, eps);
    if (prevAlt === 0 || alt === 0 || prevAlt * alt < 0) {
      let lo = prevLon;
      let hi = lon;
      let fLo = prevAlt;
      for (let k = 0; k < 32; k++) {
        const mid = (lo + hi) / 2;
        const fMid = altitudeAtEclipticLongitude(mid % 360, lstDeg, latitudeDeg, eps);
        if (fLo === 0 || fLo * fMid <= 0) {
          hi = mid;
        } else {
          lo = mid;
          fLo = fMid;
        }
      }
      const root = ((lo + hi) / 2) % 360;
      if (!roots.some(r => Math.abs(signedAngle(r - root)) < 0.1)) roots.push(root);
    }
    prevLon = lon;
    prevAlt = alt;
  }

  const rising = roots.find(root => {
    const { raDeg } = eclipticRaDec(root, eps);
    return signedAngle(lstDeg - raDeg) < 0;
  });
  return rising ?? roots[0];
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
    const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
    return firstSunday + 7 * (n - 1);
  };
  const dstStart = `${year}-03-${String(nthSunday(3, 2)).padStart(2, '0')}`;
  const dstEnd = `${year}-11-${String(nthSunday(11, 1)).padStart(2, '0')}`;
  return gameday >= dstStart && gameday < dstEnd ? -4 : -5;
}

function kickoffUtc(game) {
  const time = /^\d{1,2}:\d{2}$/.test(game.gametime || '') ? game.gametime : '13:00';
  const [year, month, day] = game.gameday.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const offset = easternUtcOffsetHours(game.gameday);
  return new Date(Date.UTC(year, month - 1, day, hour - offset, minute, 0));
}

function bodyLongitude(body, date) {
  return Ecliptic(GeoVector(body, date, true)).elon;
}

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

function natalPositions(team) {
  if (natalCache.has(team.abbr)) return natalCache.get(team.abbr);
  // Unknown franchise birth times: noon UTC is a date anchor only. Moon, natal
  // houses and natal angles are intentionally excluded from all model features.
  const d = new Date(team.birthday);
  const anchor = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0
  ));
  const positions = DATE_SAFE_NATAL_BODIES.map(body => ({
    body,
    longitude: bodyLongitude(body, anchor)
  }));
  natalCache.set(team.abbr, positions);
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
  const nowLon = bodyLongitude(transitBody, eventDate);
  const laterLon = bodyLongitude(transitBody, new Date(eventDate.getTime() + 6 * 3600000));
  const nowDist = Math.abs(foldedSeparation(nowLon, natalLongitude) - aspectAngle);
  const laterDist = Math.abs(foldedSeparation(laterLon, natalLongitude) - aspectAngle);
  return laterDist < nowDist;
}

function wholeSignHouse(longitude, ascendant) {
  const ascSign = Math.floor(ascendant / 30);
  const sign = Math.floor(((longitude % 360) + 360) % 360 / 30);
  return ((sign - ascSign + 12) % 12) + 1;
}

const featureNames = [
  ...PURE_ASPECTS.map(([name]) => `aspect:${name}`),
  ...EVENT_BODIES.map(body => `transit:${body}`),
  'retrograde-activation',
  'applying-activation',
  'angle:ASC', 'angle:MC', 'angle:DSC', 'angle:IC',
  ...Array.from({ length: 12 }, (_, i) => `event-house:${i + 1}`)
];

function teamPureVector(team, game, eventDate, eventStates, eventAngles) {
  const v = new Array(featureNames.length).fill(0);
  const natal = natalPositions(team);
  const aspectIndex = new Map(PURE_ASPECTS.map(([name], i) => [name, i]));
  const transitStart = PURE_ASPECTS.length;
  const bodyIndex = new Map(EVENT_BODIES.map((body, i) => [body, transitStart + i]));
  const retroIndex = transitStart + EVENT_BODIES.length;
  const applyingIndex = retroIndex + 1;
  const angleStart = applyingIndex + 1;
  const houseStart = angleStart + 4;

  for (const transit of eventStates) {
    for (const n of natal) {
      const aspect = nearestPureAspect(transit.longitude, n.longitude);
      if (!aspect) continue;
      const tightness = 1 - aspect.orb / ORB_DEG;
      v[aspectIndex.get(aspect.name)] += tightness;
      v[bodyIndex.get(transit.body)] += tightness;
      if (transit.retrograde) v[retroIndex] += tightness;
      if (isApplying(transit.body, eventDate, n.longitude, aspect.angle)) v[applyingIndex] += tightness;
    }
  }

  if (eventAngles) {
    const angles = [eventAngles.asc, eventAngles.mc, eventAngles.dsc, eventAngles.ic];
    angles.forEach((angleLon, angleOffset) => {
      for (const n of natal) {
        const aspect = nearestPureAspect(angleLon, n.longitude);
        if (aspect) v[angleStart + angleOffset] += 1 - aspect.orb / ORB_DEG;
      }
    });
    for (const n of natal) {
      const h = wholeSignHouse(n.longitude, eventAngles.asc);
      v[houseStart + h - 1] += 1;
    }
  }

  return v;
}

function pureMatchupFeatures(game) {
  const home = teamByAbbr.get(game.homeTeam);
  const away = teamByAbbr.get(game.awayTeam);
  if (!home || !away) return null;

  const eventDate = kickoffUtc(game);
  const eventStates = EVENT_BODIES.map(body => eventBodyState(body, eventDate));
  let eventAngles = null;
  const venue = game.location === 'Neutral' ? null : VENUES[game.homeTeam];
  if (venue) {
    const [lat, lon] = venue;
    const asc = ascendantLongitude(eventDate, lat, lon);
    if (Number.isFinite(asc)) {
      const mc = mcLongitude(eventDate, lon);
      eventAngles = {
        asc,
        mc,
        dsc: (asc + 180) % 360,
        ic: (mc + 180) % 360
      };
    }
  }

  const hv = teamPureVector(home, game, eventDate, eventStates, eventAngles);
  const av = teamPureVector(away, game, eventDate, eventStates, eventAngles);
  return hv.map((value, i) => value - av[i]);
}

// Football core deliberately mirrors v2.1 historical production scoring so PURE
// can be tested as an incremental residual signal rather than replacing the baseline.
function expectedHomeProbability(homeRating, awayRating, neutral) {
  const homeAdjusted = homeRating + (neutral ? 0 : HOME_ELO_ADVANTAGE);
  return 1 / (1 + Math.pow(10, (awayRating - homeAdjusted) / 400));
}

function footballProbability(games, target) {
  const targetIso = target.gameday;
  const prior = games
    .filter(g => completed(g) && g.gameday < targetIso)
    .sort((a, b) => a.gameday.localeCompare(b.gameday));

  const ratings = new Map();
  let priorSeason = 0;
  const rating = t => ratings.get(t) ?? 1500;

  for (const g of prior) {
    if (priorSeason && g.season !== priorSeason) {
      for (const [team, value] of ratings.entries()) ratings.set(team, 1500 + (value - 1500) * 0.67);
    }
    priorSeason = g.season;
    const hr = rating(g.homeTeam);
    const ar = rating(g.awayTeam);
    const expected = expectedHomeProbability(hr, ar, g.location === 'Neutral');
    const actual = g.homeScore === g.awayScore ? 0.5 : g.homeScore > g.awayScore ? 1 : 0;
    const margin = Math.abs(g.homeScore - g.awayScore);
    const movMultiplier = clamp(Math.log(margin + 1) / Math.log(8), 0.75, 1.65);
    const change = ELO_K * movMultiplier * (actual - expected);
    ratings.set(g.homeTeam, hr + change);
    ratings.set(g.awayTeam, ar - change);
  }

  const base = expectedHomeProbability(
    rating(target.homeTeam), rating(target.awayTeam), target.location === 'Neutral'
  );
  let z = logit(base);

  const form = (team, limit = 8, season, venue) => {
    const selected = prior
      .filter(g => g.homeTeam === team || g.awayTeam === team)
      .filter(g => season == null || g.season === season)
      .filter(g => venue == null || (venue === 'home'
        ? g.homeTeam === team && g.location !== 'Neutral'
        : g.awayTeam === team && g.location !== 'Neutral'))
      .sort((a, b) => b.gameday.localeCompare(a.gameday))
      .slice(0, limit);
    let wins = 0, losses = 0, ties = 0, pointDiff = 0, den = 0;
    selected.forEach((g, i) => {
      const isHome = g.homeTeam === team;
      const scored = isHome ? g.homeScore : g.awayScore;
      const allowed = isHome ? g.awayScore : g.homeScore;
      const w = Math.pow(0.9, i);
      pointDiff += (scored - allowed) * w;
      den += w;
      if (scored > allowed) wins++;
      else if (scored < allowed) losses++;
      else ties++;
    });
    const n = selected.length;
    return {
      games: n,
      winPct: n ? (wins + ties * 0.5) / n : 0.5,
      avgPointDiff: n ? pointDiff / (den || 1) : 0
    };
  };

  const recentHome = form(target.homeTeam, 8);
  const recentAway = form(target.awayTeam, 8);
  const seasonHome = form(target.homeTeam, 30, target.season);
  const seasonAway = form(target.awayTeam, 30, target.season);
  const homeVenue = form(target.homeTeam, 24, undefined, 'home');
  const awayVenue = form(target.awayTeam, 24, undefined, 'away');

  const recentEdge = clamp(
    ((recentHome.winPct - recentAway.winPct) * 0.22) +
    ((recentHome.avgPointDiff - recentAway.avgPointDiff) / 100),
    -0.24, 0.24
  );
  const seasonEdge = seasonHome.games + seasonAway.games >= 4
    ? clamp(
      ((seasonHome.winPct - seasonAway.winPct) * 0.14) +
      ((seasonHome.avgPointDiff - seasonAway.avgPointDiff) / 140),
      -0.16, 0.16
    )
    : 0;
  z += recentEdge + seasonEdge;

  if (target.location !== 'Neutral') {
    z += clamp(
      ((homeVenue.winPct - 0.55) - (awayVenue.winPct - 0.45)) * 0.24,
      -0.12, 0.12
    );

    const sameVenue = prior
      .filter(g => g.location !== 'Neutral' &&
        g.homeTeam === target.homeTeam && g.awayTeam === target.awayTeam)
      .sort((a, b) => b.gameday.localeCompare(a.gameday));
    let weightedHome = 2;
    let weightedAway = 2;
    const targetMs = new Date(`${targetIso}T12:00:00Z`).getTime();
    for (const g of sameVenue) {
      const ageYears = Math.max(
        0,
        (targetMs - new Date(`${g.gameday}T12:00:00Z`).getTime()) / 31557600000
      );
      const w = Math.pow(0.5, ageYears / 5);
      if (g.homeScore > g.awayScore) weightedHome += w;
      else if (g.awayScore > g.homeScore) weightedAway += w;
      else {
        weightedHome += w * 0.5;
        weightedAway += w * 0.5;
      }
    }
    const pct = weightedHome / (weightedHome + weightedAway);
    const reliability = clamp(sameVenue.length / 8, 0, 1);
    z += clamp((pct - 0.5) * 0.30 * reliability, -0.12, 0.12);
  }

  return sigmoid(z);
}

function buildExamples(games) {
  const sample = games.filter(g =>
    g.gameType === 'REG' &&
    g.season >= 2021 &&
    g.season <= 2026 &&
    completed(g) &&
    g.homeScore !== g.awayScore &&
    teamByAbbr.has(g.homeTeam) &&
    teamByAbbr.has(g.awayTeam) &&
    (g.season < 2026 || g.gameday <= SAFE_2026_CUTOFF)
  );

  console.log(`Building point-in-time PURE features for ${sample.length} games...`);
  return sample.map((game, index) => {
    if ((index + 1) % 100 === 0) console.log(`  ${index + 1}/${sample.length}`);
    return {
      game,
      y: game.homeScore > game.awayScore ? 1 : 0,
      x: pureMatchupFeatures(game),
      football: footballProbability(games, game)
    };
  }).filter(e => Array.isArray(e.x));
}

function fitScaler(examples) {
  const p = examples[0].x.length;
  const mean = new Array(p).fill(0);
  const sd = new Array(p).fill(0);
  for (const e of examples) for (let j = 0; j < p; j++) mean[j] += e.x[j];
  for (let j = 0; j < p; j++) mean[j] /= examples.length;
  for (const e of examples) for (let j = 0; j < p; j++) sd[j] += (e.x[j] - mean[j]) ** 2;
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j] / examples.length) || 1;
  return { mean, sd };
}

function scaledX(x, scaler) {
  return x.map((v, j) => (v - scaler.mean[j]) / scaler.sd[j]);
}

function trainLogistic(examples, lambda, useFootballOffset, scaler, iterations = 800) {
  const p = examples[0].x.length;
  const w = new Array(p + 1).fill(0);
  const lr0 = 0.08;
  const rows = examples.map(e => ({
    x: scaledX(e.x, scaler),
    y: e.y,
    offset: useFootballOffset ? logit(e.football) : 0
  }));

  for (let iter = 0; iter < iterations; iter++) {
    const grad = new Array(p + 1).fill(0);
    for (const row of rows) {
      let z = row.offset + w[0];
      for (let j = 0; j < p; j++) z += w[j + 1] * row.x[j];
      const err = sigmoid(z) - row.y;
      grad[0] += err;
      for (let j = 0; j < p; j++) grad[j + 1] += err * row.x[j];
    }
    grad[0] /= rows.length;
    for (let j = 1; j <= p; j++) grad[j] = grad[j] / rows.length + lambda * w[j];
    const lr = lr0 / (1 + iter / 600);
    for (let j = 0; j <= p; j++) w[j] -= lr * grad[j];
  }
  return { w, scaler, useFootballOffset };
}

function modelProbability(model, example) {
  const x = scaledX(example.x, model.scaler);
  let z = (model.useFootballOffset ? logit(example.football) : 0) + model.w[0];
  for (let j = 0; j < x.length; j++) z += model.w[j + 1] * x[j];
  return sigmoid(z);
}

function metrics(examples, predictor) {
  let correct = 0;
  let brier = 0;
  let logloss = 0;
  let homeWins = 0;
  let homePicks = 0;
  let awayPicks = 0;
  let homeCorrect = 0;
  let awayCorrect = 0;
  for (const e of examples) {
    const p = clamp(predictor(e), 0.001, 0.999);
    const pick = p >= 0.5 ? 1 : 0;
    const hit = pick === e.y;
    correct += hit ? 1 : 0;
    homeWins += e.y;
    brier += (p - e.y) ** 2;
    logloss += -(e.y * Math.log(p) + (1 - e.y) * Math.log(1 - p));
    if (pick) {
      homePicks++;
      homeCorrect += hit ? 1 : 0;
    } else {
      awayPicks++;
      awayCorrect += hit ? 1 : 0;
    }
  }
  const n = examples.length;
  return {
    n,
    correct,
    wrong: n - correct,
    accuracy: correct / n,
    brier: brier / n,
    logloss: logloss / n,
    homeBaseline: homeWins / n,
    homePicks,
    awayPicks,
    homePickAccuracy: homePicks ? homeCorrect / homePicks : 0,
    awayPickAccuracy: awayPicks ? awayCorrect / awayPicks : 0
  };
}

function printMetrics(label, m) {
  console.log(
    `${label.padEnd(24)} ${m.correct}/${m.n} = ${(m.accuracy * 100).toFixed(2)}%` +
    ` | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logloss.toFixed(4)}` +
    ` | H/A picks ${m.homePicks}/${m.awayPicks}`
  );
}

function selectLambda(train, validation, useFootballOffset) {
  const candidates = [0.001, 0.005, 0.01, 0.02, 0.05];
  const scaler = fitScaler(train);
  let best = null;
  for (const lambda of candidates) {
    const model = trainLogistic(train, lambda, useFootballOffset, scaler, 650);
    const m = metrics(validation, e => modelProbability(model, e));
    console.log(
      `  lambda ${String(lambda).padEnd(5)} -> ${(m.accuracy * 100).toFixed(2)}%` +
      ` | Brier ${m.brier.toFixed(4)}`
    );
    if (!best || m.brier < best.metrics.brier) best = { lambda, metrics: m };
  }
  return best.lambda;
}

function topCoefficients(model, count = 12) {
  return featureNames
    .map((name, i) => ({ name, coefficient: model.w[i + 1] }))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))
    .slice(0, count);
}

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`NFLverse download failed: ${response.status}`);
  const games = parseGamesCsv(await response.text());
  const examples = buildExamples(games);

  const train13 = examples.filter(e => e.game.season >= 2021 && e.game.season <= 2023);
  const tune24 = examples.filter(e => e.game.season === 2024);
  const train14 = examples.filter(e => e.game.season >= 2021 && e.game.season <= 2024);
  const validate25 = examples.filter(e => e.game.season === 2025);
  const observe26 = examples.filter(e => e.game.season === 2026);

  console.log('\nPURE Astrology date-safe core research');
  console.log('======================================');
  console.log(`Features: ${featureNames.length}`);
  console.log(`Train 2021-2023: ${train13.length}`);
  console.log(`Tune 2024: ${tune24.length}`);
  console.log(`Validation 2025: ${validate25.length}`);
  console.log(`Observation 2026 through ${SAFE_2026_CUTOFF}: ${observe26.length}`);

  console.log('\nRegularization selection on 2024 (PURE-only):');
  const pureLambda = selectLambda(train13, tune24, false);
  console.log(`Selected PURE-only lambda: ${pureLambda}`);

  console.log('\nRegularization selection on 2024 (PURE residual over football):');
  const combinedLambda = selectLambda(train13, tune24, true);
  console.log(`Selected combined lambda: ${combinedLambda}`);

  const finalScaler = fitScaler(train14);
  const pureModel = trainLogistic(train14, pureLambda, false, finalScaler, 1000);
  const combinedModel = trainLogistic(train14, combinedLambda, true, finalScaler, 1000);

  console.log('\n2025 VALIDATION — not used to fit final coefficients');
  console.log('-----------------------------------------------------');
  const football25 = metrics(validate25, e => e.football);
  const pure25 = metrics(validate25, e => modelProbability(pureModel, e));
  const combined25 = metrics(validate25, e => modelProbability(combinedModel, e));
  printMetrics('Football v2.1 core', football25);
  printMetrics('PURE date-safe core', pure25);
  printMetrics('Football + PURE', combined25);
  console.log(`Always-home baseline      ${(football25.homeBaseline * 100).toFixed(2)}%`);

  if (football25.n === 271 && football25.correct !== 177) {
    console.warn(
      `\nWARNING: replicated football core produced ${football25.correct}/271, expected 177/271. ` +
      `Treat combined comparison as approximate until parity is restored.`
    );
  }

  console.log(`\n2026 OBSERVATION — through ${SAFE_2026_CUTOFF}; never used for tuning`);
  console.log('------------------------------------------------------------------');
  const football26 = metrics(observe26, e => e.football);
  const pure26 = metrics(observe26, e => modelProbability(pureModel, e));
  const combined26 = metrics(observe26, e => modelProbability(combinedModel, e));
  printMetrics('Football v2.1 core', football26);
  printMetrics('PURE date-safe core', pure26);
  printMetrics('Football + PURE', combined26);
  console.log(`Always-home baseline      ${(football26.homeBaseline * 100).toFixed(2)}%`);

  console.log('\n2026 football misses — did PURE/combined recover them?');
  console.log('------------------------------------------------------');
  for (const e of observe26) {
    const footballPickHome = e.football >= 0.5;
    if (footballPickHome === Boolean(e.y)) continue;
    const pp = modelProbability(pureModel, e);
    const cp = modelProbability(combinedModel, e);
    const actual = e.y ? e.game.homeTeam : e.game.awayTeam;
    const purePick = pp >= 0.5 ? e.game.homeTeam : e.game.awayTeam;
    const combinedPick = cp >= 0.5 ? e.game.homeTeam : e.game.awayTeam;
    console.log(
      `${e.game.gameday} ${e.game.awayTeam} @ ${e.game.homeTeam} | actual ${actual}` +
      ` | football ${e.football >= 0.5 ? e.game.homeTeam : e.game.awayTeam} ${(Math.max(e.football, 1-e.football)*100).toFixed(1)}%` +
      ` | PURE ${purePick} ${(Math.max(pp, 1-pp)*100).toFixed(1)}% ${purePick === actual ? 'RECOVERED' : 'miss'}` +
      ` | combined ${combinedPick} ${(Math.max(cp, 1-cp)*100).toFixed(1)}% ${combinedPick === actual ? 'RECOVERED' : 'miss'}`
    );
  }

  console.log('\nLargest learned PURE residual coefficients (training/tuning only):');
  for (const row of topCoefficients(combinedModel)) {
    console.log(`  ${row.name.padEnd(24)} ${row.coefficient >= 0 ? '+' : ''}${row.coefficient.toFixed(4)}`);
  }

  console.log('\nGovernance:');
  console.log('- No unknown birth/founding times were invented.');
  console.log('- Franchise natal Moon, natal houses and natal angles are excluded.');
  console.log('- 2025 was not used to fit the final PURE coefficients.');
  console.log('- 2026 is observation only and must not be used to retune this run.');
  console.log('- This is the date-safe franchise + kickoff/location core, not the full personnel v3.2 stack.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
