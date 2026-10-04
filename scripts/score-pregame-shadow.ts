import { readFile } from 'node:fs/promises';
import { scorePregameShadowRecords, PregameShadowScoreRecord } from '../services/pregameIntelligenceService';

function parseArgs(argv: string[]): { input?: string } {
  const inputArg = argv.find(arg => arg.startsWith('--input='));
  return { input: inputArg?.slice('--input='.length) };
}

function parseRecords(raw: string): PregameShadowScoreRecord[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const parsed: unknown[] = trimmed.startsWith('[')
    ? JSON.parse(trimmed)
    : trimmed.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

  return parsed.map((record, index) => {
    if (!record || typeof record !== 'object') throw new Error(`Record ${index + 1} is not an object.`);
    const value = record as Record<string, unknown>;
    const baseHomeProbability = Number(value.baseHomeProbability);
    const shadowHomeProbability = Number(value.shadowHomeProbability);
    const homeWon = value.homeWon;
    if (!Number.isFinite(baseHomeProbability) || !Number.isFinite(shadowHomeProbability) || typeof homeWon !== 'boolean') {
      throw new Error(`Record ${index + 1} must contain baseHomeProbability, shadowHomeProbability, and boolean homeWon.`);
    }
    return { baseHomeProbability, shadowHomeProbability, homeWon };
  });
}

const { input } = parseArgs(process.argv.slice(2));
if (!input) {
  console.log('Usage: bun scripts/score-pregame-shadow.ts --input=path/to/prospective-records.jsonl');
  console.log('Each record: {"baseHomeProbability":0.61,"shadowHomeProbability":0.57,"homeWon":true}');
  process.exit(0);
}

const records = parseRecords(await readFile(input, 'utf8'));
const metrics = scorePregameShadowRecords(records);

console.log('\nEXP-031 prospective shadow score');
console.log('================================');
console.log(`Games: ${metrics.games}`);
console.log(`Control: ${metrics.baseCorrect}/${metrics.games} = ${(metrics.baseAccuracy * 100).toFixed(2)}%`);
console.log(`Shadow:  ${metrics.shadowCorrect}/${metrics.games} = ${(metrics.shadowAccuracy * 100).toFixed(2)}%`);
console.log(`Accuracy delta: ${metrics.accuracyDeltaPoints >= 0 ? '+' : ''}${metrics.accuracyDeltaPoints.toFixed(2)} points`);
console.log(`Control Brier: ${metrics.baseBrier.toFixed(4)}`);
console.log(`Shadow Brier:  ${metrics.shadowBrier.toFixed(4)} | delta ${metrics.brierDelta.toFixed(4)} (negative is better)`);
console.log(`Control LogLoss: ${metrics.baseLogLoss.toFixed(4)}`);
console.log(`Shadow LogLoss:  ${metrics.shadowLogLoss.toFixed(4)} | delta ${metrics.logLossDelta.toFixed(4)} (negative is better)`);
console.log(`Paired flips: shadow-only correct=${metrics.shadowOnlyCorrect}, control-only correct=${metrics.baseOnlyCorrect}`);
console.log('\nGovernance: score only records frozen before kickoff. Never reconstruct historical EXP-031 evidence after outcomes are known.');
