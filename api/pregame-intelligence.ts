import {
  buildPregameShadowPrediction,
  PREGAME_INTELLIGENCE_VERSION,
  PregameModelPayload
} from '../services/pregameIntelligenceService';

export const maxDuration = 120;

const DEFAULT_MODEL = 'deepseek/deepseek-v4-pro-0813';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;

const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LV', 'LAC', 'LA', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS'
]);

function asString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function normalizeTeam(value: unknown): string {
  return asString(value).trim().toUpperCase();
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text ?? '');
        return '';
      })
      .join('')
      .trim();
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
            category: {
              type: 'string',
              enum: ['qb', 'injury', 'offensive_line', 'weather', 'roster', 'coaching']
            },
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
      notes: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string', maxLength: 500 }
      }
    }
  };
}

function buildSystemPrompt(input: {
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  evaluatedAt: string;
}): string {
  return `You are EXP-031, a forensic NFL pregame evidence collector. You are NOT the prediction model and you do not choose a winner.

MATCHUP
- Away: ${input.awayTeam}
- Home: ${input.homeTeam}
- Scheduled kickoff UTC: ${input.kickoffUtc}
- Research timestamp UTC: ${input.evaluatedAt}

MISSION
Search and fetch current web sources for material information that was publicly available before kickoff and could change a football-only pregame assessment. Return structured evidence only in the required JSON schema.

ALLOWED CATEGORIES
1. qb — confirmed starter status, meaningful QB injury/availability, verified starter change.
2. injury — material non-QB injuries/availability, especially high-snap or high-value players.
3. offensive_line — confirmed OL starters out/limited, lineup continuity, tackle/center changes.
4. weather — venue-relevant wind, precipitation, temperature/extreme conditions; prefer NOAA/NWS.
5. roster — verified activation, suspension, trade, signing, release, or depth-chart change with direct game relevance.
6. coaching — verified play-caller/head-coach change or unusual operational issue with direct game relevance.

SOURCE PRIORITY
A. NFL / official team injury reports, transactions, depth charts, official club statements.
B. NOAA/NWS for outdoor weather.
C. AP, Reuters, ESPN, CBS Sports, NBC Sports, Fox Sports, The Athletic, SI.
D. Named local beat reporting with direct sourcing.
Social posts alone are weak evidence. Rumor aggregators, anonymous repost accounts, prediction sites, gambling picks, fan forums, and SEO content are not sufficient for a material fact.

VERIFICATION RULES
- Search the web and fetch the underlying page for material claims whenever possible.
- Every fact needs a real source URL and a retrieval timestamp.
- Include publishedAt when the page provides one. Never invent a publication time.
- Do not use information published after ${input.kickoffUtc}.
- Do not use game results, in-game developments, postgame recaps, or hindsight.
- If sources conflict, lower confidence and state the conflict in the summary.
- A player's generic season reputation is not a new pregame fact.
- Do not use betting lines, public picks, astrology, numerology, Lettrology, or the base model's prediction.
- Duplicate reports of the same underlying fact should be one fact with multiple sources.

SCORING FIELDS
- team: the team directly affected, or BOTH.
- effect: positive/negative/neutral effect on that team's football outlook.
- severity: 0 to 1 describing football materiality if true, not certainty.
- confidence: 0 to 1 describing evidence confidence.
- Keep severity conservative. Routine questionable tags without meaningful role/usage evidence should be low severity.
- Return noMaterialUpdate=true when there is nothing trustworthy and material enough to matter.

Your job is evidence collection. The application has a separate deterministic evidence gate and hard adjustment cap.`;
}

async function callOpenRouter(input: {
  apiKey: string;
  model: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  evaluatedAt: string;
}): Promise<{ payload: PregameModelPayload; model: string; usage?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 105_000);

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
        temperature: 0.1,
        max_tokens: 7000,
        tools: [
          { type: 'openrouter:web_search' },
          { type: 'openrouter:web_fetch' }
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
          {
            role: 'system',
            content: buildSystemPrompt(input)
          },
          {
            role: 'user',
            content: `Research ${input.awayTeam} at ${input.homeTeam}. Search broadly enough to check QB, injury, offensive line, weather, roster, and coaching. Return only the schema-compliant evidence object.`
          }
        ]
      })
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OpenRouter ${response.status}: ${raw.slice(0, 1000)}`);
    }

    const data = JSON.parse(raw) as {
      model?: string;
      usage?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = normalizeContent(data.choices?.[0]?.message?.content);
    if (!content) throw new Error('OpenRouter returned no structured content.');

    let payload: PregameModelPayload;
    try {
      payload = JSON.parse(content) as PregameModelPayload;
    } catch {
      throw new Error(`OpenRouter returned non-JSON content: ${content.slice(0, 500)}`);
    }

    return {
      payload,
      model: data.model || input.model,
      usage: data.usage
    };
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
  const baseHomeProbability = Number(req.body?.baseHomeProbability);
  const kickoffMs = Date.parse(kickoffUtc);
  const nowMs = Date.now();

  if (!NFL_TEAMS.has(homeTeam) || !NFL_TEAMS.has(awayTeam) || homeTeam === awayTeam) {
    return res.status(400).json({ error: 'Invalid NFL matchup.' });
  }
  if (!Number.isFinite(kickoffMs)) {
    return res.status(400).json({ error: 'kickoffUtc must be a valid timestamp.' });
  }
  if (!Number.isFinite(baseHomeProbability) || baseHomeProbability <= 0 || baseHomeProbability >= 1) {
    return res.status(400).json({ error: 'baseHomeProbability must be a decimal strictly between 0 and 1.' });
  }
  if (kickoffMs <= nowMs) {
    return res.status(409).json({
      error: 'EXP-031 is prospective-only. Research is blocked at and after kickoff to prevent outcome leakage.'
    });
  }
  if (kickoffMs > nowMs + MAX_LOOKAHEAD_MS) {
    return res.status(400).json({ error: 'Pregame intelligence may only be requested within 14 days of kickoff.' });
  }

  const evaluatedAt = new Date(nowMs).toISOString();
  const normalizedKickoff = new Date(kickoffMs).toISOString();
  const model = process.env.OPENROUTER_PREGAME_MODEL || DEFAULT_MODEL;

  try {
    const research = await callOpenRouter({
      apiKey,
      model,
      homeTeam,
      awayTeam,
      kickoffUtc: normalizedKickoff,
      evaluatedAt
    });

    const shadow = buildPregameShadowPrediction({
      homeTeam,
      awayTeam,
      kickoffUtc: normalizedKickoff,
      evaluatedAt,
      baseHomeProbability,
      payload: research.payload
    });

    return res.status(200).json({
      experiment: PREGAME_INTELLIGENCE_VERSION,
      mode: 'shadow-only',
      productionPickChanged: false,
      researchModel: research.model,
      generatedAt: evaluatedAt,
      payload: research.payload,
      shadow,
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
