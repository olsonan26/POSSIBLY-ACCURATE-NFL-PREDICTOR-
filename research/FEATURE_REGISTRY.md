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
| PURE Astrology | RESEARCH ONLY | private source-authoritative engine | pregame only; retrospective current personnel blocked | independent ecosystem analysis; no invented blend with football | unavailable/limited/unresolved states preserved | zero production influence | v3.x research; frozen 2026 Week 1 v3.2 slate 6/15 |
| Simple opponent-adjusted point differential | REJECTED RESEARCH | nflverse historical games | same-season completed games strictly before target | iterative SRS-style opponent adjustment; 2024 selected 0.03 logit/point | no prior sample -> neutral | zero | EXP-006 failed untouched 2025: 66.05%, Brier 0.2259, log loss 0.6448 vs v2.2 66.42%, 0.2250, 0.6416 |
| Offense-vs-defense matchup efficiency | RESEARCH CANDIDATE | nflverse weekly team stats | prior weeks only; same-week games excluded | passing EPA/dropback + rushing YPC + protection/sack rate + ball-security/turnover interaction; 2024 selected 0.15 | Week 1 / insufficient prior sample -> zero edge | zero | EXP-007 untouched 2025: 67.90%, Brier 0.2243, log loss 0.6412; paired p=0.424; needs broader replication |
| Expected-margin architecture | RESEARCH COMPONENT | frozen-control pregame features | strictly pregame | ridge expected margin + discovery-only residual mapping | insufficient data -> control-only context | zero | EXP-008 improved calibration/Brier/log loss but reduced 2025 winner accuracy to 64.94% |
| QB value layer | RESEARCH CANDIDATE | nflverse weekly player stats + historical named starters | prior QB games only; same-week excluded | EPA/dropback + CPOE + sack avoidance + QB rushing; 16-game/100-DB prior/0.20 locked | cold starts shrink toward contemporaneous league mean | zero | EXP-010 tied 2025 accuracy 66.42%, improved Brier/log loss/ECE; 2026 obs 29/48 |
| Success + explosive-play matchup | REJECTED RESEARCH | nflverse play-by-play | prior weeks only; same-week/target-game plays excluded | pass/rush success + pass/rush explosive rates; 2024 selected 20/15-yard thresholds, no garbage filter, 0.20 weight | Week 1 / insufficient sample -> zero edge | zero | EXP-014 failed untouched 2025: 65.68%, Brier 0.2253, log loss 0.6440, ECE 0.0885; 2026 obs 27/48 |
| Probability calibration | RESEARCH TARGET | prior out-of-sample model probabilities | calibration fit must precede evaluated season | Platt/logistic or isotonic candidate; not yet promoted | no valid calibration sample -> raw probability | none | 2025 ECE 0.0804 exposes non-monotonic confidence buckets |
| Market benchmark | NOT IMPLEMENTED | future point-in-time sportsbook source | line available at prediction cutoff | benchmark only unless separate market-assisted model is created | missing -> unavailable | none | master-prompt research target |
| Opponent-adjusted EPA / success rate | NOT IMPLEMENTED | future nflverse play-by-play research pipeline | strictly pregame rolling features | separate future challenger, distinct from failed EXP-006 point-differential SRS and failed EXP-014 raw rate blend | missing -> explicit unknown | none | EXP-009 roadmap item |
| OL vs pass-rush matchup | NOT IMPLEMENTED | future point-in-time efficiency + personnel | strictly pregame | TBD challenger only | missing -> explicit unknown | none | priority challenger |
| Weather | NOT IMPLEMENTED | future historical/live weather source | observed/forecast known before kickoff | matchup/scoring modifier only if validated | missing -> unavailable | none | research target |

## Rules

1. `v2.2-validated-current-season` remains runnable as the production/control model.
2. Experimental features cannot modify the control's historical predictions.
3. Every new feature needs a timestamp rule and a missing-data rule before backtesting.
4. A feature is not promoted because it makes one slate or one season look better.
5. Market-assisted and non-market models must remain separately labeled.
6. Post-confirmation ablations can generate hypotheses but cannot be used to retune the same test season and call it untouched.
