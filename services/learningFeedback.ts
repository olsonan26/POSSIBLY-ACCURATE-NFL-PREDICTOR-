/** Outcome feedback for the hosted model. This never changes an LLM's weights. */
export const LEARNING_VERSION = 'EXP-032-feedback-v1';
export const MIN_TRAIN_GAMES = 40;
export const MIN_FORWARD_GAMES = 40;
const SCALES = [1, 0.75, 0.5, 0.25, 0];
const CATEGORIES = ['qb', 'injury', 'offensive_line', 'weather', 'roster', 'coaching'];

export interface LearningExample {
  gameId: string;
  capturedAt: string;
  kickoffAt: string;
  outcomeObservedAt: string;
  baseHomeProbability: number;
  rawHomeProbability: number;
  learnedHomeProbability: number;
  homeScore: number;
  awayScore: number;
  categories: string[];
}

export interface FeedbackMetrics {
  games: number;
  accuracy: number;
  brier: number;
  logLoss: number;
}

const clamp = (p: number) => Math.max(0.001, Math.min(0.999, p));
const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));

export function scaledEvidenceProbability(base: number, raw: number, scale: number): number {
  return 1 / (1 + Math.exp(-(logit(base) + scale * (logit(raw) - logit(base)))));
}

/** One eligible, first frozen forecast per game; ties are excluded from binary scoring. */
export function eligibleLearningExamples(examples: LearningExample[], asOf: string): LearningExample[] {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('Invalid learning cutoff.');
  const first = new Map<string, LearningExample>();
  for (const row of [...examples].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))) {
    const captured = Date.parse(row.capturedAt);
    const kickoff = Date.parse(row.kickoffAt);
    const observed = Date.parse(row.outcomeObservedAt);
    if (!row.gameId || ![captured, kickoff, observed].every(Number.isFinite)) continue;
    if (!(captured < kickoff && kickoff < observed && observed < cutoff)) continue;
    if (![row.baseHomeProbability, row.rawHomeProbability, row.learnedHomeProbability].every(p => Number.isFinite(p) && p > 0 && p < 1)) continue;
    if (![row.homeScore, row.awayScore].every(n => Number.isInteger(n) && n >= 0)) continue;
    if (row.homeScore === row.awayScore || first.has(row.gameId)) continue;
    first.set(row.gameId, row);
  }
  return [...first.values()].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.gameId.localeCompare(b.gameId));
}

export function feedbackMetrics(rows: LearningExample[], probability: (row: LearningExample) => number): FeedbackMetrics | null {
  if (!rows.length) return null;
  let correct = 0, brier = 0, logLoss = 0;
  for (const row of rows) {
    const y = row.homeScore > row.awayScore ? 1 : 0;
    const p = clamp(probability(row));
    correct += Number((p >= 0.5) === Boolean(y));
    brier += (p - y) ** 2;
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  return { games: rows.length, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length };
}

function scaleFromLosses(losses: number[], count: number): number {
  if (count < MIN_TRAIN_GAMES) return 1;
  let best = 1, bestLoss = Infinity;
  // Only shrink the existing news adjustment. Never reverse or amplify it.
  for (let i = 0; i < SCALES.length; i++) {
    const scale = SCALES[i];
    const loss = losses[i] / count + 0.002 * (scale - 1) ** 2;
    if (loss < bestLoss - 1e-12) { bestLoss = loss; best = scale; }
  }
  return best;
}

function addLosses(losses: number[], row: LearningExample) {
  const y = Number(row.homeScore > row.awayScore);
  for (let i = 0; i < SCALES.length; i++) losses[i] += (scaledEvidenceProbability(row.baseHomeProbability, row.rawHomeProbability, SCALES[i]) - y) ** 2;
}

export function buildLearningFeedback(examples: LearningExample[], asOf: string) {
  const rows = eligibleLearningExamples(examples, asOf);
  const forward: LearningExample[] = [];
  const forwardProbabilities = new Map<string, number>();
  const byObserved = [...rows].sort((a, b) => Date.parse(a.outcomeObservedAt) - Date.parse(b.outcomeObservedAt));
  const runningLosses = SCALES.map(() => 0);
  let available = 0;
  for (const row of rows) {
    // A prior game's result must have been recorded BEFORE this forecast, even
    // when games in the same week overlap. Kickoff order alone is insufficient.
    while (available < byObserved.length && Date.parse(byObserved[available].outcomeObservedAt) < Date.parse(row.capturedAt)) {
      addLosses(runningLosses, byObserved[available++]);
    }
    if (available < MIN_TRAIN_GAMES) continue;
    forward.push(row);
    forwardProbabilities.set(row.gameId, scaledEvidenceProbability(row.baseHomeProbability, row.rawHomeProbability, scaleFromLosses(runningLosses, available)));
  }
  const candidate = feedbackMetrics(forward, r => forwardProbabilities.get(r.gameId)!);
  const rawForward = feedbackMetrics(forward, r => r.rawHomeProbability);
  const baseForward = feedbackMetrics(forward, r => r.baseHomeProbability);
  const gatePassed = forward.length >= MIN_FORWARD_GAMES && candidate!.brier < rawForward!.brier - 0.001
    && candidate!.logLoss < rawForward!.logLoss - 0.001;
  const categories = CATEGORIES.map(category => {
    const subset = rows.filter(r => r.categories.includes(category));
    const base = feedbackMetrics(subset, r => r.baseHomeProbability);
    const raw = feedbackMetrics(subset, r => r.rawHomeProbability);
    return { category, games: subset.length, rawMinusBaseBrier: raw && base ? raw.brier - base.brier : null };
  });
  const allLosses = SCALES.map(() => 0);
  rows.forEach(row => addLosses(allLosses, row));
  const suggestedScale = scaleFromLosses(allLosses, rows.length);
  return {
    version: LEARNING_VERSION,
    asOf,
    games: rows.length,
    gameIds: rows.map(r => r.gameId),
    scale: gatePassed ? suggestedScale : 1,
    suggestedScale,
    gatePassed,
    status: gatePassed ? 'calibrated-shadow' as const : 'collecting-evidence' as const,
    base: feedbackMetrics(rows, r => r.baseHomeProbability),
    raw: feedbackMetrics(rows, r => r.rawHomeProbability),
    deployedLearningShadow: feedbackMetrics(rows, r => r.learnedHomeProbability),
    forward: { games: forward.length, candidate, raw: rawForward, base: baseForward },
    categories,
    // Numeric feedback only: no past source text can become a prompt instruction.
    prompt: `OUTCOME FEEDBACK (${LEARNING_VERSION}, cutoff ${asOf})\n`
      + `${rows.length} distinct, pre-kickoff forecasts have verified non-tie outcomes. Repeated runs are not new evidence.\n`
      + `Overall evidence-versus-control Brier delta: ${rows.length ? (feedbackMetrics(rows, r => r.rawHomeProbability)!.brier - feedbackMetrics(rows, r => r.baseHomeProbability)!.brier).toFixed(4) : 'unavailable'}. Negative is better.\n`
      + categories.filter(c => c.games >= 12).map(c => `${c.category}: ${c.games} games, evidence-versus-control Brier delta ${c.rawMinusBaseBrier!.toFixed(4)} (descriptive, not causal).`).join('\n')
      + '\nUse feedback to check corroboration, uncertainty and duplicate evidence. A loss does not prove an injury or weather claim caused it. Do not select a winner, invent facts, or override source requirements. All changes remain prospective research.'
  };
}

export type LearningFeedback = ReturnType<typeof buildLearningFeedback>;
