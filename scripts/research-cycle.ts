import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';
import {
  buildFailureFeatureRows,
  challengerHomeProbability,
  clusterEligibleSnapshots,
  controlHomeProbability,
  decideExperiment,
  discoverFailureClusters,
  generateHypotheses,
  leakageInvariant,
  logit,
  normalizeFailureRows,
  pairedComparison,
  removePreviouslyTested,
  ResearchHypothesis,
  ResearchMetrics,
  ResearchPredictionSnapshot,
  scoreProbabilities
} from './research-core';

const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const CONTROL_VERSION = 'v2.2-validated-current-season';
const LEDGER_PATH = resolve('research/experiment-ledger.json');
const QUEUE_PATH = resolve('research/research-queue.json');
const RUNTIME_DIR = resolve('research/runtime');
const REPORT_PATH = resolve('research/reports/latest.md');
const DISCOVERY_SEASONS = new Set([2022, 2023]);
const VALIDATION_SEASON = 2024;
const LOCKED_TEST_SEASON = 2025;

type Game = ReturnType<typeof parseGamesCsv>[number];

interface LedgerEntry {
  experiment_id: string;
  hypothesis_id: string;
  cluster_id: string;
  date: string;
  parent_model: string;
  challenger: string;
  feature_family: string;
  parameters: Record<string, unknown>;
  train_period: string;
  validation_period: string;
  test_period: string;
  accuracy_control?: number;
  accuracy_challenger?: number;
  brier_control?: number;
  brier_challenger?: number;
  logloss_control?: number;
  logloss_challenger?: number;
  paired_game_delta?: number;
  parameter_stability?: string;
  season_stability?: string;
  ablation_result?: string;
  leakage_status?: string;
  decision: string;
  reason: string;
  git_commit: string;
}

interface QueueEntry {
  cluster_id: string;
  hypothesis_id: string;
  priority: number;
  status: 'QUEUED' | 'RUNNING' | 'TESTED' | 'KILLED' | 'SURVIVED' | 'BLOCKED_DATA';
  reason: string;
  dependencies: string[];
}

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const metricText = (m: ResearchMetrics) => `${m.correct}/${m.n} = ${pct(m.accuracy)} | Brier ${m.brier.toFixed(4)} | LogLoss ${m.logLoss.toFixed(4)}`;
const safeWrite = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const readJson = <T>(path: string, fallback: T): T => {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
};

function actualWinner(game: Game): string | undefined {
  if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore) || game.homeScore === game.awayScore) return undefined;
  return game.homeScore! > game.awayScore! ? game.homeTeam : game.awayTeam;
}

async function generateSnapshots(games: Game[]): Promise<ResearchPredictionSnapshot[]> {
  const teams = parseTeamData();
  const byAbbr = new Map(teams.map(team => [team.abbr, team]));
  const selected = games.filter(game =>
    (DISCOVERY_SEASONS.has(game.season) || game.season === VALIDATION_SEASON || game.season === LOCKED_TEST_SEASON) &&
    game.gameType === 'REG' &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeScore !== game.awayScore
  );
  const snapshots: ResearchPredictionSnapshot[] = [];

  for (let i = 0; i < selected.length; i++) {
    const game = selected[i];
    const home = byAbbr.get(game.homeTeam);
    const away = byAbbr.get(game.awayTeam);
    if (!home || !away) continue;
    const result = await predictWinner(
      home,
      away,
      new Date(`${game.gameday}T12:00:00Z`),
      true,
      { neutralSite: game.location === 'Neutral' }
    );
    if (!result.modelScores) continue;
    const s = result.modelScores;
    const homeProbability = s.finalHomeProbability / 100;
    const winner = actualWinner(game);
    const predictedWinner = homeProbability >= 0.5 ? game.homeTeam : game.awayTeam;
    snapshots.push({
      snapshotId: `${CONTROL_VERSION}:${game.gameId || `${game.season}-${game.week}-${game.awayTeam}-${game.homeTeam}`}`,
      gameId: game.gameId || `${game.season}-${game.week}-${game.awayTeam}-${game.homeTeam}`,
      sourceModelVersion: CONTROL_VERSION,
      season: game.season,
      week: Number(game.week) || 0,
      gameday: game.gameday,
      predictionTimestamp: `${game.gameday}T00:00:00.000Z`,
      dataCutoffTimestamp: `${game.gameday}T00:00:00.000Z`,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      neutralSite: game.location === 'Neutral',
      homeWinProbability: homeProbability,
      awayWinProbability: 1 - homeProbability,
      predictedWinner,
      featureSnapshot: {
        baseLogit: logit(s.baseHomeProbability / 100),
        formLogit: s.footballLogitAdjustment,
        venueLogit: s.venueLogitAdjustment,
        h2hLogit: s.h2hLogitAdjustment,
        personnelLogit: s.personnelLogitAdjustment,
        restLogit: s.restLogitAdjustment
      },
      actualWinner: winner,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      correct: winner ? predictedWinner === winner : undefined
    });
    if ((i + 1) % 100 === 0) console.log(`snapshot progress ${i + 1}/${selected.length}`);
  }
  return snapshots;
}

function neutralParameter(hypothesis: ResearchHypothesis): number {
  return hypothesis.proposedImplementation === 'HOME_BIAS' ? 0 : 1;
}

function selectParameter(hypothesis: ResearchHypothesis, validation: ResearchPredictionSnapshot[]) {
  const candidates = hypothesis.parameterGrid.map(parameter => ({
    parameter,
    metrics: scoreProbabilities(validation, snapshot => challengerHomeProbability(snapshot, hypothesis.proposedImplementation, parameter))
  }));
  const selected = candidates.reduce((best, candidate) => {
    if (candidate.metrics.brier < best.metrics.brier - 1e-9) return candidate;
    if (Math.abs(candidate.metrics.brier - best.metrics.brier) < 1e-9 && candidate.metrics.logLoss < best.metrics.logLoss) return candidate;
    return best;
  });
  return { candidates, selected };
}

function exactTwoSidedBinomial(a: number, b: number): number {
  const n = a + b;
  if (!n) return 1;
  const k = Math.min(a, b);
  const choose = (nn: number, kk: number) => {
    let result = 1;
    for (let i = 1; i <= kk; i++) result = result * (nn - kk + i) / i;
    return result;
  };
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i) * Math.pow(0.5, n);
  return Math.min(1, 2 * tail);
}

function replayIntegrity(snapshots: ResearchPredictionSnapshot[]) {
  const violations = snapshots.filter(snapshot => Math.abs(controlHomeProbability(snapshot) - snapshot.homeWinProbability) > 0.0025);
  return { passed: violations.length === 0, violations: violations.map(item => item.gameId) };
}

function parameterStability(
  hypothesis: ResearchHypothesis,
  selectedParameter: number,
  locked: ResearchPredictionSnapshot[],
  control: ResearchMetrics
) {
  const index = hypothesis.parameterGrid.indexOf(selectedParameter);
  const neighborParams = [hypothesis.parameterGrid[index - 1], hypothesis.parameterGrid[index + 1]].filter((value): value is number => value != null);
  const neighbors = neighborParams.map(parameter => ({
    parameter,
    metrics: scoreProbabilities(locked, snapshot => challengerHomeProbability(snapshot, hypothesis.proposedImplementation, parameter))
  }));
  const acceptable = neighbors.filter(item =>
    item.metrics.brier <= control.brier + 0.001 &&
    item.metrics.accuracy >= control.accuracy - 0.01
  ).length;
  return { stable: neighbors.length === 0 ? true : acceptable >= 1, neighbors };
}

function experimentId(ledger: LedgerEntry[]): string {
  const numbers = ledger.map(entry => Number(entry.experiment_id.match(/(\d+)/)?.[1] || 0));
  return `AUTO-${String(Math.max(7, ...numbers) + 1).padStart(3, '0')}`;
}

async function main() {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(dirname(REPORT_PATH), { recursive: true });

  console.log('\nNFL AUTORESEARCH CYCLE');
  console.log('======================');
  console.log('Pipeline: predictions -> misses -> failure matrix -> clusters -> hypotheses -> experiment -> attack -> survive/kill -> ledger');

  const response = await fetch(GAMES_URL);
  if (!response.ok) throw new Error(`Could not load nflverse games.csv: ${response.status}`);
  const games = parseGamesCsv(await response.text());
  const snapshots = await generateSnapshots(games);
  if (snapshots.length < 900) throw new Error(`Autoresearch snapshot coverage too small: ${snapshots.length}`);
  safeWrite(resolve(RUNTIME_DIR, 'prediction-snapshots.json'), snapshots);

  const allRows = buildFailureFeatureRows(snapshots);
  const normalizedRows = normalizeFailureRows(allRows);
  const discoveryRows = allRows.filter(row => DISCOVERY_SEASONS.has(row.season));
  const discoveryMisses = discoveryRows.filter(row => !row.correct);
  const discoveryCorrect = discoveryRows.filter(row => row.correct);
  safeWrite(resolve(RUNTIME_DIR, 'failure-feature-matrix.raw.json'), discoveryMisses);
  safeWrite(resolve(RUNTIME_DIR, 'failure-feature-matrix.model-ready.json'), normalizedRows.filter(row => DISCOVERY_SEASONS.has(row.season) && !row.correct));
  safeWrite(resolve(RUNTIME_DIR, 'comparison-population.correct.json'), discoveryCorrect);

  const clusters = discoverFailureClusters(discoveryRows);
  safeWrite(resolve(RUNTIME_DIR, 'failure-clusters.json'), clusters);
  console.log(`Snapshots: ${snapshots.length}; discovery misses: ${discoveryMisses.length}; comparison correct: ${discoveryCorrect.length}`);
  console.log(`Possible/stable failure clusters: ${clusters.length}`);

  const ledger = readJson<LedgerEntry[]>(LEDGER_PATH, []);
  const hypotheses = removePreviouslyTested(generateHypotheses(clusters), ledger);
  const queue: QueueEntry[] = hypotheses.map(hypothesis => ({
    cluster_id: hypothesis.sourceClusterId,
    hypothesis_id: hypothesis.hypothesisId,
    priority: Number(hypothesis.priorityScore.toFixed(2)),
    status: 'QUEUED',
    reason: hypothesis.statement,
    dependencies: []
  }));
  safeWrite(resolve(RUNTIME_DIR, 'research-queue.json'), queue);

  if (!hypotheses.length) {
    const noCluster = clusters.length ? 'NO UNTESTED STABLE FAILURE HYPOTHESIS FOUND' : 'NO STABLE FAILURE CLUSTER FOUND';
    console.log(noCluster);
    safeWrite(REPORT_PATH, `# NFL Autoresearch latest\n\n${noCluster}\n`);
    return;
  }

  const hypothesis = hypotheses[0];
  const cluster = clusters.find(item => item.clusterId === hypothesis.sourceClusterId)!;
  queue[0].status = 'RUNNING';
  const id = experimentId(ledger);
  const commit = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'working-tree';
  const manifest = {
    experiment_id: id,
    hypothesis_id: hypothesis.hypothesisId,
    cluster_id: hypothesis.sourceClusterId,
    parent_model: CONTROL_VERSION,
    created_at: new Date().toISOString(),
    feature_change: hypothesis.proposedImplementation,
    parameter_values: hypothesis.parameterGrid,
    training_range: '2022-2023 failure discovery',
    validation_range: '2024 parameter selection by Brier',
    locked_test_range: '2025 one-time confirmation',
    datasets: ['nflverse games.csv', 'immutable v2.2 pregame feature snapshots generated by this cycle'],
    random_seed: 20260929,
    model_commit: commit,
    metrics_to_measure: ['accuracy', 'Brier', 'log loss', 'paired winner delta', 'cluster-specific metrics', 'parameter stability', 'leakage'],
    success_conditions: ['No leakage violations', 'Locked global metrics not materially worse', 'Originating failure population improves', 'Neighboring parameter is not catastrophic'],
    failure_conditions: ['Leakage failure', 'Material locked regression on all primary metrics', 'Narrow one-parameter-only effect']
  };
  safeWrite(resolve(RUNTIME_DIR, 'active-experiment-manifest.json'), manifest);
  console.log(`Selected hypothesis: ${hypothesis.hypothesisId} (${hypothesis.priorityScore.toFixed(1)})`);
  console.log(hypothesis.statement);

  const validation = snapshots.filter(snapshot => snapshot.season === VALIDATION_SEASON);
  const locked = snapshots.filter(snapshot => snapshot.season === LOCKED_TEST_SEASON);
  const parameterSelection = selectParameter(hypothesis, validation);
  const selectedParameter = parameterSelection.selected.parameter;
  console.log(`2024 selected parameter: ${selectedParameter}`);
  for (const candidate of parameterSelection.candidates) console.log(`  ${candidate.parameter}: ${metricText(candidate.metrics)}`);

  const control = scoreProbabilities(locked, controlHomeProbability);
  const challengerFn = (snapshot: ResearchPredictionSnapshot) => challengerHomeProbability(snapshot, hypothesis.proposedImplementation, selectedParameter);
  const challenger = scoreProbabilities(locked, challengerFn);
  const paired = pairedComparison(locked, challengerFn);
  const pValue = exactTwoSidedBinomial(paired.controlOnlyCorrect, paired.challengerOnlyCorrect);

  const clusterLocked = clusterEligibleSnapshots(locked, cluster);
  const clusterControl = scoreProbabilities(clusterLocked, controlHomeProbability);
  const clusterChallenger = scoreProbabilities(clusterLocked, challengerFn);
  const leakage = leakageInvariant(snapshots);
  const replay = replayIntegrity(snapshots);
  const stability = parameterStability(hypothesis, selectedParameter, locked, control);
  const neutral = neutralParameter(hypothesis);
  const ablation = scoreProbabilities(locked, snapshot => challengerHomeProbability(snapshot, hypothesis.proposedImplementation, neutral));
  const decision = decideExperiment({
    control,
    challenger,
    clusterControl,
    clusterChallenger,
    leakagePassed: leakage.passed && replay.passed,
    parameterStable: stability.stable
  });

  console.log('\nLOCKED 2025');
  console.log(`CONTROL:    ${metricText(control)}`);
  console.log(`CHALLENGER: ${metricText(challenger)}`);
  console.log(`Origin cluster control: ${metricText(clusterControl)}`);
  console.log(`Origin cluster challenger: ${metricText(clusterChallenger)}`);
  console.log(`Paired: challenger-only ${paired.challengerOnlyCorrect}, control-only ${paired.controlOnlyCorrect}, exact p=${pValue.toFixed(4)}`);
  console.log(`Leakage invariant: ${leakage.passed ? 'PASS' : 'FAIL'}; deterministic replay: ${replay.passed ? 'PASS' : 'FAIL'}`);
  console.log(`Parameter neighborhood: ${stability.stable ? 'PASS' : 'WARNING'}`);
  console.log(`Decision: ${decision.decision} — ${decision.reason}`);

  const entry: LedgerEntry = {
    experiment_id: id,
    hypothesis_id: hypothesis.hypothesisId,
    cluster_id: hypothesis.sourceClusterId,
    date: new Date().toISOString(),
    parent_model: CONTROL_VERSION,
    challenger: `${hypothesis.proposedImplementation}@${selectedParameter}`,
    feature_family: hypothesis.featuresInvolved.join(','),
    parameters: { selected: selectedParameter, grid: hypothesis.parameterGrid, validation_candidates: parameterSelection.candidates },
    train_period: '2022-2023',
    validation_period: '2024',
    test_period: '2025',
    accuracy_control: control.accuracy,
    accuracy_challenger: challenger.accuracy,
    brier_control: control.brier,
    brier_challenger: challenger.brier,
    logloss_control: control.logLoss,
    logloss_challenger: challenger.logLoss,
    paired_game_delta: paired.challengerOnlyCorrect - paired.controlOnlyCorrect,
    parameter_stability: stability.stable ? 'PASS' : 'WARNING',
    season_stability: 'Discovery spans 2022-2023; parameter selected on 2024; locked confirmation 2025.',
    ablation_result: `Neutral/control parameter ${neutral}: ${metricText(ablation)}`,
    leakage_status: leakage.passed && replay.passed ? 'PASS' : `FAIL (${[...leakage.violations, ...replay.violations].slice(0, 5).join('; ')})`,
    decision: decision.decision,
    reason: decision.reason,
    git_commit: commit
  };
  const nextLedger = [...ledger, entry];
  safeWrite(resolve(RUNTIME_DIR, 'experiment-ledger.json'), nextLedger);

  queue[0].status = decision.decision === 'KILLED' ? 'KILLED' : decision.decision === 'SURVIVED_RESEARCH' ? 'SURVIVED' : 'TESTED';
  queue[0].reason = decision.reason;
  const next = queue.find(item => item.status === 'QUEUED');
  safeWrite(resolve(RUNTIME_DIR, 'research-queue.after-cycle.json'), queue);

  const report = `# NFL Autoresearch latest\n\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `## Pipeline counts\n\n` +
    `- Predictions/snapshots: ${snapshots.length}\n` +
    `- Discovery misses: ${discoveryMisses.length}\n` +
    `- Discovery correct comparison games: ${discoveryCorrect.length}\n` +
    `- Possible/stable clusters: ${clusters.length}\n` +
    `- Untested hypotheses before cycle: ${hypotheses.length}\n\n` +
    `## Selected failure cluster\n\n` +
    `**${cluster.clusterId} — ${cluster.stability}**\n\n${cluster.description}\n\n` +
    `Misses ${cluster.numberOfMisses}/${cluster.eligibleGames}; miss-rate lift ${(cluster.missRateLift * 100).toFixed(1)} points; ${cluster.seasonsRepresented} discovery seasons; ${cluster.teamsRepresented} teams.\n\n` +
    `## Hypothesis\n\n**${hypothesis.hypothesisId}** — ${hypothesis.statement}\n\n` +
    `## Experiment\n\n2024 selected parameter **${selectedParameter}** from ${hypothesis.parameterGrid.join(', ')} by Brier before the locked 2025 comparison.\n\n` +
    `- Control: ${metricText(control)}\n` +
    `- Challenger: ${metricText(challenger)}\n` +
    `- Origin cluster control: ${metricText(clusterControl)}\n` +
    `- Origin cluster challenger: ${metricText(clusterChallenger)}\n` +
    `- Paired challenger-only/control-only: ${paired.challengerOnlyCorrect}/${paired.controlOnlyCorrect}; exact p=${pValue.toFixed(4)}\n` +
    `- Leakage: ${leakage.passed && replay.passed ? 'PASS' : 'FAIL'}\n` +
    `- Parameter stability: ${stability.stable ? 'PASS' : 'WARNING'}\n\n` +
    `## Decision\n\n**${decision.decision}** — ${decision.reason}\n\n` +
    `## Next queued candidate\n\n${next ? `${next.hypothesis_id} (${next.priority.toFixed(1)})` : 'No additional eligible untested hypothesis in this cycle.'}\n`;
  safeWrite(REPORT_PATH, report);
  safeWrite(resolve(RUNTIME_DIR, 'cycle-summary.json'), {
    status: 'PASS',
    counts: { snapshots: snapshots.length, misses: discoveryMisses.length, correctComparison: discoveryCorrect.length, clusters: clusters.length, hypotheses: hypotheses.length },
    cluster,
    hypothesis,
    manifest,
    control,
    challenger,
    clusterControl,
    clusterChallenger,
    paired: { ...paired, pValue },
    leakage: { invariant: leakage, replay },
    robustness: stability,
    decision,
    nextQueued: next || null,
    ledgerEntry: entry
  });

  console.log(`Ledger entry written to research/runtime/experiment-ledger.json (${id}).`);
  console.log(`Next queued: ${next?.hypothesis_id || 'none'}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
