import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {verifiedSchedule} from '../server/learningStore.js';
import {DatabaseResearchState} from '../server/researchStore.js';
import {FileResearchState} from './research-state.js';
import {backfillOptions,startBackfill,advanceBackfill,historicalSnapshots} from '../server/historicalResearch.js';
import {runResearchEngine} from './research-engine.js';
const arg=(key:string)=>process.argv.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3);
const options=backfillOptions({season:arg('season'),from:arg('from'),through:arg('through'),includePlayoffs:process.argv.includes('--include-playoffs')});
const local=arg('local-state'),state=local?new FileResearchState(resolve(local)):new DatabaseResearchState(true);
const games=await verifiedSchedule(),dry=process.argv.includes('--dry-run');
let jobId=arg('job');
if(process.argv.includes('--resume')&&!jobId){const jobs=(await state.all()).filter(e=>e.event_kind==='RUN'&&e.payload.recordType==='BACKFILL_JOB'&&JSON.stringify(e.payload.options)===JSON.stringify(options));jobId=jobs.at(-1)?.event_key;}
const start=await startBackfill(state,games,options,dry||Boolean(jobId));
console.log(JSON.stringify({...start,gameIds:undefined,coverageBefore:{...start.coverageBefore,fieldCoverage:undefined},durable:state.durable},null,2));
if(!dry){
 jobId=jobId||start.jobId;let progress;
 do{progress=await advanceBackfill(state,games,jobId,25);console.log(JSON.stringify({...progress,coverage:undefined}));}while(progress.status==='RUNNING');
 const output=resolve(arg('output-dir')||'research/runtime/backfill');mkdirSync(output,{recursive:true});
 writeFileSync(resolve(output,'summary.json'),JSON.stringify({...progress,durable:state.durable,before:start.coverageBefore},null,2));
 if(process.argv.includes('--research'))writeFileSync(resolve(output,'research.json'),JSON.stringify(await runResearchEngine(historicalSnapshots(await state.all()),{state,
  manual:JSON.parse(readFileSync(new URL('../research/research-queue.json',import.meta.url),'utf8')),codeCommit:process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}),null,2));
 if(progress.failed||progress.blocked)process.exitCode=1;
}
