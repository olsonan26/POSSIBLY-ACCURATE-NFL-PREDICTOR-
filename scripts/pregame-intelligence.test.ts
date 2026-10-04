import {
  buildPregameShadowPrediction,
  scorePregameShadowRecords,
  sourceReliability,
  PregameModelPayload
} from '../services/pregameIntelligenceService';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function near(actual: number, expected: number, tolerance = 1e-9): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const kickoffUtc = '2026-10-04T20:00:00.000Z';
const evaluatedAt = '2026-10-04T13:00:00.000Z';

const officialQbOut: PregameModelPayload = {
  noMaterialUpdate: false,
  notes: [],
  facts: [
    {
      id: 'qb-home-out',
      category: 'qb',
      team: 'KC',
      summary: 'Official pregame report confirms the starting quarterback will not play.',
      effect: 'negative',
      severity: 1,
      confidence: 1,
      sources: [
        {
          url: 'https://www.nfl.com/news/example-qb-status',
          title: 'QB status',
          publisher: 'NFL',
          publishedAt: '2026-10-04T12:30:00.000Z',
          retrievedAt: evaluatedAt
        }
      ]
    }
  ]
};

const qbShadow = buildPregameShadowPrediction({
  homeTeam: 'KC',
  awayTeam: 'DEN',
  kickoffUtc,
  evaluatedAt,
  baseHomeProbability: 0.60,
  payload: officialQbOut
});

assert(qbShadow.acceptedFactCount === 1, 'Official QB fact should clear the evidence gate.');
assert(qbShadow.totalLogitAdjustment < 0, 'Home QB outage must move the shadow against the home team.');
assert(qbShadow.shadowHomeProbability < qbShadow.baseHomeProbability, 'Accepted negative home QB news must lower home probability.');
assert(qbShadow.governance.productionChanged === false, 'EXP-031 must never mutate production scoring.');

const rumorOnly: PregameModelPayload = {
  noMaterialUpdate: false,
  notes: [],
  facts: [
    {
      id: 'single-rumor',
      category: 'injury',
      team: 'DEN',
      summary: 'Single low-authority site claims a key defender may be unavailable.',
      effect: 'negative',
      severity: 0.8,
      confidence: 0.6,
      sources: [
        {
          url: 'https://example-sports-rumors.test/story',
          publishedAt: '2026-10-04T12:00:00.000Z',
          retrievedAt: evaluatedAt
        }
      ]
    }
  ]
};

const rumorShadow = buildPregameShadowPrediction({
  homeTeam: 'KC',
  awayTeam: 'DEN',
  kickoffUtc,
  evaluatedAt,
  baseHomeProbability: 0.60,
  payload: rumorOnly
});

assert(rumorShadow.acceptedFactCount === 0, 'One non-high-trust domain must not move the model.');
assert(near(rumorShadow.shadowHomeProbability, 0.60), 'Rejected rumor must leave base probability unchanged.');

const corroboratedOl: PregameModelPayload = {
  noMaterialUpdate: false,
  notes: [],
  facts: [
    {
      id: 'away-ol-out',
      category: 'offensive_line',
      team: 'DEN',
      summary: 'Two independent reports confirm the starting left tackle will be unavailable.',
      effect: 'negative',
      severity: 0.85,
      confidence: 0.9,
      sources: [
        {
          url: 'https://denver-football.example/report-a',
          publishedAt: '2026-10-04T11:30:00.000Z',
          retrievedAt: evaluatedAt
        },
        {
          url: 'https://colorado-sports.example/report-b',
          publishedAt: '2026-10-04T12:00:00.000Z',
          retrievedAt: evaluatedAt
        }
      ]
    }
  ]
};

const olShadow = buildPregameShadowPrediction({
  homeTeam: 'KC',
  awayTeam: 'DEN',
  kickoffUtc,
  evaluatedAt,
  baseHomeProbability: 0.55,
  payload: corroboratedOl
});

assert(olShadow.acceptedFactCount === 1, 'Two independent reliable domains should satisfy corroboration.');
assert(olShadow.totalLogitAdjustment > 0, 'Negative away-team OL news should move toward the home team.');

const lateSource: PregameModelPayload = {
  noMaterialUpdate: false,
  notes: [],
  facts: [
    {
      id: 'post-kickoff-leak',
      category: 'injury',
      team: 'KC',
      summary: 'This source was published after kickoff and must never be usable.',
      effect: 'negative',
      severity: 1,
      confidence: 1,
      sources: [
        {
          url: 'https://www.nfl.com/news/post-kickoff-example',
          publishedAt: '2026-10-04T20:05:00.000Z',
          retrievedAt: '2026-10-04T20:06:00.000Z'
        }
      ]
    }
  ]
};

const lateShadow = buildPregameShadowPrediction({
  homeTeam: 'KC',
  awayTeam: 'DEN',
  kickoffUtc,
  evaluatedAt,
  baseHomeProbability: 0.60,
  payload: lateSource
});

assert(lateShadow.acceptedFactCount === 0, 'Post-kickoff evidence must be rejected.');
assert(near(lateShadow.shadowHomeProbability, 0.60), 'Post-kickoff evidence must not change the shadow.');

const manySevereFacts: PregameModelPayload = {
  noMaterialUpdate: false,
  notes: [],
  facts: [
    ...(['qb', 'injury', 'offensive_line', 'weather', 'roster', 'coaching'] as const).map((category, index) => ({
      id: `cap-${category}`,
      category,
      team: 'KC',
      summary: `Synthetic severe ${category} issue used only to test the hard total cap.`,
      effect: 'negative' as const,
      severity: 1,
      confidence: 1,
      sources: [
        {
          url: category === 'weather'
            ? 'https://www.weather.gov/example'
            : `https://www.nfl.com/news/cap-test-${index}`,
          publishedAt: '2026-10-04T12:45:00.000Z',
          retrievedAt: evaluatedAt
        }
      ]
    }))
  ]
};

const cappedShadow = buildPregameShadowPrediction({
  homeTeam: 'KC',
  awayTeam: 'DEN',
  kickoffUtc,
  evaluatedAt,
  baseHomeProbability: 0.70,
  payload: manySevereFacts
});

assert(cappedShadow.totalLogitAdjustment >= -0.550000001, 'Total AI adjustment must respect the -0.55 hard cap.');
assert(cappedShadow.totalLogitAdjustment <= 0.550000001, 'Total AI adjustment must respect the +0.55 hard cap.');

const metrics = scorePregameShadowRecords([
  { baseHomeProbability: 0.60, shadowHomeProbability: 0.70, homeWon: true },
  { baseHomeProbability: 0.55, shadowHomeProbability: 0.45, homeWon: false },
  { baseHomeProbability: 0.40, shadowHomeProbability: 0.35, homeWon: false },
  { baseHomeProbability: 0.65, shadowHomeProbability: 0.55, homeWon: true }
]);

assert(metrics.games === 4, 'Metrics scorer must preserve sample size.');
assert(metrics.shadowAccuracy >= metrics.baseAccuracy, 'Synthetic shadow fixture should not score below control.');
assert(metrics.shadowBrier < metrics.baseBrier, 'Synthetic shadow fixture should improve Brier score.');
assert(sourceReliability('https://www.nfl.com/news/example') === 1, 'NFL.com should receive top source reliability.');
assert(sourceReliability('https://www.weather.gov/example') === 1, 'weather.gov should receive top source reliability.');
assert(sourceReliability('not-a-url') === 0, 'Invalid URLs must receive zero reliability.');

console.log('EXP-031 pregame intelligence synthetic acceptance tests: PASS');
console.log(`QB outage example: ${(qbShadow.baseHomeProbability * 100).toFixed(1)}% -> ${(qbShadow.shadowHomeProbability * 100).toFixed(1)}% home`);
console.log(`Rumor gate example: accepted=${rumorShadow.acceptedFactCount}, rejected=${rumorShadow.rejectedFactCount}`);
console.log(`Hard cap example: total logit=${cappedShadow.totalLogitAdjustment.toFixed(3)}`);
console.log(`Synthetic scoring: control ${(metrics.baseAccuracy * 100).toFixed(1)}% vs shadow ${(metrics.shadowAccuracy * 100).toFixed(1)}%, ΔBrier ${metrics.brierDelta.toFixed(4)}`);
