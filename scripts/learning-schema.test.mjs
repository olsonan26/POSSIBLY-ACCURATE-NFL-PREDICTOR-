// Optional Postgres-compatible check, using an isolated @electric-sql/pglite install.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.NFL_TEST_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const schema = await readFile(new URL('../database/learning-schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  const postgame = await readFile(new URL('../database/postgame-schema.sql', import.meta.url), 'utf8');
  await db.exec(postgame);
  await db.exec(postgame);
  await db.exec(schema); // Setup is repeatable, with no destructive data operation.
  const sql = `insert into public.nfl_learning_forecasts (game_id, experiment_version, research_model,
    captured_at, completed_at, kickoff_at, home_team, away_team, base_home_probability, raw_home_probability,
    learned_home_probability, facts, feedback, payload_sha256)
    values ($1, 'EXP-032-feedback-v1', 'offline-model', '2000-01-01', clock_timestamp() - interval '1 second',
      $2, 'KC', 'DEN', 0.6, 0.55, 0.55, '[]', '{}', $3) returning *`;
  const future = new Date(Date.now() + 1200).toISOString();
  await db.exec('set role service_role;');
  const inserted = await db.query(sql, ['future-game', future, 'a'.repeat(64)]);
  assert.ok(new Date(inserted.rows[0].captured_at).getUTCFullYear() > 2020, 'DB must replace caller clock.');
  await assert.rejects(db.query(sql, ['past-game', '2000-01-02', 'b'.repeat(64)]));
  const outcome = `insert into public.nfl_learning_outcomes(game_id, observed_at, home_score, away_score, source)
    values ($1, '2000-01-01', 28, 17, 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv') returning *`;
  await assert.rejects(db.query(outcome, ['future-game']), 'Cannot record final results before kickoff.');
  await assert.rejects(db.exec("update public.nfl_learning_forecasts set raw_home_probability=0.99"));
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.exec('select * from public.nfl_learning_forecasts'));
  await assert.rejects(db.query(sql, ['anon-game', '2099-01-01', 'c'.repeat(64)]));
  await db.exec('reset role;');
  await assert.rejects(db.exec("delete from public.nfl_learning_forecasts"), 'Even privileged deletes must hit append-only trigger.');
  await new Promise(resolve => setTimeout(resolve, 1250));
  await db.exec('set role service_role;');
  const scored = await db.query(outcome, ['future-game']);
  assert.ok(new Date(scored.rows[0].observed_at) > new Date(inserted.rows[0].kickoff_at));
  await assert.rejects(db.query(outcome, ['future-game']), 'A rerun cannot duplicate an outcome.');
  await assert.rejects(db.exec('delete from public.nfl_learning_outcomes'));
  await db.exec('reset role;');
  const rls = await db.query("select relname from pg_class where relname in ('nfl_learning_forecasts','nfl_learning_outcomes') and relrowsecurity");
  assert.equal(rls.rows.length, 2);
  await db.exec('set role service_role;');
  const token = '11111111-1111-4111-8111-111111111111';
  const token2 = '22222222-2222-4222-8222-222222222222';
  const claim = 'select nfl_claim_postgame($1,$2,$3,$4) as claimed';
  assert.equal((await db.query(claim, ['old', 'offline-model', 'EXP-033-postgame-v1', token])).rows[0].claimed, true);
  assert.equal((await db.query(claim, ['old', 'offline-model', 'EXP-033-postgame-v1', token2])).rows[0].claimed, false);
  await db.query('select nfl_release_postgame($1,$2,$3,$4)', ['old', 'offline-model', 'EXP-033-postgame-v1', token2]);
  assert.equal((await db.query(claim, ['old', 'offline-model', 'EXP-033-postgame-v1', token2])).rows[0].claimed, false, 'Only the lease owner can release it.');
  await db.query('select nfl_release_postgame($1,$2,$3,$4)', ['old', 'offline-model', 'EXP-033-postgame-v1', token]);
  assert.equal((await db.query(claim, ['old', 'offline-model', 'EXP-033-postgame-v1', token2])).rows[0].claimed, true);
  await db.exec('reset role;');
  const secret = 'offline-scoped-secret';
  const { createHash } = await import('node:crypto');
  const scoped = (await readFile(new URL('../database/learning-scoped-access.sql', import.meta.url), 'utf8')).replaceAll('__LEARNING_SECRET_SHA256__', createHash('sha256').update(secret).digest('hex'));
  await db.exec(scoped);
  await db.exec('set role anon;');
  assert.equal((await db.query('select * from nfl_learning_forecasts')).rows.length, 0, 'Anon without secret has no rows.');
  await assert.rejects(db.query(claim, ['unauthorized', 'offline-model', 'EXP-033-postgame-v1', token]));
  await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-learning-secret': secret })]);
  assert.equal((await db.query('select * from nfl_learning_forecasts')).rows.length, 1);
  assert.equal((await db.query(claim, ['scoped', 'offline-model', 'EXP-033-postgame-v1', token])).rows[0].claimed, true);
  await assert.rejects(db.exec("update public.nfl_learning_forecasts set raw_home_probability=0.99"));
  const reviewSql = `insert into public.nfl_postgame_reviews(game_id,research_model,version,season,home_team,away_team,home_score,away_score,kickoff_at,outcome_source,provider_model,review,reviewed_at)
    values ($1,'offline-model','EXP-033-postgame-v1',2000,'KC','DEN',28,17,$2,'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv','offline-model','{}','2001-01-01') returning *`;
  const historical = await db.query(reviewSql, ['scoped', '2000-09-10']);
  assert.ok(new Date(historical.rows[0].reviewed_at).getUTCFullYear() > 2020, 'Review time cannot be backdated.');
  assert.equal((await db.query(claim, ['scoped', 'offline-model', 'EXP-033-postgame-v1', token2])).rows[0].claimed, false);
  await assert.rejects(db.query(reviewSql, ['future-review', '2099-01-01']));
  await assert.rejects(db.exec('delete from public.nfl_postgame_reviews'));
  console.log('Postgame SQL: atomic leases, owner release, scoped secret RLS, immutable reviews and DB clock passed.');
  console.log('Database rules: capture clocks, pre-kickoff freeze, append-only writes, RLS and outcome deduplication passed.');
} finally {
  await db.close();
}
