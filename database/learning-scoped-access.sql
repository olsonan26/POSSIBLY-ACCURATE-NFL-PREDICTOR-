-- Optional deployment adapter for a publishable API key plus a private server secret.
-- Replace the placeholder with SHA-256(secret), never the secret itself.
-- Use this instead of granting the application a project-wide service-role key.
begin;
create or replace function public.nfl_learning_server_request_allowed()
returns boolean language sql stable security invoker set search_path = pg_catalog, public as $$
  select encode(sha256(convert_to(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-learning-secret', ''), 'UTF8')), 'hex') = '__LEARNING_SECRET_SHA256__';
$$;
revoke all on function public.nfl_learning_server_request_allowed() from public, authenticated;
grant execute on function public.nfl_learning_server_request_allowed() to anon, service_role;
do $$
declare t text;
begin
  foreach t in array array['nfl_learning_forecasts','nfl_learning_outcomes','nfl_postgame_reviews','nfl_postgame_claims'] loop
    execute format('grant select, insert on public.%I to anon', t);
    execute format('drop policy if exists nfl_learning_server_access on public.%I', t);
    execute format('create policy nfl_learning_server_access on public.%I for all to anon using (public.nfl_learning_server_request_allowed()) with check (public.nfl_learning_server_request_allowed())', t);
  end loop;
end;
$$;
grant update, delete on public.nfl_postgame_claims to anon;
grant execute on function public.nfl_learning_append_only(), public.nfl_learning_capture_clock(), public.nfl_learning_outcome_clock(), public.nfl_postgame_review_clock(), public.nfl_claim_postgame(text,text,text,uuid), public.nfl_release_postgame(text,text,text,uuid) to anon;
commit;
