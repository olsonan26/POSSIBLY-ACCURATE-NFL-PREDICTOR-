# EXP-019 — Market-Aware Residual / Disagreement Layer

## Status

PREREGISTERED. Results are intentionally absent from this file until CI runs the locked protocol.

Production `v2.2-validated-current-season` is not modified by this experiment.

## Why this experiment exists

The pure-football control has shown a weak first three weeks in the small 2026 observational sample. A sportsbook market is an unusually information-dense pregame sensor: it aggregates roster news, quarterback status, injuries, matchup opinion, and public/professional trading pressure that our current control may not represent explicitly.

The goal is not to pretend that the market is our football model. The goal is to test whether a separately labeled market-aware lane can improve winner classification and probability quality without contaminating the pure-football control.

## Data and timestamp rule

Source: nflverse `games.csv` pregame moneylines.

Historical evaluation uses the recorded closing moneyline. Closing prices are pre-kickoff information, but they represent a late pregame cutoff. Therefore any surviving model must be labeled `market-aware` and should eventually be exposed as a late-pregame lane rather than as a replacement for an earlier pure-football forecast.

Two-sided American moneylines are converted to implied probabilities and normalized to remove the bookmaker overround:

`p_home_novig = p_home_raw / (p_home_raw + p_away_raw)`

Games missing either side of the moneyline are excluded from EXP-019 rather than imputed.

## Candidate family — frozen before 2025

The 2024 discovery season may choose only among these predeclared rules:

1. Logit blends of v2.2 and no-vig market probability with market weights `0, .25, .50, .75, 1.00`.
2. Market guardrails that override v2.2 only when the two disagree on the winner and market confidence is at least `55%, 60%, 65%, 70%`.
3. Disagreement-only logit blending at `50%` market weight.
4. Disagreement-only full market override.

No threshold, weight, or rule may be added after seeing 2025.

## Selection rule

Primary objective: straight-up winner accuracy on 2024.

Tie breakers, in order:

1. lower Brier score,
2. lower log loss,
3. deterministic candidate label order.

The winning 2024 rule is locked before 2025 is evaluated.

## Confirmation and observation

- 2024: discovery / rule selection.
- 2025: locked model-spec confirmation. No parameter changes permitted.
- 2026 completed games: observation only. They cannot rescue a failed 2025 confirmation.

Metrics:

- winner accuracy,
- Brier score,
- log loss,
- ECE,
- paired challenger-only vs control-only flips,
- exact McNemar p-value,
- Weeks 1–4 / 5–9 / 10+,
- control-market disagreement subset,
- high-confidence market subsets.

## Promotion gate

EXP-019 may survive only as a **market-aware shadow candidate** if locked 2025 confirmation simultaneously:

1. improves winner accuracy over v2.2,
2. does not worsen Brier score,
3. does not worsen log loss.

Even if it survives, it does not replace v2.2. Pure-football and market-aware models remain separately labeled.

## Leakage rule

Final score, target-game play-by-play, postgame information, and any line not available before kickoff are forbidden. Historical closing odds are accepted only because they are recorded pregame prices. Future live deployment must timestamp the exact line snapshot used.
