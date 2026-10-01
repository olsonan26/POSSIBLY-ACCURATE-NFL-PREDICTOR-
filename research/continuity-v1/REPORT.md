# Phase 1 — offseason continuity audit v1

**Decision: BLOCKED — insufficient point-in-time information. No continuity candidate was scored, selected, rejected on performance, or promoted. Phase 1 is not fully evaluated; later phases remain paused.**

Production remains at `9fe9c75`, model `v2.2-validated-current-season`. The preregistration commit is `e70a731`.

## Baseline reproduction

Actual production code was called with a frozen nflverse games snapshot. All network requests except the frozen games feed were denied and audited. No live personnel data were requested. All historical results had zero personnel adjustment and no live personnel display.

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2020 | 255 | 173 | 82 | 67.84% | 173:82 | 0.2151 | 0.6225 | 64.15% | 73.96% |
| 2021 | 271 | 162 | 109 | 59.78% | 162:109 | 0.2311 | 0.6546 | 59.06% | 61.00% |
| 2022 | 269 | 166 | 103 | 61.71% | 166:103 | 0.2319 | 0.6553 | 63.48% | 58.24% |
| 2023 | 272 | 167 | 105 | 61.40% | 167:105 | 0.2361 | 0.6664 | 62.78% | 58.70% |
| 2024 | 272 | 180 | 92 | 66.18% | 180:92 | 0.2118 | 0.6122 | 65.14% | 68.04% |
| 2025 | 271 | 180 | 91 | 66.42% | 180:91 | 0.2250 | 0.6416 | 66.27% | 66.67% |
| 2026 | 16 | 10 | 6 | 62.50% | 10:6 | 0.2199 | 0.6307 | 66.67% | 50.00% |

2026 is observation only through September 14. 2020–2024 rows are retrospective baseline diagnostics, not untouched performance claims. The 2025 baseline matches 180/271 and Brier 0.2250. Displayed-probability log loss is 0.6416; the existing carryover research used unrounded probabilities and documented 0.6415. Do not mix rounding conventions when comparing candidates.

## Source coverage and temporal eligibility

| Season | Weekly roster teams | Depth-chart teams | Teams with timestamped preseason depth records | Eligible primary continuity profiles |
|---|---:|---:|---:|---:|
| 2020 | 32 | 32 | 0 | 0/32 |
| 2021 | 32 | 32 | 0 | 0/32 |
| 2022 | 32 | 32 | 0 | 0/32 |
| 2023 | 32 | 32 | 0 | 0/32 |
| 2024 | 32 | 32 | 0 | 0/32 |
| 2025 | 32 | 32 | 32 | 0/32 |

All 19 requested source files downloaded successfully. Prior-season snap files cover 2019–2024. Raw coverage is not pregame eligibility. The 192 team-season records in `profile-coverage.json` are a coverage ledger with missing component values, not reconstructed continuity profiles.

Older depth files expose season/week but no capture timestamp. All six weekly roster files lack a capture timestamp. The 2025 depth file does contain pre-season timestamped observations for all teams, but this does not establish full roster membership or historical 2020–2024 training coverage.

The primary source implementation queries NGS by season and week, and includes a current-roster fallback with null weeks. This audit excludes non-REG/Week-1 rows, but found no documented guarantee that regular weekly rows were frozen before kickoff. That is an unresolved provenance issue, not proof that nflverse data are wrong or unusable.

| Component | Audit disposition |
|---|---|
| Starting QB | Weekly historical depth available; pregame timing unverified for development/selection. Do not use realized game starter as announced starter. |
| Offensive starters / offensive line / WR–TE–RB / defensive starters | Weekly depth available; same timing blocker. No starter overlap fabricated. |
| Head coach / coordinators | Timestamped announcements not acquired. Game-record coach fields alone do not establish the pregame snapshot. |
| Overall roster | Week 1 membership available for all teams, but pre-kickoff provenance unverified. |
| Returning snap share | Prior-season snaps available; pregame membership and audited cross-source ID mapping still required. Not computed. |

## Candidate evaluation

Games tested: 0. Correct, incorrect, accuracy, ratio, Brier, log loss, calibration, home/away accuracy, winner flips, rolling tests and ablations: **not computed**. Baseline fallback would not constitute a continuity experiment. No selection or confirmation candidate scores were examined.

Required next input: timestamped opening-roster archives or independently documented historical pregame snapshot semantics for 2020–2025, followed by audited player-ID joins and snap coverage. The registered formula is unchanged. Do not replace unavailable continuity with a simple QB penalty or generic stronger carryover.

## Baseline week splits and calibration

### 2020

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week_1 | 16 | 11 | 5 | 68.75% | 11:5 | 0.2152 | 0.6180 | 63.64% | 80.00% |
| weeks_1_4 | 62 | 46 | 16 | 74.19% | 46:16 | 0.2064 | 0.6009 | 69.23% | 82.61% |
| weeks_5_8 | 56 | 35 | 21 | 62.50% | 35:21 | 0.2286 | 0.6525 | 61.11% | 65.00% |
| weeks_9_plus | 137 | 92 | 45 | 67.15% | 92:45 | 0.2135 | 0.6199 | 63.10% | 73.58% |
| overall | 255 | 173 | 82 | 67.84% | 173:82 | 0.2151 | 0.6225 | 64.15% | 73.96% |

Excluded ties: 2020_03_CIN_PHI. Week 1 overlaps Weeks 1–4; these groups are not additive.

| Confidence band | Picks | Mean confidence | Observed accuracy |
|---|---:|---:|---:|
| 50–55% | 40 | 52.20% | 67.50% |
| 55–60% | 56 | 57.57% | 55.36% |
| 60–65% | 39 | 62.21% | 58.97% |
| 65–70% | 28 | 67.49% | 75.00% |
| 70–100% | 92 | 77.80% | 77.17% |

### 2021

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week_1 | 16 | 7 | 9 | 43.75% | 7:9 | 0.2505 | 0.6910 | 46.15% | 33.33% |
| weeks_1_4 | 64 | 35 | 29 | 54.69% | 35:29 | 0.2504 | 0.6965 | 52.08% | 62.50% |
| weeks_5_8 | 58 | 39 | 19 | 67.24% | 39:19 | 0.1973 | 0.5765 | 62.86% | 73.91% |
| weeks_9_plus | 149 | 88 | 61 | 59.06% | 88:61 | 0.2360 | 0.6670 | 61.36% | 55.74% |
| overall | 271 | 162 | 109 | 59.78% | 162:109 | 0.2311 | 0.6546 | 59.06% | 61.00% |

Excluded ties: 2021_10_DET_PIT. Week 1 overlaps Weeks 1–4; these groups are not additive.

| Confidence band | Picks | Mean confidence | Observed accuracy |
|---|---:|---:|---:|
| 50–55% | 47 | 52.09% | 48.94% |
| 55–60% | 51 | 57.52% | 47.06% |
| 60–65% | 38 | 62.21% | 55.26% |
| 65–70% | 44 | 66.95% | 61.36% |
| 70–100% | 91 | 78.61% | 73.63% |

### 2022

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week_1 | 15 | 9 | 6 | 60.00% | 9:6 | 0.2407 | 0.6770 | 50.00% | 71.43% |
| weeks_1_4 | 63 | 33 | 30 | 52.38% | 33:30 | 0.2621 | 0.7206 | 53.66% | 50.00% |
| weeks_5_8 | 59 | 35 | 24 | 59.32% | 35:24 | 0.2383 | 0.6681 | 60.47% | 56.25% |
| weeks_9_plus | 147 | 98 | 49 | 66.67% | 98:49 | 0.2164 | 0.6222 | 69.15% | 62.26% |
| overall | 269 | 166 | 103 | 61.71% | 166:103 | 0.2319 | 0.6553 | 63.48% | 58.24% |

Excluded ties: 2022_01_IND_HOU, 2022_13_WAS_NYG. Week 1 overlaps Weeks 1–4; these groups are not additive.

| Confidence band | Picks | Mean confidence | Observed accuracy |
|---|---:|---:|---:|
| 50–55% | 54 | 52.73% | 50.00% |
| 55–60% | 48 | 57.24% | 64.58% |
| 60–65% | 46 | 62.15% | 58.70% |
| 65–70% | 39 | 67.47% | 61.54% |
| 70–100% | 82 | 76.86% | 69.51% |

### 2023

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week_1 | 16 | 8 | 8 | 50.00% | 8:8 | 0.2756 | 0.7551 | 40.00% | 66.67% |
| weeks_1_4 | 64 | 36 | 28 | 56.25% | 36:28 | 0.2396 | 0.6708 | 52.38% | 63.64% |
| weeks_5_8 | 58 | 33 | 25 | 56.90% | 33:25 | 0.2465 | 0.6874 | 64.71% | 45.83% |
| weeks_9_plus | 150 | 98 | 52 | 65.33% | 98:52 | 0.2305 | 0.6564 | 66.35% | 63.04% |
| overall | 272 | 167 | 105 | 61.40% | 167:105 | 0.2361 | 0.6664 | 62.78% | 58.70% |

Excluded ties: none. Week 1 overlaps Weeks 1–4; these groups are not additive.

| Confidence band | Picks | Mean confidence | Observed accuracy |
|---|---:|---:|---:|
| 50–55% | 59 | 52.46% | 61.02% |
| 55–60% | 48 | 57.70% | 41.67% |
| 60–65% | 52 | 62.16% | 63.46% |
| 65–70% | 28 | 66.87% | 67.86% |
| 70–100% | 85 | 77.49% | 69.41% |

### 2024

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week_1 | 16 | 13 | 3 | 81.25% | 13:3 | 0.1908 | 0.5690 | 78.57% | 100.00% |
| weeks_1_4 | 64 | 35 | 29 | 54.69% | 35:29 | 0.2614 | 0.7201 | 54.17% | 56.25% |
| weeks_5_8 | 59 | 37 | 22 | 62.71% | 37:22 | 0.2149 | 0.6204 | 60.53% | 66.67% |
| weeks_9_plus | 149 | 108 | 41 | 72.48% | 108:41 | 0.1893 | 0.5627 | 73.03% | 71.67% |
| overall | 272 | 180 | 92 | 66.18% | 180:92 | 0.2118 | 0.6122 | 65.14% | 68.04% |

Excluded ties: none. Week 1 overlaps Weeks 1–4; these groups are not additive.

| Confidence band | Picks | Mean confidence | Observed accuracy |
|---|---:|---:|---:|
| 50–55% | 49 | 52.12% | 40.82% |
| 55–60% | 40 | 57.45% | 70.00% |
| 60–65% | 57 | 62.19% | 64.91% |
| 65–70% | 43 | 67.25% | 72.09% |
| 70–100% | 83 | 78.40% | 77.11% |

### 2025

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week_1 | 16 | 12 | 4 | 75.00% | 12:4 | 0.2080 | 0.6042 | 72.73% | 80.00% |
| weeks_1_4 | 63 | 46 | 17 | 73.02% | 46:17 | 0.2075 | 0.6019 | 77.50% | 65.22% |
| weeks_5_8 | 57 | 38 | 19 | 66.67% | 38:19 | 0.2411 | 0.6800 | 65.71% | 68.18% |
| weeks_9_plus | 151 | 96 | 55 | 63.58% | 96:55 | 0.2263 | 0.6437 | 61.70% | 66.67% |
| overall | 271 | 180 | 91 | 66.42% | 180:91 | 0.2250 | 0.6416 | 66.27% | 66.67% |

Excluded ties: 2025_04_GB_DAL. Week 1 overlaps Weeks 1–4; these groups are not additive.

| Confidence band | Picks | Mean confidence | Observed accuracy |
|---|---:|---:|---:|
| 50–55% | 53 | 52.73% | 64.15% |
| 55–60% | 48 | 57.24% | 68.75% |
| 60–65% | 38 | 62.31% | 52.63% |
| 65–70% | 32 | 67.58% | 65.62% |
| 70–100% | 100 | 77.91% | 72.00% |

### 2026

| Sample | Games | Correct | Incorrect | Accuracy | C:I | Brier | Log loss | Home-pick accuracy | Away-pick accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| week_1 | 16 | 10 | 6 | 62.50% | 10:6 | 0.2199 | 0.6307 | 66.67% | 50.00% |
| weeks_1_4 | 16 | 10 | 6 | 62.50% | 10:6 | 0.2199 | 0.6307 | 66.67% | 50.00% |
| weeks_5_8 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| weeks_9_plus | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| overall | 16 | 10 | 6 | 62.50% | 10:6 | 0.2199 | 0.6307 | 66.67% | 50.00% |

Excluded ties: none. Week 1 overlaps Weeks 1–4; these groups are not additive.

| Confidence band | Picks | Mean confidence | Observed accuracy |
|---|---:|---:|---:|
| 50–55% | 7 | 52.97% | 42.86% |
| 55–60% | 3 | 56.40% | 66.67% |
| 60–65% | 1 | 62.20% | 100.00% |
| 65–70% | 2 | 69.25% | 100.00% |
| 70–100% | 3 | 70.73% | 66.67% |

## Primary source references

- [nflreadr weekly roster semantics](https://nflreadr.nflverse.com/reference/load_rosters_weekly.html)
- [Depth-chart schema change and capture timestamps](https://nflreadr.nflverse.com/articles/dictionary_depth_charts.html)
- [Prior-season snap data](https://nflreadr.nflverse.com/reference/load_snap_counts.html)
- [NGS roster acquisition code, inspected commit](https://github.com/nflverse/nflverse-rosters/blob/ecc6ef182842deabc81b63018a220bb56d65d5f7/R/rosters_ngs.R)
- [Depth snapshot accumulation code, inspected commit](https://github.com/nflverse/nflverse-rosters/blob/ecc6ef182842deabc81b63018a220bb56d65d5f7/exec/update-depth-charts.R)
