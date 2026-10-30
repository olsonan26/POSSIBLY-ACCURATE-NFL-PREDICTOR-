# NFL research data engine

The Full Season backtest remains read-only: Pure Forecast, Market Shadow, same-game comparisons and weekly audit are preserved. Its separate **Historical research library** action previews or starts a season-range backfill, advances server-side batches and offers the existing autoresearch engine after completion.

## Storage and evidence

No new database schema is needed. The existing append-only `nfl_research_events` table stores canonical historical snapshots in INPUTS events keyed `LIBRARY:HISTORICAL_RECONSTRUCTION:<game>:<model>:<horizon>:<schema>`. Each payload embeds the existing UnifiedPregameSnapshot, verified outcome and reconstruction metadata. RUN events store job definitions, per-game first-wins results, scheduler status and cost reservations. Existing tables continue storing prospective forecasts, Coach reports and appended outcomes. JSON gains numeric `hoursToKickoff`; historical reconstruction correctly has negative actual hours because capture occurred after the event. This value is metadata, not a predictive feature.

Historical records are validated as after-event reconstructions with a verified completed game and cannot enter the prospective confirmation cohort. Repeating a season skips existing evidence; it never updates immutable features or adds independent forward observations. Ties are saved and remain excluded from directional accuracy. Missing or cancelled games with no final result are not invented. Postseason ingestion is optional; default existing research cohort ranges remain regular-season windows unless explicitly preregistered otherwise.

Reconstruction reuses the protected predictWinner path. Current personnel, historical Coach reports, timestamped historical market lines and forecast weather are not reconstructed. Prior-week team EPA/pass/rush, pressure/OL/explosive/turnover/special-teams proxies reuse the existing season/week parser, with target and future weeks excluded. New schedule rest and verified venue/surface fields are descriptive historical context. Unknown venues/retractable roof decisions stay blocked. Derived cutoffs are labeled as such; downloaded historical feeds may contain revisions and are not falsely described as archived provider bytes.

Season-level source promises are cached, including a ten-minute negative cache for unavailable feeds, to avoid repeatedly hammering a missing season. Actual per-season field/family coverage accompanies the aggregate coverage.

## Resumable backfill

```powershell
bun run research:backfill --season=2025 --dry-run
bun run research:backfill --season=2025
bun run research:backfill --from=2015 --through=2025 --include-playoffs
bun run research:backfill --from=2015 --through=2025 --resume --research
```

Default CLI state is the live database and requires the existing server-only NFL_LEARNING storage configuration. `--local-state=research/state-backfill` performs an explicitly local acceptance/replay run. `--output-dir=research/runtime/backfill` controls reports. `--job=<id>` resumes a specific saved job. Completed failures remain visible; starting a new job skips successful library records and retries missing ones. Job counts distinguish created, existing, blocked and failed. Before/after coverage persists in the job definition. Dry run performs reads and source checks without inserting job or snapshot evidence.

`api/research-backfill` is owner-key protected and accepts only server-verified game identifiers/ranges. The browser never receives provider, database or cron secrets. Server-side batches keep the normal UI responsive. The background worker resumes unfinished jobs when configured; an open panel can also advance batches and show progress.

## Scheduled future capture

The existing `.github/workflows/nfl-learning.yml` now runs `research:worker` every ten minutes at minute 7/17/27/37/47/57. Its concurrency group prevents overlapping GitHub workers. The existing daily Vercel learning-sync cron remains a limited fallback rather than a second frequent scheduler. GitHub scheduling is best-effort and can be delayed; missed windows are never backdated. Missing credentials fail the scheduled job explicitly as BLOCKED_CONFIGURATION.

Canonical first-wins capture windows are:

| Horizon | Actual hours before kickoff |
|---|---|
| T-72h | 60–84 |
| T-24h | 18–24 |
| T-3h | 1.5–3 |
| T-30m | 10–30 minutes |

These fit the existing horizon buckets. Source collection must finish before kickoff and within the same due horizon. Exact captured hours remain in snapshot metadata. The worker uses the existing production prediction, public market/weather/team-stat sources and existing prediction-ledger validation. New server secret keys use apikey headers rather than an invalid JWT bearer header. First immutable forecast per model/game/horizon wins, whether captured automatically or through the app.

At T-24h and T-3h the worker attempts the existing Coach Analyzer. Two new paid report attempts per run and sixteen first-wins daily cost slots bound spending. Cached, missing-provider and already-attempted reports do not starve later slate games. A failed paid attempt is recorded and is not automatically purchased again for the same horizon. Unavailable paid access yields BLOCKED_PROVIDER and never prevents the ordinary research forecast from freezing. Each report freezes ten sections, evidence/source/missing counts, direction and dated evidence. A generation crossing its horizon fails closed. Later reports never modify earlier reports or primary forecasts.

The worker appends official outcomes without changing pregame bytes. It performs outcome grading/learning sync/autoresearch once per UTC day, rather than after every single game or every scheduler tick. The daily protected Vercel route reports degraded health when a capture actually fails. Paid attempt counts are preserved even when later research fails; exact billed call counts are not fabricated.

## Dashboard and activation

Live reporting separates historical unique games/snapshots/seasons/coverage from prospective unique games/snapshots/completed observations. Horizon metrics and same-game comparisons are grouped by model; field deltas include raw QB identity and missing-to-known changes as well as numeric injury/weather/market/Coach/evidence/disagreement changes.

Required GitHub server secrets: NFL_LEARNING_SUPABASE_URL, NFL_LEARNING_SUPABASE_KEY and the relevant scoped secret if using publishable credentials. Prediction storage may use NFL_LEDGER_SUPABASE_URL/KEY; service-role/secret fallback to learning storage is supported. Scoped publishable prediction access additionally requires NFL_LEDGER_SECRET. Automatic paid Coach capture requires OPENROUTER_API_KEY and NFL_RESEARCH_ACCESS_KEY; otherwise captures continue with explicit blocked Coach status.

At implementation time the connected Supabase account no longer has access to the existing NFL project `vrgqwszxrlulkzaqhftw`; only unrelated projects are visible. Therefore live library population and live scheduler credentials cannot be verified from this session. No unrelated database was used as a substitute, and local acceptance is not called production ingestion. Reconnect the existing NFL account to complete that operational verification.

## Executed acceptance

Real local 2024–2025 ingestion: 544 games created, zero blocked/failed. Repeating 2025: 272 already existing, zero created. Modern 2015–2025: 2,895 unique historical games, 2,351 additional records plus 544 deduplicated; zero blocked/failed. Snapshot coverage: 138 named fields, 30 ever known. Adding older games increases sample breadth, not fabricated feature parity. Source availability is recorded by season.

The shared autoresearch engine ran on that library: 2,342 discovery rows, 272 validation rows, one known-rule form hypothesis tested with four parameters; decision INCONCLUSIVE, no survivor, no new validated discovered subgroup. The 2025 control is unchanged: 180/271 (66.42%), Brier 0.225048. No historical run adds a prospective observation or establishes promotion evidence.

Synthetic/API acceptance exercises four immutable horizons at 70/23/2.5 hours and 25 minutes, duplicate skipping, restart recovery, strict evidence classes, source-week exclusion, frozen Coach section scoring, provider outage isolation, later-slate budget fairness and appended/deduplicated outcome grading. Native Node loads the new API path. Run `bun run research:test:data`, `bun run research:verify`, and `bun run research:audit`.
