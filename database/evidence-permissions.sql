-- Install after all evidence tables. Processing leases remain intentionally mutable.
begin;
do $$ declare tbl text; begin
 foreach tbl in array array['nfl_prediction_snapshots','nfl_prediction_outcomes','nfl_learning_forecasts','nfl_learning_outcomes','nfl_postgame_reviews','nfl_coach_reports','nfl_research_events','nfl_game_results'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tbl);
  execute format('grant select,insert on public.%I to service_role',tbl);
  execute format('drop trigger if exists nfl_evidence_no_truncate on public.%I',tbl);
  execute format('create trigger nfl_evidence_no_truncate before truncate on public.%I for each statement execute function public.nfl_prediction_append_only()',tbl);
 end loop;
end; $$;
commit;
