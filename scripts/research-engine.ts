import {buildFailureFeatureRows,discoverFailureClusters,clusterEligibleSnapshots,leakageInvariant,controlHomeProbability,hypothesisProbability,type ResearchPredictionSnapshot as Snapshot,type ResearchHypothesis as Hypothesis} from './research-core.js';
import {numericResearchFeatures,captureHorizon} from '../services/researchSnapshot.js';
import {discoverResidualSubgroups} from './residual-discovery.js';
import {cohortRows,defaultCohortPlan,researchPopulations,digest,type CohortPlan} from './research-cohorts.js';
import {generateResearchHypotheses,manualHypotheses,validateHypothesis} from './research-hypotheses.js';
import {walkForward,evaluateChallenger} from './research-walk-forward.js';
import type {ResearchState,ResearchEvent} from './research-state.js';
export const ENGINE_VERSION='autoresearch-v2.1';
const completed=(s:Snapshot)=>Boolean(s.actualWinner&&s.actualWinner!=='TIE');
function inputSignature(rows:Snapshot[]){return digest(rows.map(s=>({id:s.snapshotId,model:s.sourceModelVersion,p:s.homeWinProbability,
  features:numericResearchFeatures(s.unifiedSnapshot),actual:s.actualWinner,cutoff:s.dataCutoffTimestamp})));}
export function checkResearchInputs(rows:Snapshot[],asOf=new Date().toISOString()) {
  const invariant=leakageInvariant(rows);
  const replay=rows.filter(s=>!Number.isFinite(s.homeWinProbability)||s.homeWinProbability<=0||s.homeWinProbability>=1||Math.abs(controlHomeProbability(s)-s.homeWinProbability)>.0025).map(s=>`${s.gameId}: control replay mismatch`);
  const identities=new Set<string>();
  for(const s of rows){const key=`${s.gameId}:${s.sourceModelVersion}:${s.unifiedSnapshot?.captureHorizon}:${s.unifiedSnapshot?.evidenceMode}`;
    if(completed(s)&&s.unifiedSnapshot&&Date.parse(s.unifiedSnapshot.kickoffAt)>=Date.parse(asOf))invariant.violations.push(`${key}: future outcome`);
    if(identities.has(key))invariant.violations.push(`${key}: duplicate model/horizon forecast`);identities.add(key);}
  return {passed:!invariant.violations.length&&!replay.length,violations:[...invariant.violations,...replay],replayPassed:!replay.length};
}
function materialize(s:Snapshot):Snapshot {
  const unified=s.unifiedSnapshot!;
  return {...s,unifiedSnapshot:{...unified,features:Object.fromEntries(Object.entries(numericResearchFeatures(unified)).filter(([,v])=>v!==null)
    .map(([key,value])=>[key,{value,status:'known',source:`Frozen input archive:${digest(unified)}`,observedAt:s.dataCutoffTimestamp,capturedAt:unified.capturedAt,
      version:'research-encoding-v2',includedInProduction:key.startsWith('football_core.')&&!key.endsWith('restLogit'),timestampKind:'derived_cutoff',sourceObservedAt:null}]))}};
}
export interface EngineOptions {state:ResearchState;now?:string;codeCommit:string;manual?:any[];plans?:CohortPlan[];discoveryBudget?:number;bootstrapRepetitions?:number}
export async function freezeChallengerForecasts(rows:Snapshot[],state:ResearchState,now=new Date().toISOString()) {
  const events=await state.all(),manifests=events.filter(e=>e.event_kind==='MANIFEST'),survived=new Set(events.filter(e=>e.event_kind==='RESULT'&&e.payload.decision==='SURVIVED_RESEARCH').map(e=>e.event_key));
  let captured=0;
  for(const event of manifests.filter(e=>survived.has(e.event_key))) {
    const m=event.payload,result=events.find(e=>e.event_kind==='RESULT'&&e.event_key===event.event_key)!.payload;
    for(const s of rows) {
      if(s.sourceModelVersion!==m.plan.modelVersion||s.unifiedSnapshot?.captureHorizon!==m.plan.horizon||s.unifiedSnapshot?.evidenceMode!=='PROSPECTIVE'||
        !s.unifiedSnapshot||Date.parse(s.unifiedSnapshot.kickoffAt)<=Date.parse(now)||Date.parse(m.created_at)>Date.parse(s.predictionTimestamp)||
        Date.parse(s.predictionTimestamp)>Date.parse(now)||captureHorizon(s.unifiedSnapshot.kickoffAt,now)!==s.unifiedSnapshot.captureHorizon)continue;
      const key=`${m.experiment_id}:${s.gameId}:${m.plan.horizon}`;
      if(events.some(e=>e.event_kind==='SHADOW_FORECAST'&&e.event_key===key))continue;
      await state.append('SHADOW_FORECAST',key,{experimentId:m.experiment_id,gameId:s.gameId,snapshotId:s.snapshotId,modelVersion:s.sourceModelVersion,
        horizon:m.plan.horizon,kickoffAt:s.unifiedSnapshot.kickoffAt,capturedAt:now,sourceHash:digest(s),controlProbability:s.homeWinProbability,
        challengerProbability:hypothesisProbability(s,m.hypothesis,result.selectedParameter),hypothesisHash:digest(m.hypothesis)});captured++;
    }
  }
  return captured;
}
async function assessPromotions(rows:Snapshot[],state:ResearchState,now:string) {
  const events=await state.all(),promotions:any[]=[];
  for(const resultEvent of events.filter(e=>e.event_kind==='RESULT'&&e.payload.decision==='SURVIVED_RESEARCH')) {
    const manifest=events.find(e=>e.event_kind==='MANIFEST'&&e.event_key===resultEvent.event_key)?.payload;
    if(!manifest)continue;
    const result=resultEvent.payload,forecasts=events.filter(e=>e.event_kind==='SHADOW_FORECAST'&&e.payload.experimentId===manifest.experiment_id&&
      Date.parse(e.payload.capturedAt)<Date.parse(e.payload.kickoffAt)&&Date.parse(e.recorded_at)<Date.parse(e.payload.kickoffAt));
    const confirmation=cohortRows(rows,{...manifest.plan,mode:'PROSPECTIVE'},'FUTURE_LOCKBOX').filter(s=>Date.parse(s.unifiedSnapshot!.kickoffAt)>Date.parse(manifest.created_at));
    const byId=new Map(forecasts.map(e=>[e.payload.snapshotId,e.payload]));
    const frozen=confirmation.filter(s=>byId.has(s.snapshotId));
    const assessments=evaluateChallenger(frozen,manifest.hypothesis,result.selectedParameter,manifest.plan.minimum.confirmation,20);
    // Evaluate the actual frozen bytes, not post-outcome recomputations.
    const exact=frozen.every(s=>Math.abs(byId.get(s.snapshotId).challengerProbability-hypothesisProbability(s,manifest.hypothesis,result.selectedParameter))<1e-12);
    const breadth=events.filter(e=>e.event_kind==='MANIFEST').length;
    const adjustedNull=assessments.attacks.nullPValue!==null&&assessments.attacks.nullPValue<=.05/Math.max(1,breadth);
    const reliable=frozen.every(s=>{
      const values=numericResearchFeatures(s.unifiedSnapshot);return manifest.hypothesis.featuresInvolved.every((key:string)=>values[key]!=null);
    });
    const status=state.durable&&assessments.decision==='SURVIVED_RESEARCH'&&exact&&adjustedNull&&reliable?'PRODUCTION_CANDIDATE':'SHADOW_CANDIDATE';
    const payload={experimentId:manifest.experiment_id,status,prospectiveN:frozen.length,exactFrozenPredictions:exact,adjustedNull,reliable,
      searchBreadth:breadth,gates:assessments.gates,productionModelChanged:false,reason:status==='PRODUCTION_CANDIDATE'?'Preregistered frozen prospective evidence passed all gates; production control remains separately protected.':'Collect preregistered frozen confirmation forecasts; no production influence.'};
    const key=`${manifest.experiment_id}:${digest({status,ids:frozen.map(s=>s.snapshotId)})}`;
    await state.append('PROMOTION',key,payload);promotions.push(payload);
  }
  return promotions;
}
export async function runResearchEngine(rows:Snapshot[],options:EngineOptions) {
  const {state}=options,now=options.now||new Date().toISOString();
  const leakage=checkResearchInputs(rows,now);
  if(!leakage.passed)throw new Error(`Research blocked by leakage: ${leakage.violations.slice(0,8).join('; ')}`);
  let events=await state.all();
  const populations:any[]=[],candidates:{hypothesis:Hypothesis;plan:CohortPlan;discovery:Snapshot[];validation:Snapshot[];legacy:Snapshot[]}[]=[],blocked:any[]=[];
  for(const population of researchPopulations(rows)) {
    const proposed=options.plans?.find(p=>p.modelVersion===population[0].sourceModelVersion&&p.horizon===population[0].unifiedSnapshot?.captureHorizon&&p.mode===population[0].unifiedSnapshot?.evidenceMode)||defaultCohortPlan(population,now);
    const existing=events.find(e=>e.event_kind==='COHORT'&&e.event_key===proposed.id);
    const plan:CohortPlan=(existing||await state.append('COHORT',proposed.id,proposed)).payload;
    const discovery=cohortRows(population,plan,'DISCOVERY'),validation=cohortRows(population,plan,'VALIDATION'),legacy=cohortRows(population,plan,'LEGACY_TEST');
    if(discovery.length<plan.minimum.discovery||validation.length<plan.minimum.validation){
      populations.push({plan,status:'INSUFFICIENT_SAMPLE',discovery:discovery.length,validation:validation.length,confirmation:cohortRows(population,plan,'FUTURE_LOCKBOX').length,
        features:Object.keys(numericResearchFeatures(population[0].unifiedSnapshot)).length});continue;
    }
    const signature=inputSignature([...discovery,...validation]),searchKey=`${plan.id}:${signature}:${ENGINE_VERSION}`;
    const cached=events.find(e=>e.event_kind==='SEARCH'&&e.event_key===searchKey);
    let search:any;
    if(cached)search=cached.payload;
    else {
      const discoveryRows=buildFailureFeatureRows(discovery),validationRows=buildFailureFeatureRows(validation);
      const priorSearches=events.filter(e=>e.event_kind==='SEARCH').reduce((n,e)=>n+(e.payload.clusters_examined||0),0);
      const discovered=discoverResidualSubgroups(discoveryRows,validationRows,{budget:options.discoveryBudget||1500,allowSingleSeason:plan.mode==='PROSPECTIVE',requireQbContext:true,priorSearches});
      const known=discoverFailureClusters(discoveryRows);
      // A discovered split must add information beyond an existing hand-authored population.
      const memberships=known.map(c=>new Set(clusterEligibleSnapshots(discovery,c).map(s=>s.snapshotId)));
      discovered.clusters=discovered.clusters.filter(c=>{const ids=new Set(clusterEligibleSnapshots(discovery,c).map(s=>s.snapshotId));
        return !memberships.some(other=>[...ids].filter(id=>other.has(id)).length/Math.max(1,new Set([...ids,...other]).size)>.85);});
      const hypotheses=generateResearchHypotheses([...known,...discovered.clusters],discoveryRows,plan.modelVersion);
      search={planId:plan.id,inputHash:signature,createdAt:now,knownClusters:known,discovered,
        hypotheses,hypotheses_generated:hypotheses.length,hypotheses_tested:0,feature_variants_tested:0,parameter_sets_tested:0,
        clusters_examined:discovered.search.clustersExamined,interaction_candidates_examined:discovered.search.validationCandidates};
      const recorded=await state.append('SEARCH',searchKey,search);search=recorded.payload;events.push(recorded);
    }
    const manual=manualHypotheses(options.manual||[],[...search.knownClusters,...search.discovered.clusters],plan.modelVersion);blocked.push(...manual.blocked);
    const tested=new Set(events.filter(e=>e.event_kind==='MANIFEST'&&e.payload.plan.id===plan.id).map(e=>e.payload.hypothesis.hypothesisId));
    for(const h of [...search.hypotheses,...manual.executable])if(!tested.has(h.hypothesisId))candidates.push({hypothesis:validateHypothesis(h),plan,discovery,validation,legacy});
    populations.push({plan,status:'EVALUATED',discovery:discovery.length,validation:validation.length,known:search.knownClusters.length,discovered:search.discovered.clusters.length,
      search:search.discovered.search,clusters:[...search.knownClusters,...search.discovered.clusters],hypotheses:search.hypotheses});
  }
  events=await state.all();
  const pending=events.find(e=>e.event_kind==='MANIFEST'&&!events.some(r=>r.event_kind==='RESULT'&&r.event_key===e.event_key));
  let active:any=pending?.payload;
  if(!active&&candidates.length) {
    const selected=candidates.sort((a,b)=>b.hypothesis.priorityScore-a.hypothesis.priorityScore)[0];
    const experiment_id=`AUTO-${digest({plan:selected.plan.id,hypothesis:selected.hypothesis.hypothesisId}).slice(0,20)}`;
    const inputs=[...selected.discovery,...selected.validation,...selected.legacy].map(materialize),inputEvents:string[]=[];
    for(let i=0;i<inputs.length;i+=100){const batch=inputs.slice(i,i+100),event=await state.append('INPUTS',`${experiment_id}:${i/100}`,batch);inputEvents.push(event.event_id);}
    active={experiment_id,hypothesis_id:selected.hypothesis.hypothesisId,cluster_id:selected.hypothesis.sourceClusterId,created_at:now,
      parent_model:selected.plan.modelVersion,code_commit:options.codeCommit,engine_version:ENGINE_VERSION,encoding_version:'research-encoding-v2',
      feature_change:selected.hypothesis.featuresInvolved,action_type:selected.hypothesis.actionType,parameter_grid:selected.hypothesis.parameterGrid,
      hypothesis:selected.hypothesis,plan:selected.plan,input_event_ids:inputEvents,input_hash:inputSignature(inputs),eligible_population:inputs.map(s=>s.snapshotId),
      discovery_range:selected.plan.ranges.filter(r=>r.role==='DISCOVERY'),validation_range:selected.plan.ranges.filter(r=>r.role==='VALIDATION'),
      confirmation_range:selected.plan.ranges.filter(r=>r.role==='FUTURE_LOCKBOX'||r.role==='LEGACY_TEST'),
      primary_metrics:['accuracy','Brier','log loss'],secondary_metrics:['ECE','paired comparison','week bootstrap','origin population','season','selected side'],
      success_conditions:['all minimum samples','rolling OOS probability improvement','origin improvement','calibration non-regression','bootstrap upper bound < 0','null <= .05','neighbor and subgroup stability'],
      failure_conditions:['leakage','missing provenance','global regression','fragile parameters','null-like improvement'],leakage_checks:leakage,
      search_budget_used:{clusters:candidates.length,parameterSets:selected.hypothesis.parameterGrid.length},production_changes_allowed:false};
    active=(await state.append('MANIFEST',experiment_id,active)).payload;
  }
  let experiment:any=null;
  if(active) {
    const all=await state.all(),inputs=active.input_event_ids.flatMap((id:string)=>all.find(e=>e.event_id===id)?.payload||[]) as Snapshot[];
    if(inputSignature(inputs)!==active.input_hash)throw new Error('Preregistered input archive integrity failure');
    const gate=checkResearchInputs(inputs,now);if(!gate.passed)throw new Error('Archived inputs failed leakage/replay');
    const d=cohortRows(inputs,active.plan,'DISCOVERY'),v=cohortRows(inputs,active.plan,'VALIDATION'),legacy=cohortRows(inputs,active.plan,'LEGACY_TEST');
    const rolling=walkForward(v,active.hypothesis,40,d);
    const rollingPass=rolling.oosGames>=40&&rolling.attacks.observedBrierDelta<0&&rolling.attacks.global.challenger.logLoss!<rolling.attacks.global.control.logLoss!;
    const evaluation=evaluateChallenger(legacy.length?legacy:v,active.hypothesis,rolling.selectedParameter);
    experiment={experimentId:active.experiment_id,hypothesis:active.hypothesis,selectedParameter:rolling.selectedParameter,rolling,evaluation,
      decision:rollingPass?evaluation.decision:'INCONCLUSIVE',reason:rollingPass?'All explicit development/legacy gates evaluated; prospective confirmation required.':'Rolling chronological validation did not pass.',
      hypotheses_tested:1,feature_variants_tested:1,parameter_sets_tested:active.parameter_grid.length,leakage:gate};
    experiment=(await state.append('RESULT',active.experiment_id,experiment)).payload;
  }
  const captured=await freezeChallengerForecasts(rows,state,now),promotions=await assessPromotions(rows,state,now);
  events=await state.all();
  const searches=events.filter(e=>e.event_kind==='SEARCH'),results=events.filter(e=>e.event_kind==='RESULT');
  const counts={hypotheses_generated:searches.reduce((n,e)=>n+e.payload.hypotheses_generated,0),hypotheses_tested:results.length,
    feature_variants_tested:results.reduce((n,e)=>n+e.payload.feature_variants_tested,0),parameter_sets_tested:results.reduce((n,e)=>n+e.payload.parameter_sets_tested,0),
    clusters_examined:searches.reduce((n,e)=>n+e.payload.clusters_examined,0),interaction_candidates_examined:searches.reduce((n,e)=>n+e.payload.interaction_candidates_examined,0),
    experiments_killed:results.filter(e=>e.payload.decision==='KILLED').length,experiments_survived:results.filter(e=>e.payload.decision==='SURVIVED_RESEARCH').length};
  const summary={status:populations.some(p=>p.status==='EVALUATED')?'PASS':'BLOCKED_DATA',version:ENGINE_VERSION,generatedAt:now,durableState:state.durable,leakage,
    counts,populations,queue:candidates.map(c=>({hypothesisId:c.hypothesis.hypothesisId,origin:c.hypothesis.origin,priority:c.hypothesis.priorityScore,status:c.hypothesis.hypothesisId===experiment?.hypothesis.hypothesisId?'TESTED':'QUEUED'})),
    blockedManual:blocked,experiment,promotions,shadowForecastsCaptured:captured,champion:'v2.2-validated-current-season'};
  const runKey=digest({input:inputSignature(rows),events:events.length,version:ENGINE_VERSION});await state.append('RUN',runKey,summary);
  return summary;
}
