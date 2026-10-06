import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildLearningFeedback } from '../services/learningFeedback';
import { exportLearningForecasts, learningStorageConfigured, loadLearningExamples, syncLearningOutcomes, verifiedSchedule } from '../server/learningStore';

if (!learningStorageConfigured()) {
  console.error('Set NFL_LEARNING_SUPABASE_URL and NFL_LEARNING_SUPABASE_KEY (server service-role/secret key).');
  process.exit(1);
}
const args = process.argv.slice(2);
const model = process.env.OPENROUTER_PREGAME_MODEL || 'deepseek/deepseek-v4.1-flash';
if (args.includes('--sync')) console.log(JSON.stringify(await syncLearningOutcomes(await verifiedSchedule())));
const feedback = buildLearningFeedback(await loadLearningExamples(model), new Date().toISOString());
console.log(JSON.stringify({ version: feedback.version, games: feedback.games, scale: feedback.scale, status: feedback.status,
  base: feedback.base, raw: feedback.raw, deployedLearningShadow: feedback.deployedLearningShadow, forward: feedback.forward }, null, 2));
const output = args.find(a => a.startsWith('--export='))?.slice('--export='.length);
if (output) {
  const path = resolve(output);
  const rows = await exportLearningForecasts(model);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  console.log(`Exported ${rows.length} frozen, scored forecasts to ${path}.`);
}
