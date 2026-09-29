import {
  buildFailureFeatureRows,
  controlHomeProbability,
  discoverFailureClusters,
  generateHypotheses,
  leakageInvariant,
  removePreviouslyTested,
  ResearchPredictionSnapshot
} from './research-core';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ACCEPTANCE TEST FAILED: ${message}`);
}

function syntheticSnapshots(): ResearchPredictionSnapshot[] {
  const rows: ResearchPredictionSnapshot[] = [];
  for (let i = 0; i < 240; i++) {
    const season = i < 120 ? 2022 : 2023;
    const week = (i % 18) + 1;
    const h2hTrap = i < 60;
    const formDisagreement = i >= 60 && i < 120;
    const expectedMiss = h2hTrap ? i % 3 !== 0 : formDisagreement ? i % 2 === 0 : i % 5 === 0;
    const homeTeam = `H${i % 16}`;
    const awayTeam = `A${(i + 5) % 16}`;
    const baseLogit = 0.45;
    const formLogit = formDisagreement ? -0.16 : 0.03;
    const venueLogit = 0;
    const h2hLogit = h2hTrap ? 0.20 : 0;
    const personnelLogit = 0;
    const restLogit = 0;
    const temp: ResearchPredictionSnapshot = {
      snapshotId: `synthetic-${i}`,
      gameId: `S-${season}-${i}`,
      sourceModelVersion: 'synthetic-control',
      season,
      week,
      gameday: `${season}-10-${String((i % 27) + 1).padStart(2, '0')}`,
      predictionTimestamp: `${season}-10-01T00:00:00.000Z`,
      dataCutoffTimestamp: `${season}-09-30T23:59:59.000Z`,
      homeTeam,
      awayTeam,
      neutralSite: false,
      homeWinProbability: 0,
      awayWinProbability: 0,
      predictedWinner: homeTeam,
      featureSnapshot: { baseLogit, formLogit, venueLogit, h2hLogit, personnelLogit, restLogit }
    };
    const pHome = controlHomeProbability(temp);
    temp.homeWinProbability = pHome;
    temp.awayWinProbability = 1 - pHome;
    temp.actualWinner = expectedMiss ? awayTeam : homeTeam;
    temp.correct = !expectedMiss;
    rows.push(temp);
  }
  return rows;
}

const snapshots = syntheticSnapshots();
const matrix = buildFailureFeatureRows(snapshots);
assert(matrix.length === 240, 'failure/comparison matrix should contain all completed predictions');
assert(matrix.filter(row => !row.correct).length > 50, 'synthetic fixture should contain a meaningful miss population');

const leakage = leakageInvariant(snapshots);
assert(leakage.passed, `synthetic point-in-time leakage invariant failed: ${leakage.violations.join(', ')}`);

const clusters = discoverFailureClusters(matrix, { minMisses: 8, minEligible: 18, minLift: 0.05 });
assert(clusters.length >= 1, 'known repeated failure pattern was not discovered');
const h2hCluster = clusters.find(cluster => cluster.ruleKey === 'H2H_SUPPORTS_PICK');
assert(h2hCluster, 'known H2H-supported failure pattern was not detected');
assert(h2hCluster.stability === 'POSSIBLE' || h2hCluster.stability === 'STABLE', 'known failure pattern did not clear stability gate');

const hypotheses = generateHypotheses(clusters);
const h2hHypothesis = hypotheses.find(hypothesis => hypothesis.hypothesisId === 'H-DAMP-H2H');
assert(h2hHypothesis, 'cluster did not generate the expected falsifiable H2H hypothesis');
assert(h2hHypothesis.parameterGrid.length > 1, 'hypothesis must define a controlled parameter neighborhood');

// Acceptance test #2: research memory must prevent an exact retest and advance.
const afterFirstRun = removePreviouslyTested(hypotheses, [{ hypothesis_id: h2hHypothesis.hypothesisId, decision: 'KILLED' }]);
assert(!afterFirstRun.some(hypothesis => hypothesis.hypothesisId === h2hHypothesis.hypothesisId), 'previously tested hypothesis was not deduplicated');
assert(afterFirstRun.length >= 1, 'fixture should leave at least one next eligible hypothesis after deduplication');

console.log('AUTORESEARCH SYNTHETIC ACCEPTANCE TEST: PASS');
console.log(`Snapshots: ${snapshots.length}`);
console.log(`Misses: ${matrix.filter(row => !row.correct).length}`);
console.log(`Clusters discovered: ${clusters.length}`);
console.log(`Detected known cluster: ${h2hCluster.clusterId} (${h2hCluster.stability})`);
console.log(`Hypothesis generated: ${h2hHypothesis.hypothesisId}`);
console.log(`Second-cycle dedup next candidate: ${afterFirstRun[0].hypothesisId}`);
