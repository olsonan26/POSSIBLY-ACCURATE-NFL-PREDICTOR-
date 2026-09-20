import { readFile, writeFile, rm } from 'node:fs/promises';

const SOURCE_PATH = 'scripts/baseline-error-meta-model-2025.mjs';
const OUTPUT_PATH = 'research/baseline-error-walkforward-2024-2025.json';

const folds = [
  {
    label: '2024',
    pbpSeasons: '[2021, 2022, 2023, 2024]',
    buildSeason: 2021,
    hyperparamSeason: 2022,
    thresholdSeason: 2023,
    testSeason: 2024,
    outputPath: 'research/baseline-error-fold-2024.json'
  },
  {
    label: '2025',
    pbpSeasons: '[2022, 2023, 2024, 2025]',
    buildSeason: 2022,
    hyperparamSeason: 2023,
    thresholdSeason: 2024,
    testSeason: 2025,
    outputPath: 'research/baseline-error-fold-2025.json'
  }
];

function replaceRequired(source, from, to) {
  if (!source.includes(from)) throw new Error(`Unable to transform source; missing: ${from}`);
  return source.replace(from, to);
}

function transformedSource(source, fold) {
  let out = source;
  out = replaceRequired(out, 'const PBP_SEASONS = [2022, 2023, 2024, 2025];', `const PBP_SEASONS = ${fold.pbpSeasons};`);
  out = replaceRequired(out, 'const BUILD_SEASON = 2022;', `const BUILD_SEASON = ${fold.buildSeason};`);
  out = replaceRequired(out, 'const HYPERPARAM_SEASON = 2023;', `const HYPERPARAM_SEASON = ${fold.hyperparamSeason};`);
  out = replaceRequired(out, 'const THRESHOLD_SEASON = 2024;', `const THRESHOLD_SEASON = ${fold.thresholdSeason};`);
  out = replaceRequired(out, 'const TEST_SEASON = 2025;', `const TEST_SEASON = ${fold.testSeason};`);
  out = replaceRequired(
    out,
    'const TEST_WEEKS = new Set([16, 17, 18]);',
    'const TEST_WEEKS = new Set(Array.from({ length: 18 }, (_, i) => i + 1));'
  );
  out = replaceRequired(
    out,
    "await Bun.write('research/baseline-error-meta-model-2025-w16-18.json', JSON.stringify(report, null, 2));",
    `await Bun.write('${fold.outputPath}', JSON.stringify(report, null, 2));`
  );
  return out;
}

async function runFold(source, fold) {
  const tempPath = `scripts/.tmp-baseline-error-fold-${fold.label}.mjs`;
  await writeFile(tempPath, transformedSource(source, fold));
  try {
    console.log(`\n===== WALK-FORWARD FOLD ${fold.label} =====`);
    const proc = Bun.spawn(['bun', tempPath], { stdout: 'inherit', stderr: 'inherit' });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error(`Fold ${fold.label} failed with exit code ${exitCode}`);
    return JSON.parse(await readFile(fold.outputPath, 'utf8'));
  } finally {
    await rm(tempPath, { force: true });
  }
}

function gateStats(gameTable, predicate) {
  const totalErrors = gameTable.reduce((sum, row) => sum + (row.baselineCorrect ? 0 : 1), 0);
  const flaggedRows = gameTable.filter(predicate);
  const flaggedErrors = flaggedRows.reduce((sum, row) => sum + (row.baselineCorrect ? 0 : 1), 0);
  const n = gameTable.length;
  const flagged = flaggedRows.length;
  const baseErrorRate = n ? totalErrors / n : 0;
  const precision = flagged ? flaggedErrors / flagged : 0;
  const recall = totalErrors ? flaggedErrors / totalErrors : 0;
  const flagRate = n ? flagged / n : 0;
  const lift = baseErrorRate ? precision / baseErrorRate : 0;
  return {
    n,
    totalErrors,
    baseErrorRate,
    flagged,
    flaggedErrors,
    falseAlarms: flagged - flaggedErrors,
    precision,
    recall,
    flagRate,
    lift,
    flaggedGames: flaggedRows.map(row => ({
      week: row.week,
      gameId: row.gameId,
      matchup: row.matchup,
      baselinePick: row.baselinePick,
      baselineCorrect: row.baselineCorrect,
      vulnerabilityProbability: row.vulnerabilityProbability
    }))
  };
}

function compactGate(stats) {
  const { flaggedGames, ...rest } = stats;
  return rest;
}

function summarizeFold(fold, report) {
  const test = report.heldout2025Weeks16to18;
  if (!test?.gameTable?.length) throw new Error(`Fold ${fold.label} did not produce a game table.`);
  const table = test.gameTable;
  const tunedThreshold = report.methodology.frozenVulnerabilityThreshold;
  const tuned = gateStats(table, row => row.vulnerabilityProbability >= tunedThreshold);

  // A fixed, semantically meaningful second tier: >= 0.50 means the model estimates
  // that a v2.2 error is more likely than not. This threshold is not tuned on test outcomes.
  const highRisk = gateStats(table, row => row.vulnerabilityProbability >= 0.5);

  const blocks = [
    { label: 'Weeks 5-9', min: 5, max: 9 },
    { label: 'Weeks 10-14', min: 10, max: 14 },
    { label: 'Weeks 15-18', min: 15, max: 18 }
  ].map(block => {
    const rows = table.filter(row => row.week >= block.min && row.week <= block.max);
    return {
      label: block.label,
      tunedGate: compactGate(gateStats(rows, row => row.vulnerabilityProbability >= tunedThreshold)),
      highRisk50: compactGate(gateStats(rows, row => row.vulnerabilityProbability >= 0.5))
    };
  });

  const late = table.filter(row => row.week >= 16 && row.week <= 18);

  return {
    testSeason: fold.testSeason,
    buildSeason: fold.buildSeason,
    hyperparamSeason: fold.hyperparamSeason,
    thresholdSeason: fold.thresholdSeason,
    selectedL2: report.methodology.selectedL2,
    selectedCalibrationScale: report.methodology.selectedCalibrationScale,
    tunedThreshold,
    modelAuc: test.auc,
    probability: test.probability,
    tunedGate: tuned,
    highRisk50: highRisk,
    weeks16to18: {
      tunedGate: gateStats(late, row => row.vulnerabilityProbability >= tunedThreshold),
      highRisk50: gateStats(late, row => row.vulnerabilityProbability >= 0.5)
    },
    blocks
  };
}

function aggregate(summaries, key) {
  const rows = summaries.flatMap(summary => summary[key].flaggedGames.map(game => ({ ...game, season: summary.testSeason })));
  const n = summaries.reduce((sum, summary) => sum + summary[key].n, 0);
  const totalErrors = summaries.reduce((sum, summary) => sum + summary[key].totalErrors, 0);
  const flagged = summaries.reduce((sum, summary) => sum + summary[key].flagged, 0);
  const flaggedErrors = summaries.reduce((sum, summary) => sum + summary[key].flaggedErrors, 0);
  const baseErrorRate = n ? totalErrors / n : 0;
  const precision = flagged ? flaggedErrors / flagged : 0;
  const recall = totalErrors ? flaggedErrors / totalErrors : 0;
  const flagRate = n ? flagged / n : 0;
  const lift = baseErrorRate ? precision / baseErrorRate : 0;
  return {
    n,
    totalErrors,
    baseErrorRate,
    flagged,
    flaggedErrors,
    falseAlarms: flagged - flaggedErrors,
    precision,
    recall,
    flagRate,
    lift,
    flaggedGames: rows
  };
}

const pct = value => `${(value * 100).toFixed(2)}%`;

async function main() {
  const source = await readFile(SOURCE_PATH, 'utf8');
  const reports = [];
  for (const fold of folds) reports.push(await runFold(source, fold));

  const summaries = folds.map((fold, index) => summarizeFold(fold, reports[index]));
  const aggregateTuned = aggregate(summaries, 'tunedGate');
  const aggregateHighRisk = aggregate(summaries, 'highRisk50');

  const result = {
    purpose: 'Larger chronological walk-forward validation of the v2.2 baseline-error vulnerability architecture.',
    guardrails: {
      productionMutation: false,
      winnerOverrideAllowed: false,
      testOutcomesUsedForThresholdSelection: false,
      highRiskThreshold: 0.5,
      highRiskThresholdReason: 'Fixed semantic threshold: predicted error probability is at least 50%; not optimized on the test seasons.'
    },
    folds: summaries,
    aggregate: {
      tunedGate: aggregateTuned,
      highRisk50: aggregateHighRisk
    },
    comparison: {
      highRiskLiftMinusTunedLift: aggregateHighRisk.lift - aggregateTuned.lift,
      highRiskPrecisionMinusTunedPrecision: aggregateHighRisk.precision - aggregateTuned.precision,
      highRiskRecallMinusTunedRecall: aggregateHighRisk.recall - aggregateTuned.recall
    },
    conclusion: aggregateHighRisk.lift > aggregateTuned.lift
      ? 'The fixed >=50% high-risk tier concentrated more v2.2 errors than the broader tuned gate across the walk-forward folds. Keep it research-only and validate on future games before any production use.'
      : 'The fixed >=50% high-risk tier did not improve aggregate error concentration over the broader tuned gate. Do not promote it.'
  };

  await Bun.write(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log('\n===== WALK-FORWARD SUMMARY =====');
  for (const summary of summaries) {
    console.log(`${summary.testSeason}: tuned lift=${summary.tunedGate.lift.toFixed(3)}x, precision=${pct(summary.tunedGate.precision)}, recall=${pct(summary.tunedGate.recall)} | >=50% lift=${summary.highRisk50.lift.toFixed(3)}x, precision=${pct(summary.highRisk50.precision)}, recall=${pct(summary.highRisk50.recall)}`);
  }
  console.log(`Aggregate tuned: lift=${aggregateTuned.lift.toFixed(3)}x, precision=${pct(aggregateTuned.precision)}, recall=${pct(aggregateTuned.recall)}, flags=${aggregateTuned.flagged}/${aggregateTuned.n}`);
  console.log(`Aggregate >=50%: lift=${aggregateHighRisk.lift.toFixed(3)}x, precision=${pct(aggregateHighRisk.precision)}, recall=${pct(aggregateHighRisk.recall)}, flags=${aggregateHighRisk.flagged}/${aggregateHighRisk.n}`);
  console.log('Production action: NONE. Research-only vulnerability warning layer.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
