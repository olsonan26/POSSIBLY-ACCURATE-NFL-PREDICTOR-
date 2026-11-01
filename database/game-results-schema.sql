-- Official results are postgame evidence, never prospective forecasts.
begin;
create table if not exists public.nfl_game_results (
 result_key text primary key check(result_key ~ '^[0-9a-f]{64}$'),
 game_id text not null, season integer not null check(season>=1999),
 game_date date not null, observed_at timestamptz not null default clock_timestamp(),
 source text not null check(source='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<16000),
 constraint nfl_game_results_verified_payload check((
  payload->>'gameId'=game_id and (payload->>'season')::integer=season and
  payload->>'gameday'=game_date::text and payload->>'completed'='true' and
  length(payload->>'homeTeam')>0 and length(payload->>'awayTeam')>0 and payload->>'homeTeam'<>payload->>'awayTeam' and
  jsonb_typeof(payload->'homeScore')='number' and jsonb_typeof(payload->'awayScore')='number' and
  (payload->>'homeScore')::integer between 0 and 200 and (payload->>'awayScore')::integer between 0 and 200
 ) is true)
);
create index if not exists nfl_game_results_game_idx on public.nfl_game_results(game_id,observed_at desc);
create or replace function public.nfl_game_result_clock()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 new.observed_at:=clock_timestamp();
 if new.game_date>new.observed_at::date then raise exception 'Result game date is in the future'; end if;
 return new;
end; $$;
drop trigger if exists nfl_game_result_clock on public.nfl_game_results;
create trigger nfl_game_result_clock before insert on public.nfl_game_results for each row execute function public.nfl_game_result_clock();
drop trigger if exists nfl_game_result_immutable on public.nfl_game_results;
create trigger nfl_game_result_immutable before update or delete on public.nfl_game_results for each row execute function public.nfl_prediction_append_only();
drop trigger if exists nfl_game_result_no_truncate on public.nfl_game_results;
create trigger nfl_game_result_no_truncate before truncate on public.nfl_game_results for each statement execute function public.nfl_prediction_append_only();
alter table public.nfl_game_results enable row level security;
revoke all on public.nfl_game_results from public,anon,authenticated,service_role;
grant select,insert on public.nfl_game_results to service_role;
revoke execute on function public.nfl_game_result_clock() from public,anon,authenticated;
grant execute on function public.nfl_game_result_clock() to service_role;
commit;
