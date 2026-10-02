# EXP-026: Hybrid Bayesian-Monte Carlo Betting System Architecture

## Voulgaris-Inspired Hybrid Design for the NFL Predictor

**Status:** PROPOSED ARCHITECTURE  
**Author:** Alex Kotzev  
**Date:** 2026-10-02  
**Baseline:** v2.2-validated-current-season (66.42% accuracy, Brier 0.2250, log loss 0.6416 on 2025)  
**Market-aware shadow:** EXP-019 (67.16% accuracy, Brier 0.2137, log loss 0.6137 on 2025)  
**Dependencies:** EXP-007 (EPA matchup), EXP-008 (expected margin), EXP-010 (QB value), EXP-015 (OL vs pass-rush), EXP-019 (market-aware), EXP-025 (Tier 1-3 features)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Layer 1 — Pure Football Baseline (existing v2.2)](#3-layer-1--pure-football-baseline)
4. [Layer 2 — Market-Aware Probability (existing EXP-019)](#4-layer-2--market-aware-probability)
5. [Layer 3 — Monte Carlo Game/Drive Simulator (NEW)](#5-layer-3--monte-carlo-gamedrive-simulator)
6. [Layer 4 — Bayesian Calibration Service (NEW)](#6-layer-4--bayesian-calibration-service)
7. [Layer 5 — Coach Tendency & Contextual Signal Layer (NEW)](#7-layer-5--coach-tendency--contextual-signal-layer)
8. [Layer 6 — Bet Decision & Bankroll Layer (NEW)](#8-layer-6--bet-decision--bankroll-layer)
9. [Layer 7 — Governance, Validation & Audit (NEW)](#9-layer-7--governance-validation--audit)
10. [Integration Plan](#10-integration-plan)
11. [New File Manifest](#11-new-file-manifest)
12. [Experiment Governance (EXP-026+)](#12-experiment-governance)
13. [Academic Sources](#13-academic-sources)
14. [Mapping: Voulgaris Concept → Repo Module](#14-mapping-voulgaris-concept--repo-module)

---

## 1. Executive Summary

This document proposes a hybrid betting-system architecture inspired by Haralabos Voulgaris's methodology — the most successful NBA sports bettor documented, who famously exploited halftime totals and coach tendencies before moving to model-driven betting with possession-level simulations ([ESPN, 2013](https://www.espn.com/blog/playbook/dollars/post/_/id/2935/meet-the-worlds-top-nba-gambler)). Nate Silver characterized Voulgaris's thought process as fundamentally Bayesian: forming probability estimates, revising them as evidence arrives, and betting only when the estimate diverges sufficiently from offered odds ([Silver, *The Signal and the Noise*](http://faculty.bard.edu/hhaggard/teaching/sci127Sp20/notes/SilverSignalExcerpt.pdf)).

The proposed architecture layers Voulgaris's concepts onto the existing v2.2 control model and EXP-025 feature set, adding six new service modules that transform the predictor from a pure pick-generator into a complete betting system with uncertainty quantification, market-aware calibration, contextual signal integration, and bankroll management.

**Core thesis:** Voulgaris's hybrid was never "human vs. model" — it was "model plus expert feature engineering." Human intuition beats black-box software when the relevant variable is real but not yet cleanly represented in structured data: coaching tendencies, tactical adjustments, player motivation, regime shifts, and contextual fragments that no data schema captures. Once a signal becomes measurable and repeatable, automation captures and commoditizes it. This architecture preserves both lanes — the automated baseline and the human-context overlay — with strict governance preventing leakage.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EXP-026 HYBRID ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 7: GOVERNANCE & AUDIT                                       │
│  ├── featureTimestampGuard.ts    (leakage prevention utility)        │
│  ├── experimentLedger (EXP-026+)                                     │
│  └── walk-forward validation                                        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 6: BET DECISION & BANKROLL                                   │
│  ├── betDecisionService.ts       (EV, edge, no-bet gate)            │
│  ├── bankrollStrategyService.ts  (fractional Kelly, flat stake)     │
│  └── clvTrackerService.ts        (closing line value tracking)      │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 5: COACH TENDENCY & CONTEXTUAL SIGNALS                       │
│  ├── coachTendencyService.ts     (4th-down, timeout, clock mgmt)    │
│  ├── contextualSignalService.ts  (film notes, motivation, scheme)   │
│  └── expertSignalRegistry.ts     (structured human signal store)    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 4: BAYESIAN CALIBRATION                                      │
│  ├── bayesianCalibrationService.ts (posterior updating, Platt/iso) │
│  └── uncertaintyService.ts       (MC variance, bootstrap, no-bet)   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 3: MONTE CARLO GAME/DRIVE SIMULATOR                          │
│  ├── monteCarloGameService.ts    (drive-by-drive simulation)        │
│  ├── gameStateModel.ts           (down, distance, yardline, clock)  │
│  └── simulationConfig.ts         (iterations, variance, seed mgmt)  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 2: MARKET-AWARE PROBABILITY (EXP-019, existing)              │
│  ├── marketAwareService.ts       (75% market / 25% v2.2 blend)      │
│  └── structuralMarketGates.ts    (disagreement arbiter)             │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 1: PURE FOOTBALL BASELINE (v2.2, existing)                   │
│  ├── validatedPredictionService.ts (Elo + form + venue + H2H)      │
│  ├── epaService.ts, weatherService.ts, travelService.ts             │
│  ├── paceMetricsService.ts, specialTeamsService.ts                  │
│  ├── turnoverExpectationService.ts, dynamicHfaService.ts            │
│  ├── divisionalService.ts, preseasonPriorsService.ts                │
│  └── ensembleService.ts                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data flow

```
nflverse data → Layer 1 (v2.2 + EXP-025 features) → Layer 2 (market blend)
    → Layer 3 (Monte Carlo simulation) → Layer 4 (Bayesian calibration + UQ)
    → Layer 5 (coach/contextual overlay) → Layer 6 (bet decision + bankroll)
    → Layer 7 (governance audit)
```

---

## 3. Layer 1 — Pure Football Baseline

### Existing modules (no changes)

The v2.2 control model remains the production baseline. All EXP-025 Tier 1-3 features are wired in:

| Module | File | Logit Weight | Evidence |
|---|---|---|---|
| EPA matchup efficiency | `services/epaService.ts` | 0.15 | EXP-007: 67.90% |
| Weather (wind/precip) | `services/weatherService.ts` | 0.03/0.02 | Published research |
| Travel + time zones | `services/travelService.ts` | 0.02/0.02 | Published: 2-4pp for 3+ tz |
| Dynamic HFA | `services/dynamicHfaService.ts` | 0.7x-1.3x | HFA declining league-wide |
| Divisional adjustments | `services/divisionalService.ts` | 0.03 | Market inefficiency |
| Preseason priors | `services/preseasonPriorsService.ts` | 0.30/0.15/0.05 | Early-season Elo stabilization |
| Pace metrics | `services/paceMetricsService.ts` | 0.02 | Game flow prediction |
| Special teams EPA | `services/specialTeamsService.ts` | 0.03 | 15-20% of scoring |
| Turnover expectation | `services/turnoverExpectationService.ts` | 0.02 | Turnover regression |
| QB value | (EXP-010, research) | — | Tied accuracy, improved Brier |
| OL vs pass-rush | (EXP-015, research) | — | Improved Brier/log loss |

### Logit aggregation formula (existing)

```
logit(p_final) = logit(p_elo)
  + football_adj + venue_adj + personnel_adj + h2h_adj
  + epa_adj + weather_adj + travel_adj + dynamic_hfa_adj
  + divisional_adj + preseason_prior_adj + pace_adj
  + special_teams_adj + turnover_adj
```

All adjustments default to 0 when data is unavailable, ensuring backward compatibility with v2.2.

### Academic grounding

The v2.2 model's Elo-based approach is consistent with established sports rating systems. Hubáček et al. (2019b) demonstrated that gradient-boosted trees with feature-based methods — including Elo-like ratings — achieved the best performance on the Soccer Prediction Challenge, with pi-ratings identified as optimal features ([Hubáček et al., *Machine Learning*, 2019](https://doi.org/10.1007/s10994-018-5704-6)). Horvat & Job (2020) reviewed over 100 studies and found that neural networks using data segmentation were the most commonly used models, with feature selection and extraction performed prior to model training in almost all cases ([Horvat & Job, *WIREs Data Mining and Knowledge Discovery*, 2020](https://doi.org/10.1002/widm.1380)).

---

## 4. Layer 2 — Market-Aware Probability

### Existing module (EXP-019)

The market-aware shadow layer blends 75% market-implied probability with 25% v2.2 logit:

```
logit(p_market_aware) = 0.75 × logit(p_market) + 0.25 × logit(p_v22)
```

**2025 results:** 67.16% accuracy, Brier 0.2137, log loss 0.6137 vs. control 66.42%, 0.2250, 0.6416.

**2026 observation:** 31/48 = 64.58% vs. control 28/48 = 58.33%. Market-only 32/48 = 66.67%.

### Proposed promotion

Per EXP-025 Phase 2:
1. Display market-aware prediction as primary pick when moneylines are available
2. Keep pure-football v2.2 as secondary lane
3. Fall back to enhanced v2.2 (with Tier 1-3 features) when moneylines are missing

### Academic grounding

Market efficiency in sports betting is well-documented. Pinnacle's closing lines are remarkably well-calibrated: if they imply 60% probability, actual outcomes match at roughly 60% across thousands of events. Positive CLV is widely used as a strong proxy for long-term edge, assuming the closing market is efficient and execution costs and account limits are accounted for ([Datafield Sports Betting Textbook, Ch. 11](https://datafield.dev/sports-betting-textbook/part-03/chapter-11/)). Simon (2024) analyzed 3,681 MLB games across four sportsbooks and found that while forecasts are mostly reliable, there are simple betting strategies that yield significant profit — betting lines tend to overreact, exhibiting significant negatively autocorrelated changes exploitable by sophisticated bettors ([Simon, *Management Science*, 2024](https://doi.org/10.1287/mnsc.2022.00456)).

---

## 5. Layer 3 — Monte Carlo Game/Drive Simulator

### New module: `services/monteCarloGameService.ts`

This module implements the Voulgaris "Ewing" concept — possession-by-possession game simulation — adapted for NFL as drive-by-drive simulation. Voulgaris and his collaborator built Ewing to simulate NBA games possession-by-possession, running tens of thousands of simulations per matchup and discarding the most improbable results ([ESPN, 2013](https://www.espn.com/blog/playbook/dollars/post/_/id/2935/meet-the-worlds-top-nba-gambler)).

### Game state model

```typescript
// services/gameStateModel.ts

export interface GameState {
  down: 1 | 2 | 3 | 4;
  distance: number;          // yards to first down
  yardline: number;          // 1 = own goal line, 100 = opponent goal line
  clockSeconds: number;      // remaining in half
  half: 1 | 2;
  scoreDiff: number;         // home - away
  timeouts: { home: number; away: number };
  possession: 'home' | 'away';
  gamePhase: 'early' | 'mid' | 'late' | 'two_minute' | 'overtime';
  isTwoMinuteWarning: boolean;
}

export interface DriveResult {
  points: 0 | 3 | 6 | 7 | 8;
  possession: 'home' | 'away';
  durationSeconds: number;
  plays: number;
  endingType: 'touchdown' | 'field_goal' | 'punt' | 'turnover' | 'turnover_on_downs' | 'end_of_half';
}

export interface SimulationResult {
  homeScore: number;
  awayScore: number;
  margin: number;            // home - away
  total: number;             // home + away
  homeWin: boolean;
  homeCover: boolean | null; // null if no spread provided
  totalOver: boolean | null; // null if no total provided
}

export interface MonteCarloOutput {
  iterations: number;
  homeWinProbability: number;   // 0-1
  marginDistribution: {
    mean: number;
    stdDev: number;
    percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  };
  totalDistribution: {
    mean: number;
    stdDev: number;
    percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  };
  coverProbability: number | null;
  overProbability: number | null;
  uncertaintyBand: number;      // stdDev of homeWinProbability across bootstrap subsamples
}
```

### Simulation logic

The simulator steps through a game drive-by-drive, using the existing feature services to inform transition probabilities:

```
For each of N iterations (default: 10,000):
  1. Initialize game state (coin toss → possession, score 0-0)
  2. While clock > 0:
     a. Simulate drive outcome using:
        - EPA per play (epaService) → expected yards per play
        - Pace metrics (paceMetricsService) → drive duration
        - Turnover expectation (turnoverExpectationService) → TO probability
        - Special teams (specialTeamsService) → FG range, return TD
        - Weather (weatherService) → scoring environment modifier
        - Coach tendency (coachTendencyService) → 4th-down decision
     b. Update game state (score, clock, possession)
     c. Check game phase transitions (two-minute, end of half)
  3. Record SimulationResult
  4. Aggregate into MonteCarloOutput
```

### Drive outcome model

```typescript
// services/monteCarloGameService.ts (core logic sketch)

interface DriveTransitionProbabilities {
  pTouchdown: number;      // probability drive ends in TD
  pFieldGoal: number;      // probability drive ends in FG
  pPunt: number;           // probability drive ends in punt
  pTurnover: number;        // probability drive ends in turnover
  pTurnoverOnDowns: number; // probability drive ends on downs
  pEndOfHalf: number;      // probability clock expires during drive
  expectedDuration: number; // expected drive duration in seconds
  expectedPlays: number;    // expected number of plays
}

async function computeDriveTransitionProbabilities(
  state: GameState,
  homeAbbr: string,
  awayAbbr: string,
  season: number,
  context: SimulationContext
): Promise<DriveTransitionProbabilities> {
  // Use existing services to compute transition probabilities
  const epaContext = await getMatchupEpaContext(homeAbbr, awayAbbr, season);
  const pace = await getPaceMetrics(homeAbbr, awayAbbr, season);
  const turnoverExp = await getTurnoverExpectation(homeAbbr, awayAbbr, season);
  const specialTeams = await getSpecialTeamsStats(homeAbbr, awayAbbr, season);
  const weather = await getWeatherForGame(/* ... */);

  // Coach tendency overrides 4th-down logic
  const coachTendency = await getCoachTendency(
    state.possession === 'home' ? homeAbbr : awayAbbr,
    state,
    season
  );

  // Compute probabilities from EPA, pace, TO, special teams, weather, coach tendency
  // ...
}
```

### Configuration

```typescript
// services/simulationConfig.ts

export const DEFAULT_SIMULATION_CONFIG = {
  iterations: 10_000,
  bootstrapSamples: 500,      // for uncertainty quantification
  randomSeed: 42,              // deterministic for reproducibility
  discardOutliers: true,       // discard top/bottom 1% of margins
  minIterations: 5_000,        // fallback if time-constrained
  maxIterations: 50_000,       // for high-confidence situations
  driveLevelSimulation: true,  // simulate drives, not plays (performance)
};
```

### Relationship to EXP-008

EXP-008 already predicted continuous home-minus-away scoring margin with ridge regression (margin MAE: 10.283 points) and improved calibration (ECE 0.0396) even though winner accuracy dropped to 64.94%. The Monte Carlo simulator builds on this by replacing the point-estimate margin with a full distribution, enabling:

- Cover probability (not just winner probability)
- Total points over/under probability
- Uncertainty bands for confidence calibration
- Scenario analysis (what if star QB is injured mid-game?)

### Academic grounding

Monte Carlo simulation is a standard technique in sports betting for estimating probability distributions of game outcomes ([Galekwa et al., arXiv:2410.21484, 2024](https://arxiv.org/abs/2410.21484)). Montrucchio, Barbierato & Gatti (2026) introduced an uncertainty-aware forecasting framework for NBA games that integrates team-level performance metrics, rolling-form indicators, and spatial shot-chart embeddings, using a recurrent neural network equipped with Monte Carlo dropout to yield calibrated sequential probabilities. They found that economic value emerges primarily in less-efficient segments of the market — the fused predictor outperforms both market-only and non-market-only variants on moneylines, while spreads and totals show limited exploitable edge, consistent with higher pricing efficiency ([Montrucchio et al., *Information*, 2026](https://doi.org/10.3390/info17010056)).

---

## 6. Layer 4 — Bayesian Calibration Service

### New module: `services/bayesianCalibrationService.ts`

This module implements the Bayesian reasoning that characterized Voulgaris's approach: forming probability estimates, revising them as new evidence arrives, and producing calibrated posteriors ([Silver, *The Signal and the Noise*](http://faculty.bard.edu/hhaggard/teaching/sci127Sp20/notes/SilverSignalExcerpt.pdf)).

### Prior → Likelihood → Posterior pipeline

```
Prior (p_prior):
  - Blend of preseason Elo, market-implied probability, and v2.2 logit
  - Weight: 0.40 market + 0.30 v2.2 + 0.30 preseason Elo (tunable)

Likelihood (p_likelihood):
  - Monte Carlo simulation output (Layer 3)
  - Current-season EPA, pace, turnover, special teams features
  - Weather, travel, divisional context

Posterior (p_posterior):
  - Bayesian-style calibration: logit(p_posterior) = logit(p_prior) + logit(p_likelihood) - logit(p_base)
  - Note: this is an empirical-Bayes / logit-stacking approximation, not a full conjugate posterior.
    The likelihood weights must be learned or predeclared through walk-forward validation.
  - Platt scaling or isotonic regression for final calibration
```

### Double-counting guard

A critical architectural concern: the Monte Carlo simulator (Layer 3) consumes the same raw
features (EPA, pace, turnover, special teams, weather) that are already wired into the v2.2
logit stack (Layer 1). Naively adding the simulation output on top of those same feature logits
would double-count overlapping information.

**Design rule:** The Monte Carlo output should be treated as a separate candidate probability
distribution, not as an additional logit edge. It enters the Bayesian calibration (Layer 4) as
an alternative likelihood source, and the blend weight between the v2.2 logit stack and the
simulation distribution must be predeclared and validated through walk-forward backtesting.

```
logit(p_posterior) = w_prior × logit(p_market_aware)
                    + w_sim × logit(p_monte_carlo)
                    + w_context × context_logit_edge

where w_prior + w_sim + w_context = 1 (predeclared, validated on 2020-2024, confirmed on 2025)
```

This prevents information leakage between layers and ensures each component's marginal
contribution is measurable and auditable.

### Implementation

```typescript
// services/bayesianCalibrationService.ts

export interface BayesianInput {
  priorProbability: number;       // from Layer 2 market-aware blend
  simulationProbability: number;  // from Layer 3 Monte Carlo
  simulationUncertainty: number;  // stdDev across bootstrap samples
  featureLogitAdjustment: number; // sum of EXP-025 logit edges
}

export interface BayesianOutput {
  posteriorProbability: number;   // calibrated 0-1
  posteriorLogit: number;
  confidenceLevel: 'low' | 'medium' | 'high';
  uncertaintyBand: { lower: number; upper: number };
  calibrationMethod: 'platt' | 'isotonic' | 'beta';
  disagreementFlag: boolean;      // prior and simulation disagree
}

export async function bayesianUpdate(input: BayesianInput): Promise<BayesianOutput> {
  // Logit-space Bayesian update
  const priorLogit = logit(clamp(input.priorProbability, 0.01, 0.99));
  const simLogit = logit(clamp(input.simulationProbability, 0.01, 0.99));
  const baseLogit = 0; // neutral prior

  // Posterior in logit space (logistic-normal approximation)
  const posteriorLogit = priorLogit + simLogit - baseLogit + input.featureLogitAdjustment;
  const posteriorProbability = logistic(posteriorLogit);

  // Uncertainty quantification
  const uncertainty = input.simulationUncertainty;
  const lower = logistic(posteriorLogit - 1.96 * uncertainty);
  const upper = logistic(posteriorLogit + 1.96 * uncertainty);

  // Confidence level
  const edge = Math.abs(posteriorProbability - 0.5);
  const confidenceLevel = uncertainty < 0.05 && edge > 0.15
    ? 'high'
    : uncertainty < 0.10 && edge > 0.10
    ? 'medium'
    : 'low';

  // Disagreement flag
  const priorSimDisagreement = Math.abs(
    input.priorProbability - input.simulationProbability
  ) > 0.15;

  return {
    posteriorProbability,
    posteriorLogit,
    confidenceLevel,
    uncertaintyBand: { lower, upper },
    calibrationMethod: 'platt',
    disagreementFlag: priorSimDisagreement,
  };
}
```

### New module: `services/uncertaintyService.ts`

This module tracks model disagreement, bootstrap intervals, Monte Carlo variance, and "no bet" conditions — critical for preventing overconfidence in low-information situations.

```typescript
// services/uncertaintyService.ts

export interface UncertaintyReport {
  totalUncertainty: number;        // combined epistemic + aleatoric
  epistemicUncertainty: number;    // model uncertainty (reducible)
  aleatoricUncertainty: number;   // data noise (irreducible)
  modelDisagreement: number;       // |p_market_aware - p_monte_carlo|
  noBetRecommendation: boolean;    // true if uncertainty too high
  noBetReason: string | null;
}

export function computeUncertainty(
  marketAwareProb: number,
  monteCarloProb: number,
  monteCarloVariance: number,
  bootstrapIntervals: { lower: number; upper: number }
): UncertaintyReport {
  const modelDisagreement = Math.abs(marketAwareProb - monteCarloProb);
  const epistemic = Math.sqrt(monteCarloVariance);
  const aleatoric = (bootstrapIntervals.upper - bootstrapIntervals.lower) / 3.92;

  const total = Math.sqrt(epistemic ** 2 + aleatoric ** 2);

  const noBetRecommendation =
    total > 0.15 ||           // too uncertain
    modelDisagreement > 0.20 || // models disagree
    monteCarloProb < 0.52 ||    // too close to coin flip
    monteCarloProb > 0.48 && monteCarloProb < 0.52;

  return {
    totalUncertainty: total,
    epistemicUncertainty: epistemic,
    aleatoricUncertainty: aleatoric,
    modelDisagreement,
    noBetRecommendation,
    noBetReason: noBetRecommendation
      ? total > 0.15
        ? 'Total uncertainty exceeds 15% threshold'
        : modelDisagreement > 0.20
        ? 'Market-aware and Monte Carlo models disagree by >20%'
        : 'Probability too close to 50% — no exploitable edge'
      : null,
  };
}
```

### Academic grounding

Bayesian calibration in sports prediction is supported by the broader ML literature on sports betting. Galekwa et al. (2024) noted that supervised learning methods dominate the landscape, with ensemble methods like XGBoost showing consistent effectiveness, and that feature engineering has evolved beyond basic statistics to include contextual variables like venue effects, referee tendencies, and team chemistry indicators ([Galekwa et al., arXiv:2410.21484, 2024](https://arxiv.org/abs/2410.21484)). Montrucchio et al. (2026) demonstrated that uncertainty-aware models using Monte Carlo dropout deliver systematically better calibration than non-Bayesian baselines, and that SHAP-based interpretability verifies only pre-game information influences predictions ([Montrucchio et al., *Information*, 2026](https://doi.org/10.3390/info17010056)).

---

## 7. Layer 5 — Coach Tendency & Contextual Signal Layer

This layer implements the human-intuition components of Voulgaris's methodology — the areas where human judgment still beats black-box software.

### New module: `services/coachTendencyService.ts`

Voulgaris's early edge came from profiling coaching tendencies so thoroughly that he said of Eddie Jordan, Jerry Sloan, and Byron Scott: "Those were three coaches I had nailed perfectly. I knew exactly what they were going to do" ([ESPN, 2013](https://www.espn.com/blog/playbook/dollars/post/_/id/2935/meet-the-worlds-top-nba-gambler)). For the NFL, this translates to tracking 4th-down decisions, timeout usage, clock management, challenge tendencies, and scripted opening drives.

```typescript
// services/coachTendencyService.ts

export interface CoachTendency {
  coachName: string;
  teamAbbr: string;
  season: number;
  // 4th-down tendencies
  fourthDownGoRate: number;        // % of 4th-down situations where coach goes for it
  fourthDownGoRateByDistance: {    // by yards to go
    short: number;  // 1-3 yards
    medium: number; // 4-7 yards
    long: number;   // 8+ yards
  };
  fourthDownGoRateByFieldPosition: {
    ownTerritory: number;
    midfield: number;
    opponentTerritory: number;
    redZone: number;
  };
  fourthDownGoRateByScoreDiff: {
    trailing: number;
    tied: number;
    leading: number;
  };
  fourthDownGoRateByGamePhase: {
    earlyGame: number;   // Q1-Q2, >2 min remaining
    lateGame: number;    // Q4, <2 min remaining
  };
  // Timeout management
  timeoutUsageRate: { firstHalf: number; secondHalf: number };
  timeoutsBurnedPerGame: number;
  // Challenge tendencies
  challengeRate: number;
  challengeSuccessRate: number;
  // Clock management
  clockManagementScore: number;  // 0-100, derived from hurry-up frequency
  // Scripted drives
  openingDriveScripted: boolean; // does coach script first 15 plays?
  openingDrivePassRate: number;
  // Play-calling tendencies
  runPassRatio: { overall: number; firstDown: number; secondDown: number; thirdDown: number };
  personnelGroupings: Record<string, number>; // 11-personnel, 12-personnel, etc.
}

export interface CoachTendencyAdjustment {
  logitEdge: number;     // adjustment to home win probability
  confidence: 'low' | 'medium' | 'high';
  source: string;        // coach name + season
  reasoning: string;     // human-readable explanation
}

export async function getCoachTendency(
  teamAbbr: string,
  gameState: GameState,
  season: number
): Promise<CoachTendency | null> {
  // Fetch from nflverse play-by-play data
  // Compute 4th-down tendencies, timeout usage, etc.
  // Return null if insufficient sample (< 5 games of data)
}

export async function getCoachTendencyAdjustment(
  homeAbbr: string,
  awayAbbr: string,
  gameState: GameState,
  season: number
): Promise<CoachTendencyAdjustment> {
  // Compare coaching tendencies in context
  // Example: if home coach is aggressive on 4th down and away coach is conservative,
  // and game state favors aggression, add small logit edge to home team
  // Weight: 0.02-0.05 logit (pre-declared before backtesting)
}
```

### New module: `services/contextualSignalService.ts`

Voulgaris gathered "a thousand little secrets, quanta of information" — following player Twitter feeds, parsing press-conference language, monitoring locker-room dynamics ([Silver, *The Signal and the Noise*](http://faculty.bard.edu/hhaggard/teaching/sci127Sp20/notes/SilverSignalExcerpt.pdf)). This module provides a structured framework for recording and testing such signals.

```typescript
// services/contextualSignalService.ts

export interface ContextualSignal {
  id: string;
  gameId: string;
  timestamp: string;         // ISO 8601, must be before kickoff
  author: string;            // who recorded the signal
  category: ContextualCategory;
  team: string;              // affected team
  direction: 'positive' | 'negative' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
  expectedLogitEdge: number; // expected impact on win probability
  expirationRule: string;    // when this signal becomes stale
  productionAllowed: boolean; // false = research only
  source: string;            // URL, film timestamp, or description
  notes: string;             // human-readable detail
}

export type ContextualCategory =
  | 'injury_context'        // non-reported injury impact, player recovery status
  | 'scheme_change'         // offensive/defensive scheme adjustment
  | 'motivation'           // playoff clinch, letdown, revenge game
  | 'personnel_change'      // depth chart change not yet in data
  | 'game_plan'            // coach press conference hints
  | 'environment'          // weather interpretation beyond raw data
  | 'locker_room'          // team chemistry, internal conflict
  | 'rest_recovery'        // short week, travel fatigue beyond raw miles
  | 'matchup_specific'     // individual player matchup insight
  | 'market_signal';       // line movement interpretation
```

### New module: `services/expertSignalRegistry.ts`

Every human/film signal must follow the repo's existing governance pattern — timestamped, sourced, categorized, and testable. This is not a raw "override button" but a structured feature source that gets tested like any other feature.

```typescript
// services/expertSignalRegistry.ts

export interface RegisteredSignal extends ContextualSignal {
  registeredAt: string;         // when signal was entered
  resolvedAt: string | null;    // when game was played
  actualOutcome: 'correct' | 'incorrect' | 'unresolved' | null;
  actualLogitImpact: number | null;  // measured impact vs. expected
  backtestEligible: boolean;    // can be used in walk-forward validation
}

export class ExpertSignalRegistry {
  private signals: Map<string, RegisteredSignal> = new Map();

  register(signal: ContextualSignal): string {
    // Validate timestamp is before kickoff
    // Validate all required fields
    // Assign ID and store
    // Return signal ID
  }

  getSignalsForGame(gameId: string): RegisteredSignal[] {
    // Return all signals for a specific game
    // Only return signals where productionAllowed === true
  }

  resolve(signalId: string, outcome: boolean, actualLogitImpact: number): void {
    // After game is played, record actual outcome
    // For future backtesting
  }

  aggregateLogitEdge(gameId: string): number {
    // Sum all production-allowed signal edges for a game
    // Apply confidence weighting: high=1.0, medium=0.5, low=0.25
  }
}
```

### Where human intuition still wins

Based on the Voulgaris analysis, the contextual signal layer addresses five domains where human judgment retains a structural edge over automated systems:

1. **Feature discovery before data encoding** — A human watching film notices a new tactical pattern (e.g., a coach's new substitution package) before it exists as a structured variable in any dataset.

2. **Causal reasoning vs. correlation** — Understanding *why* a pattern exists (e.g., a player inflating stats for free agency) enables predicting its persistence, while models may overfit spurious correlations.

3. **Small-sample and regime-shift intelligence** — When coaching schemes change or playoff incentives shift, historical data becomes stale. A human can identify a regime shift after 1-2 games; a model may require dozens of observations.

4. **Contextual signal integration** — Press-conference language, player behavior, locker-room dynamics — soft signals that no structured data feed captures. Voulgaris followed player Twitter feeds and parsed coaches' phrasing for tactical intent.

5. **The human element** — As Voulgaris himself said about his current work in football: "That human element is the biggest challenge, the most interesting part of the puzzle. You can't put that on the spreadsheet" ([The Guardian, 2024](https://www.theguardian.com/football/2024/feb/18/castellon-owner-bob-voulgaris-analytics-gambling-interview)).

### Where intuition fails

The architecture also acknowledges the limits of human judgment:
- **Emotional vulnerability:** Voulgaris's 2003-04 "tilt" — hyper-aggressive loss chasing — is the failure mode that automated systems eliminate.
- **Bandwidth limits:** No human processes 1,230 NBA games with the thoroughness of a model. Voulgaris's migration from ~350 subjective bets to 1,000+ model-driven bets acknowledged this.
- **Edge decay:** Bookmakers learn from bet patterns. Automation accelerates competitive adjustment.

---

## 8. Layer 6 — Bet Decision & Bankroll Layer

This layer separates prediction from wager decision — the distinction between "who will win" and "should I bet this."

### New module: `services/betDecisionService.ts`

```typescript
// services/betDecisionService.ts

export interface BetDecision {
  recommendation: 'bet' | 'no_bet' | 'wait';
  betType: 'moneyline' | 'spread' | 'total' | null;
  recommendedSide: 'home' | 'away' | 'over' | 'under' | null;
  modelProbability: number;
  marketProbability: number;
  edge: number;              // modelProb - marketProb
  expectedValue: number;     // edge × stake
  uncertainty: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
}

export function evaluateBet(
  modelProb: number,
  marketProb: number,
  uncertainty: UncertaintyReport,
  bankroll: number
): BetDecision {
  const edge = modelProb - marketProb;
  const ev = edge * bankroll * 0.01; // 1% bankroll unit

  // No-bet conditions
  if (uncertainty.noBetRecommendation) {
    return {
      recommendation: 'no_bet',
      betType: null,
      recommendedSide: null,
      modelProbability: modelProb,
      marketProbability: marketProb,
      edge,
      expectedValue: 0,
      uncertainty: uncertainty.totalUncertainty,
      confidence: 'low',
      reasoning: uncertainty.noBetReason || 'Uncertainty too high',
    };
  }

  if (Math.abs(edge) < 0.03) {
    return {
      recommendation: 'no_bet',
      betType: null,
      recommendedSide: null,
      modelProbability: modelProb,
      marketProbability: marketProb,
      edge,
      expectedValue: 0,
      uncertainty: uncertainty.totalUncertainty,
      confidence: 'low',
      reasoning: 'Edge below 3% threshold — no exploitable value',
    };
  }

  // Determine bet type and side
  const recommendedSide = modelProb > marketProb ? 'home' : 'away';
  const betType = 'moneyline'; // simplified; extend for spread/total

  return {
    recommendation: 'bet',
    betType,
    recommendedSide,
    modelProbability: modelProb,
    marketProbability: marketProb,
    edge,
    expectedValue: ev,
    uncertainty: uncertainty.totalUncertainty,
    confidence: uncertainty.totalUncertainty < 0.05 ? 'high' : 'medium',
    reasoning: `Model gives ${(modelProb * 100).toFixed(1)}% vs market ${(marketProb * 100).toFixed(1)}% — edge of ${(edge * 100).toFixed(1)}pp`,
  };
}
```

### New module: `services/bankrollStrategyService.ts`

```typescript
// services/bankrollStrategyService.ts

export interface BankrollDecision {
  stake: number;              // recommended wager amount
  stakePercent: number;       // % of bankroll
  strategy: 'fractional_kelly' | 'flat' | 'quarter_kelly';
  kellyFraction: number;       // full Kelly stake (for reference)
  reasoning: string;
}

export function computeStake(
  modelProb: number,
  marketProb: number,
  bankroll: number,
  uncertainty: number,
  strategy: 'fractional_kelly' | 'flat' | 'quarter_kelly' = 'quarter_kelly'
): BankrollDecision {
  // Kelly criterion: f = (bp - q) / b
  // where b = decimal odds - 1, p = model prob, q = 1 - p
  const decimalOdds = 1 / marketProb;
  const b = decimalOdds - 1;
  const p = modelProb;
  const q = 1 - p;
  const kellyFraction = (b * p - q) / b;

  // Uncertainty discount: reduce stake when uncertain
  const uncertaintyDiscount = Math.max(0.3, 1 - uncertainty * 2);

  let stakePercent: number;
  switch (strategy) {
    case 'fractional_kelly':
      stakePercent = kellyFraction * 0.5 * uncertaintyDiscount; // half Kelly
      break;
    case 'quarter_kelly':
      stakePercent = kellyFraction * 0.25 * uncertaintyDiscount;
      break;
    case 'flat':
      stakePercent = 0.01; // 1% flat
      break;
  }

  // Cap at 5% of bankroll
  stakePercent = Math.max(0, Math.min(stakePercent, 0.05));

  const stake = bankroll * stakePercent;

  return {
    stake,
    stakePercent,
    strategy,
    kellyFraction,
    reasoning: `${strategy} with ${(uncertaintyDiscount * 100).toFixed(0)}% uncertainty discount — ${stakePercent < 0 ? 'no bet (negative Kelly)' : (stakePercent * 100).toFixed(2) + '% of bankroll'}`,
  };
}
```

### Academic grounding

Uhrín, Šourek, Hubáček & Železný (2021) demonstrated that betting strategy has a major influence on final profit measures — a worse model with a better strategy can outperform a better model with a worse strategy. They tested Kelly criterion variants across horse racing, basketball, and soccer, finding that an adaptive variant of the "fractional Kelly" method is a very suitable choice across a wide range of settings ([Uhrín et al., *IMA Journal of Management Mathematics*, 2021](https://arxiv.org/abs/2107.08827)).

### New module: `services/clvTrackerService.ts`

Closing Line Value (CLV) — the gap between odds at bet placement and the closing line — is widely regarded as the gold-standard metric for evaluating betting skill. Consistently positive CLV is a strong proxy for long-term edge, assuming an efficient closing market and accounted-for execution costs.

```typescript
// services/clvTrackerService.ts

export interface CLVRecord {
  gameId: string;
  betTimestamp: string;
  placedOdds: number;          // decimal odds at placement
  placedImpliedProb: number;   // 1 / placedOdds
  closingOdds: number;        // decimal odds at kickoff
  closingImpliedProb: number;  // 1 / closingOdds
  clv: number;                 // placedImpliedProb - closingImpliedProb
  betResult: 'win' | 'loss' | 'push' | 'pending';
  pnl: number;                 // profit/loss on this bet
  cumulativeCLV: number;      // running total
}

export class CLVTracker {
  private records: CLVRecord[] = [];

  record(record: Omit<CLVRecord, 'cumulativeCLV'>): void { /* ... */ }

  getAverageCLV(): number {
    if (this.records.length === 0) return 0;
    return this.records.reduce((sum, r) => sum + r.clv, 0) / this.records.length;
  }

  getCLVPercentile(): { p25: number; p50: number; p75: number } { /* ... */ }

  getPositiveCLVRate(): number {
    return this.records.filter(r => r.clv > 0).length / this.records.length;
  }

  getROIFromCLV(): number {
    // Expected ROI ≈ average CLV × number of bets
    return this.getAverageCLV() * this.records.length;
  }
}
```

### Academic grounding

CLV as the primary performance metric is supported by research showing that Pinnacle's closing lines are extremely well-calibrated — if Pinnacle's closing line implies 60% win probability, actual win rate across thousands of events is very close to 60%. Consistently beating the closing line demonstrates genuine predictive edge ([Datafield Sports Betting Textbook, Ch. 11](https://datafield.dev/sports-betting-textbook/part-03/chapter-11/)). Simon (2024) found that sports betting markets exhibit semi-efficiency: efficient enough that naive strategies fail, but inefficient enough that skilled bettors with information advantages, superior models, or faster execution can find edges — particularly in less liquid markets, at opening lines, and in prop betting markets ([Simon, *Management Science*, 2024](https://doi.org/10.1287/mnsc.2022.00456)).

---

## 9. Layer 7 — Governance, Validation & Audit

### New module: `services/featureTimestampGuard.ts`

The repo already enforces strict timestamp rules (every feature must have a timestamp rule and missing-data rule before backtesting). This module makes timestamp validation a first-class shared utility.

```typescript
// services/featureTimestampGuard.ts

export interface TimestampGuard {
  featureName: string;
  gameId: string;
  gameKickoff: string;        // ISO 8601
  featureTimestamp: string;   // when the feature data was available
  isPregame: boolean;         // true if featureTimestamp < gameKickoff
  violation: string | null;   // null if OK, description if violation
}

export function validateTimestamp(
  featureName: string,
  gameId: string,
  gameKickoff: string,
  featureTimestamp: string
): TimestampGuard {
  const kickoff = new Date(gameKickoff).getTime();
  const feature = new Date(featureTimestamp).getTime();
  const isPregame = feature < kickoff;

  return {
    featureName,
    gameId,
    gameKickoff,
    featureTimestamp,
    isPregame,
    violation: !isPregame
      ? `LEAKAGE: ${featureName} timestamp ${featureTimestamp} is after kickoff ${gameKickoff}`
      : null,
  };
}

export function validateAllFeatures(
  gameId: string,
  gameKickoff: string,
  features: { name: string; timestamp: string }[]
): TimestampGuard[] {
  return features.map(f =>
    validateTimestamp(f.name, gameId, gameKickoff, f.timestamp)
  );
}
```

### Walk-forward validation (existing, extended)

The existing `scripts/walk-forward-validation.ts` should be extended to validate the full 7-layer stack:

1. Run Layer 1 (v2.2) across 2020-2025 (existing)
2. Run Layer 2 (market-aware) across same period (existing)
3. Run Layer 3 (Monte Carlo) — compare simulation accuracy vs. actuals
4. Run Layer 4 (Bayesian calibration) — compare calibrated vs. raw probabilities
5. Run Layer 5 (coach/contextual) — test each signal category independently
6. Run Layer 6 (bet decisions) — track CLV, ROI, profit/loss
7. Audit with Layer 7 — verify no timestamp violations

### Experiment governance rules (inherited + extended)

1. `v2.2-validated-current-season` remains runnable as the production/control model.
2. Experimental features cannot modify the control's historical predictions.
3. Every new feature needs a timestamp rule and a missing-data rule before backtesting.
4. A feature is not promoted because it makes one slate or one season look better.
5. Market-assisted and non-market models must remain separately labeled.
6. Post-confirmation ablations can generate hypotheses but cannot be used to retune the same test season and call it untouched.
7. **NEW:** Every contextual signal must have a timestamp, author, category, confidence, expected direction, expiration rule, and production-allowed flag before it can influence any prediction.
8. **NEW:** Monte Carlo simulation results must be reproducible (fixed seed) and auditable.
9. **NEW:** Bet decisions must record placed odds, closing odds, and CLV for every wager.
10. **NEW:** No bet decision can be made when the uncertainty gate recommends "no bet."

---

## 10. Integration Plan

### Phase 1: Monte Carlo Simulator (Weeks 1-3)

1. Implement `gameStateModel.ts` — define the game state interface
2. Implement `monteCarloGameService.ts` — drive-by-drive simulation engine
3. Implement `simulationConfig.ts` — configuration and seed management
4. Wire into existing services (EPA, pace, turnover, special teams, weather)
5. Backtest against 2020-2025 — compare margin distribution accuracy vs. EXP-008
6. Log as EXP-026A

### Phase 2: Bayesian Calibration (Weeks 4-5)

1. Implement `bayesianCalibrationService.ts` — prior → likelihood → posterior
2. Implement `uncertaintyService.ts` — epistemic/aleatoric decomposition, no-bet gate
3. Backtest calibration improvement (Brier, log loss, ECE) vs. v2.2 and EXP-019
4. Log as EXP-026B

### Phase 3: Coach Tendency & Contextual Signals (Weeks 6-8)

1. Implement `coachTendencyService.ts` — 4th-down, timeout, clock management patterns
2. Implement `contextualSignalService.ts` — structured signal framework
3. Implement `expertSignalRegistry.ts` — signal store with governance
4. Backtest coach tendency adjustments independently (EXP-026C)
5. Backtest contextual signals with walk-forward validation (EXP-026D)
6. **All signals start as research-only (productionAllowed = false)**

### Phase 4: Bet Decision & Bankroll (Weeks 9-10)

1. Implement `betDecisionService.ts` — EV, edge, no-bet gate
2. Implement `bankrollStrategyService.ts` — fractional Kelly
3. Implement `clvTrackerService.ts` — CLV recording and tracking
4. Run paper-trading simulation across 2025 season
5. Log as EXP-026E

### Phase 5: Full Stack Integration (Weeks 11-12)

1. Wire all 7 layers into `validatedPredictionService.ts`
2. Implement `featureTimestampGuard.ts` — leakage prevention
3. Run full walk-forward validation across 2020-2025
4. Confirm integrated model improves over v2.2 on untouched 2025
5. If accuracy improves, promote to production
6. If not, ablate features individually
7. Log as EXP-026F

### Phase 6: Live Forward Testing (Ongoing)

1. Deploy market-aware + Monte Carlo + Bayesian stack for 2026 season
2. Track CLV on every bet recommendation
3. Record contextual signals with timestamps
4. Audit at season end — compare predicted vs. actual
5. No promotion of any feature based on a single season

---

## 11. New File Manifest

### New services

| File | Purpose | Layer |
|---|---|---|
| `services/monteCarloGameService.ts` | Drive-by-drive Monte Carlo game simulation | 3 |
| `services/gameStateModel.ts` | Game state interfaces (down, distance, yardline, clock) | 3 |
| `services/simulationConfig.ts` | Simulation configuration (iterations, seeds, variance) | 3 |
| `services/bayesianCalibrationService.ts` | Prior → likelihood → posterior Bayesian updating | 4 |
| `services/uncertaintyService.ts` | Epistemic/aleatoric uncertainty, no-bet gate | 4 |
| `services/coachTendencyService.ts` | 4th-down, timeout, clock management patterns | 5 |
| `services/contextualSignalService.ts` | Structured human/film signal framework | 5 |
| `services/expertSignalRegistry.ts` | Signal store with governance and audit trail | 5 |
| `services/betDecisionService.ts` | EV, edge, no-bet gate | 6 |
| `services/bankrollStrategyService.ts` | Fractional Kelly, flat stake, bankroll management | 6 |
| `services/clvTrackerService.ts` | Closing line value tracking | 6 |
| `services/featureTimestampGuard.ts` | Shared leakage prevention utility | 7 |

### New scripts

| File | Purpose |
|---|---|
| `scripts/monte-carlo-backtest.ts` | Backtest Monte Carlo margin distribution vs. actuals |
| `scripts/bayesian-calibration-backtest.ts` | Backtest calibration improvement (Brier, log loss, ECE) |
| `scripts/coach-tendency-extract.ts` | Extract coach tendencies from nflverse PBP data |
| `scripts/contextual-signal-backtest.ts` | Walk-forward validation of contextual signals |
| `scripts/bet-decision-simulation.ts` | Paper-trading simulation with CLV tracking |
| `scripts/exp026-full-stack-validation.ts` | Full 7-layer walk-forward validation |

### New data files

| File | Purpose |
|---|---|
| `data/coachTendencies/` | Pre-computed coach tendency profiles by season |
| `data/contextualSignals/` | Registered expert signals (JSON, per-game) |
| `data/clvRecords/` | CLV tracking records (JSON, per-season) |

### New research docs

| File | Purpose |
|---|---|
| `research/EXP-026_HYBRID_BAYES_MONTE_CARLO_ARCHITECTURE.md` | This document |
| `research/reports/exp-026a.md` | Monte Carlo simulator backtest results |
| `research/reports/exp-026b.md` | Bayesian calibration backtest results |
| `research/reports/exp-026c.md` | Coach tendency backtest results |
| `research/reports/exp-026d.md` | Contextual signal walk-forward results |
| `research/reports/exp-026e.md` | Bet decision simulation results |
| `research/reports/exp-026f.md` | Full stack integration results |

---

## 12. Experiment Governance

### EXP-026 ledger entries

| ID | Hypothesis | Control | Challenger | Evaluation | Status |
|---|---|---|---|---|---|
| EXP-026A | Drive-by-drive Monte Carlo simulation improves margin prediction and enables cover/total probability | EXP-008 expected margin | Monte Carlo simulator | 2020-2024 select; 2025 confirm; 2026 observe | PROPOSED |
| EXP-026B | Bayesian calibration improves probability quality (Brier, log loss, ECE) beyond v2.2 and EXP-019 | v2.2 + EXP-019 | Bayesian posterior with uncertainty | 2020-2024 select; 2025 confirm; 2026 observe | PROPOSED |
| EXP-026C | Coach tendency adjustments (4th-down, timeout, clock) add predictive value beyond v2.2 | v2.2 | Coach tendency logit edge (0.02-0.05 weight) | 2020-2024 select; 2025 confirm; 2026 observe | PROPOSED |
| EXP-026D | Structured contextual signals (film, motivation, scheme) improve prediction when timestamped and validated | v2.2 | Contextual signal logit edge (research-only initially) | 2020-2024 select; 2025 confirm; 2026 observe | PROPOSED |
| EXP-026E | Bet decision + bankroll strategy produces positive CLV and ROI | N/A (paper trading) | Full 7-layer stack with fractional Kelly | 2025 paper trade; 2026 live | PROPOSED |
| EXP-026F | Full 7-layer integrated stack improves over v2.2 on untouched 2025 | v2.2 | EXP-026A through EXP-026E combined | 2025 confirm; 2026 observe | PROPOSED |

### Pre-declared weights (locked before 2025 evaluation)

| Component | Logit Weight | Source |
|---|---|---|
| Monte Carlo margin (simulated) | Derived from simulation (no fixed weight) | EXP-026A |
| Bayesian posterior | Replaces raw probability (no fixed weight) | EXP-026B |
| Coach tendency | 0.02-0.05 (pre-declared range) | EXP-026C |
| Contextual signals | 0.01-0.03 per signal (research-only initially) | EXP-026D |
| Market blend | 0.75 market / 0.25 model (locked from EXP-019) | EXP-019 |
| Kelly fraction | 0.25 (quarter Kelly) with uncertainty discount | EXP-026E |

### Leakage guards (inherited + new)

- EPA calculations use only plays from games with `gameday < targetIso` (existing)
- Same-week and target-game plays are excluded (existing)
- Monte Carlo simulation uses only features available before kickoff (new)
- Contextual signals must have timestamp before kickoff (new)
- Bet decisions must record placed odds timestamp (new)
- Coach tendency data uses only games from prior seasons and prior weeks of current season (new)

---

## 13. Academic Sources

### Primary sources on ML in sports betting

1. **Galekwa, R. M., Tshimula, J. M., Tajeuna, E., & Kyamakya, K. (2024).** "A Systematic Review of Machine Learning in Sports Betting: Techniques, Challenges, and Future Directions." *arXiv preprint arXiv:2410.21484*.  
   DOI: [10.48550/arXiv.2410.21484](https://doi.org/10.48550/arXiv.2410.21484)  
   URL: [https://arxiv.org/abs/2410.21484](https://arxiv.org/abs/2410.21484)  
   *Key finding:* Systematic review covering SVMs, random forests, neural networks, and ensemble methods across soccer, basketball, tennis, and cricket. Highlights that Bayesian methods, Monte Carlo methods, Markov chains, and Chapman-Kolmogorov equations are among the key techniques applied by sports gamblers. Notes that feature engineering has evolved beyond basic statistics to include contextual variables like venue effects, referee tendencies, and team chemistry indicators.*

2. **Hubáček, O., Šourek, G., & Železný, F. (2019a).** "Exploiting sports-betting market using machine learning." *International Journal of Forecasting*, 35(2), 783–796.  
   DOI: [10.1016/j.ijforecast.2019.01.001](https://doi.org/10.1016/j.ijforecast.2019.01.001)  
   *Key finding:* Demonstrates that gradient-boosted trees (XGBoost) can exploit betting market inefficiencies. Introduces the critical insight that accuracy ≠ profit — a model with inferior accuracy can be profitable with the right betting strategy. Features are more important than the selected ML algorithm.*

3. **Hubáček, O., Šourek, G., & Železný, F. (2019b).** "Learning to predict soccer results from relational data with gradient boosted trees." *Machine Learning*, 108(1), 29–47.  
   DOI: [10.1007/s10994-018-5704-6](https://doi.org/10.1007/s10994-018-5704-6)  
   *Key finding:* Won the 2017 Soccer Prediction Challenge using gradient-boosted trees with pi-ratings as features. Demonstrates that relational feature engineering (team-level ratings derived from match history) outperforms raw statistical features. The model achieved 52.4% accuracy on the challenge test set.*

4. **Uhrín, M., Šourek, G., Hubáček, O., & Železný, F. (2021).** "Optimal sports betting strategies in practice: an experimental review." *IMA Journal of Management Mathematics*, 32(4), 465–489.  
   DOI: [10.1093/imaman/dpab006](https://doi.org/10.1093/imaman/dpab006)  
   Preprint: [https://arxiv.org/abs/2107.08827](https://arxiv.org/abs/2107.08827)  
   *Key finding:* Demonstrates that betting strategy has a major influence on final profit — a worse model with a better strategy can outperform a better model with a worse strategy. Tests Kelly criterion variants across horse racing, basketball, and soccer. An adaptive "fractional Kelly" method is the most suitable choice across a wide range of settings.*

5. **Simon, J. (2024).** "Inefficient Forecasts at the Sportsbook: An Analysis of Real-Time Betting Line Movement." *Management Science*.  
   DOI: [10.1287/mnsc.2022.00456](https://doi.org/10.1287/mnsc.2022.00456)  
   *Key finding:* Analyzes 3,681 MLB games across four sportsbooks. Forecasts are mostly reliable but exhibit overreaction — significant negatively autocorrelated changes exploitable by sophisticated bettors. Weak-form market efficiency is rejected. Opening lines are less efficient than closing lines; speed of identifying and acting on mispricings is a significant advantage.*

6. **Horvat, T., & Job, J. (2020).** "The use of machine learning in sport outcome prediction: A review." *WIREs Data Mining and Knowledge Discovery*, 10(5), e1380.  
   DOI: [10.1002/widm.1380](https://doi.org/10.1002/widm.1380)  
   *Key finding:* Reviews 100+ studies on predicting sport outcomes. Almost all papers use feature selection/extraction prior to ML. Neural networks with data segmentation are most common. Sport predictions are usually treated as classification problems. K-cross-validation and chronological data segmentation are standard evaluation methods.*

7. **Montrucchio, M., Barbierato, E., & Gatti, A. (2026).** "Uncertainty-Aware Machine Learning for NBA Forecasting in Digital Betting Markets." *Information*, 17(1), 56.  
   DOI: [10.3390/info17010056](https://doi.org/10.3390/info17010056)  
   URL: [https://www.mdpi.com/2078-2489/17/1/56](https://www.mdpi.com/2078-2489/17/1/56)  
   *Key finding:* Introduces a fully uncertainty-aware forecasting framework using RNNs with Monte Carlo dropout for calibrated sequential probabilities. Demonstrates that uncertainty-aware models systematically outperform non-Bayesian baselines on calibration. Economic value emerges primarily in less-efficient market segments — moneylines show exploitable edge while spreads and totals show limited edge, consistent with higher pricing efficiency. Uses fractional-Kelly staking, EV thresholds, and bootstrap-based uncertainty estimation.*

### Supporting sources on sports prediction

8. **Tammouch, I., Elouafi, A., & Essadik, I. (2024).** "Betting on Machine Learning: Extracting Patterns from Football's Anarchic Odds." *IEEE CommNet 2024*.  
   DOI: [10.1109/CommNet63022.2024.10793344](https://doi.org/10.1109/CommNet63022.2024.10793344)  
   *Key finding:* Investigates DNNs, Decision Trees, and Random Forests for football match prediction. Emphasizes role of feature selection (Mutual Information) and dimensionality reduction (PCA) in enhancing model accuracy.*

9. **Obradović, A., & Kečo, D. (2024).** "Sports Results Prediction Model Using Machine Learning." *SAR Journal*, 73, 184–189.  
   DOI: [10.18421/sar73-03](https://doi.org/10.18421/sar73-03)  
   *Key finding:* Proposes a framework for developing AI-based sports prediction systems. Reviews data mining approaches for athletic performance evaluation.*

10. **Dalacqua, R., Kajihara, A. Y., & Schwerz, A. L. (2025).** "Match Outcome Prediction in the Brazilian Basketball League using Machine Learning." *IEEE CLEI 2025*.  
    DOI: [10.1109/CLEI67442.2025.11420708](https://doi.org/10.1109/CLEI67442.2025.11420708)  
    *Key finding:* XGBoost consistently delivered best results for basketball outcome prediction, achieving F1-Score = 0.89 with sliding window training. Reinforces importance of data volume for reliable prediction.*

11. **Zhu, H., Soen, A., Cheung, Y.-K., & Xie, L. (2024).** "Online Learning in Betting Markets: Profit versus Prediction." *arXiv preprint arXiv:2406.04062*.  
    DOI: [10.48550/arXiv.2406.04062](https://doi.org/10.48550/arXiv.2406.04062)  
    *Key finding:* Articulates the fundamental incompatibility between maximizing bookmaker profit and eliciting information. Profit hinges on deviation between bettor and true beliefs. Introduces online learning methods for price-setting with O(√T) stochastic regret.*

12. **Wilkens, S. (2021).** "Sports prediction and betting models in the machine learning age: The case of tennis." *Journal of Sports Analytics*.  
    DOI: [10.3233/JSA-200463](https://doi.org/10.3233/JSA-200463)  
    *Key finding:* Tests gradient boosting, logistic regression, and neural networks for tennis prediction. Notes that bookmaker odds alone encompass most relevant information — models struggle to beat market-implied probabilities.*

### Sources on Voulgaris methodology

13. **Eden, S. (2013).** "Meet the world's top NBA gambler." *ESPN The Magazine*.  
    URL: [https://www.espn.com/blog/playbook/dollars/post/_/id/2935/meet-the-worlds-top-nba-gambler](https://www.espn.com/blog/playbook/dollars/post/_/id/2935/meet-the-worlds-top-nba-gambler)  
    *Primary source on Voulgaris's Ewing model, the Whiz, coaching tendencies (Eddie Jordan, Jerry Sloan, Byron Scott), halftime totals edge, Bayesian/Monte Carlo methods, and the evolution from subjective to model-driven betting.*

14. **Silver, N. (2012).** *The Signal and the Noise: Why So Many Predictions Fail — but Some Don't.*  
    Excerpt: [http://faculty.bard.edu/hhaggard/teaching/sci127Sp20/notes/SilverSignalExcerpt.pdf](http://faculty.bard.edu/hhaggard/teaching/sci127Sp20/notes/SilverSignalExcerpt.pdf)  
    *Characterizes Voulgaris's thought process as Bayesian reasoning. Details his Lakers championship bet (13% market-implied vs. 25% his estimate), the Ricky Davis free-agency hypothesis, and his information-gathering approach (film study, Twitter monitoring, press-conference parsing).*

15. **Lowe, S. (2024).** "Castellón's Haralabos Voulgaris: 'Our model gives us a 53% chance...'" *The Guardian*.  
    URL: [https://www.theguardian.com/football/2024/feb/18/castellon-owner-bob-voulgaris-analytics-gambling-interview](https://www.theguardian.com/football/2024/feb/18/castellon-owner-bob-voulgaris-analytics-gambling-interview)  
    *Voulgaris's own words on data-led player identification, the human element ("the biggest challenge, the most interesting part of the puzzle. You can't put that on the spreadsheet"), and his approach to building predictive models.*

### Sources on market efficiency and CLV

16. **Datafield (2026).** "Chapter 11: Understanding Betting Markets." *Sports Betting Textbook*.  
    URL: [https://datafield.dev/sports-betting-textbook/part-03/chapter-11/](https://datafield.dev/sports-betting-textbook/part-03/chapter-11/)  
    *Documents that Pinnacle closing lines are extremely well-calibrated. Opening lines are less efficient than closing lines. Low-liquidity markets are less efficient than high-liquidity markets. CLV is the gold-standard metric for evaluating betting skill.*

17. **Rebellion Research (2026).** "The Algorithmic Trader's Guide to Sports Prediction Markets in 2026."  
    URL: [https://www.rebellionresearch.com/the-algorithmic-traders-guide-to-sports-prediction-markets-in-2026](https://www.rebellionresearch.com/the-algorithmic-traders-guide-to-sports-prediction-markets-in-2026)  
    *Documents structural inefficiencies (longshot bias), real-time anomaly detection for sharp line movement, and CLV-based evaluation as the most rigorous systematic approach.*

---

## 14. Mapping: Voulgaris Concept → Repo Module

| Voulgaris Concept | Description | Repo Module | Status |
|---|---|---|---|
| **Ewing (possession simulator)** | Tens of thousands of simulations per matchup, possession-by-possession | `monteCarloGameService.ts` | NEW (Layer 3) |
| **Van Gundy (lineup/minutes model)** | Feeder model forecasting which lineups/players would be used | `validatedFootballContext.ts` (existing) + `coachTendencyService.ts` (NEW) | PARTIAL |
| **Morey (roster pattern database)** | Tracking trades, draft picks, acquisition tendencies | `preseasonPriorsService.ts` (existing) | PARTIAL |
| **Bayesian reasoning** | Forming probability estimates, revising with new evidence | `bayesianCalibrationService.ts` | NEW (Layer 4) |
| **Coach tendency tracking** | Profiling Eddie Jordan, Jerry Sloan, Byron Scott | `coachTendencyService.ts` | NEW (Layer 5) |
| **Film study / game watching** | 400 games/season, charting defensive positioning | `contextualSignalService.ts` + `expertSignalRegistry.ts` | NEW (Layer 5) |
| **Human override of model** | Sometimes overriding Ewing's recommendations | `expertSignalRegistry.ts` (structured, testable, not raw override) | NEW (Layer 5) |
| **Soft signal gathering** | Twitter feeds, press conferences, body language | `contextualSignalService.ts` (category: `game_plan`, `locker_room`, etc.) | NEW (Layer 5) |
| **Causal hypothesis testing** | Ricky Davis free-agency hypothesis | `expertSignalRegistry.ts` (resolve method) | NEW (Layer 5) |
| **Market-aware blend** | 75% market / 25% model (EXP-019) | `marketAwareService.ts` (existing) | EXISTING (Layer 2) |
| **Scalability (1,000+ bets/season)** | Increased betting frequency with model | `betDecisionService.ts` + `bankrollStrategyService.ts` | NEW (Layer 6) |
| **CLV tracking** | Beat the closing line | `clvTrackerService.ts` | NEW (Layer 6) |
| **Uncertainty awareness** | Confidence levels, no-bet conditions | `uncertaintyService.ts` | NEW (Layer 4) |
| **Leakage prevention** | Timestamp rules, missing-data rules | `featureTimestampGuard.ts` | NEW (Layer 7) |
| **Experiment governance** | No post-hoc retuning, pre-declared weights | `research/EXPERIMENT_LEDGER.md` (existing, extended) | EXISTING + EXTENDED |

---

## Appendix A: Voulgaris's Evolution as a Bettor

Understanding Voulgaris's career arc informs the architecture's phased approach:

| Phase | Period | Method | Key Edge | Repo Analog |
|---|---|---|---|---|
| **Subjective** | Late 1990s–2004 | Film study, coach tendencies, pattern recognition | Halftime totals, coach profiling | Layer 5 (contextual signals) |
| **Hybrid** | 2006–2012 | Ewing model + subjective override | Possession-level simulation + film | Layers 3+5 combined |
| **Model-dependent** | 2012+ | Model-only bet origination | Scale (1,000+ bets/season), ROI decline | Layers 1-4 without Layer 5 |
| **Front office** | 2018–2021 | Dallas Mavericks Dir. of Quant Research | Applied analytics to team strategy | N/A (different domain) |
| **Club ownership** | 2022+ | CD Castellón owner | Data-led football management | N/A (different domain) |

The architecture preserves all three betting phases simultaneously — the subjective lane (Layer 5), the hybrid lane (full stack), and the model-dependent lane (Layers 1-4 only) — letting the user choose which mode to operate in based on available time and expertise.

---

## Appendix B: Research Targets (Success Criteria)

Based on the academic literature and the repo's existing performance. These are aspirational research targets, not guaranteed outcomes:

| Metric | v2.2 Baseline | EXP-019 Market | Target (EXP-026) | Source |
|---|---|---|---|---|
| Winner accuracy (2025) | 66.42% | 67.16% | 67.5-68.5% | Ensemble of model + simulation |
| Brier score | 0.2250 | 0.2137 | < 0.2100 | Bayesian calibration |
| Log loss | 0.6416 | 0.6137 | < 0.6100 | Bayesian calibration |
| ECE | 0.0840 | — | < 0.0500 | Platt/isotonic calibration |
| Margin MAE | 10.28 (EXP-008) | — | < 9.50 | Monte Carlo simulation |
| CLV (average) | N/A | N/A | > +0.02 | Bet decision layer |
| ROI (paper trade) | N/A | N/A | > +3% | Bankroll strategy |

---

*This document follows the repo's experiment governance: all weights are pre-declared before 2025 evaluation, all features have timestamp and missing-data rules, and no post-confirmation ablation can be used to retune the same test season.*
