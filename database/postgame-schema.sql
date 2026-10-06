begin;
create table if not exists public.nfl_postgame_reviews (
  game_id text not null,
  research_model text not null,
  version text not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  season integer not null check (season >= 1999),
  home_team text not null,
  away_team text not null check (away_team <> home_team),
  home_score integer not null check (home_score between 0 and 200),
  away_score integer not null check (away_score between 0 and 200),
  kickoff_at timestamptz not null,
  outcome_source text not null check (outcome_source = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'),
  provider_model text not null,
  review jsonb not null check (jsonb_typeof(review) = 'object' and octet_length(review::text) < 96000),
  primary key (game_id, research_model, version),
  check (kickoff_at < reviewed_at)
);
create index if not exists nfl_postgame_season_idx on public.nfl_postgame_reviews (research_model, version, season);
create index if not exists nfl_postgame_memory_idx on public.nfl_postgame_reviews (research_model, version, reviewed_at desc);
create table if not exists public.nfl_postgame_claims (
  game_id text not null, research_model text not null, version text not null,
  claim_token uuid not null, lease_until timestamptz not null,
  primary key (game_id, research_model, version)
);
create or replace function public.nfl_postgame_review_clock()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  new.reviewed_at := clock_timestamp();
  if new.kickoff_at >= new.reviewed_at then raise exception 'Postgame review requires a past kickoff'; end if;
  return new;
end;
$$;
drop trigger if exists nfl_postgame_clock on public.nfl_postgame_reviews;
create trigger nfl_postgame_clock before insert on public.nfl_postgame_reviews for each row execute function public.nfl_postgame_review_clock();
drop trigger if exists nfl_postgame_immutable on public.nfl_postgame_reviews;
create trigger nfl_postgame_immutable before update or delete on public.nfl_postgame_reviews for each row execute function public.nfl_learning_append_only();
create or replace function public.nfl_claim_postgame(p_game text, p_model text, p_version text, p_token uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public as $$
declare affected integer;
begin
  if exists (select 1 from public.nfl_postgame_reviews where game_id=p_game and research_model=p_model and version=p_version) then return false; end if;
  insert into public.nfl_postgame_claims as c (game_id, research_model, version, claim_token, lease_until)
  values (p_game, p_model, p_version, p_token, clock_timestamp() + interval '3 minutes')
  on conflict (game_id, research_model, version) do update
    set claim_token=excluded.claim_token, lease_until=excluded.lease_until
    where c.lease_until < clock_timestamp();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
create or replace function public.nfl_release_postgame(p_game text, p_model text, p_version text, p_token uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  delete from public.nfl_postgame_claims where game_id=p_game and research_model=p_model and version=p_version and claim_token=p_token;
  return true;
end;
$$;
alter table public.nfl_postgame_reviews enable row level security;
alter table public.nfl_postgame_claims enable row level security;
revoke all on public.nfl_postgame_reviews, public.nfl_postgame_claims from public, anon, authenticated;
grant select, insert on public.nfl_postgame_reviews to service_role;
grant select, insert, update, delete on public.nfl_postgame_claims to service_role;
revoke execute on function public.nfl_postgame_review_clock(), public.nfl_claim_postgame(text,text,text,uuid), public.nfl_release_postgame(text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.nfl_postgame_review_clock(), public.nfl_claim_postgame(text,text,text,uuid), public.nfl_release_postgame(text,text,text,uuid) to service_role;
commit;
