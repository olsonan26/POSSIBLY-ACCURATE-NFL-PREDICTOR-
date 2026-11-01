-- Fresh-project prediction storage. Install before research-ledger-schema.sql.
begin;
create table if not exists public.nfl_prediction_snapshots (
 id uuid primary key default gen_random_uuid(), capture_token text not null unique,
 run_id text not null, game_id text not null, season integer not null check(season>=1999),
 week integer not null check(week between 1 and 25), game_date date not null,
 captured_at timestamptz not null default clock_timestamp(), kickoff_at timestamptz not null,
 home_team text not null, away_team text not null check(away_team<>home_team), neutral_site boolean not null default false,
 model_version text not null, predicted_winner text not null,
 home_win_probability double precision not null check(home_win_probability>0 and home_win_probability<1),
 away_win_probability double precision not null check(away_win_probability>0 and away_win_probability<1),
 market_home_probability double precision, market_blended_home_probability double precision,
 market_winner text, market_snapshot_at timestamptz, market_source text,
 feature_snapshot jsonb not null, source_metadata jsonb not null,
 git_sha text, payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 check(captured_at<kickoff_at), check(predicted_winner in(home_team,away_team)),
 check(abs(home_win_probability+away_win_probability-1)<0.000001),
 check(jsonb_typeof(feature_snapshot)='object' and octet_length(feature_snapshot::text)<=96000),
 check(jsonb_typeof(source_metadata)='object')
);
create index if not exists nfl_predictions_game_idx on public.nfl_prediction_snapshots(game_id);
create index if not exists nfl_predictions_capture_idx on public.nfl_prediction_snapshots(captured_at,id);
create table if not exists public.nfl_prediction_outcomes (
 id uuid primary key default gen_random_uuid(), outcome_key text not null unique, game_id text not null,
 season integer not null check(season>=1999), week integer not null, game_date date not null,
 home_team text not null, away_team text not null check(away_team<>home_team),
 home_score integer not null check(home_score between 0 and 200), away_score integer not null check(away_score between 0 and 200),
 actual_winner text not null, source text not null, source_metadata jsonb not null,
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 check(actual_winner=case when home_score=away_score then 'TIE' when home_score>away_score then home_team else away_team end)
);
create index if not exists nfl_outcomes_game_idx on public.nfl_prediction_outcomes(game_id);
create or replace function public.nfl_prediction_clock()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if tg_table_name='nfl_prediction_snapshots' then
  new.captured_at:=clock_timestamp();
  if new.kickoff_at<=new.captured_at then raise exception 'Prediction must be captured before kickoff'; end if;
 else
  new.recorded_at:=clock_timestamp();
  if not exists(select 1 from public.nfl_prediction_snapshots s where s.game_id=new.game_id and s.kickoff_at<new.recorded_at)
   then raise exception 'Outcome requires a frozen forecast and past kickoff'; end if;
 end if;
 return new;
end; $$;
create or replace function public.nfl_prediction_append_only()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin raise exception 'Prediction evidence is append-only'; end; $$;
do $$ declare tbl text; begin
 foreach tbl in array array['nfl_prediction_snapshots','nfl_prediction_outcomes'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tbl);
  execute format('grant select,insert on public.%I to service_role',tbl);
  execute format('drop trigger if exists nfl_prediction_freeze on public.%I',tbl);
  execute format('create trigger nfl_prediction_freeze before insert on public.%I for each row execute function public.nfl_prediction_clock()',tbl);
  execute format('drop trigger if exists nfl_prediction_immutable on public.%I',tbl);
  execute format('create trigger nfl_prediction_immutable before update or delete on public.%I for each row execute function public.nfl_prediction_append_only()',tbl);
  execute format('drop trigger if exists nfl_prediction_no_truncate on public.%I',tbl);
  execute format('create trigger nfl_prediction_no_truncate before truncate on public.%I for each statement execute function public.nfl_prediction_append_only()',tbl);
 end loop;
end; $$;
revoke execute on function public.nfl_prediction_clock(),public.nfl_prediction_append_only() from public,anon,authenticated;
grant execute on function public.nfl_prediction_clock(),public.nfl_prediction_append_only() to service_role;
commit;
