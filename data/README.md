# Data directory status

## Production sources

The v2.1 production engine does **not** use `historicalGames.ts`, `winning_patterns.ts`, or `losing_patterns.ts` as verified NFL outcomes.

Production football history is loaded from nflverse `nfldata/data/games.csv` with a strict pregame cutoff. Current/future personnel and injury context is retrieved from ESPN public NFL endpoints when available. `teamRegistry.ts` supplies canonical franchise dates plus current fallback coach/QB information if live personnel retrieval is incomplete.

## Legacy / quarantined files

The following files remain in the repository only for research provenance and backwards comparison:

- `historicalGames.ts`
- `winning_patterns.ts`
- `losing_patterns.ts`

They must not be reintroduced into a production score without first being rebuilt/verified against authoritative game outcomes and evaluated through the same temporal validation process used by v2.1.

The 2026-09-18 audit found internal outcome/date consistency problems in the old historical dataset, so keeping it out of the production path is intentional.
