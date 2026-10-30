# NFL Autoresearch V2.1 contract

The numerical production model remains `v2.2-validated-current-season`. Research survival and production-candidate eligibility never edit that model or its weights. The original model formula and validated football context are checked against commit `33d1d72b77ef9c51866ba3cd28cb398c9bbea57d`.

## Frozen representation and evidence

`services/researchSnapshot.ts` captures model/game/horizon identity, five active control contributions, the separate rest/shadow contribution, available Analyzer signals, ten Coach sections, Coach summary, experimental signals, market, disagreement and data quality. Known booleans become 1/0. Fixed categorical vocabularies use one-hot encoding; missing and unrecognized values stay null. IDs and timestamps are not numeric discovery features.

Features identify their source, capture clock, observation/cutoff clock, version and production inclusion. `timestampKind` distinguishes an upstream/retrieval observation from a derived cutoff. A historical cutoff does not prove that a mutable downloaded historical feed existed byte-for-byte at that time. Season-to-date statistics exclude target/future weeks but remain labeled team proxies with possible historical revisions.

Live personnel now retains retrieval timestamps, depth availability and injury-feed availability. Failed injury retrieval cannot become a known zero-injury count. Unverified old personnel remains blocked. Pregame QB identities are context for concentration checks, never split features. Weather retains its own capture and actual venue/hour provenance. No archived reanalysis is presented as a prospectively frozen forecast.

Captures use separate T-72h, T-24h, T-3h and T-30m identities. Server and database clocks reject late/backdated captures. First per game/model/horizon wins. Later Coach/learning reports cannot alter earlier forecasts. Available prior-week team EPA, pressure, OL, explosive, turnover and special-teams proxies are connected at server capture. Unsupported player-level QB/OL/pressure ratings remain blocked.

## Chronological populations

`research-cohorts.ts` registers immutable cohort plans. Model versions, horizons and evidence modes are isolated. Default historical development is 2022–23 DISCOVERY, 2024 VALIDATION and 2025 LEGACY_TEST. All are previously used data; 2025 is never called a fresh lockbox.

For each prospective season, weeks 1–8 are DISCOVERY, weeks 9–12 VALIDATION, and weeks 13–18 plus the following season are FUTURE_LOCKBOX. Minimum discovery/validation/confirmation sample sizes are 80/40/50. Historical survivors have separately declared 2026–27 prospective confirmation ranges. Only actual challenger forecasts captured after registration and before kickoff count as confirmation. The orchestrator excludes future outcomes even on its insufficient-data path.

Explicit plans can be supplied with `--cohorts=...`; registering a different plan creates a new tracked search, not a silent change to an existing experiment. Lockbox outcomes never fit scales, thresholds, parameters or ranking. A late-starting plan cannot backfill confirmation forecasts.

## Discovery and hypotheses

Seven known rules are preserved. Residual discovery separately searches conjunctions of up to three conditions with discovery-only thresholds, bounded beam/search budgets and minimum leaf N=30. Comparable populations match selected side, market favorite where available, confidence, Elo and season phase. Gates enforce effect size, independent validation, team/week/QB concentration, missingness confounding, temporal folds and nearby thresholds. Cross-season candidates must also be rediscovered with each discovery season held out. A single-season forward finding is POSSIBLE, not cross-season STABLE.

Discovery corrects for current and prior search breadth. Equivalent memberships are deduplicated; more than 85% Jaccard overlap with a known rule does not count as a novel subgroup. Unknown QB context blocks the engine's dependency-sensitive acceptance rather than asserting independence.

`research-hypotheses.ts` validates executable contracts: source cluster/model, origin, mechanism, features, comparison population, direction, bounded grid, minimum N, leakage/duplication/missing-data risks, complexity and falsification condition. Automatic football/Coach findings generate additive features or interactions with discovery-fitted scales. Quality/disagreement findings generate uncertainty gates. The existing bounded action dispatcher remains available for explicit manual hypotheses.

Manual/generated hypotheses enter the same scheduler. Existing prose briefs remain visible as BLOCKED_CONTRACT or TESTED; they are not arbitrarily converted to executable algorithms. Adding an executable manual hypothesis requires a complete research specification, not user intervention in normal automated cycles.

## Durable experiments and evaluation

`nfl_research_events` stores append-only COHORT, SEARCH, INPUTS, MANIFEST, RESULT, SHADOW_FORECAST, PROMOTION and RUN events. The additive migration was applied to the connected database. RLS uses the existing server scope; service-role access is supported. Updates, deletes and truncation are rejected. Database clocks replace caller clocks. Shadow insertion requires a registered survivor and an immutable source forecast with the same game, model and kickoff that is still in the future.

Every experiment archives encoded input batches, exact eligible IDs, hashes, subgroup conditions/scales, code/encoding versions, ranges, metrics, success/failure gates and search counts before evaluation. Interrupted runs resume from that manifest and archive. First-wins keys prevent duplicate results. File state supports offline replay but is explicitly non-durable and cannot confer production eligibility.

Validation uses rolling weekly folds trained only on earlier dates. The chosen parameter then receives global/origin comparisons, accuracy/Brier/log-loss/ECE gates, paired results, week-block bootstrap, stratified shuffled-adjustment null tests, neighboring parameters, season and selected-side robustness, and control-restoring ablation. A displayed statistic is not enough: survival requires every explicit gate. 2025 comparisons remain legacy evidence.

Survivors become SHADOW_CANDIDATE. New primary forecasts trigger actual frozen challenger forecasts. Confirmation joins those saved bytes and verifies reproducibility. PRODUCTION_CANDIDATE requires durable state, sufficient prospective sample, all evaluation gates, reliable feature availability, exact frozen predictions and a search-breadth-adjusted null test. This status does not activate a model. No LLM has promotion authority.

## Coach and reports

Ten sections remain qualitative home/away/even/unknown signals. No section is assigned an invented probability. Scorecards separate evidence mode and horizon and report coverage, directional accuracy, control disagreement, incremental paired comparison, favorite/underdog and season results. The overall independently sourced Coach direction and dynamic frozen challengers appear on the shadow leaderboard with same-population control comparisons.

Evidence excerpts are classified into current-state or structural windows. Current injury, starter and replacement claims require the recent 30-day window even outside the availability section. Structural windows follow the actual season opening. Sensitivity conditions cite actual evidence and player/role dependencies, without invented numerical pick-flip thresholds.

Disagreement includes available EPA, QB, matchup, Coach, market, PURE, Lettrology and DeepSeek signals. Correlated signals are not independent votes. Upset reports compare underdog wins with favorite wins using explicit market/control references. Paired horizon reports show all known field changes and before/after control outcomes, including QB, injury, weather, evidence and market changes when captured.

The authenticated dashboard reads live stored evidence, the latest run, queue, counts, scorecards, leaderboard, quality, redundancy, upsets and horizon changes. A storage outage returns a clearly labeled dated archive. Daily outcome grading invokes research without paid model calls; immutable prediction capture invokes surviving challenger capture. The optional GitHub worker also runs the live engine when its server environment is configured.

## Verification and data limits

Run `bun run research:verify`, `bun run research:test:engine`, `bun run research:audit`, `bun run research:cycle`, and the existing weather/EPA chronology checks. The default historical cycle and frozen export ingestion share the same engine. `--live` uses the durable database. Runtime state, exports and credentials are not committed.

Real historical acceptance found no new validated failure subgroup across 1,084 eligible games. The frozen export contains 85 first-per-model/game/horizon forecasts, 69 completed horizon forecasts across 43 unique games; the chronological forward sample is insufficient. There are zero prospective Coach reports and zero DeepSeek learning forecasts in the inspected export. No winning new real mechanism, Coach utility or production improvement can be claimed from these data. Synthetic fixtures prove the complete executable path, including survival, future frozen confirmation and restart recovery; they are never presented as real games.
