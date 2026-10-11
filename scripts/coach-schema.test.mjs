import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {PGlite}=await import(process.env.NFL_TEST_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const name of ['learning-schema.sql','postgame-schema.sql']) await db.exec(await readFile(new URL('../database/'+name,import.meta.url),'utf8'));
 const scoped=(await readFile(new URL('../database/learning-scoped-access.sql',import.meta.url),'utf8')).replaceAll('__LEARNING_SECRET_SHA256__',createHash('sha256').update('test-secret').digest('hex'));
 await db.exec(scoped);
 const schema=await readFile(new URL('../database/coach-analysis-schema.sql',import.meta.url),'utf8');await db.exec(schema);await db.exec(schema);
 await db.exec('set role anon;');
 const token='11111111-1111-4111-8111-111111111111';
 const claim='select nfl_claim_coach($1,$2,$3,$4) as claimed';
 await assert.rejects(db.query(claim,['report','model','coach-matchup-v1',token]));
 await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-learning-secret':'test-secret'})]);
 assert.equal((await db.query(claim,['report','model','coach-matchup-v1',token])).rows[0].claimed,true);
 assert.equal((await db.query(claim,['report','model','coach-matchup-v1',token])).rows[0].claimed,false);
 const sql=`insert into nfl_coach_reports(report_key,game_id,version,research_model,captured_at,kickoff_at,cutoff_at,mode,report) values($1,'game','coach-matchup-v1','model','2000-01-01',$2,$3,$4,$5) returning *`;
 const late=await db.query(sql,['report','2020-09-10T17:00:00Z','2020-09-10T16:00:00Z','pregame',JSON.stringify({capture:'Saved before kickoff'})]);
 assert.ok(new Date(late.rows[0].captured_at).getUTCFullYear()>2020);
 assert.match(late.rows[0].report.capture,/not a prospective/);
 await assert.rejects(db.exec("update nfl_coach_reports set report='{}'"));
 await db.exec('reset role;');await assert.rejects(db.exec('delete from nfl_coach_reports'));
 await db.exec('set role service_role;');
 await assert.rejects(db.query(sql,['future','2099-09-10T17:00:00Z','2099-09-10T16:00:00Z','pregame','{}']));
 console.log('Coach SQL: repeatable setup, scoped access, concurrent claims, server clock, late capture and immutability passed.');
}finally{await db.close();}
