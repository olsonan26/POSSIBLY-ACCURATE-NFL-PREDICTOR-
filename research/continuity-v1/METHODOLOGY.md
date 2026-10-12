# Offseason continuity v1 — preregistration

Status: specification frozen before candidate confirmation scoring. No production changes.
Baseline commit: `9fe9c75` (`v2.2-validated-current-season`).

## Hypothesis

Objective returning personnel continuity moderates offseason Elo regression:
higher continuity retains more of the previous rating's deviation from 1500.
This is not an additive QB-change penalty or generic higher Elo carryover.
No team-specific exceptions, outcome-based roster reconstruction, or 2026 selection.

## Information cutoff and source gate

Freeze each franchise's profile before the first regular-season kickoff of the
league season, not after that franchise's first game. Use the latest documented
pregame snapshot at that cutoff. Prior-season regular-season snaps may weight
returning players; current-season snaps may not. Join stable player IDs, never
names. Missing IDs, ambiguous duplicate starters, or absent snapshots are missing
data, not departures. IR/availability is not inferred from current data.

Weekly labels without a source-supported pregame capture convention are insufficient
to establish availability. A release's present-day download timestamp is not a
historical capture timestamp. The games file's realized starting QB/coach is not
an opening-day announcement. Older weekly data may be explored descriptively,
but cannot pass the pregame provenance gate without independent documentation.

Audit all nine requested components: starting QB, offensive starters, offensive
line, WR/TE/RB, defensive starters, head coach, coordinators, whole roster, returning
snap share. Record excluded components and reasons. Coordinator continuity is
excluded unless independently timestamped coverage exists. No subjective grading.

## Single primary candidate

For each team, C is the mean of returning offensive and defensive snap shares.
Each share is previous regular-season player snaps belonging to players on the
documented opening roster / all previous regular-season player snaps. An ID that
cannot be resolved makes the affected profile ineligible. Include rostered reserve
players: this measures organizational continuity, not an injury adjustment.

Retention = clamp(0.67 + alpha * (C - mu), 0.40, 0.90).
mu is the mean C across eligible 2020–2023 team-seasons, frozen before 2024.
alpha candidates: 0 (baseline), 0.10, 0.20, 0.30. No fitted component weights.
Missing profiles fall back to 0.67 but are explicitly counted; they cannot be used
to claim coverage or evidence. At least 30/32 valid team profiles in each evaluated
season and at least 95% matched prior offensive/defensive snaps are required before
any outcome selection. Report missingness by team and year.

Preserve production Elo update order, season-boundary timing, team aliases,
same-date exclusion, ties in rating updates, home advantage, and rounding. The
baseline's season-boundary timing is deliberately not fixed inside this experiment.
Candidate retention acts at the same boundary as baseline. Target-only snapshots
must never alter historical season transitions retrospectively.

## Chronology and selection

2020–2023 development; 2024 selection; 2025 one-time confirmation; 2026 observation
through September 14 only after a candidate is frozen. Warm up Elo from 1999.
Select lowest 2024 Brier among candidates that do not worsen 2024 accuracy or log
loss, with at least two of three 2021–2023 annual Brier deltas nonpositive. Ties
select smaller alpha; alpha zero means rejection, not a new production model.
Rolling 2021→2022, 2022→2023, 2023→2024, 2024→2025 uses expanding earlier-only
centering and selection. Do not inspect 2025 candidate scores until selection is
persisted with formula and input hashes. 2025 has been used in earlier research;
it is a confirmation season for this frozen experiment, not a globally pristine
holdout across the entire research program. Further experiments need that caveat.

## Gate and ablations

Require non-worse 2025 accuracy, Brier and log loss versus exact same-file baseline,
at least one strict improvement, no more than one rolling evaluation with worse
Brier, and no rolling accuracy decline greater than two percentage points.
Report paired season/block uncertainty; small evidence cannot justify a strong
causal or repeatability claim. Failure of data or baseline parity is BLOCKED,
not evidence rejecting the hypothesis. Failure of a valid tested candidate is REJECTED.

Compare baseline; baseline + continuity; Elo + continuity without other production
context; baseline without form; candidate without form. A continuity-only winner
model is not meaningful (continuity preserves strength, it is not strength).
Also compare centered heterogeneous retention to constant 0.67 to distinguish
continuity from generic stronger carryover. Do not tune using ablation answers.

## Reporting

All eligible non-tied regular-season games: n, correct, incorrect, accuracy,
correct:incorrect ratio, Brier, log loss, home/away pick accuracy, calibration bands
50–55, 55–60, 60–65, 65–70, 70–100 percent; Week 1, Weeks 1–4, 5–8, 9+, overall.
Report ties/exclusions separately. Winner flips include game ID, baseline/candidate
probabilities and picks, outcome, and better/worse status; diagnostic only.
No candidate metrics or flips when provenance is blocked. Do not turn fallback
baseline predictions into apparent candidate evaluation results.

## Architectural boundary

Only `research/continuity-v1/` changes. Production cannot import this directory.
No edits to services, UI, model version, or deployment configuration unless a later
fully evaluated candidate passes. Phase 2 and later remain paused if Phase 1 is
blocked. Research is reviewable in a GitHub PR, not merged into production by default.
