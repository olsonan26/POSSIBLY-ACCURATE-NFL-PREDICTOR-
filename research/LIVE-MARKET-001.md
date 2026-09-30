# LIVE-MARKET-001 — Market-Aware Shadow Deployment

## Purpose

Expose the locked EXP-019 market-aware challenger prospectively without overwriting the frozen pure-football `v2.2-validated-current-season` control.

## Locked formula

EXP-019 selected the following rule using 2024 only:

`logit(p_shadow) = 0.25 * logit(p_v2.2) + 0.75 * logit(p_market_novig)`

The 75% weight is frozen. 2025 and 2026 observations cannot retune it.

## Live behavior

- v2.2 is still calculated and displayed independently.
- The market-aware shadow is displayed only when both home and away moneylines are available for the exact scheduled matchup.
- American moneylines are converted to two-sided no-vig probability before blending.
- Missing lines fail closed: there is no market-aware pick rather than an imputed line.
- The browser refreshes the market source at most once per minute during an active session.
- Each generated shadow snapshot records source, moneylines, no-vig probability, v2.2 probability, blended probability, and fetch timestamp in local browser storage for audit.
- Historical rows use the recorded nflverse pregame/closing market values; future rows use the current value present in the feed at fetch time.

## Presentation rule

The UI must always distinguish:

1. **Pure Football · v2.2**
2. **Market-Aware Shadow · EXP-019**
3. **Market-only probability**

A shadow forecast is not presented as a silent v2.2 upgrade.

## Validation evidence

Locked EXP-019 results:

- 2024 discovery: shadow **196/272 = 72.06%**, v2.2 **181/272 = 66.54%**.
- 2025 confirmation: shadow **182/271 = 67.16%**, v2.2 **180/271 = 66.42%**.
- 2025 Brier: shadow **0.2137**, v2.2 **0.2250**.
- 2025 log loss: shadow **0.6137**, v2.2 **0.6416**.
- 2026 first 48 games observation: shadow **31/48 = 64.58%**, v2.2 **28/48 = 58.33%**.
- 2026 market-only observation: **32/48 = 66.67%**.

The 2025 paired winner difference is not statistically established (`p=0.8388`). LIVE-MARKET-001 therefore remains a shadow lane for prospective accumulation rather than replacing the control.

## Next research use

Prospective snapshots should be used to evaluate:

- whether market disagreement remains especially informative,
- how performance changes by time-to-kickoff,
- whether the pure-football survivor ensemble adds value beyond the market,
- whether injury/QB/news verification improves early snapshots before the closing market has fully incorporated new information.
