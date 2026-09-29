# EXP-014 — Explosive Play + Success Rate Engine

## Status
Research challenger only. Production v2.2 remains frozen and unchanged.

## Hypothesis
Pregame offense-vs-defense **success-rate** and **explosive-play-rate** matchup features may capture repeatable team quality that aggregate Elo/form and raw box-score efficiency miss.

## Research contract

1. Use nflverse play-by-play only from completed regular-season plays before the target game week.
2. Exclude the target game and all same-week plays from its feature construction.
3. Build separate offense and defense-allowed profiles for:
   - pass success rate,
   - rush success rate,
   - explosive pass rate,
   - explosive rush rate.
4. Predeclare four explosive-play threshold families:
   - pass >= 15 yards, rush >= 10 yards,
   - pass >= 20 yards, rush >= 10 yards,
   - pass >= 15 yards, rush >= 12 yards,
   - pass >= 20 yards, rush >= 15 yards.
5. For each threshold family test both:
   - all eligible pass/rush plays,
   - a discovery-period garbage-time filter excluding plays with pre-play win probability below 5% or above 95%, when win probability is available.
6. Test logit weights `0, 0.05, 0.10, 0.15, 0.20`.
7. This creates **40 preregistered discovery variants**: 4 threshold definitions × 2 game-state filters × 5 weights.
8. Select the complete specification on **2024 Brier score only**, with log loss as tie-breaker.
9. Lock thresholds, filtering rule, and weight before looking at 2025 confirmation performance.
10. Evaluate unchanged on untouched 2025, then observe 2026 without retuning.
11. Run component ablation, neighboring-weight/threshold/filter robustness, time splits, close-game/blowout splits, and paired winner flips.
12. Do not promote automatically.

## Leakage firewall

For a target game in Week N, EXP-014 uses only play-by-play from weeks `< N` of that same season. Completed games from the target week are conservatively excluded. The target game's plays can never affect its own prediction.

No sportsbook market information, astrology, Lettrology, current-roster hindsight, or future game information is used.

## Matchup construction

Each week's pregame profiles are standardized across teams. For each offense-vs-defense matchup, a favorable score is created from the offense's rate plus the opponent defense's corresponding **rate allowed**. The home offense-vs-away defense score is compared with the away offense-vs-home defense score.

The resulting matchup edge is bounded and applied as a logit adjustment to the frozen v2.2 home-win probability.

## Required evaluation

Primary metrics:

- straight-up accuracy,
- Brier score,
- log loss,
- expected calibration error,
- paired correct/wrong flips against v2.2.

Required splits:

- Weeks 1–4,
- Weeks 5–9,
- Weeks 10–18,
- actual home winners,
- actual away winners,
- one-score games (<= 8 points),
- blowouts (>= 14 points),
- neutral-site games.

## Ablation

At the frozen selected configuration, remove each component independently:

- pass success,
- rush success,
- pass explosive rate,
- rush explosive rate.

Any 2025 ablation result is diagnostic only. It may generate a later hypothesis but may not be used to rewrite EXP-014 and still call 2025 untouched.

## Robustness

After the locked 2025 result is revealed, evaluate immediate neighboring weights, alternative preregistered threshold definitions using the same game-state filter, and the exact filter/no-filter twin. These are diagnostics only and cannot reselect the experiment.

## Reproduce

```bash
bun run research:explosives
```

Runtime outputs:

- `research/runtime/exp-014.json`
- `research/reports/exp-014.md`
