-- Additive migration. Existing forecasts, reports, outcomes and control records are preserved.
begin;
create table if not exists public.nfl_research_events (
 event_id text primary key check(event_id ~ '^[0-9a-f]{64}$'),
 event_kind text not null check(event_kind in ('COHORT','SEARCH','INPUTS','MANIFEST','RESULT','SHADOW_FORECAST','PROMOTION','RUN')),
 event_key text not null check(length(event_key) between 1 and 2048),
 payload jsonb not null check(jsonb_typeof(payload) in ('object','array') and octet_length(payload::text)<=8388608),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(event_kind,event_key)
);
create or replace function public.nfl_research_capture_clock()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 new.recorded_at:=clock_timestamp();
 if new.event_kind='SHADOW_FORECAST' then
   if (new.payload->>'kickoffAt')::timestamptz<=new.recorded_at then raise exception 'Shadow finished after kickoff'; end if;
   if not exists(select 1 from public.nfl_research_events where event_kind='MANIFEST' and event_key=new.payload->>'experimentId')
     or not exists(select 1 from public.nfl_research_events where event_kind='RESULT' and event_key=new.payload->>'experimentId' and payload->>'decision'='SURVIVED_RESEARCH')
     then raise exception 'Shadow requires registered surviving experiment'; end if;
   if not exists(select 1 from public.nfl_prediction_snapshots where id::text=new.payload->>'snapshotId'
     and game_id=new.payload->>'gameId' and model_version=new.payload->>'modelVersion' and captured_at<kickoff_at and kickoff_at=(new.payload->>'kickoffAt')::timestamptz and new.recorded_at<kickoff_at)
     then raise exception 'Shadow requires an existing immutable source forecast'; end if;
   new.payload:=jsonb_set(new.payload,'{capturedAt}',to_jsonb(new.recorded_at));
 end if;
 return new;
end; $$;
create or replace function public.nfl_research_append_only()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin raise exception 'Research events are append-only'; end; $$;
drop trigger if exists nfl_research_clock on public.nfl_research_events;
create trigger nfl_research_clock before insert on public.nfl_research_events for each row execute function public.nfl_research_capture_clock();
drop trigger if exists nfl_research_immutable on public.nfl_research_events;
create trigger nfl_research_immutable before update or delete on public.nfl_research_events for each row execute function public.nfl_research_append_only();
drop trigger if exists nfl_research_no_truncate on public.nfl_research_events;
create trigger nfl_research_no_truncate before truncate on public.nfl_research_events for each statement execute function public.nfl_research_append_only();
alter table public.nfl_research_events enable row level security;
revoke all on public.nfl_research_events from public,anon,authenticated;
grant select,insert on public.nfl_research_events to service_role;
revoke execute on function public.nfl_research_capture_clock(),public.nfl_research_append_only() from public,anon,authenticated;
grant execute on function public.nfl_research_capture_clock(),public.nfl_research_append_only() to service_role;
do $$ begin
 if to_regprocedure('public.nfl_learning_server_request_allowed()') is not null then
   grant select,insert on public.nfl_research_events to anon;
   grant execute on function public.nfl_research_capture_clock(),public.nfl_research_append_only() to anon;
   drop policy if exists nfl_research_read on public.nfl_research_events;
   create policy nfl_research_read on public.nfl_research_events for select to anon using(public.nfl_learning_server_request_allowed());
   drop policy if exists nfl_research_insert on public.nfl_research_events;
   create policy nfl_research_insert on public.nfl_research_events for insert to anon with check(public.nfl_learning_server_request_allowed());
 end if;
end; $$;
commit;
