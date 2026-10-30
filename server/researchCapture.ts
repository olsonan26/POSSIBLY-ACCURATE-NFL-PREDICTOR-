import {storage,learningStorageConfigured} from './learningStore.js';
import type {CoachReport} from '../services/coachAnalysis.js';
import type {ResearchFeature} from '../services/researchSnapshot.js';
import {loadResearchTeamEdges} from '../services/researchTeamStats.js';
/** A later report must never be retroactively attached to an earlier forecast. Unavailable sources stay unknown. */
export async function frozenResearchContext(gameId:string,cutoffAt:string,capturedAt:string,game?:{homeTeam:string;awayTeam:string;gameday:string;season:number;week:number}):Promise<{coach?:CoachReport;extraFeatures?:Record<string,ResearchFeature>}> {
  if(!learningStorageConfigured()) return {};
  const filter=`game_id=eq.${encodeURIComponent(gameId)}&captured_at=lte.${encodeURIComponent(cutoffAt)}&order=captured_at.desc&limit=1`;
  const [coachResult,learningResult]=await Promise.allSettled([
    storage<any[]>(`nfl_coach_reports?${filter}&mode=eq.pregame&select=report,captured_at,kickoff_at`),
    storage<any[]>(`nfl_learning_forecasts?${filter}&select=learned_home_probability,captured_at,kickoff_at,research_model,experiment_version`)
  ]);
  const eligible=(row:any)=>row&&Number.isFinite(Date.parse(row.captured_at))&&Date.parse(row.captured_at)<=Date.parse(cutoffAt)&&Date.parse(row.captured_at)<Date.parse(row.kickoff_at);
  const coachRow=coachResult.status==='fulfilled'?coachResult.value[0]:undefined;
  const learningRow=learningResult.status==='fulfilled'?learningResult.value[0]:undefined;
  const learning=eligible(learningRow)&&Number.isFinite(learningRow.learned_home_probability)&&learningRow.learned_home_probability>0&&learningRow.learned_home_probability<1?learningRow:undefined;
  const teamEdges=game?await loadResearchTeamEdges(game.homeTeam,game.awayTeam,game.gameday,game.season,game.week,cutoffAt,capturedAt):{};
  return {coach:eligible(coachRow)?coachRow.report:undefined,
    extraFeatures:{...teamEdges,...(learning?{'deepseek_learning.homeProbability':{value:learning.learned_home_probability,status:'known' as const,
      source:`Frozen DeepSeek learning shadow:${learning.research_model}`,observedAt:learning.captured_at,capturedAt,
      version:learning.experiment_version,includedInProduction:false}}:{})}};
}
