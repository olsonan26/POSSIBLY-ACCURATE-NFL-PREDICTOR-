export const PREGAME_INTELLIGENCE_VERSION = 'EXP-031-shadow-v1';

export type PregameCategory =
  | 'qb'
  | 'injury'
  | 'offensive_line'
  | 'weather'
  | 'roster'
  | 'coaching';

export type PregameEffect = 'positive' | 'negative' | 'neutral';

export interface PregameSource {
  url: string;
  title?: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
}

export interface PregameFact {
  id: string;
  category: PregameCategory;
  team: string;
  summary: string;
  effect: PregameEffect;
  severity: number;
  confidence: number;
  sources: PregameSource[];
}

export interface PregameModelPayload {
  facts: PregameFact[];
  noMaterialUpdate: boolean;
  notes: string[];
}

export interface EvaluatedPregameFact extends PregameFact {
  accepted: boolean;
  rejectReason?: string;
  sourceReliability: number;
  freshnessWeight: number;
  effectiveEvidence: number;
  logitAdjustment: number;
  sourceDomains: string[];
}

export interface PregameShadowPrediction {
  version: typeof PREGAME_INTELLIGENCE_VERSION;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  evaluatedAt: string;
  baseHomeProbability: number;
  shadowHomeProbability: number;
  totalLogitAdjustment: number;
  acceptedFactCount: number;
  rejectedFactCount: number;
  facts: EvaluatedPregameFact[];
  governance: {
    productionChanged: false;
    prospectiveOnly: true;
    maxAbsoluteLogitAdjustment: number;
    evidenceRule: string;
  };
}

export interface PregameShadowScoreRecord {
  baseHomeProbability: number;
  shadowHomeProbability: number;
  homeWon: boolean;
}

export interface PregameShadowMetrics {
  games: number;
  baseCorrect: number;
  shadowCorrect: number;
  baseAccuracy: number;
  shadowAccuracy: number;
  accuracyDeltaPoints: number;
  baseBrier: number;
  shadowBrier: number;
  brierDelta: number;
  baseLogLoss: number;
  shadowLogLoss: number;
  logLossDelta: number;
  shadowOnlyCorrect: number;
  baseOnlyCorrect: number;
}

const CATEGORY_LOGIT_CAP: Record<PregameCategory, number> = {
  qb: 0.40,
  injury: 0.25,
  offensive_line: 0.20,
  weather: 0.10,
  roster: 0.12,
  coaching: 0.08
};

const CATEGORY_FRESHNESS_HOURS: Record<PregameCategory, number> = {
  qb: 72,
  injury: 72,
  offensive_line: 96,
  weather: 24,
  roster: 168,
  coaching: 336
};

const TOTAL_LOGIT_CAP = 0.55;

const NATIONAL_DOMAINS = new Set([
  'apnews.com',
  'reuters.com',
  'espn.com',
  'cbssports.com',
  'foxsports.com',
  'nbcsports.com',
  'nfl.com',
  'si.com',
  'theathletic.com'
]);

const OFFICIAL_TEAM_DOMAINS = new Set([
  '49ers.com', 'baltimoreravens.com', 'buffalobills.com', 'bengals.com',
  'clevelandbrowns.com', 'denverbroncos.com', 'detroitlions.com', 'packers.com',
  'houstontexans.com', 'colts.com', 'jaguars.com', 'chiefs.com', 'raiders.com',
  'chargers.com', 'therams.com', 'miamidolphins.com', 'vikings.com',
  'patriots.com', 'neworleanssaints.com', 'giants.com', 'newyorkjets.com',
  'philadelphiaeagles.com', 'steelers.com', 'seahawks.com', 'buccaneers.com',
  'tennesseetitans.com', 'commanders.com', 'atlantafalcons.com',
  'panthers.com', 'chicagobears.com', 'dallascowboys.com', 'azcardinals.com'
]);

const WEATHER_DOMAINS = new Set([
  'weather.gov',
  'noaa.gov',
  'nws.noaa.gov'
]);

const SOCIAL_DOMAINS = new Set(['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'threads.net']);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability: number): number {
  const p = clamp(probability, 0.001, 0.999);
  return Math.log(p / (1 - p));
}

function parseTime(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function sourceReliability(url: string): number {
  const host = normalizeDomain(url);
  if (!host) return 0;
  if (WEATHER_DOMAINS.has(host) || [...WEATHER_DOMAINS].some(domain => matchesDomain(host, domain))) return 1;
  if (host === 'nfl.com' || host.endsWith('.nfl.com')) return 1;
  if (OFFICIAL_TEAM_DOMAINS.has(host)) return 0.98;
  if (NATIONAL_DOMAINS.has(host) || [...NATIONAL_DOMAINS].some(domain => matchesDomain(host, domain))) return 0.90;
  if (SOCIAL_DOMAINS.has(host) || [...SOCIAL_DOMAINS].some(domain => matchesDomain(host, domain))) return 0.50;
  if (host.endsWith('.gov') || host.endsWith('.edu')) return 0.90;
  return 0.72;
}

function factDirection(fact: PregameFact, homeTeam: string, awayTeam: string): number {
  const team = fact.team.toUpperCase();
  if (fact.effect === 'neutral' || team === 'BOTH') return 0;
  if (team !== homeTeam && team !== awayTeam) return 0;
  const teamSign = team === homeTeam ? 1 : -1;
  const effectSign = fact.effect === 'positive' ? 1 : -1;
  return teamSign * effectSign;
}

function freshnessWeight(
  fact: PregameFact,
  kickoffMs: number,
  evaluatedAtMs: number
): number {
  const timestamps = fact.sources
    .map(source => parseTime(source.publishedAt) ?? parseTime(source.retrievedAt))
    .filter((value): value is number => value != null && value <= kickoffMs && value <= evaluatedAtMs);
  if (timestamps.length === 0) return 0;
  const newest = Math.max(...timestamps);
  const ageHours = Math.max(0, (evaluatedAtMs - newest) / 3_600_000);
  const horizon = CATEGORY_FRESHNESS_HOURS[fact.category];
  if (ageHours <= horizon) return 1;
  if (ageHours >= horizon * 3) return 0.25;
  return clamp(1 - ((ageHours - horizon) / (horizon * 2)) * 0.75, 0.25, 1);
}

function sourceGate(fact: PregameFact, kickoffMs: number, evaluatedAtMs: number): {
  pass: boolean;
  reason?: string;
  reliability: number;
  domains: string[];
} {
  const usable = fact.sources
    .map(source => {
      const domain = normalizeDomain(source.url);
      const published = parseTime(source.publishedAt);
      const retrieved = parseTime(source.retrievedAt);
      const time = published ?? retrieved;
      return {
        source,
        domain,
        reliability: sourceReliability(source.url),
        time
      };
    })
    .filter(item => item.domain && item.time != null && item.time <= kickoffMs && item.time <= evaluatedAtMs);

  const domains = [...new Set(usable.map(item => item.domain as string))];
  if (usable.length === 0) return { pass: false, reason: 'No usable pre-kickoff source.', reliability: 0, domains };

  const best = Math.max(...usable.map(item => item.reliability));
  const independentReliableDomains = new Set(
    usable.filter(item => item.reliability >= 0.72).map(item => item.domain)
  ).size;
  const officialOrNational = usable.some(item => item.reliability >= 0.90);

  if (fact.category === 'weather') {
    const authoritativeWeather = usable.some(item => item.reliability >= 0.90);
    if (!authoritativeWeather && independentReliableDomains < 2) {
      return {
        pass: false,
        reason: 'Weather claim lacks an authoritative weather source or two independent reliable sources.',
        reliability: best,
        domains
      };
    }
  } else if (!officialOrNational && independentReliableDomains < 2) {
    return {
      pass: false,
      reason: 'Material claim requires one high-trust source or two independent reliable domains.',
      reliability: best,
      domains
    };
  }

  const reliability = usable.reduce((sum, item) => sum + item.reliability, 0) / usable.length;
  return { pass: true, reliability: clamp(reliability, 0, 1), domains };
}

function normalizeFact(fact: PregameFact): PregameFact {
  return {
    ...fact,
    id: String(fact.id || '').slice(0, 120),
    category: fact.category,
    team: String(fact.team || '').toUpperCase().slice(0, 8),
    summary: String(fact.summary || '').trim().slice(0, 700),
    effect: fact.effect,
    severity: clamp(Number(fact.severity) || 0, 0, 1),
    confidence: clamp(Number(fact.confidence) || 0, 0, 1),
    sources: Array.isArray(fact.sources) ? fact.sources.slice(0, 6).map(source => ({
      url: String(source.url || '').slice(0, 1500),
      title: source.title ? String(source.title).slice(0, 300) : undefined,
      publisher: source.publisher ? String(source.publisher).slice(0, 180) : undefined,
      publishedAt: source.publishedAt ? String(source.publishedAt).slice(0, 80) : undefined,
      retrievedAt: String(source.retrievedAt || '').slice(0, 80)
    })) : []
  };
}

export function buildPregameShadowPrediction(input: {
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  evaluatedAt: string;
  baseHomeProbability: number;
  payload: PregameModelPayload;
}): PregameShadowPrediction {
  const homeTeam = input.homeTeam.toUpperCase();
  const awayTeam = input.awayTeam.toUpperCase();
  const kickoffMs = Date.parse(input.kickoffUtc);
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(kickoffMs) || !Number.isFinite(evaluatedAtMs)) throw new Error('Invalid kickoff/evaluation timestamp.');
  if (evaluatedAtMs > kickoffMs) throw new Error('EXP-031 is prospective-only: evaluation time must not be after kickoff.');
  if (!Number.isFinite(input.baseHomeProbability) || input.baseHomeProbability <= 0 || input.baseHomeProbability >= 1) {
    throw new Error('baseHomeProbability must be a decimal strictly between 0 and 1.');
  }

  const facts = (Array.isArray(input.payload?.facts) ? input.payload.facts : [])
    .slice(0, 30)
    .map(normalizeFact);

  const evaluated: EvaluatedPregameFact[] = facts.map(fact => {
    const direction = factDirection(fact, homeTeam, awayTeam);
    const gate = sourceGate(fact, kickoffMs, evaluatedAtMs);
    const freshness = freshnessWeight(fact, kickoffMs, evaluatedAtMs);
    const effectiveEvidence = clamp(fact.severity * fact.confidence * gate.reliability * freshness, 0, 1);
    const allowedTeam = fact.team === homeTeam || fact.team === awayTeam || fact.team === 'BOTH';
    const categoryKnown = Object.prototype.hasOwnProperty.call(CATEGORY_LOGIT_CAP, fact.category);
    const material = fact.summary.length >= 8 && fact.severity >= 0.05 && fact.confidence >= 0.25;
    const accepted = gate.pass && allowedTeam && categoryKnown && material;
    const rawAdjustment = accepted
      ? direction * CATEGORY_LOGIT_CAP[fact.category] * effectiveEvidence
      : 0;

    let rejectReason: string | undefined;
    if (!allowedTeam) rejectReason = 'Fact team does not match either matchup team.';
    else if (!categoryKnown) rejectReason = 'Unknown category.';
    else if (!material) rejectReason = 'Fact did not clear minimum materiality/confidence.';
    else if (!gate.pass) rejectReason = gate.reason;

    return {
      ...fact,
      accepted,
      rejectReason,
      sourceReliability: gate.reliability,
      freshnessWeight: freshness,
      effectiveEvidence,
      logitAdjustment: rawAdjustment,
      sourceDomains: gate.domains
    };
  });

  const categoryTotals = new Map<PregameCategory, number>();
  for (const fact of evaluated) {
    if (!fact.accepted) continue;
    categoryTotals.set(fact.category, (categoryTotals.get(fact.category) ?? 0) + fact.logitAdjustment);
  }

  let totalLogitAdjustment = 0;
  for (const [category, value] of categoryTotals.entries()) {
    totalLogitAdjustment += clamp(value, -CATEGORY_LOGIT_CAP[category], CATEGORY_LOGIT_CAP[category]);
  }
  totalLogitAdjustment = clamp(totalLogitAdjustment, -TOTAL_LOGIT_CAP, TOTAL_LOGIT_CAP);

  const shadowHomeProbability = logistic(logit(input.baseHomeProbability) + totalLogitAdjustment);

  return {
    version: PREGAME_INTELLIGENCE_VERSION,
    homeTeam,
    awayTeam,
    kickoffUtc: new Date(kickoffMs).toISOString(),
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    baseHomeProbability: input.baseHomeProbability,
    shadowHomeProbability,
    totalLogitAdjustment,
    acceptedFactCount: evaluated.filter(fact => fact.accepted).length,
    rejectedFactCount: evaluated.filter(fact => !fact.accepted).length,
    facts: evaluated,
    governance: {
      productionChanged: false,
      prospectiveOnly: true,
      maxAbsoluteLogitAdjustment: TOTAL_LOGIT_CAP,
      evidenceRule: 'One source with reliability >=0.90 OR two independent reliable domains; all evidence must be timestamped before kickoff.'
    }
  };
}

export function scorePregameShadowRecords(records: PregameShadowScoreRecord[]): PregameShadowMetrics {
  if (!records.length) throw new Error('At least one scored shadow record is required.');
  let baseCorrect = 0;
  let shadowCorrect = 0;
  let baseBrier = 0;
  let shadowBrier = 0;
  let baseLogLoss = 0;
  let shadowLogLoss = 0;
  let shadowOnlyCorrect = 0;
  let baseOnlyCorrect = 0;

  for (const record of records) {
    const y = record.homeWon ? 1 : 0;
    const base = clamp(record.baseHomeProbability, 0.001, 0.999);
    const shadow = clamp(record.shadowHomeProbability, 0.001, 0.999);
    const baseHit = (base >= 0.5) === record.homeWon;
    const shadowHit = (shadow >= 0.5) === record.homeWon;
    if (baseHit) baseCorrect += 1;
    if (shadowHit) shadowCorrect += 1;
    if (shadowHit && !baseHit) shadowOnlyCorrect += 1;
    if (baseHit && !shadowHit) baseOnlyCorrect += 1;
    baseBrier += (base - y) ** 2;
    shadowBrier += (shadow - y) ** 2;
    baseLogLoss += -(y * Math.log(base) + (1 - y) * Math.log(1 - base));
    shadowLogLoss += -(y * Math.log(shadow) + (1 - y) * Math.log(1 - shadow));
  }

  const games = records.length;
  const baseAccuracy = baseCorrect / games;
  const shadowAccuracy = shadowCorrect / games;
  const baseBrierMean = baseBrier / games;
  const shadowBrierMean = shadowBrier / games;
  const baseLogLossMean = baseLogLoss / games;
  const shadowLogLossMean = shadowLogLoss / games;

  return {
    games,
    baseCorrect,
    shadowCorrect,
    baseAccuracy,
    shadowAccuracy,
    accuracyDeltaPoints: (shadowAccuracy - baseAccuracy) * 100,
    baseBrier: baseBrierMean,
    shadowBrier: shadowBrierMean,
    brierDelta: shadowBrierMean - baseBrierMean,
    baseLogLoss: baseLogLossMean,
    shadowLogLoss: shadowLogLossMean,
    logLossDelta: shadowLogLossMean - baseLogLossMean,
    shadowOnlyCorrect,
    baseOnlyCorrect
  };
}
