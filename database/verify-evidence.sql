-- Run after installing all schemas. All fixture writes are rolled back.
begin;
set local role service_role;
do $$ declare captured timestamptz;blocked boolean;begin
 insert into public.nfl_prediction_snapshots(capture_token,run_id,game_id,season,week,game_date,captured_at,kickoff_at,home_team,away_team,model_version,predicted_winner,home_win_probability,away_win_probability,feature_snapshot,source_metadata,payload_sha256)
 values('migration-verification-'||gen_random_uuid(),'migration-verification','migration-verification',2026,1,current_date,'2000-01-01',clock_timestamp()+interval '1 hour','BUF','TEN','migration-fixture','BUF',0.6,0.4,'{}','{}',repeat('a',64)) returning captured_at into captured;
 if captured<clock_timestamp()-interval '1 minute' then raise exception 'Server capture clock did not override backdated input';end if;
 blocked:=false;
 begin update public.nfl_prediction_snapshots set model_version='tampered' where game_id='migration-verification';exception when others then blocked:=true;end;
 if not blocked then raise exception 'Stored predictions allowed mutation';end if;
 blocked:=false;
 begin
  insert into public.nfl_prediction_snapshots(capture_token,run_id,game_id,season,week,game_date,kickoff_at,home_team,away_team,model_version,predicted_winner,home_win_probability,away_win_probability,feature_snapshot,source_metadata,payload_sha256)
  values('late-'||gen_random_uuid(),'migration-verification','migration-verification',2026,1,current_date,clock_timestamp()-interval '1 hour','BUF','TEN','migration-fixture','BUF',0.6,0.4,'{}','{}',repeat('b',64));
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'Late prediction was accepted';end if;
 blocked:=false;
 begin
  insert into public.nfl_game_results(result_key,game_id,season,game_date,source,payload)
  values(repeat('c',64),'migration-verification',2026,current_date,'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv','{}');
 exception when check_violation then blocked:=true;end;
 if not blocked then raise exception 'Incomplete result payload was accepted';end if;
end; $$;
rollback;
select c.relname as evidence_table,c.relrowsecurity as rls_enabled,
 has_table_privilege('anon',c.oid,'SELECT') as public_read,
 has_table_privilege('anon',c.oid,'INSERT') as public_write,
 has_table_privilege('service_role',c.oid,'SELECT') as server_read,
 has_table_privilege('service_role',c.oid,'INSERT') as server_append,
 has_table_privilege('service_role',c.oid,'UPDATE') as server_mutate,
 has_table_privilege('service_role',c.oid,'TRUNCATE') as server_truncate
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'nfl_%' and c.relname<>'nfl_postgame_claims'
order by c.relname;
