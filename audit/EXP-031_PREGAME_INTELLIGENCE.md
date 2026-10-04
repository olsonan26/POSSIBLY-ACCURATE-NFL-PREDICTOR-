# EXP-031 — DeepSeek / OpenRouter Pregame Intelligence

## Status

Prospective research shadow only. EXP-031 does **not** change the production v2.2 pick or probability.

## Purpose

EXP-031 tests whether verified, time-stamped pregame information can add incremental value beyond the frozen football control. The research model gathers evidence; deterministic application code decides whether the evidence is trustworthy enough to influence the shadow probability.

## Research stack

- OpenRouter Chat Completions API.
- Default model: `deepseek/deepseek-v4-pro-0813`.
- OpenRouter server-side `web_search` and `web_fetch` tools.
- Strict JSON-schema output.
- Server-side evidence gate and bounded logit adjustment.

The model slug can be overridden with `OPENROUTER_PREGAME_MODEL` without changing the production model. Any model change creates a new research condition and must be recorded before comparing results.

## Allowed evidence categories

1. QB — starter status, meaningful QB availability/injury, verified starter changes.
2. Injury — material non-QB player availability.
3. Offensive line — confirmed OL absences, lineup changes, continuity disruptions.
4. Weather — venue-relevant wind, precipitation, temperature/extreme conditions.
5. Roster — verified activation, suspension, trade, signing, release, depth-chart change.
6. Coaching — verified play-caller/head-coach change or direct operational disruption.

Betting lines, public picks, astrology, numerology/Lettrology, fan sentiment, game results, and post-kickoff developments are excluded from EXP-031.

## Source governance

The LLM does not get to declare its own source trustworthy. `pregameIntelligenceService.ts` derives reliability from the URL domain.

High-trust examples:

- NFL / NFL.com
- official club sites
- NOAA / NWS
- AP / Reuters
- ESPN / CBS Sports / NBC Sports / Fox Sports / The Athletic / SI

A material fact must have either:

- at least one source with server-derived reliability >= 0.90, **or**
- at least two independent reliable source domains.

All usable evidence must be time-stamped no later than the evaluation time and no later than kickoff. Post-kickoff evidence is rejected. Single low-trust rumors cannot move the shadow.

## Freshness

Freshness is category-specific. QB/injury information decays quickly; weather is treated as especially time-sensitive; roster/coaching facts have longer horizons. Old evidence is down-weighted even when otherwise credible.

## Fixed v1 adjustment budget

Each accepted fact receives a deterministic effective-evidence score:

`severity × confidence × source reliability × freshness`

That score is multiplied by a preregistered category logit cap:

| Category | Maximum absolute category logit |
| --- | ---: |
| QB | 0.40 |
| Injury | 0.25 |
| Offensive line | 0.20 |
| Weather | 0.10 |
| Roster | 0.12 |
| Coaching | 0.08 |

The **entire EXP-031 adjustment is then hard-capped at ±0.55 logit**. This prevents one research run from overpowering the validated control.

These values are frozen for EXP-031 v1. They must not be tuned from 2026 outcomes and then presented as untouched evidence.

## Prospective-only rule

The API rejects research requests after the scheduled kickoff grace window. We do not reconstruct historical AI research after knowing the result because search engines and pages can expose postgame information, creating severe leakage.

Therefore EXP-031 cannot honestly be backtested by asking DeepSeek today what was known before old games. Its first legitimate evidence is the set of snapshots actually generated and preserved before kickoff.

## Endpoint

`POST /api/pregame-intelligence`

Required body:

```json
{
  "homeTeam": "KC",
  "awayTeam": "DEN",
  "kickoffUtc": "2026-10-18T20:25:00.000Z",
  "baseHomeProbability": 0.61
}
```

Required deployment secret:

`OPENROUTER_API_KEY`

Optional:

- `OPENROUTER_PREGAME_MODEL`
- `OPENROUTER_SITE_URL`

The API key must stay server-side and must never be placed in Vite client environment variables.

## Returned audit information

The response includes:

- research model actually used
- research timestamp
- raw structured evidence payload
- every accepted and rejected fact
- rejection reason
- source domains
- source reliability
- freshness weight
- effective evidence
- individual fact logit adjustment
- total bounded shadow adjustment
- base v2.2 probability
- EXP-031 shadow probability
- explicit `productionPickChanged: false`

A production persistence layer should store this response, or its essential fields, before kickoff so later scoring is auditable.

## Measurement

Once outcomes exist, score only pre-kickoff frozen records:

```bash
bun scripts/score-pregame-shadow.ts --input=prospective-records.jsonl
```

Each scored record needs:

```json
{"baseHomeProbability":0.61,"shadowHomeProbability":0.57,"homeWon":true}
```

The scorer reports:

- control vs shadow straight-up accuracy
- accuracy delta
- control vs shadow Brier score
- Brier delta
- control vs shadow log loss
- log-loss delta
- paired winner flips (shadow-only correct vs control-only correct)

## Promotion rule

EXP-031 should not enter production merely because it wins a handful of games. Promotion requires a meaningful prospective sample, no evidence leakage, stable source coverage, and improvement that survives accuracy **and** probability-quality review. Until an explicit promotion decision is made, v2.2 remains the production control.
