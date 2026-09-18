# PURE Astrology v3.2 — Phase 2 Research Audit

Date: 2026-09-18
Status: **research only — no PURE Astrology role is authorized to change the production winner**

## Purpose

Phase 2 tested whether date-safe PURE Astrology attached to additional NFL ecosystem roles adds predictive information beyond the validated football model.

The tested role layers were:

1. franchise / team date-safe chart;
2. head coach;
3. starting quarterback;
4. combinations of franchise + coach + quarterback.

The experiment kept the astrology layers separable so a role could be rejected without protecting it merely because it belongs to the conceptual framework.

## Production football change discovered during Phase 2

Phase 2 also exposed a football-model issue: early-season "recent form" was carrying prior-season games into a new NFL season.

A separate one-variable ablation was therefore created in `scripts/carryover-ablation.mjs`. It preserved the v2.1 Elo, H2H, win-rate, point-differential and venue formulas and changed only whether prior-season rows could enter recent-form/home-road context.

### 2024 selection season

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| v2.1 cross-season recent form | 182 / 272 | 66.91% | 0.2128 | 0.6138 |
| Current-season reset only | 180 / 272 | 66.18% | **0.2118** | **0.6122** |

The promotion rule was fixed before looking at 2025: select the reset only if it improved 2024 Brier score. It did.

### 2025 validation after the preselected reset

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| v2.1 cross-season recent form | 177 / 271 | 65.31% | **0.2245** | **0.6400** |
| Current-season reset only | **180 / 271** | **66.42%** | 0.2250 | 0.6415 |

The reset improved winner accuracy by 1.11 percentage points, with a small 0.0005 Brier tradeoff.

### 2026 observation through September 14

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| v2.1 cross-season recent form | 9 / 16 | 56.25% | 0.2244 | 0.6407 |
| Current-season reset only | **10 / 16** | **62.50%** | **0.2200** | **0.6307** |

Because the rule was selected on 2024 and then improved accuracy on 2025 and both accuracy/probability quality on the later 2026 observation, it was promoted as production **v2.2**.

Production v2.2 now uses:

- pregame Elo with season regression;
- target-season recent/current-season form only;
- target-season home/road refinement only;
- generic recency-weighted same-venue H2H;
- live injury/availability context when available.

It does **not** score rest, numerology or PURE Astrology.

## Phase 2A — research QB identity reconstructed from game passer usage

The first Phase 2 run used the `home_qb_id` / `away_qb_id` fields in nflverse games. Those identities are useful for historical reconstruction but derive from play-by-play passer usage, so they are not acceptable as a final pregame promotion source.

QB DOB coverage was 100%. Coach DOB coverage was only about 1.4% of game pairs, which makes all coach-specific results uninterpretable.

The QB-only layer showed a potentially interesting probability effect in 2025 but did not improve winner accuracy:

| Model | 2025 correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| Football screening baseline | 180 / 271 | **66.42%** | 0.2243 | 0.6399 |
| Football + QB PURE | 178 / 271 | 65.68% | **0.2208** | **0.6334** |

Because the QB identity source was not strictly pregame and winner accuracy declined, this was treated only as a reason to run a stronger identity test.

## Phase 2B — archived pregame depth-chart QB gate

Phase 2B replaced game-derived QB identity with archived nflverse depth-chart identity before the Phase 2 runner saw the schedule.

Data rule:

- 2021–2024 legacy weekly depth charts: select the matching team/week QB on `depth_team = 1`;
- 2025+: select `pos_rank = 1` from the latest timestamped depth-chart snapshot whose calendar date is **strictly before game day**;
- if no pregame QB identity is available, leave the astrology role empty rather than falling back to the postgame-derived passer.

Coverage and identity difference:

- both-team pregame QB coverage: **1667 / 1696 = 98.3%** across the rewritten game file;
- QB DOB pair coverage within the 2021–2026 research sample: **1370 / 1371 = 99.9%**;
- depth-chart QB differed from the game-passer-derived QB in **403 home-team slots + 419 away-team slots = 822 team-game slots**.

That large identity difference confirms that Phase 2B was a materially different, safer QB test rather than a cosmetic rewrite.

### Forward Window A — 2024

Training 2021–2022, tuning 2023, testing 2024:

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| Football screening baseline | 180 / 272 | 66.18% | 0.2117 | 0.6119 |
| Football + pregame QB PURE | **183 / 272** | **67.28%** | **0.2104** | **0.6096** |

This was encouraging enough to continue to the later untouched validation window.

### Primary validation — 2025

Training 2021–2023, tuning 2024, testing 2025:

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| Football screening baseline | **180 / 271** | **66.42%** | 0.2243 | 0.6399 |
| Football + pregame QB PURE | 175 / 271 | 64.58% | **0.2229** | **0.6376** |
| Football + franchise PURE | 177 / 271 | 65.31% | 0.2280 | 0.6486 |
| Football + franchise + pregame QB PURE | 165 / 271 | 60.89% | 0.2283 | 0.6494 |
| Full Phase 2 PURE | 166 / 271 | 61.25% | 0.2285 | 0.6504 |

The safer pregame QB layer again slightly improved probability scoring, but it reduced binary winner accuracy by **1.84 percentage points**. Franchise + QB and the full combined stack were substantially worse.

### 2026 observation through September 14

| Model | Correct | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| Football screening baseline | 10 / 16 | 62.50% | 0.2200 | 0.6307 |
| Football + pregame QB PURE | 10 / 16 | 62.50% | 0.2229 | 0.6361 |
| Football + franchise PURE | **11 / 16** | **68.75%** | **0.2013** | **0.5934** |
| Football + franchise + pregame QB PURE | 10 / 16 | 62.50% | 0.2050 | 0.5992 |
| Full Phase 2 PURE | 11 / 16 | 68.75% | 0.2058 | 0.6011 |

The small 2026 sample does not override the negative 2025 validation. In particular, the earlier 75% franchise+QB observation disappeared when QB identity was changed to the conservative archived pregame source.

## Falsification test

For the full Phase 2B residual over football, 500 shuffled-residual permutations were run against 2025.

- observed full Phase 2B Brier: **0.2285**;
- shuffled-residual p-value: **approximately 0.627**.

This provides no evidence that the full Phase 2B astrology residual is stronger than what could arise from randomly reassociating those residuals with games.

## Coach layer status

Coach identity is present in the historical game records, but the automated public DOB resolver produced only **8 / 69** unique coach DOBs and approximately **1.4%** complete coach-pair game coverage.

Therefore:

- coach PURE results are **invalid / insufficient-coverage**, not positive or negative evidence;
- no coach coefficient may be promoted;
- no missing coach DOB is guessed;
- a future coach test requires a locally verified point-in-time coach DOB registry with high coverage.

## Current decision

### Production

Keep **v2.2 football-only production scoring**. It currently validates at:

- **180 / 271 = 66.42%** on the 2025 regular-season binary test;
- correct:incorrect ratio **1.978:1**;
- **10 / 16 = 62.50%** on the locked 2026 observation through September 14;
- no rest, numerology or PURE Astrology contribution to the winner.

### PURE Astrology

- Franchise PURE: **research only** — failed 2025 incremental validation.
- QB PURE: **research only / not promoted** — pregame-safe retest reduced 2025 winner accuracy.
- Coach PURE: **insufficient data coverage** — no conclusion.
- Franchise + QB / full Phase 2: **rejected for production** at the tested definitions and weights.

This does not claim that every possible PURE Astrology formulation has no signal. It means the specific, predeclared Phase 1/2 feature definitions tested here have not earned production influence under chronological validation.

## Governance going forward

1. Do not retune Phase 2 aspects or coefficients from the 2025/2026 failures and then report the same games as new validation.
2. New PURE formulations must be specified before evaluating a new untouched temporal window.
3. Continue logging PURE features prospectively even when they do not score.
4. Build the coach layer only after point-in-time identity/DOB coverage is high enough to evaluate honestly.
5. Add backup QB, blindside tackle, key defender and kicker only when equivalent pregame historical identity is available.
6. Production football changes must continue to pass isolated ablations rather than being bundled with astrology changes.
