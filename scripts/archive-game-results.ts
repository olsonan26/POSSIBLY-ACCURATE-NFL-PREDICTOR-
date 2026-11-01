import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {verifiedSchedule} from '../server/learningStore.js';
import {syncGameResults} from '../server/gameResults.js';
const result=await syncGameResults(await verifiedSchedule());
const path=resolve('research/runtime/game-results-archive.json');mkdirSync(dirname(path),{recursive:true});
writeFileSync(path,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
