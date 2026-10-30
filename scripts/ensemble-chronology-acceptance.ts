import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import { parseTeamStatsCsv,filterTeamStatsBeforeWeek } from '../services/pointInTimeTeamStats.js';
import { epaProbabilityFromDataset } from '../services/ensembleService.js';
import {teamStatResearchEdges} from '../services/researchTeamStats.js';
const url='https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2024.csv';
const response=await fetch(url);if(!response.ok)throw new Error(`Team stats unavailable: ${response.status}`);
const full=parseTeamStatsCsv(await response.text());
const truncated={headers:full.headers,rows:full.rows.filter(r=>Number(r.season)<2024||(Number(r.season)===2024&&Number(r.week)<7))};
const before=epaProbabilityFromDataset(full,'BUF','TEN',2024,7),after=epaProbabilityFromDataset(truncated,'BUF','TEN',2024,7);
assert.notEqual(before,null);assert.equal(before,after);
const cutoff='2024-10-20T00:00:00Z',capturedAt=new Date().toISOString();
const edges=(data:typeof full)=>teamStatResearchEdges({headers:data.headers,rows:filterTeamStatsBeforeWeek(data,'BUF',2024,7),targetWeek:7},
  {headers:data.headers,rows:filterTeamStatsBeforeWeek(data,'TEN',2024,7),targetWeek:7},7,cutoff,capturedAt);
assert.deepEqual(edges(full),edges(truncated));
const result={status:'PASS',gameId:'2024_07_TEN_BUF',targetSeason:2024,targetWeek:7,inputRows:full.rows.length,
  rowsAfterRemovingTargetAndFutureWeeks:truncated.rows.length,epaProbabilityBefore:before,epaProbabilityAfter:after,
  teamProxyFeaturesIdentical:true,source:url,evidence:'HISTORICAL_RECONSTRUCTION'};
mkdirSync('research/runtime',{recursive:true});writeFileSync('research/runtime/ensemble-chronology-acceptance.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
