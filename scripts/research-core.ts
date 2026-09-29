export type ResearchDecision = 'KILLED' | 'INCONCLUSIVE' | 'SURVIVED_RESEARCH' | 'SHADOW_CANDIDATE' | 'PRODUCTION_CANDIDATE';

export interface ResearchFeatureSnapshot {
  baseLogit: number;
  formLogit: number;
  venueLogit: number;
  h2hLogit: number;
  personnelLogit: number;
  restLogit: number;
}

export interface ResearchPredictionSnapshot {
  snapshotId: string;
  gameId: string;
  sourceModelVersion: string;
  season: number;
  week: number;
  gameday: string;
  predictionTimestamp: string;
  dataCutoffTimestamp: string;
  homeTeam: string;
  awayTeam: string;
  neutralSite: boolean;
  homeWinProbability: number;
  awayWinProbability: number;
  predictedWinner: string;
  featureSnapshot: ResearchFeatureSnapshot;
  actualWinner?: string;
  homeScore?: number;
  awayScore?: number;
  correct?: boolean;
}

export interface FailureFeatureRow {
  snapshotId: string;
  gameId: string;
  sourceModelVersion: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  predictedWinner: string;
  actualWinner: string;
  predictedHome: boolean;
  correct: boolean;
  earlySeason: boolean;
  neutralSite: boolean;
  confidence: number;
  alignedBaseLogit: number;
  alignedFormLogit: number;
  alignedVenueLogit: number;
  alignedH2hLogit: number;
  alignedPersonnelLogit: number;
  alignedRestLogit: number;
}

export interface ModelReadyFailureRow extends FailureFeatureRow {
  zConfidence: number;
  zBase: number;
  zForm: number;
  zVenue: number;
  zH2h: number;
}

export interface FailureCluster {
  clusterId: string;
  ruleKey: ClusterRuleKey;
  description: string;
  numberOfMisses: number;
  eligibleGames: number;
  missRate: number;
  baselineMissRate: number;
  missRateLift: number;
  seasonsRepresented: number;
  weeksRepresented: number;
  teamsRepresented: number;
  meanModelConfidence: number;
  effectSize: number;
  stabilityScore: number;
  stability: 'NOISE' | 'WEAK' | 'POSSIBLE' | 'STABLE';
  dominantFeatures: string[];
}

export type HypothesisMechanism =
  | 'DAMP_H2H'
  | 'DAMP_VENUE'
  | 'BOOST_FORM'
  | 'DAMP_ELO'
  | 'COMPRESS_CONFIDENCE'
  | 'HOME_BIAS';

export interface ResearchHypothesis {
  hypothesisId: string;
  sourceClusterId: string;
  statement: string;
  mechanism: string;
  featuresInvolved: string[];
  expectedDirection: string;
  historicalPopulation: string;
  minimumSampleRequirement: number;
  proposedImplementation: HypothesisMechanism;
  parameterGrid: number[];
  falsificationCondition: string;
  leakageRisks: string[];
  duplicatedSignals: string[];
  priorityScore: number;
}

export interface ResearchMetrics {
  n: number;
  correct: number;
  accuracy: number;
  brier: number;
  logLoss: number;
}

export interface PairedResult {
  bothCorrect: number;
  controlOnlyCorrect: number;
  challengerOnlyCorrect: number;
  bothWrong: number;
}

export interface ExperimentOutcome {
  decision: ResearchDecision;
  reason: string;
}

export interface LedgerLikeEntry {
  hypothesisId?: string;
  hypothesis_id?: string;
  decision?: string;
}

type ClusterRuleKey =
  | 'HIGH_CONFIDENCE'
  | 'H2H_SUPPORTS_PICK'
  | 'VENUE_SUPPORTS_PICK'
  | 'FORM_OPPOSES_PICK'
  | 'STRONG_ELO_FORM_OPPOSES'
  | 'AWAY_PICK'
  | 'HOME_VENUE_SUPPORT';

interface RuleDefinition {
  key: ClusterRuleKey;
  description: string;
  dominantFeatures: string[];
  predicate: (row: FailureFeatureRow) => boolean;
}

const RULES: RuleDefinition[] = [
  {
    key: 'HIGH_CONFIDENCE',
    description: 'Higher-confidence control predictions that fail more often than the comparison population.',
    dominantFeatures: ['model_confidence'],
    predicate: row => row.confidence >= 0.67
  },
  {
    key: 'H2H_SUPPORTS_PICK',
    description: 'The same-venue H2H term materially supports the predicted side, yet the control still misses.',
    dominantFeatures: ['h2h_logit', 'model_confidence'],
    predicate: row => row.alignedH2hLogit >= 0.06
  },
  {
    key: 'VENUE_SUPPORTS_PICK',
    description: 'The current-season venue term materially supports the predicted side, yet the control still misses.',
    dominantFeatures: ['venue_logit', 'home_or_away'],
    predicate: row => row.alignedVenueLogit >= 0.06
  },
  {
    key: 'FORM_OPPOSES_PICK',
    description: 'Current-season form materially opposes the selected side, suggesting the control may underweight form when other signals disagree.',
    dominantFeatures: ['form_logit', 'specialist_disagreement'],
    predicate: row => row.alignedFormLogit <= -0.06
  },
  {
    key: 'STRONG_ELO_FORM_OPPOSES',
    description: 'General team-strength strongly supports the selected side while current-season form points the other way.',
    dominantFeatures: ['elo_difference', 'form_logit', 'specialist_disagreement'],
    predicate: row => row.alignedBaseLogit >= 0.45 && row.alignedFormLogit <= -0.04
  },
  {
    key: 'AWAY_PICK',
    description: 'Away-side control selections that miss at an elevated rate compared with the full historical comparison population.',
    dominantFeatures: ['home_or_away'],
    predicate: row => !row.predictedHome
  },
  {
    key: 'HOME_VENUE_SUPPORT',
    description: 'Home selections receiving material venue support that still miss more often than comparable control predictions.',
    dominantFeatures: ['home_or_away', 'venue_logit'],
    predicate: row => row.predictedHome && row.alignedVenueLogit >= 0.05
  }
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const logistic = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => {
  const bounded = clamp(p, 0.001, 0.999);
  return Math.log(bounded / (1 - bounded));
};

function aligned(value: number, predictedHome: boolean): number {
  return predictedHome ? value : -value;
}

export function buildFailureFeatureRows(snapshots: ResearchPredictionSnapshot[]): FailureFeatureRow[] {
  return snapshots
    .filter(snapshot => snapshot.actualWinner && snapshot.actualWinner !== 'TIE')
    .map(snapshot => {
      const predictedHome = snapshot.predictedWinner === snapshot.homeTeam;
      const actualWinner = snapshot.actualWinner!;
      const correct = snapshot.predictedWinner === actualWinner;
      const f = snapshot.featureSnapshot;
      return {
        snapshotId: snapshot.snapshotId,
        gameId: snapshot.gameId,
        sourceModelVersion: snapshot.sourceModelVersion,
        season: snapshot.season,
        week: snapshot.week,
        homeTeam: snapshot.homeTeam,
        awayTeam: snapshot.awayTeam,
        predictedWinner: snapshot.predictedWinner,
        actualWinner,
        predictedHome,
        correct,
        earlySeason: snapshot.week <= 4,
        neutralSite: snapshot.neutralSite,
        confidence: Math.max(snapshot.homeWinProbability, snapshot.awayWinProbability),
        alignedBaseLogit: aligned(f.baseLogit, predictedHome),
        alignedFormLogit: aligned(f.formLogit, predictedHome),
        alignedVenueLogit: aligned(f.venueLogit, predictedHome),
        alignedH2hLogit: aligned(f.h2hLogit, predictedHome),
        alignedPersonnelLogit: aligned(f.personnelLogit, predictedHome),
        alignedRestLogit: aligned(f.restLogit, predictedHome)
      };
    });
}

function meanSd(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, values.length);
  return { mean, sd: Math.sqrt(variance) || 1 };
}

export function normalizeFailureRows(rows: FailureFeatureRow[]): ModelReadyFailureRow[] {
  const conf = meanSd(rows.map(row => row.confidence));
  const base = meanSd(rows.map(row => row.alignedBaseLogit));
  const form = meanSd(rows.map(row => row.alignedFormLogit));
  const venue = meanSd(rows.map(row => row.alignedVenueLogit));
  const h2h = meanSd(rows.map(row => row.alignedH2hLogit));
  return rows.map(row => ({
    ...row,
    zConfidence: (row.confidence - conf.mean) / conf.sd,
    zBase: (row.alignedBaseLogit - base.mean) / base.sd,
    zForm: (row.alignedFormLogit - form.mean) / form.sd,
    zVenue: (row.alignedVenueLogit - venue.mean) / venue.sd,
    zH2h: (row.alignedH2hLogit - h2h.mean) / h2h.sd
  }));
}

function effectSizeBinary(eligibleMissRate: number, baselineMissRate: number): number {
  const pooled = clamp((eligibleMissRate + baselineMissRate) / 2, 0.01, 0.99);
  const sd = Math.sqrt(pooled * (1 - pooled));
  return (eligibleMissRate - baselineMissRate) / (sd || 1);
}

export function discoverFailureClusters(
  rows: FailureFeatureRow[],
  options: { minMisses?: number; minEligible?: number; minLift?: number } = {}
): FailureCluster[] {
  const minMisses = options.minMisses ?? 8;
  const minEligible = options.minEligible ?? 18;
  const minLift = options.minLift ?? 0.05;
  const baselineMissRate = rows.length ? rows.filter(row => !row.correct).length / rows.length : 0;

  const clusters = RULES.map((rule, index) => {
    const eligible = rows.filter(rule.predicate);
    const misses = eligible.filter(row => !row.correct);
    const missRate = eligible.length ? misses.length / eligible.length : 0;
    const seasons = new Set(misses.map(row => row.season));
    const weeks = new Set(misses.map(row => `${row.season}:${row.week}`));
    const teams = new Set(misses.flatMap(row => [row.homeTeam, row.awayTeam]));
    const meanConfidence = misses.length
      ? misses.reduce((sum, row) => sum + row.confidence, 0) / misses.length
      : 0;
    const lift = missRate - baselineMissRate;
    const effect = effectSizeBinary(missRate, baselineMissRate);
    const sampleScore = Math.min(1, misses.length / 24);
    const seasonScore = Math.min(1, seasons.size / 3);
    const teamScore = Math.min(1, teams.size / 12);
    const effectScore = Math.min(1, Math.max(0, effect) / 0.5);
    const stabilityScore = sampleScore * 0.30 + seasonScore * 0.25 + teamScore * 0.20 + effectScore * 0.25;
    const stability: FailureCluster['stability'] =
      misses.length < minMisses || eligible.length < minEligible || lift < minLift
        ? 'NOISE'
        : stabilityScore >= 0.72 && seasons.size >= 2
          ? 'STABLE'
          : stabilityScore >= 0.48
            ? 'POSSIBLE'
            : 'WEAK';

    return {
      clusterId: `F-${String(index + 1).padStart(3, '0')}-${rule.key}`,
      ruleKey: rule.key,
      description: rule.description,
      numberOfMisses: misses.length,
      eligibleGames: eligible.length,
      missRate,
      baselineMissRate,
      missRateLift: lift,
      seasonsRepresented: seasons.size,
      weeksRepresented: weeks.size,
      teamsRepresented: teams.size,
      meanModelConfidence: meanConfidence,
      effectSize: effect,
      stabilityScore,
      stability,
      dominantFeatures: rule.dominantFeatures
    } satisfies FailureCluster;
  });

  return clusters
    .filter(cluster => cluster.stability === 'POSSIBLE' || cluster.stability === 'STABLE')
    .sort((a, b) => b.stabilityScore - a.stabilityScore || b.missRateLift - a.missRateLift);
}

function hypothesisForCluster(cluster: FailureCluster): Omit<ResearchHypothesis, 'priorityScore'> | null {
  const base = {
    sourceClusterId: cluster.clusterId,
    historicalPopulation: cluster.description,
    minimumSampleRequirement: 20,
    leakageRisks: ['Only immutable pre-kickoff feature snapshots may be used.', 'No final-score or in-game data may enter feature construction.'],
    duplicatedSignals: ['Elo', 'current-season form', 'venue/H2H terms must be checked for overlap.']
  };

  switch (cluster.ruleKey) {
    case 'H2H_SUPPORTS_PICK':
      return {
        ...base,
        hypothesisId: 'H-DAMP-H2H',
        statement: 'The same-venue H2H term may be overweighted when it reinforces a control pick that otherwise has weaker current evidence.',
        mechanism: 'Reduce only the H2H logit contribution while leaving every other control feature unchanged.',
        featuresInvolved: ['h2h_logit'],
        expectedDirection: 'Lower H2H influence should reduce false confidence and may flip a subset of repeated H2H-supported misses.',
        proposedImplementation: 'DAMP_H2H',
        parameterGrid: [0, 0.25, 0.5, 0.75, 1],
        falsificationCondition: 'Reject if chronological validation does not improve probability quality or if winner accuracy deteriorates materially.'
      };
    case 'VENUE_SUPPORTS_PICK':
    case 'HOME_VENUE_SUPPORT':
      return {
        ...base,
        hypothesisId: 'H-DAMP-VENUE',
        statement: 'The current-season venue adjustment may be too strong in a repeated subset of misses.',
        mechanism: 'Reduce only the venue logit contribution.',
        featuresInvolved: ['venue_logit'],
        expectedDirection: 'A lower venue weight should reduce overcommitment to venue-supported selections.',
        proposedImplementation: 'DAMP_VENUE',
        parameterGrid: [0, 0.5, 0.75, 1],
        falsificationCondition: 'Reject if the effect does not replicate on the locked season or if away/home subgroup behavior becomes less stable.'
      };
    case 'FORM_OPPOSES_PICK':
      return {
        ...base,
        hypothesisId: 'H-BOOST-FORM',
        statement: 'Current-season form may be underweighted when it materially disagrees with the selected side.',
        mechanism: 'Increase only the current-season form logit contribution.',
        featuresInvolved: ['form_logit'],
        expectedDirection: 'More form influence should correct some picks where current evidence opposed the control winner.',
        proposedImplementation: 'BOOST_FORM',
        parameterGrid: [1, 1.1, 1.25, 1.5],
        falsificationCondition: 'Reject if the locked-season gain disappears, calibration worsens, or improvement exists only at one narrow parameter.'
      };
    case 'STRONG_ELO_FORM_OPPOSES':
      return {
        ...base,
        hypothesisId: 'H-DAMP-ELO',
        statement: 'Generalized Elo strength may dominate too strongly when current-season form points the opposite way.',
        mechanism: 'Reduce only the pregame Elo/base logit magnitude.',
        featuresInvolved: ['base_elo_logit'],
        expectedDirection: 'A modest Elo damping should allow existing current-season evidence to matter more without adding a new feature.',
        proposedImplementation: 'DAMP_ELO',
        parameterGrid: [0.75, 0.85, 0.9, 1],
        falsificationCondition: 'Reject if broad historical winner accuracy or probability scoring worsens on the locked season.'
      };
    case 'HIGH_CONFIDENCE':
      return {
        ...base,
        hypothesisId: 'H-COMPRESS-CONFIDENCE',
        statement: 'The control may be overconfident in a repeated high-confidence failure population even when winner classification is useful.',
        mechanism: 'Apply probability-only logit temperature compression; winner ordering stays unchanged.',
        featuresInvolved: ['final_control_logit'],
        expectedDirection: 'Lower probability extremity should improve Brier/log loss without changing the selected winner.',
        proposedImplementation: 'COMPRESS_CONFIDENCE',
        parameterGrid: [0.75, 0.85, 0.9, 1],
        falsificationCondition: 'Reject if locked-season Brier and log loss fail to improve together.'
      };
    case 'AWAY_PICK':
      return {
        ...base,
        hypothesisId: 'H-HOME-BIAS-AUDIT',
        statement: 'The control may be slightly underweighting home-field prior information when it selects away teams.',
        mechanism: 'Add a small fixed home-side logit intercept as a controlled challenger.',
        featuresInvolved: ['home_intercept'],
        expectedDirection: 'A small home prior may reduce repeated away-pick errors if they are structural rather than random.',
        proposedImplementation: 'HOME_BIAS',
        parameterGrid: [0, 0.04, 0.08, 0.12],
        falsificationCondition: 'Reject if the apparent away-pick improvement is offset by worse global metrics or disappears across seasons.'
      };
    default:
      return null;
  }
}

export function generateHypotheses(clusters: FailureCluster[]): ResearchHypothesis[] {
  return clusters
    .map(cluster => {
      const raw = hypothesisForCluster(cluster);
      if (!raw) return null;
      const impact = Math.min(1, Math.max(0, cluster.missRateLift) / 0.20);
      const sample = Math.min(1, cluster.numberOfMisses / 30);
      const breadth = Math.min(1, cluster.teamsRepresented / 16);
      const stability = cluster.stabilityScore;
      const simplicity = raw.proposedImplementation === 'COMPRESS_CONFIDENCE' ? 1 : 0.9;
      const priorityScore = 100 * (stability * 0.30 + impact * 0.25 + sample * 0.20 + breadth * 0.15 + simplicity * 0.10);
      return { ...raw, priorityScore } satisfies ResearchHypothesis;
    })
    .filter((value): value is ResearchHypothesis => Boolean(value))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

export function removePreviouslyTested(
  hypotheses: ResearchHypothesis[],
  ledger: LedgerLikeEntry[]
): ResearchHypothesis[] {
  const tested = new Set(ledger.map(entry => entry.hypothesisId || entry.hypothesis_id).filter(Boolean));
  return hypotheses.filter(hypothesis => !tested.has(hypothesis.hypothesisId));
}

export function controlHomeProbability(snapshot: ResearchPredictionSnapshot): number {
  const f = snapshot.featureSnapshot;
  return logistic(f.baseLogit + f.formLogit + f.venueLogit + f.h2hLogit + f.personnelLogit);
}

export function challengerHomeProbability(
  snapshot: ResearchPredictionSnapshot,
  mechanism: HypothesisMechanism,
  parameter: number
): number {
  const f = snapshot.featureSnapshot;
  const control = f.baseLogit + f.formLogit + f.venueLogit + f.h2hLogit + f.personnelLogit;
  switch (mechanism) {
    case 'DAMP_H2H':
      return logistic(f.baseLogit + f.formLogit + f.venueLogit + f.h2hLogit * parameter + f.personnelLogit);
    case 'DAMP_VENUE':
      return logistic(f.baseLogit + f.formLogit + f.venueLogit * parameter + f.h2hLogit + f.personnelLogit);
    case 'BOOST_FORM':
      return logistic(f.baseLogit + f.formLogit * parameter + f.venueLogit + f.h2hLogit + f.personnelLogit);
    case 'DAMP_ELO':
      return logistic(f.baseLogit * parameter + f.formLogit + f.venueLogit + f.h2hLogit + f.personnelLogit);
    case 'COMPRESS_CONFIDENCE':
      return logistic(control * parameter);
    case 'HOME_BIAS':
      return logistic(control + parameter);
  }
}

export function scoreProbabilities(
  snapshots: ResearchPredictionSnapshot[],
  probability: (snapshot: ResearchPredictionSnapshot) => number
): ResearchMetrics {
  let n = 0;
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const snapshot of snapshots) {
    if (!snapshot.actualWinner || snapshot.actualWinner === 'TIE') continue;
    const p = clamp(probability(snapshot), 0.001, 0.999);
    const actualHome = snapshot.actualWinner === snapshot.homeTeam;
    const pickedHome = p >= 0.5;
    n++;
    if (pickedHome === actualHome) correct++;
    brier += Math.pow(p - (actualHome ? 1 : 0), 2);
    logLoss += -(actualHome ? Math.log(p) : Math.log(1 - p));
  }
  return {
    n,
    correct,
    accuracy: n ? correct / n : 0,
    brier: n ? brier / n : 0,
    logLoss: n ? logLoss / n : 0
  };
}

export function pairedComparison(
  snapshots: ResearchPredictionSnapshot[],
  challenger: (snapshot: ResearchPredictionSnapshot) => number
): PairedResult {
  const result: PairedResult = { bothCorrect: 0, controlOnlyCorrect: 0, challengerOnlyCorrect: 0, bothWrong: 0 };
  for (const snapshot of snapshots) {
    if (!snapshot.actualWinner || snapshot.actualWinner === 'TIE') continue;
    const actualHome = snapshot.actualWinner === snapshot.homeTeam;
    const controlCorrect = (controlHomeProbability(snapshot) >= 0.5) === actualHome;
    const challengerCorrect = (challenger(snapshot) >= 0.5) === actualHome;
    if (controlCorrect && challengerCorrect) result.bothCorrect++;
    else if (controlCorrect) result.controlOnlyCorrect++;
    else if (challengerCorrect) result.challengerOnlyCorrect++;
    else result.bothWrong++;
  }
  return result;
}

export function clusterEligibleSnapshots(
  snapshots: ResearchPredictionSnapshot[],
  cluster: FailureCluster
): ResearchPredictionSnapshot[] {
  const rows = buildFailureFeatureRows(snapshots);
  const rowById = new Map(rows.map(row => [row.snapshotId, row]));
  const rule = RULES.find(candidate => candidate.key === cluster.ruleKey);
  if (!rule) return [];
  return snapshots.filter(snapshot => {
    const row = rowById.get(snapshot.snapshotId);
    return Boolean(row && rule.predicate(row));
  });
}

export function decideExperiment(input: {
  control: ResearchMetrics;
  challenger: ResearchMetrics;
  clusterControl: ResearchMetrics;
  clusterChallenger: ResearchMetrics;
  leakagePassed: boolean;
  parameterStable: boolean;
  complexityPenalty?: boolean;
}): ExperimentOutcome {
  if (!input.leakagePassed) return { decision: 'KILLED', reason: 'Automated point-in-time leakage invariant failed.' };
  const accuracyDelta = input.challenger.accuracy - input.control.accuracy;
  const brierDelta = input.challenger.brier - input.control.brier;
  const logLossDelta = input.challenger.logLoss - input.control.logLoss;
  const clusterAccuracyDelta = input.clusterChallenger.accuracy - input.clusterControl.accuracy;
  const clusterBrierDelta = input.clusterChallenger.brier - input.clusterControl.brier;
  const probabilityImproves = brierDelta < 0 && logLossDelta < 0;
  const globalNotWorse = accuracyDelta >= -0.003;
  const clusterImproves = clusterAccuracyDelta > 0 || clusterBrierDelta < 0;

  if (accuracyDelta < -0.01 && brierDelta > 0 && logLossDelta > 0) {
    return { decision: 'KILLED', reason: 'Challenger is materially worse on all primary locked metrics.' };
  }
  if (!input.parameterStable) {
    return { decision: 'INCONCLUSIVE', reason: 'Any apparent gain is too parameter-sensitive to survive the robustness attack.' };
  }
  if (globalNotWorse && probabilityImproves && clusterImproves && !input.complexityPenalty) {
    return { decision: 'SURVIVED_RESEARCH', reason: 'Locked probability metrics improved, global accuracy did not materially regress, and the originating failure population improved.' };
  }
  if (accuracyDelta > 0 && (brierDelta < 0 || logLossDelta < 0) && clusterImproves) {
    return { decision: 'SURVIVED_RESEARCH', reason: 'Locked winner accuracy and at least one probability metric improved, including improvement in the originating failure population.' };
  }
  return { decision: 'INCONCLUSIVE', reason: 'The challenger did not satisfy enough locked global, cluster-specific, and robustness criteria to survive or justify a hard kill.' };
}

export function leakageInvariant(snapshots: ResearchPredictionSnapshot[]): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const snapshot of snapshots) {
    const cutoff = Date.parse(snapshot.dataCutoffTimestamp);
    const predicted = Date.parse(snapshot.predictionTimestamp);
    if (!Number.isFinite(cutoff) || !Number.isFinite(predicted) || cutoff > predicted) {
      violations.push(`${snapshot.gameId}: invalid cutoff/prediction chronology`);
    }
    const allowedKeys = Object.keys(snapshot.featureSnapshot).sort().join(',');
    const requiredKeys = ['baseLogit', 'formLogit', 'h2hLogit', 'personnelLogit', 'restLogit', 'venueLogit'].sort().join(',');
    if (allowedKeys !== requiredKeys) violations.push(`${snapshot.gameId}: feature snapshot schema drift`);
  }
  return { passed: violations.length === 0, violations };
}
