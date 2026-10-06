// Optional Postgres-compatible check, using an isolated @electric-sql/pglite install.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.NFL_TEST_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const schema = await readFile(new URL('../database/learning-schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
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
  console.log('Database rules: capture clocks, pre-kickoff freeze, append-only writes, RLS and outcome deduplication passed.');
} finally {
  await db.close();
}
