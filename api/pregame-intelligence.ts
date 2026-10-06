import { structuredResearch } from '../server/structuredResearch.js';
import { LEARNING_VERSION, scaledEvidenceProbability } from '../services/learningFeedback.js';
import { freezeLearningForecast, prepareLearningFeedback, verifiedSchedule, verifyLearningMatchup } from '../server/learningStore.js';
import { predictControlProbability } from '../services/validatedPredictionService.js';
import { preparePostgameMemory } from '../server/postgameResearch.js';
import { TEAM_BY_ABBR } from '../data/teamRegistry.js';

export const config = { maxDuration: 150 };

const PREGAME_INTELLIGENCE_VERSION = 'EXP-031-shadow-v1';
const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 95_000;
const TOTAL_LOGIT_CAP = 0.55;

type PregameCategory = 'qb' | 'injury' | 'offensive_line' | 'weather' | 'roster' | 'coaching';
type PregameEffect = 'positive' | 'negative' | 'neutral';

interface PregameSource {
  url: string;
  title?: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
}

interface PregameFact {
  id: string;
  category: PregameCategory;
  team: string;
  summary: string;
  effect: PregameEffect;
  severity: number;
  confidence: number;
  sources: PregameSource[];
}

interface PregameModelPayload {
  facts: PregameFact[];
  noMaterialUpdate: boolean;
  notes: string[];
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

const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LV', 'LAC', 'LA', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS'
]);

const NATIONAL_DOMAINS = new Set([
  'apnews.com', 'reuters.com', 'espn.com', 'cbssports.com', 'foxsports.com',
  'nbcsports.com', 'nfl.com', 'si.com', 'theathletic.com'
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

const WEATHER_DOMAINS = new Set(['weather.gov', 'noaa.gov', 'nws.noaa.gov']);
const SOCIAL_DOMAINS = new Set(['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'threads.net']);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const logistic = (value: number) => 1 / (1 + Math.exp(-value));
const logit = (probability: number) => {
  const p = clamp(probability, 0.001, 0.999);
  return Math.log(p / (1 - p));
};

function asString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function normalizeTeam(value: unknown): string {
  return asString(value).trim().toUpperCase();
}

function parseTime(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function inDomainSet(host: string, domains: Set<string>): boolean {
  return domains.has(host) || [...domains].some(domain => matchesDomain(host, domain));
}

function sourceReliability(url: string): number {
  const host = normalizeDomain(url);
  if (!host) return 0;
  if (inDomainSet(host, WEATHER_DOMAINS)) return 1;
  if (host === 'nfl.com' || host.endsWith('.nfl.com')) return 1;
  if (inDomainSet(host, OFFICIAL_TEAM_DOMAINS)) return 0.98;
  if (inDomainSet(host, NATIONAL_DOMAINS)) return 0.90;
  if (inDomainSet(host, SOCIAL_DOMAINS)) return 0.50;
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

function freshnessWeight(fact: PregameFact, kickoffMs: number, evaluatedAtMs: number): number {
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
      return {
        domain,
        reliability: sourceReliability(source.url),
        time: published ?? retrieved
      };
    })
    .filter(item => item.domain && item.time != null && item.time <= kickoffMs && item.time <= evaluatedAtMs);

  const domains = [...new Set(usable.map(item => item.domain as string))];
  if (usable.length === 0) {
    return { pass: false, reason: 'No usable pre-kickoff source.', reliability: 0, domains };
  }

  const best = Math.max(...usable.map(item => item.reliability));
  const independentReliableDomains = new Set(
    usable.filter(item => item.reliability >= 0.72).map(item => item.domain)
  ).size;
  const officialOrNational = usable.some(item => item.reliability >= 0.90);

  if (fact.category === 'weather') {
    if (!officialOrNational && independentReliableDomains < 2) {
      return {
        pass: false,
        reason: 'Weather claim lacks an authoritative source or two independent reliable sources.',
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
  const categories = new Set<PregameCategory>(['qb', 'injury', 'offensive_line', 'weather', 'roster', 'coaching']);
  const effects = new Set<PregameEffect>(['positive', 'negative', 'neutral']);
  const category = categories.has(fact.category) ? fact.category : 'injury';
  const effect = effects.has(fact.effect) ? fact.effect : 'neutral';
  return {
    id: String(fact.id || '').slice(0, 120),
    category,
    team: String(fact.team || '').toUpperCase().slice(0, 8),
    summary: String(fact.summary || '').trim().slice(0, 700),
    effect,
    severity: clamp(Number(fact.severity) || 0, 0, 1),
    confidence: clamp(Number(fact.confidence) || 0, 0, 1),
    sources: Array.isArray(fact.sources) ? fact.sources.slice(0, 6).map(source => ({
      url: String(source?.url || '').slice(0, 1500),
      title: source?.title ? String(source.title).slice(0, 300) : undefined,
      publisher: source?.publisher ? String(source.publisher).slice(0, 180) : undefined,
      publishedAt: source?.publishedAt ? String(source.publishedAt).slice(0, 80) : undefined,
      retrievedAt: String(source?.retrievedAt || '').slice(0, 80)
    })) : []
  };
}

function buildPregameShadowPrediction(input: {
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  evaluatedAt: string;
  baseHomeProbability: number;
  payload: PregameModelPayload;
}) {
  const homeTeam = input.homeTeam.toUpperCase();
  const awayTeam = input.awayTeam.toUpperCase();
  const kickoffMs = Date.parse(input.kickoffUtc);
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(kickoffMs) || !Number.isFinite(evaluatedAtMs)) throw new Error('Invalid kickoff/evaluation timestamp.');
  if (evaluatedAtMs > kickoffMs) throw new Error('EXP-031 is prospective-only: evaluation time must not be after kickoff.');

  const facts = (Array.isArray(input.payload?.facts) ? input.payload.facts : []).slice(0, 30).map(normalizeFact);
  const evaluated = facts.map(fact => {
    const direction = factDirection(fact, homeTeam, awayTeam);
    const gate = sourceGate(fact, kickoffMs, evaluatedAtMs);
    const freshness = freshnessWeight(fact, kickoffMs, evaluatedAtMs);
    const effectiveEvidence = clamp(fact.severity * fact.confidence * gate.reliability * freshness, 0, 1);
    const allowedTeam = fact.team === homeTeam || fact.team === awayTeam || fact.team === 'BOTH';
    const material = fact.summary.length >= 8 && fact.severity >= 0.05 && fact.confidence >= 0.25;
    const accepted = gate.pass && allowedTeam && material;
    const logitAdjustment = accepted ? direction * CATEGORY_LOGIT_CAP[fact.category] * effectiveEvidence : 0;

    let rejectReason: string | undefined;
    if (!allowedTeam) rejectReason = 'Fact team does not match either matchup team.';
    else if (!material) rejectReason = 'Fact did not clear minimum materiality/confidence.';
    else if (!gate.pass) rejectReason = gate.reason;

    return {
      ...fact,
      accepted,
      rejectReason,
      sourceReliability: gate.reliability,
      freshnessWeight: freshness,
      effectiveEvidence,
      logitAdjustment,
      sourceDomains: gate.domains
    };
  });

  const categoryTotals = new Map<PregameCategory, number>();
  for (const fact of evaluated) {
    if (!fact.accepted) continue;
    categoryTotals.set(fact.category, (categoryTotals.get(fact.category) ?? 0) + fact.logitAdjustment);
  }

  let totalLogitAdjustment = 0;
  for (const [category, value] of categoryTotals) {
    totalLogitAdjustment += clamp(value, -CATEGORY_LOGIT_CAP[category], CATEGORY_LOGIT_CAP[category]);
  }
  totalLogitAdjustment = clamp(totalLogitAdjustment, -TOTAL_LOGIT_CAP, TOTAL_LOGIT_CAP);

  return {
    version: PREGAME_INTELLIGENCE_VERSION,
    homeTeam,
    awayTeam,
    kickoffUtc: new Date(kickoffMs).toISOString(),
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    baseHomeProbability: input.baseHomeProbability,
    shadowHomeProbability: logistic(logit(input.baseHomeProbability) + totalLogitAdjustment),
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

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text ?? '');
      return '';
    }).join('').trim();
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

function jsonSchema(homeTeam: string, awayTeam: string) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['facts', 'noMaterialUpdate', 'notes'],
    properties: {
      facts: {
        type: 'array',
        maxItems: 30,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'category', 'team', 'summary', 'effect', 'severity', 'confidence', 'sources'],
          properties: {
            id: { type: 'string', maxLength: 120 },
            category: { type: 'string', enum: ['qb', 'injury', 'offensive_line', 'weather', 'roster', 'coaching'] },
            team: { type: 'string', enum: [homeTeam, awayTeam, 'BOTH'] },
            summary: { type: 'string', maxLength: 700 },
            effect: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
            severity: { type: 'number', minimum: 0, maximum: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            sources: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['url', 'retrievedAt'],
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  publisher: { type: 'string' },
                  publishedAt: { type: 'string' },
                  retrievedAt: { type: 'string' }
                }
              }
            }
          }
        }
      },
      noMaterialUpdate: { type: 'boolean' },
      notes: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 500 } }
    }
  };
}

function buildSystemPrompt(input: { homeTeam: string; awayTeam: string; kickoffUtc: string; evaluatedAt: string; feedbackPrompt?: string }): string {
  return `You are EXP-031, a forensic NFL pregame evidence collector. You are NOT the prediction model and you do not choose a winner.

MATCHUP
- Away: ${input.awayTeam}
- Home: ${input.homeTeam}
- Scheduled kickoff UTC: ${input.kickoffUtc}
- Research timestamp UTC: ${input.evaluatedAt}

MISSION
Search current web sources for material information publicly available before kickoff that could change a football-only pregame assessment. Check QB, injuries, offensive line, weather, roster, and coaching. Return structured evidence only.

SOURCE PRIORITY
A. NFL and official team reports/transactions/depth charts.
B. NOAA/NWS for weather.
C. AP, Reuters, ESPN, CBS Sports, NBC Sports, Fox Sports, The Athletic, SI.
D. Named local beat reporting with direct sourcing.

RULES
- Search the web and fetch underlying pages for material claims when possible.
- Every fact needs a real source URL and retrieval timestamp.
- Include publishedAt only when the page provides it; never invent one.
- Never use information published after ${input.kickoffUtc}.
- Never use game results, in-game developments, postgame recaps, or hindsight.
- Conflicts lower confidence and must be disclosed in the summary.
- Do not use betting picks, astrology, numerology, Lettrology, or the base model prediction.
- Social posts alone, rumor aggregators, fan forums, and SEO prediction pages are insufficient.
- severity = football materiality from 0 to 1; confidence = evidence confidence from 0 to 1.
- Keep severity conservative and return noMaterialUpdate=true when trustworthy evidence is not material enough.

The application independently gates evidence and hard-caps the total adjustment.

${input.feedbackPrompt || ''}

Before returning the final object, audit each claim for duplicate evidence, conflicting sources, uncertain availability and stale reports. Resolve the audit in the final JSON. This is one bounded research request, not an unlimited self-calling loop.`;
}

async function callOpenRouter(input: {
  apiKey: string;
  model: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  evaluatedAt: string;
  feedbackPrompt?: string;
}): Promise<{ payload: PregameModelPayload; model: string; usage?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://nflpredictor-pi.vercel.app',
        'X-Title': 'NFL Predictor EXP-031 Pregame Intelligence'
      },
      body: JSON.stringify({
        model: input.model,
        provider: { require_parameters: true },
        plugins: [{ id: 'response-healing' }],
        reasoning: { effort: 'low' },
        temperature: 0.1,
        max_tokens: 5000,
        tools: [
          { type: 'openrouter:web_search', parameters: { max_results: 6, max_total_results: 18 } },
          { type: 'openrouter:web_fetch', parameters: { engine: 'openrouter', max_content_tokens: 12000 } }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'exp031_pregame_intelligence',
            strict: true,
            schema: jsonSchema(input.homeTeam, input.awayTeam)
          }
        },
        messages: [
          { role: 'system', content: buildSystemPrompt(input) },
          { role: 'user', content: `Research ${input.awayTeam} at ${input.homeTeam}. Verify current QB, injury, offensive-line, weather, roster, and coaching information. Return only the schema-compliant evidence object.` }
        ]
      })
    });

    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${raw.slice(0, 1000)}`);

    const data = JSON.parse(raw) as {
      model?: string;
      usage?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = normalizeContent(data.choices?.[0]?.message?.content);
    if (!content) throw new Error('OpenRouter returned no structured content.');

    let payload: PregameModelPayload;
    try {
      payload = structuredResearch(content, ['facts', 'noMaterialUpdate', 'notes']) as PregameModelPayload;
    } catch {
      throw new Error(`OpenRouter returned non-JSON content: ${content.slice(0, 500)}`);
    }

    return { payload, model: data.model || input.model, usage: data.usage };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'EXP-031 is not configured on this deployment.',
      requiredEnvironmentVariable: 'OPENROUTER_API_KEY'
    });
  }

  const homeTeam = normalizeTeam(req.body?.homeTeam);
  const awayTeam = normalizeTeam(req.body?.awayTeam);
  const kickoffUtc = asString(req.body?.kickoffUtc).trim();
  const clientBaseHomeProbability = Number(req.body?.baseHomeProbability);
  const kickoffMs = Date.parse(kickoffUtc);
  const nowMs = Date.now();

  if (!NFL_TEAMS.has(homeTeam) || !NFL_TEAMS.has(awayTeam) || homeTeam === awayTeam) {
    return res.status(400).json({ error: 'Invalid NFL matchup.' });
  }
  if (!Number.isFinite(kickoffMs)) return res.status(400).json({ error: 'kickoffUtc must be a valid timestamp.' });
  if (!Number.isFinite(clientBaseHomeProbability) || clientBaseHomeProbability <= 0 || clientBaseHomeProbability >= 1) {
    return res.status(400).json({ error: 'baseHomeProbability must be a decimal strictly between 0 and 1.' });
  }
  if (kickoffMs <= nowMs) {
    return res.status(409).json({ error: 'EXP-031 is prospective-only. Research is blocked at and after kickoff.' });
  }
  if (kickoffMs > nowMs + MAX_LOOKAHEAD_MS) {
    return res.status(400).json({ error: 'Pregame intelligence may only be requested within 14 days of kickoff.' });
  }

  const normalizedKickoff = new Date(kickoffMs).toISOString();
  const model = process.env.OPENROUTER_PREGAME_MODEL || DEFAULT_MODEL;

  try {
    const games = await verifiedSchedule();
    let game;
    try {
      game = verifyLearningMatchup(games, { gameId: asString(req.body?.gameId) || undefined, homeTeam, awayTeam, kickoffUtc: normalizedKickoff });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unverified matchup.' });
    }
    // The browser's probability cannot poison persistent feedback.
    const baseHomeProbability = await predictControlProbability(TEAM_BY_ABBR.get(homeTeam)!, TEAM_BY_ABBR.get(awayTeam)!,
      new Date(`${game.gameday}T12:00:00Z`), { neutralSite: game.neutralSite });
    const { feedback, storageStatus } = await prepareLearningFeedback(games, model);
    if (Date.now() >= kickoffMs) return res.status(409).json({ error: 'Kickoff passed before research could start.' });
    const evaluatedAt = new Date().toISOString();
    const postgameMemory = await preparePostgameMemory(model, evaluatedAt);
    if (Date.now() >= kickoffMs) return res.status(409).json({ error: 'Kickoff passed before research could start.' });
    const research = await callOpenRouter({
      apiKey,
      model,
      homeTeam,
      awayTeam,
      kickoffUtc: normalizedKickoff,
      evaluatedAt,
      feedbackPrompt: [feedback.prompt, postgameMemory.prompt].filter(Boolean).join("\n\n")
    });

    const shadow = buildPregameShadowPrediction({
      homeTeam,
      awayTeam,
      kickoffUtc: normalizedKickoff,
      evaluatedAt,
      baseHomeProbability,
      payload: research.payload
    });

    const learnedHomeProbability = scaledEvidenceProbability(baseHomeProbability, shadow.shadowHomeProbability, feedback.scale);
    const feedbackSummary = {
      version: feedback.version, asOf: feedback.asOf, games: feedback.games, scale: feedback.scale,
      suggestedScale: feedback.suggestedScale, gatePassed: feedback.gatePassed, status: feedback.status,
      base: feedback.base, raw: feedback.raw, deployedLearningShadow: feedback.deployedLearningShadow,
      forward: feedback.forward, categories: feedback.categories
    };
    const capture = await freezeLearningForecast({
      game_id: game.gameId, experiment_version: LEARNING_VERSION, research_model: model,
      completed_at: new Date().toISOString(), kickoff_at: normalizedKickoff, home_team: homeTeam, away_team: awayTeam,
      base_home_probability: baseHomeProbability, raw_home_probability: shadow.shadowHomeProbability,
      learned_home_probability: learnedHomeProbability, facts: shadow.facts,
      feedback: { ...feedbackSummary, postgameMemory: { games: postgameMemory.games, categories: postgameMemory.categories, status: postgameMemory.status }, providerModel: research.model, controlSource: 'server-v2.2', gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null }
    });
    return res.status(200).json({
      experiment: PREGAME_INTELLIGENCE_VERSION,
      mode: 'shadow-only',
      productionPickChanged: false,
      researchModel: research.model,
      generatedAt: evaluatedAt,
      payload: research.payload,
      shadow,
      learning: { ...feedbackSummary, storageStatus, capture, postgameReviews: postgameMemory.games, memoryStatus: postgameMemory.status, homeWinProbability: learnedHomeProbability, modelWeightsChanged: false },
      usage: research.usage ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('EXP-031 pregame intelligence failed', message);
    return res.status(502).json({
      error: 'Unable to complete EXP-031 pregame intelligence research.',
      detail: message.slice(0, 1200),
      productionPickChanged: false
    });
  }
}
