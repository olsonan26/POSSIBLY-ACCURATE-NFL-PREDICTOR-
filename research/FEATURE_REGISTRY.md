# NFL Predictor Feature Registry

This registry exists to prevent hidden, duplicated, or silently changing logic.

| Feature | Status | Data source | Timestamp rule | Formula / implementation | Missing-data rule | Production weight | Version / evidence |
|---|---|---|---|---|---|---|---|
| Pregame Elo team strength | CONTROL | nflverse historical games | strictly before target game | Elo base probability in legacy research engine | use established Elo initialization path | active | v2.2 control |
| Current-season recent form | CONTROL | nflverse historical games | completed games with `gameday < targetIso`, same NFL season only | recency-weighted W/L + point differential; 0.9 decay; bounded logit edge | 0 games -> neutral .500 / 0 point diff | active | v2.2; reset selected on 2024, checked on 2025 |
| Current-season overall form | CONTROL | nflverse historical games | completed games before target, same season | W/L + weighted point differential; active after minimum combined sample | insufficient sample -> 0 adjustment | active | v2.2 |
| Home/away current-season context | CONTROL | nflverse historical games | same season, completed before target | venue win rates converted to bounded logit adjustment | neutral site -> zero; no sample -> neutral priors | active | v2.2 |
| Same-venue H2H | CONTROL / AUDIT | historical game data | only prior meetings | legacy model implementation | missing -> neutral | active in control; challenger must test removal | inherited |
| Live personnel / injury availability | CONTROL LIVE ONLY | live roster/depth/injury providers | must be pregame-current | position-weighted personnel adjustment | retrospective games force adjustment to zero | active for upcoming games only | v2.2 leakage guard |
| Rest differential | RESEARCH ONLY | schedule/game data | pregame | legacy research adjustment | missing -> neutral | zero production influence | rejected for 2025 incremental accuracy |
| Legacy numerology | RESEARCH ONLY | internal historical patterns | pregame | legacy daily definitions | missing -> neutral | zero production influence | superseded / audit only |
| Provisional Lettrology | RESEARCH ONLY | internal source-derived formulas | pregame | Daily Environment + Daily ESS provisional research | fail closed | zero production influence | not validated |
| PURE Astrology | RESEARCH ONLY | private source-authoritative engine | pregame only; retrospective current personnel blocked | independent ecosystem analysis; no invented blend with football | unavailable/limited/unresolved states preserved | zero production influence | v3.x research |
| Market benchmark | NOT IMPLEMENTED | future point-in-time sportsbook source | line available at prediction cutoff | benchmark only unless separate market-assisted model is created | missing -> unavailable | none | master-prompt research target |
| Opponent-adjusted EPA / success rate | NOT IMPLEMENTED | future nflverse play-by-play research pipeline | strictly pregame rolling features | TBD challenger only | missing -> explicit unknown | none | priority challenger |
| OL vs pass-rush matchup | NOT IMPLEMENTED | future point-in-time efficiency + personnel | strictly pregame | TBD challenger only | missing -> explicit unknown | none | priority challenger |
| Weather | NOT IMPLEMENTED | future historical/live weather source | observed/forecast known before kickoff | matchup/scoring modifier only if validated | missing -> unavailable | none | research target |

## Rules

1. `v2.2-validated-current-season` remains runnable as the control.
2. Experimental features cannot modify the control's historical predictions.
3. Every new feature needs a timestamp rule and a missing-data rule before backtesting.
4. A feature is not promoted because it makes one slate look better.
5. Market-assisted and non-market models must remain separately labeled.
