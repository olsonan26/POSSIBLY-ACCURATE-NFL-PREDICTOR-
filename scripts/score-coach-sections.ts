import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseScheduleCsv } from '../services/scheduleService.js';
import { coachReportSnapshots } from './frozen-research-input.js';
import { coachSectionScorecard } from './research-scorecards.js';
const arg=(key:string)=>process.argv.find(a=>a.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const input=arg('input');
if(!input) throw new Error('Use --input=exported-coach-rows.json; rows must include DB captured_at and kickoff_at.');
const response=await fetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv');
if(!response.ok) throw new Error('Verified outcomes unavailable.');
const reports=JSON.parse(readFileSync(input,'utf8'));
const snapshots=coachReportSnapshots(reports,parseScheduleCsv(await response.text()));
const result={reports:reports.length,prospectiveReports:snapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='PROSPECTIVE').length,
  historicalReconstructions:snapshots.filter(s=>s.unifiedSnapshot?.evidenceMode==='HISTORICAL_RECONSTRUCTION').length,
  prospective:coachSectionScorecard(snapshots,'PROSPECTIVE'),historical:coachSectionScorecard(snapshots,'HISTORICAL_RECONSTRUCTION')};
const output=resolve(arg('output')||'research/runtime/coach-section-scorecard.durable.json');
mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
