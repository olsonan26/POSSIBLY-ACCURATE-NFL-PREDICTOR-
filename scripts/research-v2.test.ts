import assert from 'node:assert/strict';
import { buildUnifiedSnapshot, numericResearchFeatures, captureHorizon, horizonDelta } from '../services/researchSnapshot.js';
import { COACH_SECTIONS, buildCoachReport } from '../services/coachAnalysis.js';
import { buildFailureFeatureRows,normalizeFailureRows, generateHypotheses, removePreviouslyTested, hypothesisProbability, type FailureFeatureRow } from './research-core.js';
import { discoverResidualSubgroups } from './residual-discovery.js';
import { coachSectionScorecard } from './research-scorecards.js';
import { epaProbabilityFromDataset } from '../services/ensembleService.js';
import { parseTeamStatsCsv } from '../services/pointInTimeTeamStats.js';
import { teamStatResearchEdges } from '../services/researchTeamStats.js';
import { getKickoffWeather } from '../services/gameWeather.js';
import { validateUnifiedSnapshot } from '../services/researchSnapshot.js';
import { preregisterManifest,evaluateRegistered } from './research-ledger.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { researchAttacks } from './research-evaluation.js';
import {frozenResearchContext} from '../server/researchCapture.js';

let tests=0;
function test(name:string,fn:()=>void) {fn();tests++;console.log(`PASS ${name}`);}
const scores={baseHomeProbability:60,finalHomeProbability:61,eloHome:1600,eloAway:1500,footballLogitAdjustment:.02,
  venueLogitAdjustment:0,h2hLogitAdjustment:0,personnelLogitAdjustment:0,restLogitAdjustment:.01,numerologyLogitAdjustment:0};
const context={gameId:'test',modelVersion:'control-test',kickoffAt:'2026-11-01T20:00:00Z',capturedAt:'2026-10-31T20:00:00Z',
  cutoffAt:'2026-10-31T20:00:00Z',horizon:'T-24h' as const,mode:'PROSPECTIVE' as const,homeTeam:'BUF',awayTeam:'MIA',
  result:{modelScores:scores,accuracyFeatures:{travel:{awayTravelMiles:1000,awayTzChange:1,isShortRest:false,logitEdge:.02}}}};
const snapshot=buildUnifiedSnapshot(context);
test('research-only signals frozen; missing remains null; model and horizon preserved',()=>{
  assert.equal(snapshot.features['football_travel.awayTravelMiles'].value,1000);
  assert.equal(snapshot.features['football_travel.awayTravelMiles'].includedInProduction,false);
  assert.equal(snapshot.features['football_qb.edge'].value,null);
  assert.equal(snapshot.modelVersion,'control-test'); assert.equal(snapshot.captureHorizon,'T-24h');
  assert.throws(()=>{snapshot.features['football_core.baseLogit'].value=99;});
  assert.equal(scores.finalHomeProbability,61);
});
test('horizons have separate identities and useful deltas',()=>{
  const later=buildUnifiedSnapshot({...context,capturedAt:'2026-11-01T18:00:00Z',cutoffAt:'2026-11-01T18:00:00Z',horizon:'T-3h',result:{modelScores:{...scores,finalHomeProbability:65}}});
  assert.notEqual(later.forecastId,snapshot.forecastId); assert.equal(snapshot.features['football_core.homeProbability'].value,.61);
  assert.ok(Math.abs(horizonDelta(snapshot,later)['football_core.homeProbability']!-.04)<1e-10);
  assert.equal(captureHorizon(context.kickoffAt,'2026-11-01T18:00:00Z'),'T-3h');
});
test('future injuries and after-kickoff prospective captures fail closed',()=>{
  assert.throws(()=>buildUnifiedSnapshot({...context,capturedAt:'2026-11-02T00:00:00Z'}));
  assert.throws(()=>buildUnifiedSnapshot({...context,extraFeatures:{'football_personnel.injuryEdge':{value:1,status:'known',source:'injuries',
    observedAt:'2026-11-01T19:00:00Z',capturedAt:context.capturedAt,version:'1',includedInProduction:false}}}));
});
test('server validates identity, timestamps and production/research boundaries',()=>{
  validateUnifiedSnapshot(snapshot,{gameId:context.gameId,modelVersion:context.modelVersion,kickoffAt:context.kickoffAt,now:context.capturedAt});
  const corrupted=structuredClone(snapshot);corrupted.features['football_travel.awayTravelMiles'].includedInProduction=true;
  assert.throws(()=>validateUnifiedSnapshot(corrupted));
  assert.throws(()=>validateUnifiedSnapshot(snapshot,{gameId:'wrong',modelVersion:context.modelVersion,kickoffAt:context.kickoffAt,now:context.capturedAt}));
});
test('manifest exists before evaluation and cannot be rewritten',()=>{
  const root=resolve('research/runtime/tests');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'nfl-manifest-')),path=join(dir,'manifest.json');
  try {
    let evaluated=false;
    assert.throws(()=>evaluateRegistered(path,'TEST',()=>{evaluated=true;}));assert.equal(evaluated,false);
    const manifest={experiment_id:'TEST',hypothesis_id:'H-test',cluster_id:'DD-test',parent_model:'test',created_at:new Date().toISOString(),
      feature_change:'CALIBRATE_SUBGROUP',parameter_values:[.8,1],validation_range:'synthetic',success_conditions:['improve'],failure_conditions:['regress']};
    preregisterManifest(path,manifest);
    assert.equal(evaluateRegistered(path,'TEST',()=>42),42);assert.throws(()=>preregisterManifest(path,manifest));
  } finally {assert.ok(resolve(dir).startsWith(root+sep));rmSync(dir,{recursive:true,force:true});}
});
test('neutral challenger has zero bootstrap delta and no null-test advantage',()=>{
  const fixture:any[]=Array.from({length:60},(_,i)=>({homeWinProbability:.6,homeTeam:'BUF',actualWinner:i%3?'BUF':'MIA',predictedWinner:'BUF',season:2024,week:1+i%18}));
  const attacks=researchAttacks(fixture,s=>s.homeWinProbability,50);
  assert.equal(attacks.observedBrierDelta,0);assert.deepEqual(attacks.bootstrap95,[0,0]);assert.equal(attacks.nullPValue,1);
});
const coach=buildCoachReport({sections:COACH_SECTIONS.map(([id])=>({id,advantage:'home',evidenceIds:['E1'],missing:[]})),prediction:{winner:'home',decisiveSections:['protection']}},
  [{id:'E1',url:'https://example.test/pregame',title:'Test evidence',publishedAt:'2026-10-30T20:00:00Z',quote:'Synthetic dated pregame evidence.'}],
  {version:'coach-test',gameId:'test',homeTeam:'BUF',awayTeam:'MIA',gameday:'2026-11-01',cutoff:context.cutoffAt,mode:'pregame',generatedAt:context.capturedAt,capture:'test',controlHomeProbability:.61});
test('ten sections freeze individually and score only in their evidence mode',()=>{
  const unified=buildUnifiedSnapshot({...context,coach});
  assert.equal(Object.keys(unified.features).filter(k=>/^coach_.*\.direction$/.test(k)).length,10);
  assert.equal(unified.features['coach_protection.direction'].value,1);
  const rows:any[]=[{unifiedSnapshot:unified,actualWinner:'BUF',homeTeam:'BUF',awayTeam:'MIA',homeWinProbability:.4,season:2026}];
  assert.equal(coachSectionScorecard(rows,'PROSPECTIVE')[0].disagreementAccuracy,1);
  assert.equal(coachSectionScorecard(rows,'HISTORICAL_RECONSTRUCTION')[0].eligible,0);
  const historical=buildUnifiedSnapshot({...context,coach:{...coach,mode:'historical-reconstruction'}});
  assert.equal(historical.features['coach_protection.direction'].value,null);
  const postgame=buildUnifiedSnapshot({...context,coach:{...coach,evidence:coach.evidence.map(e=>({...e,publishedAt:'2026-11-02T00:00:00Z'}))}});
  assert.equal(postgame.features['coach_protection.direction'].value,null);
});
test('EPA/ensemble unchanged when target and future weeks/seasons are removed',()=>{
  const header='season,week,team,passing_epa,rushing_epa,attempts,carries';
  const safe='2024,1,BUF,4,1,30,20\n2024,1,MIA,1,1,30,20';
  const full=parseTeamStatsCsv(`${header}\n${safe}\n2024,2,BUF,999,999,30,20\n2024,3,MIA,999,999,30,20\n2025,1,BUF,999,999,30,20`);
  assert.equal(epaProbabilityFromDataset(full,'BUF','MIA',2024,2),epaProbabilityFromDataset(parseTeamStatsCsv(`${header}\n${safe}`),'BUF','MIA',2024,2));
  assert.equal(epaProbabilityFromDataset(full,'BUF','MIA',2024,1),null);
  assert.equal(epaProbabilityFromDataset(parseTeamStatsCsv('team\nBUF'),'BUF','MIA',2024,2),null);
});
test('team proxies reject target-week rows',()=>{
  const data={...parseTeamStatsCsv('season,week,team,passing_epa,attempts,sacks_suffered\n2024,2,BUF,99,30,1'),targetWeek:2};
  const edge=teamStatResearchEdges(data,data,2,context.cutoffAt,context.capturedAt);
  assert.equal(edge['football_efficiency.passEpaPerDropback'].value,null);
});
let seed=739;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function synthetic(noise=false):FailureFeatureRow[] {
  return Array.from({length:4800},(_,i)=>{
    const qb=Number(random()>.5),protection=Number(random()>.5),elo=Number(random()>.5);
    const miss=random()<(noise?.2:qb&&protection&&elo?.95:.08);
    return {snapshotId:`s${i}`,gameId:`g${i}`,sourceModelVersion:'test',season:2022+Math.floor(i/1600),week:1+i%18,
      homeTeam:`T${i%32}`,awayTeam:`T${(i+7)%32}`,predictedWinner:'HOME',actualWinner:miss?'AWAY':'HOME',predictedHome:true,
      correct:!miss,earlySeason:false,neutralSite:false,confidence:.65,alignedBaseLogit:.5,alignedFormLogit:0,alignedVenueLogit:0,
      alignedH2hLogit:0,alignedPersonnelLogit:0,alignedRestLogit:0,
      researchFeatures:{'football_qb.edge':qb,'football_ol.edge':protection,'football_core.eloEdge':elo,'football_efficiency.noise':random()}};
  });
}
const rows=synthetic(), found=discoverResidualSubgroups(rows.filter(r=>r.season<2024),rows.filter(r=>r.season===2024));
test('future/target rows cannot change discovery-fitted matrix normalization',()=>{
  const reference=rows.filter(r=>r.season<2024),historical=reference[0];
  const future={...rows[rows.length-1],confidence:.999,alignedBaseLogit:999};
  assert.deepEqual(normalizeFailureRows([historical,future],reference)[0],normalizeFailureRows([historical],reference)[0]);
  assert.equal(normalizeFailureRows([historical],[])[0].zConfidence,null);
});
test('discovers an unprogrammed three-feature failure pattern outside discovery data',()=>{
  assert.ok(found.clusters.length,JSON.stringify(found.search));
  assert.ok(found.clusters.some(c=>['football_qb.edge','football_ol.edge','football_core.eloEdge'].every(f=>c.dominantFeatures.includes(f))));
});
test('random noise is not forced into a stable cluster',()=>{
  const noise=synthetic(true), result=discoverResidualSubgroups(noise.filter(r=>r.season<2024),noise.filter(r=>r.season===2024));
  assert.equal(result.clusters.length,0);
});
test('hypotheses trace to cluster and deduplicate; unsupported actions rejected',()=>{
  const hypotheses=generateHypotheses(found.clusters);assert.ok(hypotheses.length);
  assert.ok(found.clusters.some(c=>c.clusterId===hypotheses[0].sourceClusterId));
  assert.equal(hypotheses[0].actionType,'CALIBRATE_SUBGROUP');
  assert.equal(removePreviouslyTested([hypotheses[0],hypotheses[0]],[]).length,1);
  assert.equal(removePreviouslyTested(hypotheses,[{hypothesis_id:hypotheses[0].hypothesisId}]).some(h=>h.hypothesisId===hypotheses[0].hypothesisId),false);
  assert.throws(()=>removePreviouslyTested([{...hypotheses[0],actionType:'INVALID' as any}],[]));
});
test('generalized interaction challengers are bounded, ablatable and fail closed on missing inputs',()=>{
  const base=generateHypotheses(found.clusters)[0];
  const fixture:any={unifiedSnapshot:snapshot,homeWinProbability:.61,homeTeam:'BUF',awayTeam:'MIA',actualWinner:'BUF',predictedWinner:'BUF',
    featureSnapshot:{baseLogit:.4,formLogit:.02,venueLogit:0,h2hLogit:0,personnelLogit:0,restLogit:0}};
  const hypothesis:any={...base,proposedImplementation:'ADD_INTERACTION',actionType:'ADD_INTERACTION',
    featuresInvolved:['football_core.formLogit','football_travel.awayTravelMiles'],featureScales:{'football_core.formLogit':{mean:0,sd:.02},'football_travel.awayTravelMiles':{mean:0,sd:1000}}};
  assert.ok(hypothesisProbability(fixture,hypothesis,.1)>.61);
  assert.ok(Math.abs(hypothesisProbability(fixture,hypothesis,0)-.61)<1e-12);
  assert.throws(()=>hypothesisProbability(fixture,hypothesis,2));
  assert.equal(hypothesisProbability(fixture,{...hypothesis,featuresInvolved:['football_qb.edge']},.1),.61);
});
const original=globalThis.fetch;
try {
  const calls:string[]=[];
  globalThis.fetch=(async(url:any)=>{calls.push(String(url));return Response.json({hourly:{time:['2024-11-01T20:00'],temperature_2m:[40],wind_speed_10m:[18],wind_gusts_10m:[25],precipitation:[.2],snowfall:[0],relative_humidity_2m:[70]}});}) as any;
  const outdoor=await getKickoffWeather('2024-11-01T20:30:00Z',{id:'neutral-London',latitude:51.5,longitude:0,roof:'outdoor'},'2026-10-30T20:00:00Z');
  test('archived kickoff weather uses actual neutral venue and hourly values',()=>{assert.equal(outdoor?.windSpeedMph,18);assert.equal(outdoor?.evidenceMode,'ARCHIVED_REANALYSIS');assert.ok(calls[0].includes('latitude=51.5'));});
  const dome=await getKickoffWeather(context.kickoffAt,{id:'dome',latitude:40,longitude:-100,roof:'dome'},context.capturedAt);
  test('dome has no invented temperature; unknown retractable roof fails closed',()=>{assert.equal(dome?.temperatureF,null);assert.equal(dome?.weatherImpact,0);assert.equal(calls.length,1);});
  assert.equal(await getKickoffWeather(context.kickoffAt,{id:'roof',latitude:40,longitude:-100,roof:'unknown'},context.capturedAt),null);
} finally {globalThis.fetch=original;}
const storageEnv={url:process.env.NFL_LEARNING_SUPABASE_URL,key:process.env.NFL_LEARNING_SUPABASE_KEY};
try {
  process.env.NFL_LEARNING_SUPABASE_URL='https://frozen.test';process.env.NFL_LEARNING_SUPABASE_KEY='test-only';
  let late=false;
  globalThis.fetch=(async(url:any)=>{
    const captured=late?'2026-10-31T20:00:01Z':'2026-10-31T19:59:00Z';
    return Response.json(String(url).includes('nfl_coach_reports')?[{report:coach,captured_at:captured,kickoff_at:context.kickoffAt}]:
      [{learned_home_probability:.57,captured_at:captured,kickoff_at:context.kickoffAt,research_model:'test-model',experiment_version:'test-version'}]);
  }) as any;
  const known=await frozenResearchContext('test',context.cutoffAt,context.capturedAt);
  test('server capture bridges only Coach and learning signals frozen before the cutoff',()=>{
    assert.equal(known.coach?.gameId,'test');assert.equal(known.extraFeatures?.['deepseek_learning.homeProbability'].value,.57);
  });
  late=true;
  const blocked=await frozenResearchContext('test',context.cutoffAt,context.capturedAt);
  test('later frozen source records cannot modify earlier horizons',()=>{assert.equal(blocked.coach,undefined);assert.equal(blocked.extraFeatures,undefined);});
} finally {
  globalThis.fetch=original;
  for(const [name,value] of [['NFL_LEARNING_SUPABASE_URL',storageEnv.url],['NFL_LEARNING_SUPABASE_KEY',storageEnv.key]] as const) {
    if(value===undefined) delete process.env[name];else process.env[name]=value;
  }
}
console.log(`Research V2 acceptance: ${tests} passed, 0 failed.`);
