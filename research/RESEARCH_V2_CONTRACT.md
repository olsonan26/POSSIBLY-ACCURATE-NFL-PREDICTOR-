# Analyzer and autoresearch contract

The production champion remains `v2.2-validated-current-season`. The numerical control formula and `validatedFootballContext.ts` are unchanged from main `33d1d72b77ef9c51866ba3cd28cb398c9bbea57d`. New features have zero production weight. The 2025 replay remains 180/271 (66.42%), Brier 0.2250, log loss 0.6416.

## One pregame representation

`services/researchSnapshot.ts` builds a deeply frozen, namespaced representation with game/model identity, capture horizon, evidence mode, cutoff, capture and kickoff timestamps. Every field has a value, availability status, source, observation/capture time, feature version and production-use flag. Null is never imputed to neutral. The five control logit contributions remain distinguishable from derived control probability/Elo fields and research-only rest.

The snapshot captures available Analyzer efficiency, weather, travel, HFA, divisional, prior, pace, special-teams and turnover values. Live personnel coverage is captured only prospectively. PURE and provisional Lettrology directions remain qualitative research. The original immutable JSON ledgers carry the expanded snapshot, including signals excluded from scoring. No new database schema is needed.

The server validates the capture against the verified schedule and its receipt clock, chooses a deterministic `(game, model, horizon)` capture token, and uses existing append-only storage. Repeated calls within a horizon return the first record. Earlier horizons cannot be overwritten. The DB capture clock remains authoritative: import rejects a snapshot whose stored horizon disagrees with the DB clock. A transaction finishing across a horizon boundary is rejected by research ingestion instead of being silently relabeled.

The existing Coach endpoint saves ten section directions, evidence/source/missing counts and version within its immutable report JSON. It also saves its canonical research representation. Forecast capture reads the latest eligible stored Coach report that existed before the forecast cutoff. Reports arriving later cannot change an earlier forecast. DeepSeek learning captures save their canonical representation in the existing immutable feedback JSON; there were zero stored learning forecasts at this audit.

## Honest historical evidence

Historical replay records use the actual reconstruction timestamp and `HISTORICAL_RECONSTRUCTION`, rather than fabricated pregame capture times. Their observation cutoff describes the information restriction, not proof that today's downloaded feed existed byte-for-byte at that time. Revised historical feeds and historical LLM memory remain limitations. Existing immutable source records are preserved.

The 2022–2023 seasons are DISCOVERY; 2024 is VALIDATION; 2025 is LEGACY_TEST. All have previously influenced research. None is a fresh future lockbox. New, genuinely frozen forecasts are FORWARD_SHADOW. This change cannot retroactively create a pristine confirmation season.

## Failure matrix and discovery

The cycle writes all eligible rows, separate misses, and correct comparison populations. The unified numeric fields extend the six legacy logit inputs. Additional season-to-date team-stat proxies include pass EPA per dropback, rush EPA per carry, sacks allowed, sacks/QB hits generated, explosive gains, giveaways and net punting. They are explicitly team proxies, not invented player-level QB ratings or charted pressure rates. Missing source fields and Week 1 samples are blocked.

All seven original known failure rules are retained. Separately, bounded subgroup search learns interpretable conjunctions from discovery data. Defaults: depth at most 3, beam width 12, minimum leaf 30, maximum 1,500 examined candidates, discovery-only quartile thresholds and at least 60% feature availability. IDs, outcomes, final scores, seasons and weeks are forbidden splits.

Candidates must survive independent chronological validation, matched confidence/picked-side/Elo/season-phase comparisons, cross-season discovery folds, at least 12 teams, maximum 30% single-team concentration, and ±5% threshold perturbations. Discovery and validation both apply conservative search-breadth adjustments. Defaults require discovery lift ≥10 points, validation lift ≥8 points and matched coverage ≥80%. Noise does not generate a hypothesis. Membership duplicates among discovered subgroups are collapsed; the cycle rejects >85% Jaccard overlap with a surviving known-rule population. Correlation must still be inspected before interpreting a mechanism as novel.

The historical search budget and every rejected finalist are written to `research/runtime/residual-discovery.json`. A null result is valid; the engine does not lower thresholds to manufacture a result.

## Hypotheses, experiments and promotion

Known-rule mechanisms remain runnable. Generalized action families support feature addition, interaction, damping/boosting, replacement, subgroup calibration, uncertainty gates, disagreement and research-only actions. Additive actions require preregistered discovery-only scales and bounded coefficients. Missing inputs leave the control probability unchanged. The initial automatic residual challenger compresses confidence only inside its discovered subgroup; it does not flip winners.

Hypotheses reference their source cluster/model, mechanism, features, comparison population, risks, parameter grid and falsification condition. Ranking uses validation effect, sample, breadth, stability and complexity. The original manual research briefs are preserved alongside automatic queue entries. Briefs without a complete executable hypothesis contract are not silently converted into experiments.

An exclusive manifest must exist before parameter evaluation. Each experiment has its own manifest/result directory and persistent ledger entry. The cycle selects one experiment, evaluates the 2024 grid, then performs the 2025 legacy comparison, origin-cluster comparison, paired counts/McNemar, neutral ablation, parameter neighbors, season/side reports, week-block bootstrap and confidence/side-stratified null challenge. Search breadth accompanies the result. Historical survival cannot establish a causal mechanism or production eligibility.

The path remains DISCOVERED → VALIDATED → SURVIVED_RESEARCH → SHADOW_CANDIDATE → frozen prospective evaluation → PRODUCTION_CANDIDATE. No code here automatically promotes a feature or edits production weights. A production candidate requires a separate review of prospective sample, calibration, accuracy, Brier/log loss, reliability, robustness and cumulative search breadth. An LLM has no promotion authority.

## Coach and disagreement research

Each section retains home/away/even/unknown; unknown maps to null. No qualitative confidence is converted into a fabricated probability. The scorecard separates prospective and reconstructed evidence and reports coverage, available/directional N, accuracy, picked-side bias, per-season results, control agreement, and disagreement accuracy. QB–protection, QB–receivers and protection–availability agreement are explicit research fields. There are no brute-force section combinations.

Current availability evidence is restricted to 30 days. Structural evidence can extend to July 1 of the relevant NFL season. Source-window provenance is saved. Unsupported current-state sections become unknown before the final pick is built. Sensitivity conditions only identify evidence-supported dependencies; they do not invent probability or pick-flip thresholds.

Disagreement includes available control, Coach sections, market, PURE, Lettrology and DeepSeek directions. Entropy, market gap, control/Coach and experimental disagreement, section disagreement and coverage are research features. Correlated sections are not independent statistical votes. No uncertainty relationship has been validated by the current real run. The deterministic data-quality coverage is a missingness descriptor, not a calibrated reliability probability.

## Weather and chronology

The ensemble EPA API requires exact NFL season/week and uses the existing quoted-CSV point-in-time parser. Target/future weeks and seasons are excluded; missing EPA is unavailable with zero ensemble weight, never a synthetic 50% forecast. The implementation uses team EPA per opportunity and makes no calibration claim.

Weather resolves the game's actual stadium ID and verified venue name, rather than the designated home team. Unknown/relocated venues fail closed. Retractable roofs remain unknown prospectively unless supplied with verified roof context. Indoor conditions have null meteorological measurements and zero outdoor-weather adjustment, not invented 72°F observations. Outdoor weather uses the kickoff UTC hour, including gusts, precipitation, snowfall and humidity. See [Open-Meteo historical documentation](https://open-meteo.com/en/docs/historical-weather-api): archived data are reanalysis, not a historical forecast that was frozen before kickoff. The future forecast response is captured separately. New stadiums and other international venues require verified registry entries.

## Reproduction

```powershell
npm ci --ignore-scripts
bun scripts/audit-research-v2.ts
bun scripts/verify-research-v2.ts
bun run research:cycle
bun scripts/ensemble-chronology-acceptance.ts
bun run research:weather-check
bun run research:coach-score --input=training/exports/research-v2/coaches.json
bun run research:cycle --input=training/exports/research-v2/predictions.json --coaches=training/exports/research-v2/coaches.json --output-dir=research/runtime/durable
bun run research:summary
bun run evaluate --season=2025
```

`training/exports/` and `research/runtime/` are deliberately untracked. Exported prediction rows require DB capture/kickoff/cutoff clocks, frozen feature JSON, model/game identity, probabilities, market timestamps and verified outcomes. Coach exports require report JSON and DB capture/kickoff/mode. Export these read-only from the existing tables; never publish service credentials. The delivered run used 170 source prediction rows, 43 outcome records and one historical Coach report from the connected NFL database. Imports retain the first forecast per game/model/horizon: 85 forecasts, 69 completed horizon forecasts across 43 unique completed games. Multiple horizons are reported separately, not independent replications.

The authenticated dashboard displays the **last recorded research run**, not live database counts. Regenerate the summary after a new run. Existing production and forward-test components remain separate.
