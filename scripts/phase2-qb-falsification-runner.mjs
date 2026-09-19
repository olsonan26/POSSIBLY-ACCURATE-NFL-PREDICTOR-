import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, 'pure-astrology-phase2.mjs');
const runtimePath = join(here, '.phase2-qb-falsification-runtime.mjs');
let source = readFileSync(sourcePath, 'utf8');

// Missing data must never become a one-sided astrology signal.
const oldPairs = `      coach: subtract(entityVector(\`coach:\${g.homeCoach}\`, homeCoachDob, ctx), entityVector(\`coach:\${g.awayCoach}\`, awayCoachDob, ctx)),\n      qb: subtract(entityVector(\`qb:\${g.homeQbId}\`, homeQbDob, ctx), entityVector(\`qb:\${g.awayQbId}\`, awayQbDob, ctx))`;
const strictPairs = `      coach: homeCoachDob && awayCoachDob\n        ? subtract(entityVector(\`coach:\${g.homeCoach}\`, homeCoachDob, ctx), entityVector(\`coach:\${g.awayCoach}\`, awayCoachDob, ctx))\n        : new Array(baseFeatureNames.length).fill(0),\n      qb: homeQbDob && awayQbDob\n        ? subtract(entityVector(\`qb:\${g.homeQbId}\`, homeQbDob, ctx), entityVector(\`qb:\${g.awayQbId}\`, awayQbDob, ctx))\n        : new Array(baseFeatureNames.length).fill(0)`;
if (!source.includes(oldPairs)) throw new Error('Phase2 source changed: strict-pair patch target not found');
source = source.replace(oldPairs, strictPairs);

const windowNeedle = `  runWindow('FORWARD WINDOW A', built.rows, [2021, 2022], 2023, 2024, roleSets);`;
if (!source.includes(windowNeedle)) throw new Error('Phase2 source changed: Window A patch target not found');
source = source.replace(windowNeedle, `  const out24 = runWindow('FORWARD WINDOW A', built.rows, [2021, 2022], 2023, 2024, roleSets);`);

const mainNeedle = `async function main() {`;
if (!source.includes(mainNeedle)) throw new Error('Phase2 source changed: main patch target not found');
const bootstrapHelpers = `function pairedBrierBootstrap(parts, repeats = 10000) {\n  const deltas = [];\n  for (const { test, model } of parts) {\n    for (const e of test) {\n      const base = clamp(e.football, 0.001, 0.999);\n      const alt = clamp(modelProbability(model, e), 0.001, 0.999);\n      deltas.push((base - e.y) ** 2 - (alt - e.y) ** 2);\n    }\n  }\n  const observed = deltas.reduce((a, b) => a + b, 0) / deltas.length;\n  let seed = 0x51a7c0de;\n  const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };\n  const means = new Array(repeats);\n  let nonPositive = 0;\n  for (let r = 0; r < repeats; r++) {\n    let sum = 0;\n    for (let i = 0; i < deltas.length; i++) sum += deltas[Math.floor(rand() * deltas.length)];\n    const mean = sum / deltas.length;\n    means[r] = mean;\n    if (mean <= 0) nonPositive++;\n  }\n  means.sort((a, b) => a - b);\n  const q = p => means[Math.min(means.length - 1, Math.max(0, Math.floor(p * means.length)))];\n  return { n: deltas.length, observed, lo: q(0.025), hi: q(0.975), pNonPositive: (nonPositive + 1) / (repeats + 1) };\n}\n\nfunction printPaired(label, result) {\n  console.log(\`\${label}: ΔBrier(base-QB)=\${result.observed.toFixed(5)}; 95% bootstrap [\${result.lo.toFixed(5)}, \${result.hi.toFixed(5)}]; P(Δ≤0)≈\${result.pNonPositive.toFixed(4)}; n=\${result.n}\`);\n}\n\n`;
source = source.replace(mainNeedle, bootstrapHelpers + mainNeedle);

const oldPerm = `  const full25 = out25['Football + full Phase 2 PURE'];\n  const test25 = built.rows.filter(e => e.game.season === 2025);\n  const perm = permutationCheck(test25, full25.model, 500);\n  console.log(\`\\nPermutation falsification (2025 full Phase 2 residual): Brier \${perm.observed.toFixed(4)}, shuffled-residual p≈\${perm.p.toFixed(3)} (500 permutations)\`);`;
const newPerm = `  const full25 = out25['Football + full Phase 2 PURE'];\n  const qb24 = out24['Football + QB PURE'];\n  const qb25 = out25['Football + QB PURE'];\n  const test24 = built.rows.filter(e => e.game.season === 2024);\n  const test25 = built.rows.filter(e => e.game.season === 2025);\n  const fullPerm = permutationCheck(test25, full25.model, 500);\n  const qbPerm24 = permutationCheck(test24, qb24.model, 5000);\n  const qbPerm25 = permutationCheck(test25, qb25.model, 5000);\n  console.log(\`\\nPermutation falsification (2025 full Phase 2 residual): Brier \${fullPerm.observed.toFixed(4)}, shuffled-residual p≈\${fullPerm.p.toFixed(3)} (500 permutations)\`);\n  console.log(\`QB-only residual permutation 2024: Brier \${qbPerm24.observed.toFixed(4)}, shuffled-residual p≈\${qbPerm24.p.toFixed(4)} (5000 permutations)\`);\n  console.log(\`QB-only residual permutation 2025: Brier \${qbPerm25.observed.toFixed(4)}, shuffled-residual p≈\${qbPerm25.p.toFixed(4)} (5000 permutations)\`);\n  printPaired('QB-only paired bootstrap 2024', pairedBrierBootstrap([{ test: test24, model: qb24.model }]));\n  printPaired('QB-only paired bootstrap 2025', pairedBrierBootstrap([{ test: test25, model: qb25.model }]));\n  printPaired('QB-only paired bootstrap pooled 2024+2025', pairedBrierBootstrap([{ test: test24, model: qb24.model }, { test: test25, model: qb25.model }]));`;
if (!source.includes(oldPerm)) throw new Error('Phase2 source changed: permutation patch target not found');
source = source.replace(oldPerm, newPerm);

writeFileSync(runtimePath, source);
const proc = Bun.spawn([
  'bun',
  '--preload', join(here, 'phase2-preload.mjs'),
  '--preload', join(here, 'phase2-pregame-qb-preload.mjs'),
  runtimePath
], { stdout: 'inherit', stderr: 'inherit', cwd: join(here, '..') });
const exitCode = await proc.exited;
try { unlinkSync(runtimePath); } catch {}
process.exit(exitCode);
