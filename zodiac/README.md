# Chinese Zodiac research integration

This feature is isolated from the existing football control, market shadow, PURE
Astrology, DeepSeek, prediction ledger, and postgame learning. The only existing
source file changed is `App.tsx`, to add a separate tab. No existing dates,
probabilities, scores, dependencies, deployment settings, or database tables change.

## In the application

Open **Chinese Zodiac**, load an NFL date or regular-season week, and check one
game or the complete loaded slate. You can also select official home/away teams
for an exact scheduled date. Completed games show their actual scores separately.

- Year animal, five-element phase, Yin/Yang, and Gan-Zhi stem/branch pair.
- Existing team-date previews, with explicit unaudited-milestone warnings.
- Season/week-specific player birthdays, signs, own-year and enemy-year flags.
- Full-date life path preserving 11/22/33, separate raw/reduced birth day, and
  personal year under an explicitly experimental January 1 convention.
- Reciprocal enemy pairs, same-sign, friend trines, Rat–Ox special pair, and
  unclassified relationships. Non-friends are not automatically enemies.
- Full 0.1.0 schema JSON export when event, kickoff and venue resolve.

This tab never invokes a paid AI service, publishes a Zodiac probability, places
a bet, writes to the ledger, or changes a football prediction. Missing sources
produce visible limitations. No current coach/QB fallback is substituted into
a historical roster. Coach features remain unavailable without verified data.

## Contract and supplied specifications

`prediction_schema.json` transcribes the complete supplied schema, including all
27 nested definitions and conditional branches. The PDF rendered `$ref` and
`$defs` as mathematical fragments; those were restored to valid JSON syntax.
`SKILL.md` preserves the matching application specification from the supplied
PDF. It describes application behavior, not authorization for repository agents.

`rule_registry.json` versions the implemented hypotheses. The supplied document's
bracketed citations are not usable source URLs, so the implementation makes no
independently verified direct-GG33 attribution. All rules are experimental and
untested. `research_manifest.json` records the isolated simulator's features and
unapproved status. No approved or calibrated model artifact is invented.

`server/zodiacValidation.ts` checks every keyword used by this exact schema and
fails on unsupported keywords. It additionally checks source/subject/rule
references, probability equality, trusted inference/manifest identifiers,
approval/calibration prerequisites, data cutoffs, late odds, and missing originals.
The endpoint accepts only `home`, `away`, and `date`; callers cannot supply model
approval or a probability. Structured export fails visibly when venue, identity,
kickoff or schema checks fail.

Historical audits preserve unknown original forecast IDs and timestamps as null,
and publish no reconstructed original probability. Audit snapshot times describe
the present audit; final scores are confined to the audit outcome. The schema's
`forecast_stage: pregame` names the target forecast stage; it does not make a
retrospective audit a forecast made before kickoff. In-progress games have no
pregame export because this contract does not support live forecasts.

## Calendar convention and sources

Chinese-year boundaries use Lunar New Year, supported for Gregorian dates
1901–2100. JavaScript uses ICU's Chinese calendar `relatedYear`; Python uses the
equivalent versioned boundary table. Date-only inputs preserve their written
Gregorian date under the configured Hong Kong calendar convention. No birth
time is invented. Li Chun and hour pillars are not implemented.

Boundary regression anchors were checked against Hong Kong Observatory tables:
[1997](https://www.hko.gov.hk/en/gts/time/calendar/pdf/files/1997e.pdf),
[2024](https://www.hko.gov.hk/en/gts/time/calendar/pdf/files/2024e.pdf), and
[2026](https://www.hko.gov.hk/en/gts/time/calendar/pdf/files/2026e.pdf).
The tests also compare every Python boundary with the JavaScript converter.

Schedules/results come from
[nflverse/nfldata](https://github.com/nflverse/nfldata/blob/master/data/games.csv).
Historical personnel use
[nflverse weekly rosters](https://github.com/nflverse/nflreadr/blob/main/R/load_rosters_weekly.R),
not the latest season roster. ESPN's matched event supplies the actual venue;
timezone lookup uses that venue's address, including supported neutral and
international locations. Unsupported venue addresses block JSON export.

## Python simulator

Install the separate research dependency, then run:

```sh
python -m pip install -r zodiac/requirements.txt
python zodiac/simulator.py --start-season 2020 --end-season 2025
```

The simulator compares seven fixed experiments on identical eligible games:
sports only, Zodiac only, sports plus Zodiac, sports plus age/cohort/calendar
controls, controlled Zodiac, randomized Zodiac control, and Zodiac plus
numerology. It uses a separate Elo research baseline and chronological
regularized logistic regression. Scaling and model fitting use training seasons
only; all same-day pregame features are frozen before scores update ratings.
The final selected season is reserved in code. It reports accuracy, log loss,
Brier score, calibration error and paired differences from the sports baseline.

The committed `evaluation/retrospective-2020-2025.json` contains the first run:
1,345 eligible games for training/evaluation and 681 test games across 2023–2025.
It includes source-file SHA-256 hashes and all seven model comparisons. View it
from **Measured historical results** in the tab. Zodiac additions did not
consistently improve probability metrics; no model was promoted. These results
were not used to change rules, tune weights, or modify the existing predictor.

The weekly roster files are historical reconstructions, with unverified
publication timestamps. Prior-week usage reduces same-game leakage but does not
prove that every input was available before kickoff. These are exploratory
results, not certification of an accurate or profitable model. There is no
automatic model promotion. Franchise signs and historical parallels are excluded
from model fitting until their inputs and rules are audited.

Cache and output files stay in ignored `zodiac/.cache/` and `zodiac/output/`.
No existing training pipeline or automation is changed.

## Verification

```sh
npm run typecheck
npm run build
bun scripts/zodiac-research.test.ts
node scripts/zodiac-node-runtime.test.mjs
python -m unittest discover -s zodiac -p 'test_*.py'
```
