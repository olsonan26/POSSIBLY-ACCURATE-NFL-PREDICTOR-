-- Apply after learning-schema.sql, postgame-schema.sql and scoped access (if used).
begin;
create table if not exists public.nfl_coach_reports (
  report_key text primary key, game_id text not null, version text not null, research_model text not null,
  captured_at timestamptz not null default clock_timestamp(), kickoff_at timestamptz not null,
  cutoff_at timestamptz not null, mode text not null check(mode in ('pregame','historical-reconstruction')),
  report jsonb not null check(jsonb_typeof(report)='object' and octet_length(report::text)<96000),
  check(cutoff_at < kickoff_at)
);
create or replace function public.nfl_coach_capture_clock()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  new.captured_at := clock_timestamp();
  if new.cutoff_at > new.captured_at then raise exception 'Future evidence cutoff'; end if;
  if new.mode='pregame' and new.captured_at >= new.kickoff_at then
    new.report := jsonb_set(new.report,'{capture}','"Finished after kickoff; not a prospective forecast"'::jsonb);
  end if;
  return new;
end;
$$;
drop trigger if exists nfl_coach_clock on public.nfl_coach_reports;
create trigger nfl_coach_clock before insert on public.nfl_coach_reports for each row execute function public.nfl_coach_capture_clock();
drop trigger if exists nfl_coach_immutable on public.nfl_coach_reports;
create trigger nfl_coach_immutable before update or delete on public.nfl_coach_reports for each row execute function public.nfl_learning_append_only();
alter table public.nfl_coach_reports enable row level security;
revoke all on public.nfl_coach_reports from public,anon,authenticated;
grant select,insert on public.nfl_coach_reports to service_role;
revoke execute on function public.nfl_coach_capture_clock() from public,anon,authenticated;
grant execute on function public.nfl_coach_capture_clock() to service_role;
create or replace function public.nfl_claim_coach(p_game text,p_model text,p_version text,p_token uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare affected integer;
begin
  if exists(select 1 from public.nfl_coach_reports where report_key=p_game) then return false; end if;
  insert into public.nfl_postgame_claims as c(game_id,research_model,version,claim_token,lease_until)
  values(p_game,p_model,p_version,p_token,clock_timestamp()+interval '10 minutes')
  on conflict(game_id,research_model,version) do update set claim_token=excluded.claim_token,lease_until=excluded.lease_until where c.lease_until<clock_timestamp();
  get diagnostics affected=row_count;
  return affected=1;
end; $$;
create or replace function public.nfl_release_coach(p_game text,p_model text,p_version text,p_token uuid)
returns boolean language sql security invoker set search_path=pg_catalog,public as $$
  select public.nfl_release_postgame(p_game,p_model,p_version,p_token);
$$;
revoke execute on function public.nfl_claim_coach(text,text,text,uuid),public.nfl_release_coach(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.nfl_claim_coach(text,text,text,uuid),public.nfl_release_coach(text,text,text,uuid) to service_role;
do $$ begin
  if to_regprocedure('public.nfl_learning_server_request_allowed()') is not null then
    grant execute on function public.nfl_claim_coach(text,text,text,uuid),public.nfl_release_coach(text,text,text,uuid) to anon;
    grant select,insert on public.nfl_coach_reports to anon;
    grant execute on function public.nfl_coach_capture_clock() to anon;
    drop policy if exists nfl_coach_server_access on public.nfl_coach_reports;
    create policy nfl_coach_server_access on public.nfl_coach_reports for all to anon
      using(public.nfl_learning_server_request_allowed()) with check(public.nfl_learning_server_request_allowed());
  end if;
end; $$;
commit;
