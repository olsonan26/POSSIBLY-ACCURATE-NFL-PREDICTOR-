import {hypothesisProbability,scoreProbabilities,pairedComparison,buildFailureFeatureRows,type ResearchPredictionSnapshot as Snapshot,type ResearchHypothesis as Hypothesis} from './research-core.js';
import {matchesConditions} from './residual-discovery.js';
import {researchAttacks} from './research-evaluation.js';
export const frozenControl=(s:Snapshot)=>s.homeWinProbability;
export function walkForward(development:Snapshot[],h:Hypothesis,minimumTrain=40,initialTrain:Snapshot[]=[]) {
  const ordered=development.filter(s=>s.actualWinner&&s.actualWinner!=='TIE').slice().sort((a,b)=>a.gameday.localeCompare(b.gameday)||a.gameId.localeCompare(b.gameId));
  const blocks=[...new Set(ordered.map(s=>`${s.season}:${s.week}`))];
  const folds:{block:string;trainGames:number;testGames:number;parameter:number;control:any;challenger:any}[]=[],predictions:{snapshot:Snapshot;probability:number}[]=[];
  for(const block of blocks) {
    const test=ordered.filter(s=>`${s.season}:${s.week}`===block),firstDate=test[0].gameday;
    const train=[...initialTrain,...ordered].filter(s=>s.gameday<firstDate);
    if(train.length<minimumTrain)continue;
    const ranked=h.parameterGrid.map(parameter=>({parameter,score:scoreProbabilities(train,s=>hypothesisProbability(s,h,parameter))})).sort((a,b)=>a.score.brier-b.score.brier||a.score.logLoss-b.score.logLoss);
    const parameter=ranked[0].parameter;
    folds.push({block,trainGames:train.length,testGames:test.length,parameter,control:scoreProbabilities(test,frozenControl),challenger:scoreProbabilities(test,s=>hypothesisProbability(s,h,parameter))});
    predictions.push(...test.map(snapshot=>({snapshot,probability:hypothesisProbability(snapshot,h,parameter)})));
  }
  const selected=h.parameterGrid.map(parameter=>({parameter,score:scoreProbabilities(ordered,s=>hypothesisProbability(s,h,parameter))})).sort((a,b)=>a.score.brier-b.score.brier||a.score.logLoss-b.score.logLoss)[0]?.parameter;
  const byId=new Map(predictions.map(p=>[p.snapshot.snapshotId,p.probability]));
  return {folds,selectedParameter:selected??h.parameterGrid[0],oosGames:predictions.length,
    attacks:researchAttacks(predictions.map(p=>p.snapshot),s=>byId.get(s.snapshotId)!,200)};
}
export function evaluateChallenger(rows:Snapshot[],h:Hypothesis,parameter:number,minimumGlobal=40,minimumOrigin=20) {
  const completed=rows.filter(s=>s.actualWinner&&s.actualWinner!=='TIE');
  const fn=(s:Snapshot)=>hypothesisProbability(s,h,parameter);
  const origin=h.conditions?.length?completed.filter(s=>matchesConditions(buildFailureFeatureRows([s])[0],h.conditions!)):completed;
  const control=scoreProbabilities(completed,frozenControl),challenger=scoreProbabilities(completed,fn);
  const originControl=scoreProbabilities(origin,frozenControl),originChallenger=scoreProbabilities(origin,fn);
  const attacks=researchAttacks(completed,fn,500),originAttacks=researchAttacks(origin,fn,200);
  const neighbors=h.parameterGrid.filter(p=>p!==parameter&&Math.abs(h.parameterGrid.indexOf(p)-h.parameterGrid.indexOf(parameter))===1)
    .map(p=>({parameter:p,metrics:scoreProbabilities(completed,s=>hypothesisProbability(s,h,p))}));
  const seasonStable=attacks.seasons.every(s=>s.challenger.n<20||((s.challenger.brier??1)<=(s.control.brier??0)+.003&&(s.challenger.accuracy??0)>=(s.control.accuracy??0)-.02));
  const subgroupStable=attacks.selectedSide.every(s=>s.challenger.n<20||((s.challenger.brier??1)<=(s.control.brier??0)+.003&&(s.challenger.accuracy??0)>=(s.control.accuracy??0)-.02));
  const gates={sample:control.n>=minimumGlobal&&originControl.n>=minimumOrigin,
    accuracy:challenger.accuracy>=control.accuracy-.003,brier:challenger.brier<control.brier,logLoss:challenger.logLoss<control.logLoss,
    calibration:(attacks.global.challenger.ece??1)<=(attacks.global.control.ece??0)+.01,
    uncertainty:attacks.bootstrap95[1]!==null&&attacks.bootstrap95[1]!<0,
    nullChallenge:attacks.nullPValue!==null&&attacks.nullPValue<=.05,
    mechanism:originChallenger.brier<originControl.brier&&originChallenger.accuracy>=originControl.accuracy-.01,
    parameters:neighbors.length>0&&neighbors.some(n=>n.metrics.brier<=control.brier+.001&&n.metrics.accuracy>=control.accuracy-.01),seasonStable,subgroupStable};
  const passed=Object.values(gates).every(Boolean);
  return {control,challenger,originControl,originChallenger,paired:pairedComparison(completed,fn),attacks,originAttacks,neighbors,gates,
    ablation:{disabled:control,restoresControl:true},decision:passed?'SURVIVED_RESEARCH':control.n<minimumGlobal||originControl.n<minimumOrigin?'INCONCLUSIVE':
      challenger.brier>control.brier&&challenger.logLoss>control.logLoss?'KILLED':'INCONCLUSIVE'};
}
