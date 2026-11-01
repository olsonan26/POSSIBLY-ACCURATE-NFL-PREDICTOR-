# NFL database installation

The active replacement project is `sgvuwodzfbvqswlkuhvg`. No records in the old project were modified.

For a fresh project, run these scripts in order through an authenticated SQL editor or migration connection:

1. `prediction-ledger-schema.sql`
2. `learning-schema.sql`
3. `postgame-schema.sql`
4. `coach-analysis-schema.sql`
5. `research-ledger-schema.sql`
6. `game-results-schema.sql`
7. `evidence-permissions.sql`
8. `verify-evidence.sql` (transactional fixtures roll back)

This installation uses a server-only service-role/secret key. Public clients have no direct table access. Do not apply `learning-scoped-access.sql` to this configuration. The processing-lease table is intentionally mutable; prediction, result, learning, Coach and research evidence is append-only.

Configure `NFL_LEARNING_SUPABASE_URL` and `NFL_LEARNING_SUPABASE_KEY` in encrypted GitHub Actions secrets and server-only Vercel variables. Set Vercel's existing `NFL_LEDGER_SUPABASE_URL` and `NFL_LEDGER_SUPABASE_KEY` to the same project; existing ledger variables take precedence over the learning fallback. Redeploy after changing Vercel settings. Credentials never belong in this repository or browser-prefixed variables.

`bun run research:archive-results` saves every verified completed game from the schedule, including playoffs and older games without kickoff times. Repeat runs deduplicate identical source records. Corrected source records append a new version and preserve the earlier observation. The daily research worker and the authenticated daily API also archive newly completed results.

`bun run research:backfill --from=1999 --through=2026 --include-playoffs --local-state=research/state-backfill-all` reconstructs eligible historical model inputs. Use the current year for the upper bound. Very early games may lack the model's required prior history; missing kickoff times also block a forecast reconstruction. Their official results remain saved in the complete results archive. Never label these reconstructions as prospective evidence.

Import an existing local reconstruction library with `bun run research:import-history --local-state=research/state-backfill-all` to validate and preview it, then add `--apply` to persist it. Only canonical historical INPUTS records transfer. Local hypotheses, experiment results, synthetic fixtures and promotions never transfer. Repeating the import safely skips records already saved.

Scheduler/status reads omit large experiment input payloads. The research engine retrieves the exact immutable archives referenced by a manifest in bounded batches of three records and verifies their existing input hash before evaluation. Explicit historical-library reads remain separate. This allows interrupted large-history experiments to resume without pulling every archived experiment into a single response.

Automatic paid Coach generation additionally needs `OPENROUTER_API_KEY` and `NFL_RESEARCH_ACCESS_KEY` in the worker's secrets. Missing provider credentials produce an explicit blocked status while ordinary prediction capture continues. Existing budget, horizon, source-verification and immutable-capture guards still apply. Storing more games does not by itself prove improved accuracy or authorize promoting a challenger.
