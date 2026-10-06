// Exercise emitted ESM with the same native Node runtime used by Vercel.
// Bun/Vite resolve extensionless imports that native Node rejects.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = await mkdtemp(join(tmpdir(), 'nfl-node-api-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}');
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', 'false', '--allowImportingTsExtensions', 'false', '--outDir', output], { stdio: 'inherit' });
  for (const name of ['learning-status', 'learning-sync', 'postgame-intelligence', 'pregame-intelligence']) {
    const module = await import(pathToFileURL(join(output, 'api', `${name}.js`)).href);
    assert.equal(typeof module.default, 'function', `${name} must load as a native Node handler.`);
  }
  console.log(`Native Node ${process.version}: all learning API entry points and transitive imports loaded.`);
} finally { await rm(output, { recursive: true, force: true }); }
