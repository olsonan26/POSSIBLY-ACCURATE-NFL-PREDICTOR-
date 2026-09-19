# PURE Astrology Experiment 1 — Date-Safe Franchise + Kickoff Core

Date: 2026-09-18
Status: **research only — not authorized to influence the production winner**

## Research question

Can a deterministic, date-safe subset of the private PURE Astrology methodology add predictive information to the validated football baseline without using future game results, invented birth times, or outcome-specific rules?

This experiment intentionally does **not** copy the private canonical PURE source into the public repository. The code implements a limited set of derived, testable concepts only.

## What was implemented

The research runner is `scripts/pure-astrology-research.mjs`.

Astronomical positions are calculated deterministically with Astronomy Engine. The model uses:

- exact scheduled kickoff date/time from the verified NFL game feed;
- geocentric planetary longitudes at kickoff;
- conjunction, semi-sextile, sextile, square, trine, quincunx, and opposition relationships;
- applying/separating state for event transits;
- retrograde state for event planets;
- exact event ASC/MC/DSC/IC when the home venue is known;
- Whole-Sign event-house overlays;
- date-safe franchise-chart planetary positions;
- home-minus-away matchup features rather than generic horoscope labels.

The experiment explicitly excludes:

- invented franchise birth times;
- franchise natal houses and natal angles when no verified founding time exists;
- franchise natal Moon because an unknown founding time can materially move the Moon;
- coach/QB/backup/tackle/defender/kicker astrology in this first run;
- owner astrology;
- game-specific hard-coded rules;
- 2025 or 2026 outcomes from coefficient fitting.

Neutral-site angle/house features are omitted unless an exact neutral venue is available.

## Temporal design

The split was fixed before reading the final results:

- **2021–2023:** train PURE coefficients;
- **2024:** select regularization strength;
- **2021–2024:** refit final research coefficients using the selected regularization;
- **2025:** validation season, not used to fit final coefficients;
- **2026 through September 14:** observation only, never used for tuning.

The combined model treats the football model's log-odds as a fixed offset and asks whether PURE features explain residual outcome information. This prevents the astrology layer from simply relearning ordinary team strength.

## Results

### 2025 validation — 271 regular-season binary decisions

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| Football v2.1 core | 177 / 271 | **65.31%** | 0.2245 | 0.6400 |
| PURE date-safe core | 134 / 271 | **49.45%** | 0.2594 | 0.7125 |
| Football + PURE | 169 / 271 | **62.36%** | 0.2316 | 0.6564 |
| Always-home baseline | — | 53.87% | — | — |

**Interpretation:** this first PURE core did not demonstrate incremental value on 2025. Adding it to the football model reduced accuracy by 2.95 percentage points and worsened both Brier score and log loss. It therefore fails the production-promotion test.

### 2026 observation through September 14 — 16 games

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| Football v2.1 core | 9 / 16 | **56.25%** | 0.2244 | 0.6407 |
| PURE date-safe core | 12 / 16 | **75.00%** | 0.2159 | 0.6241 |
| Football + PURE | 11 / 16 | **68.75%** | 0.1966 | 0.5824 |
| Always-home baseline | — | 62.50% | — | — |

This is encouraging but far too small to override the failed 2025 validation. The 2026 results remain observational.

## 2026 football-model misses

The football baseline missed seven games in the safe 2026 sample.

| Game | Actual winner | PURE-only | Combined |
| --- | --- | --- | --- |
| SF @ LA | SF | miss | miss |
| BUF @ HOU | BUF | **recovered** | **recovered** |
| NYJ @ TEN | NYJ | **recovered** | miss |
| ARI @ LAC | ARI | miss | miss |
| MIA @ LV | LV | **recovered** | **recovered** |
| DAL @ NYG | NYG | **recovered** | **recovered** |
| DEN @ KC | KC | **recovered** | miss |

PURE-only independently selected the actual winner in **5 of the 7** games missed by the football baseline. The combined residual model changed three of those misses into correct picks.

This is the most interesting finding from Experiment 1, but it must be reproduced in a larger future/untouched sample.

## Why this is not yet "full PURE v3.2"

The intended NFL v3.2 ecosystem contains multiple interacting charts. This first experiment contains only:

1. exact kickoff/event sky;
2. franchise date-safe chart;
3. event location/angles where safely available.

It does **not** yet contain validated historical layers for:

- head coach;
- starting QB;
- backup QB;
- blindside tackle;
- key defensive leader/secondary;
- kicker;
- owner/background organizational layer.

Those layers require a historically correct person-to-team mapping and verified DOBs for each game date. Using a 2026 roster retroactively would be leakage/data corruption, so they must be built from point-in-time personnel data.

## Promotion rule

PURE Astrology should not affect the production winner merely because one small 2026 sample was strong.

A PURE layer earns production influence only if it:

1. is calculated entirely from information knowable before kickoff;
2. improves a football-only baseline on chronologically untouched games;
3. improves or at minimum does not materially damage probability quality (Brier/log loss/calibration);
4. survives more than one temporal window rather than one favorable week/season slice;
5. uses no outcome-specific exceptions or post-hoc weight changes.

## Next research steps

1. Add nested walk-forward / rolling validation using the **same fixed feature definitions**.
2. Run permutation/randomization checks to estimate how often apparent astrology lift occurs by chance.
3. Build point-in-time coach and starting-QB DOB registries first; test those layers separately.
4. Add backup QB, blindside tackle, key defender, and kicker only when historical identity and DOB coverage are adequate.
5. Keep each role separable so weak layers can be excluded instead of being protected because they are part of the concept.
6. Fix the football model's early-season cross-season form weighting independently of astrology.
7. Continue prospective 2026 logging without tuning from observed outcomes.

## Current conclusion

Experiment 1 gives a **promising 2026 observation but a negative 2025 validation**. The correct engineering decision is therefore to keep PURE Astrology as an active research layer, expand it carefully toward the full multi-chart ecosystem, and require new evidence before it is allowed to alter production picks.
