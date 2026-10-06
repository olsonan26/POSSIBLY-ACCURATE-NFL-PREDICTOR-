-- Run once in the same Supabase project used by NFL_LEARNING_SUPABASE_URL.
-- This is independent of the existing prediction ledger. No public write policy.
begin;

create table if not exists public.nfl_learning_forecasts (
  game_id text primary key,
  experiment_version text not null,
  research_model text not null,
  captured_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz not null,
  kickoff_at timestamptz not null,
  home_team text not null,
  away_team text not null check (away_team <> home_team),
  base_home_probability double precision not null check (base_home_probability > 0 and base_home_probability < 1),
  raw_home_probability double precision not null check (raw_home_probability > 0 and raw_home_probability < 1),
  learned_home_probability double precision not null check (learned_home_probability > 0 and learned_home_probability < 1),
  facts jsonb not null check (jsonb_typeof(facts) = 'array' and jsonb_array_length(facts) <= 30),
  feedback jsonb not null check (jsonb_typeof(feedback) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  check (completed_at <= captured_at and captured_at < kickoff_at),
  check (octet_length(facts::text) <= 96000)
);

create table if not exists public.nfl_learning_outcomes (
  game_id text primary key references public.nfl_learning_forecasts(game_id),
  observed_at timestamptz not null default clock_timestamp(),
  home_score integer not null check (home_score >= 0 and home_score <= 200),
  away_score integer not null check (away_score >= 0 and away_score <= 200),
  source text not null check (source = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv')
);

create index if not exists nfl_learning_model_version_idx
  on public.nfl_learning_forecasts (experiment_version, research_model);

create or replace function public.nfl_learning_append_only()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  raise exception 'NFL learning records are append-only';
end;
$$;

create or replace function public.nfl_learning_capture_clock()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  -- The DB clock is authoritative even when a caller supplies a timestamp.
  new.captured_at := clock_timestamp();
  if new.completed_at > new.captured_at or new.captured_at >= new.kickoff_at then
    raise exception 'Only completed pre-kickoff research may be frozen';
  end if;
  return new;
end;
$$;

create or replace function public.nfl_learning_outcome_clock()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  new.observed_at := clock_timestamp();
  if not exists (select 1 from public.nfl_learning_forecasts f
      where f.game_id = new.game_id and f.kickoff_at < new.observed_at) then
    raise exception 'Outcomes require a frozen game whose kickoff has passed';
  end if;
  return new;
end;
$$;

drop trigger if exists nfl_learning_freeze on public.nfl_learning_forecasts;
create trigger nfl_learning_freeze before insert on public.nfl_learning_forecasts
  for each row execute function public.nfl_learning_capture_clock();
drop trigger if exists nfl_learning_score_clock on public.nfl_learning_outcomes;
create trigger nfl_learning_score_clock before insert on public.nfl_learning_outcomes
  for each row execute function public.nfl_learning_outcome_clock();
drop trigger if exists nfl_learning_immutable_forecasts on public.nfl_learning_forecasts;
create trigger nfl_learning_immutable_forecasts before update or delete on public.nfl_learning_forecasts
  for each row execute function public.nfl_learning_append_only();
drop trigger if exists nfl_learning_immutable_outcomes on public.nfl_learning_outcomes;
create trigger nfl_learning_immutable_outcomes before update or delete on public.nfl_learning_outcomes
  for each row execute function public.nfl_learning_append_only();

alter table public.nfl_learning_forecasts enable row level security;
alter table public.nfl_learning_outcomes enable row level security;
revoke all on public.nfl_learning_forecasts, public.nfl_learning_outcomes from public, anon, authenticated;
revoke all on public.nfl_learning_forecasts, public.nfl_learning_outcomes from service_role;
grant select, insert on public.nfl_learning_forecasts, public.nfl_learning_outcomes to service_role;
revoke execute on function public.nfl_learning_append_only(), public.nfl_learning_capture_clock(), public.nfl_learning_outcome_clock() from public, anon, authenticated;
grant execute on function public.nfl_learning_append_only(), public.nfl_learning_capture_clock(), public.nfl_learning_outcome_clock() to service_role;

commit;
