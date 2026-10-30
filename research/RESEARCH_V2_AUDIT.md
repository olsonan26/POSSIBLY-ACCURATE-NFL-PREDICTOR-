# NFL V2.1 implementation audit

This audit supersedes the earlier V2 foundation's overly broad completion labels. The code gaps identified in the prompt review have been implemented. Empirical validation remains explicitly limited by available frozen data.

| Prompt-review gap | Implemented evidence |
|---|---|
| Forward discovery cohorts | Immutable season/week plans; model/horizon/mode isolation; explicit minimum samples and prospective future lockbox |
| Lost boolean/category values | Versioned boolean and fixed-vocabulary categorical encoder; unknown stays null |
| Generalized generation/manual intake | Validated executable contracts, source-specific origins, discovery-fitted feature/interaction or uncertainty mechanisms, shared scheduler |
| Walk-forward and unenforced attacks | Rolling chronological folds; calibration/bootstrap/null/neighbor/origin/season/side gates control survival |
| Ephemeral experiment memory | Applied append-only Supabase ledger; archived exact inputs and manifests; restart recovery; cumulative counters |
| Provenance and skipped leakage checks | Source/retrieval versus derived-cutoff metadata, live personnel feed flags/timestamps, early leakage/replay gate, future-outcome rejection |
| Fragility | Team/week/QB concentration, missingness confounding, market-aware peers, threshold checks and leave-one-season-out rediscovery |
| Incomplete scorecards | Per-horizon Coach scores, incremental paired control/favorite/underdog splits, overall Coach and actual dynamic challenger leaderboard |
| Missing disagreement participants | Available EPA/QB/matchup votes; PURE and Lettrology experimental disagreement |
| Promotion only documented | Real pre-kickoff challenger captures, exact-byte confirmation join, persisted SHADOW/PRODUCTION_CANDIDATE evidence; no automatic champion mutation |
| Upset comparisons | Explicit underdog-won versus favorite-won reports with frozen market or labeled control reference |
| Windows/horizons/dashboard | Recent current-state claim checks, season-based structural window, evidence-specific sensitivity, all-field paired horizon changes, live authenticated dashboard |
| Incomplete E2E | Synthetic discovery→queue→manifest→rolling evaluation→survival→freeze→confirmation, interruption/restart; live API/store/outage integration; positive SQL shadow and false-kickoff rejection |

## Real evidence

- Historical: 1,084 eligible 2022–25 regular-season games; 694 correct, 390 misses. No new validated data-driven failure subgroup. Discovery thresholds were not relaxed.
- Frozen export: 170 source rows become 85 first-per-model/game/horizon forecasts. 69 completed horizon forecasts are 45 correct/24 misses across 43 unique games. Separate horizons are not independent replications. Forward cohorts remain BLOCKED_DATA until their chronological minimum samples exist.
- Coach: one historical reconstruction, no verified directional excerpts, zero prospective reports. DeepSeek learning forecasts: zero. The real fully sourced Coach→disagreement→validated-mechanism example remains NOT YET DEMONSTRATED because those records do not exist.
- Snapshot coverage on the executed historical reconstruction: 136 named fields, 25 ever known. Named slots do not imply observed data. Unsupported player-level and revised historical sources remain identified rather than fabricated.
- Original 2025 control: 180/271 (66.42%), Brier 0.2250, log loss 0.6416. Audit confirms unchanged numerical production formula and validated football context.

## Deployment and verification

The research ledger install and source-kickoff guard migrations were applied to the existing Supabase project. RLS, scoped policies, immutable triggers and fixed function search paths were inspected. No new security advisory concerned the new research objects; unrelated existing project advisories were left outside this change.

The daily production grading endpoint now runs research without paid calls. New immutable predictions freeze eligible surviving challengers. The authenticated dashboard reads live data and labels an archived fallback explicitly. Native Node API imports, database invariants, existing research/learning/Coach regressions and production build are in the verification suite; CI also executes the new engine/live/schema acceptance.

See `RESEARCH_V2_CONTRACT.md` for exact mechanisms, ranges and limitations. Production-candidate eligibility remains separate from a change to the protected champion. Synthetic success demonstrates executable behavior, not predictive utility on real NFL games.
