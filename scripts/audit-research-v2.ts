import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const base='33d1d72b77ef9c51866ba3cd28cb398c9bbea57d';
const files=['scripts/research-core.ts','scripts/research-cycle.ts','scripts/research-cycle.test.ts','services/validatedPredictionService.ts',
  'services/coachAnalysis.ts','api/coach-analysis.ts','services/weatherService.ts','services/ensembleService.ts','api/prediction-ledger.ts',
  'api/pregame-intelligence.ts','server/learningStore.ts','server/postgameResearch.ts','research/experiment-ledger.json','research/FEATURE_REGISTRY.md','research/research-queue.json'];
const source=(path:string)=>readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const original=(path:string)=>execFileSync('git',['show',`${base}:${path}`],{encoding:'utf8'}).replace(/\r\n/g,'\n');
const production=(text:string)=>text.match(/  const s = rawResearch\.modelScores;[\s\S]*?  const validatedScores =/)?.[0];
const controlFormulaUnchanged=production(source('services/validatedPredictionService.ts'))===production(original('services/validatedPredictionService.ts'));
const contextUnchanged=source('services/validatedFootballContext.ts')===original('services/validatedFootballContext.ts');
const report={base,generatedAt:new Date().toISOString(),controlFormulaUnchanged,contextUnchanged,
  files:files.map(path=>({path,sha256:createHash('sha256').update(source(path)).digest('hex')}))};
mkdirSync('research/runtime',{recursive:true});writeFileSync('research/runtime/repository-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!controlFormulaUnchanged||!contextUnchanged) process.exit(1);
