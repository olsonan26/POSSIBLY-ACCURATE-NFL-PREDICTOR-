import { buildUnifiedSnapshot, captureHorizon, validateUnifiedSnapshot, type UnifiedPregameSnapshot } from '../services/researchSnapshot.js';
import type { CoachReport } from '../services/coachAnalysis.js';
import type { ResearchPredictionSnapshot } from './research-core.js';

/** Adapt only persisted pregame bytes. Never join reports that arrived after a forecast's capture. */
export function adaptFrozenPredictions(records: any[], coachRows: any[] = []): ResearchPredictionSnapshot[] {
  const seen = new Set<string>();
  return records.slice().sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at)).flatMap(row=>{
    if (Date.parse(row.captured_at)>=Date.parse(row.kickoff_at) || !Number.isFinite(Date.parse(row.captured_at))) throw new Error('Invalid durable prediction chronology.');
    const horizon=captureHorizon(row.kickoff_at,row.captured_at);
    const key=`${row.game_id}:${row.model_version}:${horizon}`;
    if(seen.has(key)) return [];
    seen.add(key);
    const s=row.feature_snapshot || {};
    const scores=Number.isFinite(s.baseHomeProbability)?s:undefined;
    const coachRow=coachRows.filter(c=>c.report?.gameId===row.game_id && c.mode==='pregame' && Date.parse(c.captured_at)<=Date.parse(row.captured_at) && Date.parse(c.captured_at)<Date.parse(c.kickoff_at))
      .sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at))[0];
    const cutoff=row.data_cutoff_at || row.captured_at;
    const unified:UnifiedPregameSnapshot=s.unifiedSnapshot || buildUnifiedSnapshot({gameId:row.game_id,modelVersion:row.model_version,
      kickoffAt:row.kickoff_at,capturedAt:row.captured_at,cutoffAt:cutoff,horizon,mode:'PROSPECTIVE',result:{modelScores:scores},
      controlProbability:row.home_win_probability,homeTeam:row.home_team,awayTeam:row.away_team,coach:coachRow?.report,
      market:row.market_home_probability!=null&&row.market_snapshot_at?{probability:row.market_home_probability,observedAt:row.market_snapshot_at,source:row.market_source}:undefined});
    validateUnifiedSnapshot(unified,{gameId:row.game_id,modelVersion:row.model_version,kickoffAt:row.kickoff_at,now:row.captured_at});
    if(unified.captureHorizon!==horizon) throw new Error('DB capture clock and feature horizon disagree.');
    return [{snapshotId:row.id,gameId:row.game_id,sourceModelVersion:row.model_version,season:row.season,week:row.week,
      gameday:row.game_date,predictionTimestamp:row.captured_at,dataCutoffTimestamp:cutoff,homeTeam:row.home_team,awayTeam:row.away_team,
      neutralSite:row.neutral_site,homeWinProbability:row.home_win_probability,awayWinProbability:1-row.home_win_probability,
      predictedWinner:row.predicted_winner,actualWinner:row.actual_winner || undefined,unifiedSnapshot:unified,
      featureSnapshot:{baseLogit:scores?Math.log(s.baseHomeProbability/(100-s.baseHomeProbability)):Math.log(row.home_win_probability/(1-row.home_win_probability)),
        formLogit:s.footballLogitAdjustment ?? 0,venueLogit:s.venueLogitAdjustment ?? 0,h2hLogit:s.h2hLogitAdjustment ?? 0,
        personnelLogit:s.personnelLogitAdjustment ?? 0,restLogit:s.restLogitAdjustment ?? 0}}];
  });
}
export function coachReportSnapshots(rows: any[], games: {gameId:string;season:number;week:number;homeScore?:number;awayScore?:number}[]): ResearchPredictionSnapshot[] {
  return rows.flatMap(row=>{
    const report:CoachReport=row.report, game=games.find(g=>g.gameId===report.gameId);
    if(!game) return [];
    const prospective=row.mode==='pregame'&&Date.parse(row.captured_at)<Date.parse(row.kickoff_at)&&Date.parse(report.generatedAt)<Date.parse(row.kickoff_at);
    const p=report.prediction.controlHomeProbability;
    const snapshot=buildUnifiedSnapshot({gameId:report.gameId,modelVersion:'v2.2-validated-current-season',kickoffAt:row.kickoff_at,
      capturedAt:row.captured_at,cutoffAt:report.cutoff,horizon:captureHorizon(row.kickoff_at,prospective?row.captured_at:report.cutoff),
      mode:prospective?'PROSPECTIVE':'HISTORICAL_RECONSTRUCTION',result:{},controlProbability:p,homeTeam:report.homeTeam,awayTeam:report.awayTeam,coach:report});
    const actualWinner=game.homeScore==null||game.awayScore==null?undefined:game.homeScore===game.awayScore?'TIE':game.homeScore>game.awayScore?report.homeTeam:report.awayTeam;
    return [{snapshotId:row.report_key,gameId:report.gameId,sourceModelVersion:snapshot.modelVersion,season:game.season,week:game.week,
      gameday:report.gameday,predictionTimestamp:row.captured_at,dataCutoffTimestamp:report.cutoff,homeTeam:report.homeTeam,awayTeam:report.awayTeam,
      neutralSite:false,homeWinProbability:p,awayWinProbability:1-p,predictedWinner:p>=.5?report.homeTeam:report.awayTeam,actualWinner,
      unifiedSnapshot:snapshot,featureSnapshot:{baseLogit:Math.log(p/(1-p)),formLogit:0,venueLogit:0,h2hLogit:0,personnelLogit:0,restLogit:0}}];
  });
}
