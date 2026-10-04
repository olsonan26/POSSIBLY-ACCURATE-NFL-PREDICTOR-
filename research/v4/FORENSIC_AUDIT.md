# NFL Edge Engine v4 — Initial Forensic Audit

Audit date: 2026-10-04. Baseline: a5cbab8810e17ce649bd9291df031e1c579e3ea9.

STATUS: PARTIAL SOURCE AUDIT. This document is not a completion certificate. Full repository inspection, model replay, install, typecheck, build and deployment tests remain outstanding. No implementation change is authorized by this document.

## Evidence and scope

Readable GitHub commit patches and path histories were inspected because direct file reads returned inaccessible download acknowledgements. Complete original source was available for several added services; later corrections were reviewed. Existing reported performance figures were not independently reproduced. Confirmed below means visible source behavior, not proof of a production incident.

Source links:
- [EXP-030 source and evidence](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/a5cbab8810e17ce649bd9291df031e1c579e3ea9).
- [EXP-025 original services](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/f60146d2e538349ed85654b8d0f5d025b8634a6e).
- [Control restoration](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/c78ee41e67d720c4c9f2453b7502f1e9bb18aaa0).
- [Preseason correction](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/747f4128a816330a1f041da4928c5ce64f2d4ccc).
- [Weather correction](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/a852aac47185081df15f830c8e21aea5aebeb10d).
- [HFA correction](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/0f467f68c8016a73384fed377dbef0eedc2254b7).
- [Divisional correction](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/e6621a2459f03dcabd0ac36828fb2c9cd8716da0).
- [Prediction storage](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/8cbbba586293f288bdd27f7ae8541ffb7bbe7680).
- [UI gateway](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/3745f14aaf46f5340e7e5ca134fcf486b1f38925).
- [Market source](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/4a46abd52a377b894c29ddc5abcb9aec43b984c1) and [date correction](https://github.com/olsonan26/POSSIBLY-ACCURATE-NFL-PREDICTOR-/commit/307b06568e3ae6acc3762e4f137f48e36c2e0314).

## A. Verified architecture

```text
Browser validated-service import
 -> Vite alias -> UI gateway -> validated predictor
 -> v2.2 final football probability
 -> live-only EXP-025 shadow, separate from final probability
 -> independent PURE/resolver path, not fully inspected
 -> LocalStorage snapshot before gateway returns

Market service -> games.csv -> two-sided no-vig probability
 -> 75% market / 25% control logit blend -> per-game LocalStorage write

EXP-030 -> games.csv + control calls -> historical features
 -> classifier -> in-sample calibration -> 2024 hyperparameter selection
 -> 2025 variant selection -> reports

Evaluation/autoresearch/promotion: complete call graph outstanding
```

## B. Production versus research

The control-restoration patch assigns finalHomeProbability=v22Probability, labels EXP-025 shadow-only and excludes its factors from the production score. Retrospective control calculations disable EXP-025. This supports numerical control separation; complete UI/resolver behavior and reproducibility are not yet verified. Preserve v2.2, original experiment labels, failed reports and pregame records. PURE rules must not be modified.

## C. Confirmed source defects

- EXP-030 selects its final variant using 2025 Brier while labeling 2025 untouched confirmation.
- Filtered subgroup arrays index original probabilities, losing game/prediction alignment.
- Confidence buckets exclude away-favorite predictions.
- Away-short-rest diagnostics reverse the rest-differential sign.
- Neutral travel is zero in EXP-030 and travelService.
- Calibration uses classifier training predictions, not held-out predictions.
- Historical control calls substitute noon UTC for kickoff.
- EXP-030 narrative and result JSON disagree on 2024 market results; writer schema and checked-in JSON differ.
- Turnover, special-teams and pace services do not enforce targetIso; their aggregation also lacks effective season filtering.
- Team-season aggregate caches omit cutoff/source revision and retain failed promises without an expiry policy.
- idx('team') ?? idx('recent_team') cannot recover from indexOf returning -1.
- Missing statistic columns can become measured-looking zero values.
- Travel isShortRest is inferred from timezone shift rather than prior game times.
- Preseason service explicitly ignores season/cutoff and uses one imported table.
- Weather adds unconditional positive home logits for wind/precipitation, uses archive daily summaries, ignores neutral-site status and lacks game-specific roof state.
- HFA/divisional calls receive empty histories. HFA cache still lacks cutoff/history revision.
- Divisional record disadvantage is not market-underdog status; its win-rate helper lacks internal cutoff filtering and uses inconsistent game field aliases.
- Browser prediction identity omits horizon/Git SHA; stored data cutoff is creation time; there is no pregame guard in the snapshot service.
- UI gateway can lose a valid returned prediction if convenience-storage access/write throws.
- Market snapshots overwrite per-game keys; fetch time is not source quote time; book/horizon quote history is absent.
- ensemble.blendedHomeProbability holds the shadow probability despite listed control=1/shadow=0 weights.
- The inspected walk-forward script evaluates simplified Elo, not full v2.2/EXP-025, and does not update ratings through test-season predictions.

## D–J. Modeling, leakage, names and source risks

neutralPassRate is unfiltered pass attempts divided by pass plus rush attempts. firstDownRate is per play, not per drive. Possession time is a fixed-formula estimate. Turnover expectation is observed rates without forcing/recovery separation or shrinkage. These names overstate what is measured or predicted.

EPA genuinely calculates early-down EPA. Its date-string comparison admits same-day rows when a date-only gameday is compared with a full ISO target; caller formats must be verified before claiming an actual target-game leak. Defensive opponent-adjustment sign and exposure weighting need independent tests. Historical engineered CSV lineage is unverified. The weekly source URL/schema availability was not independently checked.

Latest HFA code already sets neutral-site Elo HFA to zero. Vite hardening removed earlier API-key injection; this is not a complete secret scan. vercel.json specifies Vite, npm run build and dist; no build was executed.

## K. Unsupported claims and remaining work

Untouched confirmation, held-out calibration, neutral-script passing, per-drive efficiency, dynamic measured HFA and full-model walk-forward validation are not supported by the inspected code paths. Faulty subgroup narratives must not guide new experiments before correction. No newly validated feature coefficient or accuracy gain is claimed.

Ten isolated JavaScript expression/function checks reproduced expected bug semantics. They were transcribed fragments, not imported repository modules or the repository test suite.

Still inspect full control/context/raw dependencies; PURE/Lettrology; App/components/types; all scripts and EXP-001–030 evidence; datasets and lineage; all API/environment boundaries; package/lockfiles; full workflows. Finish this audit before implementation. Preserve original reports and append corrected versions.
