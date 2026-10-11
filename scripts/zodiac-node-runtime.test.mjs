import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = await mkdtemp(join(tmpdir(), 'nfl-zodiac-node-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}');
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc','--noEmit','false','--allowImportingTsExtensions','false','--outDir',output], { stdio:'inherit' });
  await cp('zodiac/prediction_schema.json',join(output,'zodiac/prediction_schema.json'),{recursive:true});
  await cp('zodiac/rule_registry.json',join(output,'zodiac/rule_registry.json'),{recursive:true});
  await cp('zodiac/lunar_new_years.json',join(output,'zodiac/lunar_new_years.json'),{recursive:true});
  await mkdir(join(output,'zodiac/evaluation'),{recursive:true});
  await cp('zodiac/evaluation/retrospective-2020-2025.json',join(output,'zodiac/evaluation/retrospective-2020-2025.json'));
  const module = await import(pathToFileURL(join(output,'api/zodiac-research.js')).href);
  assert.equal(typeof module.default,'function');
  await import(pathToFileURL(join(output,'scripts/zodiac-research.test.js')).href);
  console.log('Zodiac API and contract tests passed in native Node runtime.');
} finally { await rm(output,{recursive:true,force:true}); }
