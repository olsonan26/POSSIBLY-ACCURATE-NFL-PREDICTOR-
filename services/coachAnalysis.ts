export const COACH_ANALYSIS_VERSION = 'coach-matchup-v2';
export const COACH_SECTIONS = [
  ['identity', 'Coaching and team identity'], ['quarterback', 'Quarterbacks and pressure response'],
  ['run_game', 'Run schemes versus defensive fronts'], ['protection', 'Protection versus pass rush'],
  ['receivers', 'Receivers and tight ends versus coverage'], ['personnel', 'Personnel packages, motion and counters'],
  ['availability', 'Injuries, replacements and role changes'], ['situational', 'Third down, red zone and turnovers'],
  ['special_teams', 'Special teams and field position'], ['environment', 'Venue, weather and communication']
] as const;
export interface CoachEvidence { id: string; url: string; title: string; publishedAt: string; quote: string; }
export interface CoachSection { id: string; title: string; observation: string; mechanism: string; counter: string; advantage: 'home' | 'away' | 'even' | 'unknown'; evidenceIds: string[]; missing: string[]; }
export interface CoachReport {
  researchSnapshot?: import('./researchSnapshot.js').UnifiedPregameSnapshot;
  evidenceWindows?: { currentStateStart: string; structuralIdentityStart: string; cutoff: string };
  sensitivityConditions?: string[];
  version: string; gameId: string; homeTeam: string; awayTeam: string; gameday: string; cutoff: string;
  mode: 'pregame' | 'historical-reconstruction'; generatedAt: string;
  sections: CoachSection[]; evidence: CoachEvidence[]; homeKeys: string[]; awayKeys: string[];
  prediction: { winner: string; method: 'matchup-analysis' | 'football-control-fallback'; rationale: string; controlHomeProbability: number; decisiveSections: string[]; };
  limitations: string[]; capture: string;
  historicalComparison?: { homeScore:number; awayScore:number; actualWinner:string; correct:boolean|null };
}
const clean = (v: unknown, max = 1600) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function buildCoachReport(raw: any, evidence: CoachEvidence[], context: Omit<CoachReport, 'sections' | 'evidence' | 'homeKeys' | 'awayKeys' | 'prediction' | 'limitations'> & { controlHomeProbability: number }): CoachReport {
  const ids = new Set(evidence.map(e => e.id));
  const sections: CoachSection[] = COACH_SECTIONS.map(([id, title]) => {
    const row = Array.isArray(raw?.sections) ? raw.sections.find((s: any) => s.id === id) : null;
    const refs: string[] = [...new Set<string>((Array.isArray(row?.evidenceIds) ? row.evidenceIds : []).filter((x: any) => typeof x === 'string' && ids.has(x)
      && (id !== 'availability' || !context.evidenceWindows || evidence.some(e=>e.id===x && Date.parse(e.publishedAt)>=Date.parse(context.evidenceWindows!.currentStateStart)))))];
    if (!refs.length) return { id, title, observation: 'No dated pregame source was verified for this topic.', mechanism: '', counter: '', advantage: 'unknown', evidenceIds: [], missing: ['Verified scheme, player-role or situational evidence.'] };
    return { id, title, observation: refs.slice(0, 2).map(ref => evidence.find(e => e.id === ref)!.quote).join(' '), mechanism: clean(row.mechanism), counter: clean(row.counter),
      advantage: ['home','away','even'].includes(row.advantage) ? row.advantage : 'unknown', evidenceIds: refs,
      missing: Array.isArray(row.missing) ? row.missing.slice(0,6).map((x: any) => clean(x,500)) : [] };
  });
  const requested: string[] = Array.isArray(raw?.prediction?.decisiveSections) ? raw.prediction.decisiveSections : [];
  const side = raw?.prediction?.winner;
  const decisive = sections.filter(s => requested.includes(s.id) && s.evidenceIds.length && s.advantage === side);
  const supported = ['home','away'].includes(side) && decisive.length > 0;
  const {controlHomeProbability, ...base} = context;
  return { ...base, sections, evidence,
    homeKeys: sections.filter(s => s.evidenceIds.length && s.advantage === 'home').map(s => `${s.title}: ${s.mechanism || s.observation}`),
    awayKeys: sections.filter(s => s.evidenceIds.length && s.advantage === 'away').map(s => `${s.title}: ${s.mechanism || s.observation}`),
    prediction: { winner: supported ? (side === 'home' ? context.homeTeam : context.awayTeam) : (controlHomeProbability >= .5 ? context.homeTeam : context.awayTeam),
      method: supported ? 'matchup-analysis' : 'football-control-fallback',
      rationale: supported ? clean(raw.prediction.rationale) : 'Insufficient sourced matchup evidence for an independent pick. Using the football control.',
      controlHomeProbability, decisiveSections: decisive.map(s => s.id) },
    limitations: [
      'Matchup picks are experimental qualitative judgments, not calibrated win probabilities.',
      'No game film is watched by this workflow. Scheme observations must come from verified published reporting or supplied evidence; mechanisms and counters are inferences.',
      ...(context.mode === 'historical-reconstruction' ? ['Generated after the event using dated pregame excerpts. Model memorization and later page edits cannot be ruled out; this is not an unseen test or a prospective forecast.'] : []),
      ...(!evidence.length ? ['No external pregame excerpts passed the source checks. The report explicitly shows missing evidence.'] : [])
    ] };
}
