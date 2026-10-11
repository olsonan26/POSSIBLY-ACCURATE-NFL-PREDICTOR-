import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZODIAC_SIGNS, zodiacForDate, zodiacRelationship, zodiacCompatibilityMatrix, normalizeZodiacSign, birthProfile, validDate } from '../services/chineseZodiacService.js';
import { buildTeamReport, buildZodiacRecord, parseRosterCsv, venueTimezone } from '../server/zodiacResearch.js';
import { validateZodiacRecord } from '../server/zodiacValidation.js';
import handler from '../api/zodiac-research.js';
import type { ScheduledGame } from '../services/scheduleService.js';
import type { ZodiacReport } from '../services/chineseZodiacService.js';

assert.equal(zodiacForDate('2026-02-16')?.sign, 'Snake');
assert.equal(zodiacForDate('2026-02-17')?.sign, 'Horse');
assert.equal(zodiacForDate('2026-02-17')?.element, 'Fire');
assert.equal(zodiacForDate('2026-02-17')?.ganZhi, 'Bing-Wu');
assert.equal(zodiacForDate('1997-01-07')?.sign, 'Rat');
assert.equal(zodiacForDate('1997-02-07')?.sign, 'Ox');
assert.equal(zodiacForDate('2024-02-09')?.sign, 'Rabbit');
assert.equal(zodiacForDate('2024-02-10')?.sign, 'Dragon');
assert.equal(zodiacForDate('2026-02-30'), null);
assert.equal(zodiacForDate('1800-01-01'), null);
assert.equal(validDate('2024-02-29'), true);
assert.equal(validDate('2025-02-29'), false);
assert.equal(normalizeZodiacSign('Cat'), 'Rabbit');
assert.equal(normalizeZodiacSign('Sheep'), 'Goat');
for (const a of ZODIAC_SIGNS) {
  assert.equal(ZODIAC_SIGNS.filter(b => zodiacRelationship(a,b) === 'direct_enemy').length, 1);
  for (const b of ZODIAC_SIGNS) assert.equal(zodiacRelationship(a,b), zodiacRelationship(b,a));
}
assert.equal(zodiacRelationship('Horse','Goat'), 'other_or_unclassified');
assert.equal(zodiacRelationship('Horse','Dog'), 'same_friend_trine');
assert.equal(zodiacRelationship('Rat','Ox'), 'rat_ox_special_pair');
assert.equal(Object.keys(zodiacCompatibilityMatrix()).length,12);
assert.equal(zodiacCompatibilityMatrix().Rat.Horse,'direct_enemy');
const boundaries = JSON.parse(readFileSync(new URL('../zodiac/lunar_new_years.json',import.meta.url),'utf8'));
for (const [year, boundary] of Object.entries(boundaries)) {
  const before = new Date(`${boundary}T12:00:00Z`); before.setUTCDate(before.getUTCDate()-1);
  assert.equal(zodiacForDate(String(boundary))?.lunarYear, Number(year));
  assert.equal(zodiacForDate(before.toISOString().slice(0,10))?.lunarYear, Number(year)-1);
}
assert.equal(birthProfile('1963-02-17','2026-10-11')?.lifePath,11);
assert.equal(birthProfile('2027-01-01','2026-10-11'),null);
assert.equal(birthProfile('1963-02-17','2026-10-11')?.birthDay,17);
assert.equal(venueTimezone('London','England'),'Europe/London');
assert.equal(venueTimezone('Unknown','USA'),null);
assert.equal(venueTimezone('Glendale','USA'),'America/Phoenix');

const game: ScheduledGame = {gameId:'fixture',season:2025,week:2,gameType:'REG',gameday:'2025-09-14',gametime:'13:00',homeTeam:'PHI',awayTeam:'DAL',neutralSite:false,completed:true,homeScore:21,awayScore:17};
const rows = parseRosterCsv('season,week,team,gsis_id,espn_id,full_name,birth_date,position\n2025,2,PHI,p1,,"Player, One",1997-01-07,QB\n2025,2,DAL,p2,,Missing Birthday,,WR\n2026,2,PHI,future,,Wrong Season,2000-01-01,QB\n2025,2,PHI,p1,,Duplicate,1997-01-07,QB\n');
const report: ZodiacReport = {game:{id:'fixture',date:game.gameday,home:'PHI',away:'DAL',completed:true,homeScore:21,awayScore:17},gameYear:zodiacForDate(game.gameday)!,home:buildTeamReport('PHI',game,rows,'https://example.test/roster'),away:buildTeamReport('DAL',game,rows,'https://example.test/roster'),franchiseRelationship:null,record:null,recordUnavailableReason:null,limitations:['No approved Zodiac model or evaluation report exists.']};
assert.equal(report.home.players.length,1);
assert.equal(report.home.players[0].name,'Player, One');
assert.equal(report.home.coach,null);
const record = buildZodiacRecord(report,{kickoff:'2025-09-14T17:00:00Z',timezone:'America/New_York',venue:'Test venue',source:'https://example.test/event'},'2026-10-11T12:00:00Z');
const registry = JSON.parse(readFileSync(new URL('../zodiac/rule_registry.json',import.meta.url),'utf8'));
const evidence = { rules:registry.rules,subjectIds:['event:fixture','team:PHI','team:DAL','coach:PHI','coach:DAL','player:p1','player:p2'] };
assert.deepEqual(validateZodiacRecord(record,evidence),[]);
assert.equal(record.historical_audit.original_record_available,false);
assert.equal(record.historical_audit.original_prediction_timestamp_utc,null);
assert.equal(record.prediction.published_probability,null);
assert(record.symbolic_observations.every((o:any)=>o.used_in_published_probability===false));
const unavailable = record.symbolic_observations.find((o:any)=>o.subject_ids[0]==='player:p2');
assert.equal(unavailable.value,null);assert.equal(unavailable.calculation,null);assert.equal(unavailable.availability,'unavailable');
const mutate = (f:(r:any)=>void) => {const r=structuredClone(record);f(r);return validateZodiacRecord(r,evidence);};
assert(mutate(r=>r.extra=true).length);
assert(mutate(r=>r.symbolic_observations[0].source_ids=['missing']).length);
assert(mutate(r=>r.symbolic_observations[0].rule_version='unknown').length);
assert(mutate(r=>r.symbolic_observations[0].subject_ids=['missing']).length);
assert(mutate(r=>r.symbolic_observations[0].used_in_published_probability=true).length);
assert(mutate(r=>r.prediction.approved_hybrid_probability=0.7).length);
assert(mutate(r=>r.historical_audit.original_prediction_timestamp_utc='2025-09-13T12:00:00Z').length);
assert(mutate(r=>r.symbolic_observations[0].value={sign:'Snake'}).length);
assert(mutate(r=>r.timing.record_created_utc='2026-02-30T12:00:00Z').length);

const baseline = structuredClone(record);
baseline.mode='validated_prediction';baseline.historical_audit=null;
baseline.timing={record_created_utc:'2025-09-13T12:00:00Z',prediction_as_of_utc:'2025-09-13T12:00:00Z',information_cutoff_utc:'2025-09-13T12:00:00Z',forecast_stage:'pregame'};
baseline.data_quality.cutoff_check_status='passed';
baseline.model_metadata.baseline={model_id:'test-baseline',model_version:'1',manifest_version:'1',approval_status:'approved_for_prediction',training_data_cutoff_utc:'2025-08-01T00:00:00Z',calibration_version:'test-calibration',inference_id:'test-inference'};
baseline.prediction={...baseline.prediction,published_probability:0.61,published_model:'sports_baseline',baseline_probability:0.61,probability_origin:'backend_model',recommendation:'publish_probability'};
const approved = {...evidence,model:{model_id:'test-baseline',model_version:'1',manifest_version:'1',inference_id:'test-inference',probability:0.61,feature_ids:[],fitting_cutoff_utc:'2025-08-01T00:00:00Z'}};
assert.deepEqual(validateZodiacRecord(baseline,approved),[]);
assert(validateZodiacRecord(baseline,evidence).length);
const badProbability=structuredClone(baseline);badProbability.prediction.published_probability=0.7;
assert(validateZodiacRecord(badProbability,approved).length);
const lateOdds=structuredClone(baseline);lateOdds.betting_analysis={market_id:'test',target_id:baseline.target.target_id,bookmaker:'test',price_timestamp_utc:'2025-09-14T12:00:00Z',decimal_odds:2,probability_used:0.61,settlement_rules:'Test',expected_net_return_per_unit:0.22,expected_value_method:'test',source_ids:['schedule'],action:'analysis_only'};
assert(validateZodiacRecord(lateOdds,approved).length);

const originalFetch=globalThis.fetch;
let requests:string[]=[];
globalThis.fetch=async (url:any) => {
  requests.push(String(url));
  if(String(url).includes('games.csv')) return new Response('game_id,season,game_type,week,gameday,gametime,home_team,away_team,home_score,away_score,espn,location\napi-fixture,2025,REG,2,2025-09-14,13:00,PHI,DAL,21,17,fixture,Home\n');
  if(String(url).includes('roster_weekly_')) return new Response('season,week,team,gsis_id,full_name,birth_date,position\n2025,2,PHI,p1,Test Player,1997-01-07,QB\n');
  if(String(url).includes('summary?')) return new Response(JSON.stringify({header:{id:'fixture',competitions:[{date:'2025-09-14T17:00:00Z',competitors:[{homeAway:'home',team:{abbreviation:'PHI'}},{homeAway:'away',team:{abbreviation:'DAL'}}]}]},gameInfo:{venue:{fullName:'Test venue',address:{city:'Philadelphia',country:'USA'}}}}));
  throw new Error('Unexpected source: '+url);
};
async function request(method:string,body:any) {let status=200;let payload:any;const res={setHeader(){},status(n:number){status=n;return this;},json(p:any){payload=p;return this;}};await handler({method,body},res);return {status,payload};}
try {
  let savedEvaluation:any;
  await handler({method:'GET',query:{view:'evaluation'}},{setHeader(){},status(){return this;},json(r:any){savedEvaluation=r;return this;}});
  assert.equal(savedEvaluation.method,'walk_forward');
  assert.equal(savedEvaluation.folds.length,3);
  assert.equal((await request('GET',{})).status,405);
  assert.equal((await request('POST',{home:'PHI',away:'PHI',date:'2025-09-14'})).status,400);
  assert.equal((await request('POST',{home:'PHI',away:'DAL',date:'2025-02-30'})).status,400);
  assert.equal((await request('POST',{home:'PHI',away:'DAL',date:'2025-09-14',model:{approved:true}})).status,400);
  assert.equal(requests.length,0);
  const response=await request('POST',{home:'PHI',away:'DAL',date:'2025-09-14'});
  assert.equal(response.status,200);
  assert.equal(response.payload.record?.schema_version,'0.1.0');
  assert.equal(response.payload.record?.prediction.published_probability,null);
  assert(requests.every(url=>!url.includes('openrouter')&&!url.includes('supabase')));
} finally {globalThis.fetch=originalFetch;}
console.log('Zodiac calendar, relationships, contracts, publication gates, historical integrity and API isolation passed.');
