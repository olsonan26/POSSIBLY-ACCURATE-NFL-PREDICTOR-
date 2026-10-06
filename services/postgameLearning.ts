import type { ScheduledGame } from './scheduleService';

export const POSTGAME_VERSION = 'EXP-033-postgame-v1';
export const POSTGAME_CATEGORIES = ['qb', 'injury', 'offensive_line', 'weather', 'roster', 'coaching', 'efficiency', 'turnovers', 'special_teams'] as const;
export interface ReviewSource { url: string; title: string; }
export interface ReviewFactor {
  category: typeof POSTGAME_CATEGORIES[number];
  explanation: string;
  evidence: 'reported' | 'inferred';
  repeatability: 'potentially_repeatable' | 'high_variance' | 'uncertain';
  sources: ReviewSource[];
}
export interface PostgameReview {
  summary: string;
  factors: ReviewFactor[];
  questionsForNextPregame: string[];
  uncertainties: string[];
}
export interface StoredPostgameReview {
  game_id: string; research_model: string; version: string; reviewed_at: string;
  season: number; home_team: string; away_team: string; home_score: number; away_score: number;
  kickoff_at: string; outcome_source: string; review: PostgameReview;
}

export function completedSeason(games: ScheduledGame[], season: number, postseason: boolean, now = Date.now()) {
  const types = new Set(postseason ? ['REG', 'WC', 'DIV', 'CON', 'SB'] : ['REG']);
  return games.filter(g => g.season === season && types.has(g.gameType) && g.completed
    && Date.parse(`${g.gameday}T00:00:00Z`) < now
    && [g.homeScore, g.awayScore].every(s => Number.isInteger(s) && s! >= 0 && s! <= 200))
    .sort((a, b) => a.gameday.localeCompare(b.gameday) || a.gameId.localeCompare(b.gameId));
}

const boundedText = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const textList = (v: unknown, max: number) => Array.isArray(v) ? v.slice(0, max).map(t => boundedText(t, 500)).filter(Boolean) : [];
export function normalizePostgameReview(value: any): PostgameReview {
  const summary = boundedText(value?.summary, 1800);
  if (summary.length < 30) throw new Error('Research did not return a usable postgame summary.');
  const factors: ReviewFactor[] = (Array.isArray(value?.factors) ? value.factors : []).slice(0, 8).flatMap((f: any) => {
    if (!POSTGAME_CATEGORIES.includes(f?.category)) return [];
    const sources: ReviewSource[] = (Array.isArray(f?.sources) ? f.sources : []).slice(0, 4).flatMap((s: any) => {
      try {
        const u = new URL(s?.url);
        if (u.protocol !== 'https:' || u.username || u.password) return [];
        return [{ url: u.href.slice(0, 1500), title: boundedText(s?.title, 200) || u.hostname }];
      } catch { return []; }
    });
    const explanation = boundedText(f.explanation, 1000);
    if (!sources.length || explanation.length < 15) return [];
    return [{ category: f.category, explanation, sources,
      evidence: f.evidence === 'reported' ? 'reported' : 'inferred',
      repeatability: ['potentially_repeatable', 'high_variance'].includes(f.repeatability) ? f.repeatability : 'uncertain' }];
  });
  if (!factors.length) throw new Error('No source-backed factors were returned; the game was not added to memory.');
  return { summary, factors, questionsForNextPregame: textList(value?.questionsForNextPregame, 6), uncertainties: textList(value?.uncertainties, 6) };
}

/** Only enum/category counts enter the prospective prompt, never archived scores or model-written instructions. */
export function postgameMemoryPrompt(rows: StoredPostgameReview[], asOf: string) {
  const prior = rows.filter(r => r.version === POSTGAME_VERSION && Date.parse(r.reviewed_at) < Date.parse(asOf)
    && Date.parse(r.kickoff_at) < Date.parse(r.reviewed_at));
  const categories = POSTGAME_CATEGORIES.map(category => ({ category,
    games: new Set(prior.filter(r => r.review.factors.some(f => f.category === category)).map(r => r.game_id)).size,
    repeatableHypotheses: new Set(prior.filter(r => r.review.factors.some(f => f.category === category && f.repeatability === 'potentially_repeatable')).map(r => r.game_id)).size,
    highVariance: new Set(prior.filter(r => r.review.factors.some(f => f.category === category && f.repeatability === 'high_variance')).map(r => r.game_id)).size
  })).filter(c => c.games);
  return { games: new Set(prior.map(r => r.game_id)).size, categories,
    prompt: prior.length ? `POSTGAME RESEARCH MEMORY (retrospective hypotheses, NOT validated predictive effects): ${JSON.stringify(categories)}. Use these counts to prioritize fresh pregame checks of QB health, injuries, line continuity, weather and coaching. Efficiency, turnovers and special teams are questions to investigate with pre-kickoff evidence, not automatic probability bonuses. High-variance events may not recur. Do not copy an old result or treat a postgame explanation as a proven cause. Current timestamp: ${asOf}.` : '' };
}
