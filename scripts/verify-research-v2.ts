import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
const commands=[
  ['node',['node_modules/typescript/bin/tsc','--noEmit']],
  ['node',['scripts/node-api-runtime.test.mjs']],
  ...['research-cycle.test.ts','research-v2.test.ts','research-engine.test.ts','research-live.test.ts','research-data.test.ts','point-in-time-integrity.test.ts','prediction-ledger.test.ts','reliability.test.ts',
    'coach-analysis.test.ts','learning-feedback.test.ts','learning-api.test.ts','postgame-learning.test.ts','pregame-intelligence.test.ts'].map(file=>[process.execPath,[`scripts/${file}`]]),
  ['node',['scripts/research-schema.test.mjs']],['node',['scripts/coach-schema.test.mjs']],['node',['scripts/learning-schema.test.mjs']],
  ['node',['node_modules/vite/bin/vite.js','build']]
] as [string,string[]][];
mkdirSync('research/runtime/test-reports',{recursive:true});
const results=commands.map(([command,args],i)=>{
  const result=spawnSync(command,args,{encoding:'utf8',timeout:180000});
  const output=(result.stdout||'')+(result.stderr||'')+(result.error?.message||'');
  const passed=result.status===0;
  const name=args.join(' ');
  writeFileSync(`research/runtime/test-reports/${String(i+1).padStart(2,'0')}.log`,output);
  console.log(`${passed?'PASS':'FAIL'} ${name}${passed?'':`\n${output.slice(-3000)}`}`);
  return {name,passed,exitCode:result.status};
});
const report={generatedAt:new Date().toISOString(),passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
writeFileSync('research/runtime/verification.json',JSON.stringify(report,null,2));
console.log(`Verification: ${report.passed} passed; ${report.failed} failed.`);
if(report.failed) process.exit(1);
