# Lettrology matchup research v1

Status: **research-only / zero production weight**

Production model: `v2.2-validated-current-season`

Production benchmark remains locked:

- 2025 untouched: 180 / 271 = 66.42%
- Brier: 0.2250
- 2026 observations are not used to choose rules, thresholds, weights, or features.

## Purpose

Test whether pregame Lettrology relationships add repeatable information without weakening the validated football model.

The production winner must remain unchanged until an independently validated research layer demonstrates incremental out-of-sample value.

## Provisional daily formula

The current research branch implements the formula supplied on 2026-09-20 as **provisional**:

1. `PM = PY + calendar month`
2. `Daily Environment = PM + calendar day`
3. `PME = Year ESS + PM`
4. `Daily ESS = PME + Daily Environment`
5. Full daily signature = `Daily ESS over Daily Environment`

Example: `8 over 5` means Daily ESS 8 over Daily Environment 5.

Compounds/reduction trails are preserved in display values. The research implementation currently uses each upstream field's reduced tail when feeding the next stage, matching the predictor's existing staged-reduction convention.

## Formula confirmation warning

This formula is not yet promoted as canonical.

The live `ALMOST DONE CALCULATOR COPY!` spreadsheet currently contains a different formula in its `TEAM Ess` calculation. The inspected Team formula constructs the raw slash pair as:

- first side = `calendar day + Year Essence + (Year Cycle + calendar month)`
- second side = `Year Cycle + calendar month`

That existing denominator does **not** add calendar day. This discrepancy must be resolved against the authoritative Lettrology definition before any formula-derived matchup signal can be promoted.

The discrepancy does not affect the production v2.2 football winner because all Lettrology research remains excluded from scoring.

## Historical research source

The new matchup research uses verified NFLverse game history for outcomes and game dates, then recalculates the provisional Team signature using the team registry.

Eligibility rules:

- regular season only
- completed games only
- game date strictly before the requested prediction date
- 2020 onward
- ties excluded from binary matchup rates
- self-matchups excluded
- teams must resolve through the canonical team registry

The historical spreadsheet/archive is useful for auditing existing Lettrology outputs, but its previously identified impossible/synthetic game records are not used to alter the production winner.

## Matchup ledgers

For every eligible pre-cutoff game, the research index records:

- global full-signature win/loss history
- directed `Signature A -> Signature B` wins
- Team WITH its own signature
- Team AGAINST the opponent signature
- Team x own signature x opponent signature

These overlapping ledgers are displayed descriptively. They are **not added together as independent votes**.

## Monte Carlo

Monte Carlo is downstream uncertainty propagation only.

For the exact directed full-signature matchup:

- observed historical record is `A wins vs B wins`
- prior is `Beta(8, 8)` (16-game 50/50 equivalent, consistent with the existing shrinkage scale)
- 20,000 deterministic simulations sample the latent matchup rate
- output reports posterior mean, probability the home signature's latent rate exceeds 50%, and an 80% interval

Important:

- 20,000 simulations do **not** create 20,000 historical games
- a 1-0 matchup remains a tiny sample
- zero meetings remain no evidence
- Monte Carlo output has `includedInScore = false`
- Monte Carlo cannot change the production winner or production confidence

## Promotion gate

A future Lettrology feature may enter production only if the formula is confirmed first and then the feature improves an untouched chronological validation set without unacceptable degradation in calibration.

Required evaluation includes:

- winner accuracy
- Brier score
- log loss
- calibration by confidence bucket
- chronological / walk-forward testing
- leakage audit
- sufficient sample sizes
- robustness to multiple-comparison effects

2026 observed outcomes cannot be used to tune the feature.

## Current branch behavior

This branch deliberately separates two outputs:

1. **Production prediction** — unchanged v2.2 football scoring.
2. **Research display** — provisional Daily ESS over Daily Environment signatures plus full-signature matchup history and Monte Carlo uncertainty.

If the research layer fails to load, prediction falls back cleanly: the production winner is still returned and a research warning is shown.
