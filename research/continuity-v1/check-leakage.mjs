// Adversarial temporal test: target-day and all later outcomes must not change a pick.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseGamesCsv, parseTeamData, predictWinner } from '../../services/validatedPredictionService.ts';

const root = new URL('./', import.meta.url);
if (!process.env.CONTINUITY_TEST_CASE) {
  const cases = ['2025_01_DAL_PHI', '2025_05_MIN_CLE', '2025_18_BAL_PIT'];
  const results = [];
  for (const gameId of cases) {
    const runs = [false,true].map(mutate => {
      const result = spawnSync(process.execPath,
        ['--loader',fileURLToPath(new URL('ts-loader.mjs',root)),fileURLToPath(import.meta.url)],
        {env:{...process.env,CONTINUITY_TEST_CASE:gameId,CONTINUITY_TEST_MUTATE:String(mutate)},encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      return JSON.parse(result.stdout);
    });
    assert.deepEqual(runs[0],runs[1], `Future or same-day outcomes changed ${gameId}`);
    results.push({game_id:gameId, unchanged:true, result:runs[0]});
  }
  writeFileSync(new URL('results/leakage-check.json',root),JSON.stringify({passed:true,cases:results},null,2)+'\n');
  console.log('PASS: three independent production runs unaffected by target-day/later score corruption; no live personnel requests.');
} else {
  let csv = gunzipSync(readFileSync(new URL('inputs/games.csv.gz',root))).toString('utf8');
  const game = parseGamesCsv(csv).find(g=>g.gameId===process.env.CONTINUITY_TEST_CASE);
  assert(game, 'Fixture game absent from pinned data');
  if (process.env.CONTINUITY_TEST_MUTATE === 'true') {
    // Only leading simple schedule/score columns are modified; quoted later fields are preserved.
    const lines = csv.trimEnd().split(/\r?\n/);
    const fields = lines[0].split(',');
    const day = fields.indexOf('gameday'), home = fields.indexOf('home_score'), away = fields.indexOf('away_score');
    assert(day>=0&&home>=0&&away>=0);
    csv = [lines[0],...lines.slice(1).map(line=>{
      const cells=line.split(',');
      if(cells[day]>=game.gameday) {cells[home]='99';cells[away]='0';}
      return cells.join(',');
    })].join('\n');
  }
  const calls=[];
  globalThis.fetch=async input=>{
    const url=String(input);calls.push(url);
    assert.equal(url,'/api/nfl-data?dataset=games','Non-games fetch attempted');
    return new Response(csv);
  };
  const teams=new Map(parseTeamData().map(t=>[t.abbr,t]));
  const r=await predictWinner(teams.get(game.homeTeam),teams.get(game.awayTeam),
    new Date(`${game.gameday}T12:00:00Z`),true,{neutralSite:game.location==='Neutral'});
  assert(calls.every(u=>u==='/api/nfl-data?dataset=games'));
  assert.equal(r.modelScores.personnelLogitAdjustment,0);
  assert.equal(r.homePersonnel,undefined);
  assert.equal(r.awayPersonnel,undefined);
  console.log(JSON.stringify({winner:r.winner.abbr,p_home:r.modelScores.finalHomeProbability,
    base:r.modelScores.baseHomeProbability,form:r.modelScores.footballLogitAdjustment,
    venue:r.modelScores.venueLogitAdjustment,h2h:r.modelScores.h2hLogitAdjustment}));
}
