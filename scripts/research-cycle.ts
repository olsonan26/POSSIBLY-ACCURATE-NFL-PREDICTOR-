import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildUnifiedSnapshot } from '../services/researchSnapshot.js';
import { easternKickoffIso } from '../services/kickoff.js';
import { discoverResidualSubgroups } from './residual-discovery.js';
import { writeResearchScorecards } from './research-scorecards.js';
import { loadResearchTeamEdges } from '../services/researchTeamStats.js';
import { adaptFrozenPredictions } from './frozen-research-input.js';
import { researchAttacks } from './research-evaluation.js';
import { preregisterManifest, evaluateRegistered } from './research-ledger.js';
import { parseGamesCsv, parseTeamData, predictWinner } from '../services/validatedPredictionService';
import {
  buildFailureFeatureRows,
  challengerHomeProbability,
  hypothesisProbability,
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
const RUNTIME_DIR = resolve(process.argv.find(a=>a.startsWith('--output-dir='))?.slice(13) || 'research/runtime');
const REPORT_PATH = resolve(RUNTIME_DIR, 'latest.md');
const DISCOVERY_SEASONS = new Set([2022, 2023]);
const VALIDATION_SEASON = 2024;
const LEGACY_TEST_SEASON = 2025;

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
    (DISCOVERY_SEASONS.has(game.season) || game.season === VALIDATION_SEASON || game.season === LEGACY_TEST_SEASON) &&
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
    const kickoffAt = easternKickoffIso(game.gameday, game.gametime || '') || `${game.gameday}T23:59:59Z`;
    const capturedAt = new Date().toISOString();
    const cutoffAt = `${game.gameday}T00:00:00.000Z`;
    const extraFeatures = await loadResearchTeamEdges(game.homeTeam, game.awayTeam, game.gameday, game.season, game.week, cutoffAt, capturedAt);
    const unifiedSnapshot = buildUnifiedSnapshot({ gameId: game.gameId, modelVersion: CONTROL_VERSION, kickoffAt,
      capturedAt, cutoffAt, horizon: 'T-24h', mode: 'HISTORICAL_RECONSTRUCTION', result,
      homeTeam: game.homeTeam, awayTeam: game.awayTeam, extraFeatures });
    snapshots.push({
      unifiedSnapshot,
      snapshotId: `${CONTROL_VERSION}:${game.gameId || `${game.season}-${game.week}-${game.awayTeam}-${game.homeTeam}`}`,
      gameId: game.gameId || `${game.season}-${game.week}-${game.awayTeam}-${game.homeTeam}`,
      sourceModelVersion: CONTROL_VERSION,
      season: game.season,
      week: Number(game.week) || 0,
      gameday: game.gameday,
      predictionTimestamp: capturedAt,
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
  return ['HOME_BIAS','ADD_FEATURE','ADD_INTERACTION','ADD_DISAGREEMENT_FEATURE','REPLACE_FEATURE'].includes(hypothesis.proposedImplementation) ? 0 : 1;
}

function selectParameter(hypothesis: ResearchHypothesis, validation: ResearchPredictionSnapshot[]) {
  const candidates = hypothesis.parameterGrid.map(parameter => ({
    parameter,
    metrics: scoreProbabilities(validation, snapshot => hypothesisProbability(snapshot, hypothesis, parameter))
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
    metrics: scoreProbabilities(locked, snapshot => hypothesisProbability(snapshot, hypothesis, parameter))
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
  const inputPath = process.argv.find(arg=>arg.startsWith('--input='))?.slice(8);
  const coachPath = process.argv.find(arg=>arg.startsWith('--coaches='))?.slice(10);
  const snapshots = inputPath ? adaptFrozenPredictions(readJson<any[]>(resolve(inputPath),[]), coachPath?readJson<any[]>(resolve(coachPath),[]):[]) : await generateSnapshots(games);
  if (!inputPath && snapshots.length < 900) throw new Error(`Autoresearch snapshot coverage too small: ${snapshots.length}`);
  safeWrite(resolve(RUNTIME_DIR, 'prediction-snapshots.json'), snapshots);

  const allRows = buildFailureFeatureRows(snapshots);
  const normalizedRows = normalizeFailureRows(allRows,allRows.filter(row=>DISCOVERY_SEASONS.has(row.season)));
  const discoveryRows = allRows.filter(row => DISCOVERY_SEASONS.has(row.season));
  const discoveryMisses = discoveryRows.filter(row => !row.correct);
  const discoveryCorrect = discoveryRows.filter(row => row.correct);
  safeWrite(resolve(RUNTIME_DIR, 'failure-feature-matrix.raw.json'), allRows);
  safeWrite(resolve(RUNTIME_DIR, 'failure-feature-matrix.model-ready.json'), normalizedRows);
  safeWrite(resolve(RUNTIME_DIR, 'failure-feature-matrix.misses.json'), discoveryMisses);
  safeWrite(resolve(RUNTIME_DIR, 'comparison-population.correct.json'), discoveryCorrect);

  const knownClusters = discoverFailureClusters(discoveryRows);
  const discovered = discoverResidualSubgroups(discoveryRows, allRows.filter(row => row.season === VALIDATION_SEASON));
  const discoverySnapshots=snapshots.filter(s=>DISCOVERY_SEASONS.has(s.season));
  const knownMembership=knownClusters.map(c=>new Set(clusterEligibleSnapshots(discoverySnapshots,c).map(s=>s.gameId)));
  discovered.clusters=discovered.clusters.filter(cluster=>{
    const ids=new Set(clusterEligibleSnapshots(discoverySnapshots,cluster).map(s=>s.gameId));
    const duplicate=knownMembership.some(known=>[...ids].filter(id=>known.has(id)).length/Math.max(1,new Set([...ids,...known]).size)>.85);
    if(duplicate) discovered.rejected.push({...cluster,stability:'NOISE'});
    return !duplicate;
  });
  discovered.result=discovered.clusters.length?'STABLE NEW FAILURE PATTERN FOUND':'NO NEW VALIDATED DATA-DRIVEN FAILURE PATTERN FOUND';
  safeWrite(resolve(RUNTIME_DIR, 'residual-discovery.json'), discovered);
  console.log(discovered.result);
  const clusters = [...knownClusters, ...discovered.clusters];
  writeResearchScorecards(snapshots, RUNTIME_DIR);
  safeWrite(resolve(RUNTIME_DIR, 'discovery-summary.json'), { evidence: inputPath?'PROSPECTIVE_FROZEN_EXPORT':'HISTORICAL_RECONSTRUCTION',
    datasets: { '2022-2023': 'DISCOVERY', '2024': 'VALIDATION', '2025': 'LEGACY_TEST', future: 'FORWARD_SHADOW' },
    eligible: allRows.length, misses: allRows.filter(r => !r.correct).length, correct: allRows.filter(r => r.correct).length,
    knownClusters: knownClusters.length, validatedDiscoveredClusters: discovered.clusters.length, search: discovered.search });
  safeWrite(resolve(RUNTIME_DIR, 'failure-clusters.json'), clusters);
  console.log(`Snapshots: ${snapshots.length}; discovery misses: ${discoveryMisses.length}; comparison correct: ${discoveryCorrect.length}`);
  console.log(`Possible/stable failure clusters: ${clusters.length}`);

  const runtimeLedger = readJson<LedgerEntry[]>(resolve(RUNTIME_DIR, 'experiment-ledger.json'), []);
  const ledger = [...new Map([...readJson<LedgerEntry[]>(LEDGER_PATH, []), ...runtimeLedger].map(e=>[e.experiment_id,e])).values()];
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
  safeWrite(resolve(RUNTIME_DIR, 'combined-research-queue.json'), [
    ...readJson<any[]>(QUEUE_PATH,[]).map(item=>({...item,origin:'MANUAL'})),
    ...queue.map(item=>({...item,origin:item.cluster_id.startsWith('DD-')?'DISCOVERED_FAILURE_CLUSTER':'KNOWN_FAILURE_RULE'}))]);

  if (!hypotheses.length) {
    const noCluster = `${discovered.result}; ${clusters.length ? 'NO UNTESTED STABLE FAILURE HYPOTHESIS FOUND' : 'NO STABLE FAILURE CLUSTER FOUND'}`;
    console.log(noCluster);
    safeWrite(REPORT_PATH, `# NFL Autoresearch latest\n\n${noCluster}\n`);
    return;
  }

  const hypothesis = hypotheses[0];
  const cluster = clusters.find(item => item.clusterId === hypothesis.sourceClusterId)!;
  queue[0].status = 'RUNNING';
  const id = experimentId(ledger);
  const commit = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
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
    locked_test_range: '2025 LEGACY_TEST; repeatedly inspected, not fresh confirmation',
    action_type: hypothesis.actionType || hypothesis.proposedImplementation,
    search_budget_used: discovered.search,
    datasets: ['nflverse games.csv', 'v2.2 HISTORICAL_RECONSTRUCTION snapshots; no prospective claims'],
    random_seed: 20260929,
    model_commit: commit,
    metrics_to_measure: ['accuracy', 'Brier', 'log loss', 'paired winner delta', 'cluster-specific metrics', 'parameter stability', 'leakage'],
    success_conditions: ['No leakage violations', 'Legacy global metrics not materially worse', 'Originating failure population improves', 'Neighboring parameter is not catastrophic'],
    failure_conditions: ['Leakage failure', 'Material locked regression on all primary metrics', 'Narrow one-parameter-only effect']
  };
  safeWrite(resolve(RUNTIME_DIR, 'active-experiment-manifest.json'), manifest);
  const experimentDir = resolve(RUNTIME_DIR, 'experiments', id);
  const manifestPath = resolve(experimentDir, 'manifest.json');
  mkdirSync(experimentDir, { recursive: true });
  preregisterManifest(manifestPath,manifest);
  safeWrite(resolve(RUNTIME_DIR,'experiment-ledger.json'),[...runtimeLedger,{
    experiment_id:id,hypothesis_id:hypothesis.hypothesisId,cluster_id:hypothesis.sourceClusterId,date:manifest.created_at,
    parent_model:CONTROL_VERSION,challenger:'PREREGISTERED',feature_family:hypothesis.featuresInvolved.join(','),
    parameters:{grid:hypothesis.parameterGrid},train_period:'2022-2023',validation_period:'2024',test_period:'2025 LEGACY_TEST',
    decision:'RUNNING',reason:'Manifest persisted before parameter evaluation. Interrupted runs remain in the ledger.',git_commit:commit
  }]);
  console.log(`Selected hypothesis: ${hypothesis.hypothesisId} (${hypothesis.priorityScore.toFixed(1)})`);
  console.log(hypothesis.statement);

  const validation = snapshots.filter(snapshot => snapshot.season === VALIDATION_SEASON);
  const locked = snapshots.filter(snapshot => snapshot.season === LEGACY_TEST_SEASON);
  const parameterSelection = evaluateRegistered(manifestPath,id,()=>selectParameter(hypothesis, validation));
  const selectedParameter = parameterSelection.selected.parameter;
  console.log(`2024 selected parameter: ${selectedParameter}`);
  for (const candidate of parameterSelection.candidates) console.log(`  ${candidate.parameter}: ${metricText(candidate.metrics)}`);

  const control = scoreProbabilities(locked, controlHomeProbability);
  const challengerFn = (snapshot: ResearchPredictionSnapshot) => hypothesisProbability(snapshot, hypothesis, selectedParameter);
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
  const ablation = scoreProbabilities(locked, controlHomeProbability);
  const attacks = researchAttacks(locked,challengerFn);
  const decision = decideExperiment({
    control,
    challenger,
    clusterControl,
    clusterChallenger,
    leakagePassed: leakage.passed && replay.passed,
    parameterStable: stability.stable,
    complexityPenalty: attacks.nullPValue === null || attacks.nullPValue > .05
  });

  console.log('\nLEGACY TEST 2025');
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
    season_stability: 'Discovery spans 2022-2023; parameter selected on 2024; legacy comparison 2025.',
    ablation_result: `Neutral/control parameter ${neutral}: ${metricText(ablation)}`,
    leakage_status: leakage.passed && replay.passed ? 'PASS' : `FAIL (${[...leakage.violations, ...replay.violations].slice(0, 5).join('; ')})`,
    decision: decision.decision,
    reason: decision.reason,
    git_commit: commit
  };
  const nextLedger = [...runtimeLedger, entry];
  safeWrite(resolve(RUNTIME_DIR, 'experiment-ledger.json'), nextLedger);
  writeFileSync(resolve(experimentDir, 'result.json'), JSON.stringify({ entry, paired, manifestPath, attacks },null,2), {flag:'wx'});

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
    `## Experiment\n\n2024 selected parameter **${selectedParameter}** from ${hypothesis.parameterGrid.join(', ')} by Brier before the legacy 2025 comparison.\n\n` +
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
    robustness: { ...stability, attacks },
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
