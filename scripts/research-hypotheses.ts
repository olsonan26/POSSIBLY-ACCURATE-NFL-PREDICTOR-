import {ACTION_FAMILIES,generateHypotheses,type FailureCluster,type FailureFeatureRow,type ResearchHypothesis} from './research-core.js';
import {digest} from './research-cohorts.js';
export function validateHypothesis(h:ResearchHypothesis) {
  for(const key of ['hypothesisId','sourceClusterId','sourceModelVersion','statement','mechanism','featuresInvolved','actionType','expectedDirection','historicalPopulation',
    'comparisonPopulation','proposedImplementation','parameterGrid','minimumSampleRequirement','leakageRisks','duplicationRisks','missingDataRisks','falsificationCondition','complexityScore','priorityScore','origin'])
    if(h[key]===undefined||h[key]===null)throw new Error(`Hypothesis missing ${key}`);
  if(!ACTION_FAMILIES.includes(h.actionType!)||h.minimumSampleRequirement<20||!h.parameterGrid.length||h.parameterGrid.length>20||h.parameterGrid.some(p=>!Number.isFinite(p)))throw new Error('Invalid hypothesis contract');
  if(['ADD_FEATURE','ADD_INTERACTION','ADD_DISAGREEMENT_FEATURE','REPLACE_FEATURE'].includes(h.proposedImplementation)) {
    if(h.featuresInvolved.length<1||h.featuresInvolved.length>3||h.parameterGrid.some(p=>Math.abs(p)>.5))throw new Error('Unbounded feature experiment');
    for(const key of h.featuresInvolved)if(!h.featureScales?.[key]||h.featureScales[key].sd<=0)throw new Error('Discovery-only scales required');
  }
  if(h.conditions&&h.conditions.length>3)throw new Error('Unbounded subgroup complexity');
  return h;
}
export function generateResearchHypotheses(clusters:FailureCluster[],discovery:FailureFeatureRow[],modelVersion:string):ResearchHypothesis[] {
  return generateHypotheses(clusters).map(h=>{
    h={...h,sourceModelVersion:modelVersion,actionType:h.actionType||(['BOOST_FORM'].includes(h.proposedImplementation)?'BOOST_FEATURE':['HOME_BIAS'].includes(h.proposedImplementation)?'ADD_FEATURE':'DAMP_FEATURE'),
      comparisonPopulation:h.comparisonPopulation||'Same selected side, confidence, Elo and season phase',duplicationRisks:h.duplicationRisks||h.duplicatedSignals,
      missingDataRisks:h.missingDataRisks||['Unavailable fields cannot satisfy a rule'],complexityScore:h.complexityScore||1};
    if(h.origin==='DISCOVERED_FAILURE_CLUSTER') {
      const keys=h.featuresInvolved.filter(k=>!k.startsWith('data_quality.')&&!k.startsWith('meta_disagreement.')).slice(0,3);
      const disagreement=h.featuresInvolved.some(k=>k.startsWith('meta_disagreement.'));
      const quality=h.featuresInvolved.some(k=>k.startsWith('data_quality.'));
      h.origin=quality?'DATA_QUALITY_RESEARCH':disagreement?'DISAGREEMENT_RESEARCH':keys.some(k=>k.startsWith('coach_'))?'COACH_SECTION_SCORECARD':'DISCOVERED_FAILURE_CLUSTER';
      if(disagreement||quality||!keys.length) {
        h.actionType=h.proposedImplementation='ADD_UNCERTAINTY_GATE';h.parameterGrid=[.75,.85,.95,1];
      } else {
        h.featuresInvolved=keys;h.featureScales={};
        for(const key of keys) {
          const values=discovery.map(r=>r.researchFeatures?.[key]).filter((v):v is number=>v!=null&&Number.isFinite(v));
          const mean=values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
          const sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,values.length));
          h.featureScales[key]={mean,sd:sd||1};
        }
        h.actionType=h.proposedImplementation=keys.length>1?'ADD_INTERACTION':'ADD_FEATURE';h.parameterGrid=[-.15,-.075,0,.075,.15];
        h.statement=`Test incremental ${keys.length>1?'interaction':'feature'} information in ${keys.join(' × ')} inside ${h.sourceClusterId}.`;
        h.mechanism='One bounded additive logit term; scales fitted on discovery only; no change outside the frozen subgroup.';
        h.expectedDirection='Coefficient sign and magnitude selected exclusively by chronological development folds.';
      }
      h.hypothesisId=`H-${digest({cluster:h.sourceClusterId,action:h.actionType,features:h.featuresInvolved,modelVersion}).slice(0,20)}`;
    }
    return validateHypothesis(h);
  });
}
export function manualHypotheses(entries:any[],clusters:FailureCluster[],modelVersion:string) {
  const executable:ResearchHypothesis[]=[],blocked:any[]=[];
  for(const item of entries) {
    if(item.hypothesisId&&item.proposedImplementation) {
      try {const h=validateHypothesis({...item,origin:'MANUAL',sourceModelVersion:modelVersion});
        if(!clusters.some(c=>c.clusterId===h.sourceClusterId))throw new Error('Manual hypothesis source population unavailable');executable.push(h);
      } catch(e){blocked.push({...item,status:'BLOCKED_CONTRACT',reason:String(e),origin:'MANUAL'});}
    } else blocked.push({...item,status:item.priority==='completed'?'TESTED':'BLOCKED_CONTRACT',origin:'MANUAL',reason:'Research brief preserved; requires an executable hypothesis and registered population.'});
  }
  return {executable,blocked};
}
