import { createHash } from 'node:crypto';
import type { FailureFeatureRow, FailureCluster } from './research-core.js';

export interface SplitCondition { feature: string; operator: '>' | '<='; threshold: number; }
export const matchesConditions = (row: FailureFeatureRow, conditions: SplitCondition[]) => conditions.every(c => {
  const value = row.researchFeatures?.[c.feature];
  return value != null && Number.isFinite(value) && (c.operator === '>' ? value > c.threshold : value <= c.threshold);
});
const missRate = (rows: FailureFeatureRow[]) => rows.length ? rows.filter(r => !r.correct).length / rows.length : 0;
function comparisons(all: FailureFeatureRow[], conditions: SplitCondition[]) {
  const selected = all.filter(r => matchesConditions(r, conditions));
  const outside = all.filter(r => !matchesConditions(r, conditions));
  // Stratify on selected side, confidence, Elo magnitude and season phase. Missing matched strata do not count as evidence.
  const stratum = (r: FailureFeatureRow) => `${r.predictedHome}:${Math.floor(r.confidence * 10)}:${Math.floor(Math.abs(r.alignedBaseLogit) * 2)}:${r.week <= 4 ? 'early' : 'later'}`;
  const strata = new Map<string, FailureFeatureRow[]>();
  outside.forEach(r => { const k = stratum(r); strata.set(k, [...(strata.get(k) || []), r]); });
  let expected = 0, matched = 0;
  for (const row of selected) { const peers = strata.get(stratum(row)); if (peers && peers.length >= 5) { expected += missRate(peers); matched++; } }
  const rate = missRate(selected), baseline = matched ? expected / matched : missRate(outside);
  const n = selected.length;
  const se = Math.sqrt(.25 / Math.max(1, n) + .25 / Math.max(1, outside.length));
  return { n, misses: selected.filter(r => !r.correct).length, rate, baseline, lift: rate - baseline,
    z: (rate - baseline) / se, matchedCoverage: n ? matched / n : 0,
    seasons: new Set(selected.map(r => r.season)).size,
    teams: new Set(selected.flatMap(r => [r.homeTeam, r.awayTeam])).size,
    weeks: new Set(selected.map(r => `${r.season}:${r.week}`)).size,
    maximumTeamShare: n ? Math.max(0, ...[...new Set(selected.flatMap(r => [r.homeTeam, r.awayTeam]))].map(t => selected.filter(r => r.homeTeam === t || r.awayTeam === t).length / n)) : 1,
    allMissRate: missRate(all), correct: n ? n - selected.filter(r => !r.correct).length : 0 };
}
export interface DiscoveredCluster extends FailureCluster {
  conditions: SplitCondition[];
  validation: ReturnType<typeof comparisons>;
  discovery: ReturnType<typeof comparisons>;
  thresholdStable: boolean;
  foldLifts: number[];
}
/** Bounded beam subgroup search. All thresholds and choices use discovery rows only. Validation never retunes a rule. */
export function discoverResidualSubgroups(discovery: FailureFeatureRow[], validation: FailureFeatureRow[],
  options: { minLeaf?: number; maxDepth?: number; beamWidth?: number; budget?: number } = {}) {
  const minLeaf = options.minLeaf ?? 30, maxDepth = options.maxDepth ?? 3, beamWidth = options.beamWidth ?? 12, budget = options.budget ?? 1500;
  if (maxDepth < 1 || maxDepth > 3 || minLeaf < 15 || beamWidth > 30 || budget > 5000) throw new Error('Unsafe discovery search budget.');
  const names = [...new Set(discovery.flatMap(r => Object.keys(r.researchFeatures || {})))].sort()
    .filter(name => /^(football_|coach_|experimental_|meta_disagreement\.|data_quality\.|deepseek_learning\.)/.test(name) && !/(^|\.)(score|winner|actual|season|week|game.?id|team.?id|final|postgame)(\.|$)/i.test(name));
  const splits: SplitCondition[] = [];
  for (const feature of names) {
    const values = discovery.map(r => r.researchFeatures?.[feature]).filter((v): v is number => v != null && Number.isFinite(v)).sort((a,b) => a-b);
    if (values.length < discovery.length * .6 || new Set(values).size < 2) continue;
    const thresholds = [...new Set([.25,.5,.75].map(q => values[Math.floor((values.length - 1) * q)]))];
    for (const threshold of thresholds) for (const operator of ['>', '<='] as const) splits.push({ feature, operator, threshold });
  }
  let examined = 0;
  type Candidate = { conditions: SplitCondition[]; score: number };
  let beam: Candidate[] = [{ conditions: [], score: 0 }];
  const candidates: Candidate[] = [], seen = new Set<string>();
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: Candidate[] = [];
    for (const parent of beam) for (const split of splits) {
      if (examined >= budget) break;
      if (parent.conditions.some(c => c.feature === split.feature)) continue;
      const conditions = [...parent.conditions, split].sort((a,b) => a.feature.localeCompare(b.feature));
      const signature = JSON.stringify(conditions);
      if (seen.has(signature)) continue;
      seen.add(signature); examined++;
      const stats = comparisons(discovery, conditions);
      if (stats.n < minLeaf || discovery.length - stats.n < minLeaf) continue;
      next.push({ conditions, score: stats.lift * Math.sqrt(stats.n) - depth * .05 });
    }
    beam = next.sort((a,b) => b.score - a.score).slice(0, beamWidth);
    candidates.push(...beam);
  }
  const unique = [...new Map(candidates.map(c => [JSON.stringify(c.conditions), c])).values()];
  // Conservative normal-tail family-wise bound across every attempted split, plus independent validation.
  const requiredZ = Math.max(3, Math.sqrt(2 * Math.log(Math.max(1, examined) / .01)));
  const validationRequiredZ=Math.max(3,Math.sqrt(2*Math.log(Math.max(1,unique.length)/.05)));
  const clusters: DiscoveredCluster[] = unique.map(candidate => {
    const d = comparisons(discovery, candidate.conditions), v = comparisons(validation, candidate.conditions);
    const selected = discovery.filter(r => matchesConditions(r, candidate.conditions));
    const seasons = [...new Set(discovery.map(r => r.season))];
    const foldLifts = seasons.map(season => comparisons(discovery.filter(r => r.season === season), candidate.conditions).lift);
    const thresholdStable = candidate.conditions.every((condition, index) => [-.05,.05].every(delta => {
      const perturbed = candidate.conditions.map((c,i) => i === index ? { ...c, threshold: c.threshold + Math.max(.1, Math.abs(c.threshold)) * delta } : c);
      const stats = comparisons(validation, perturbed);
      return stats.n >= minLeaf && stats.lift >= .05;
    }));
    const stable = d.n >= minLeaf && v.n >= minLeaf && d.lift >= .1 && v.lift >= .08 &&
      d.z >= requiredZ && v.z >= validationRequiredZ && d.seasons >= 2 && d.teams >= 12 && v.teams >= 12 &&
      d.maximumTeamShare <= .3 && v.maximumTeamShare <= .3 && d.matchedCoverage >= .8 && v.matchedCoverage >= .8 &&
      foldLifts.every(lift => lift >= .05) && thresholdStable;
    const hash = createHash('sha256').update(JSON.stringify(candidate.conditions)).digest('hex').slice(0,12);
    return { clusterId: `DD-${hash}`, ruleKey: 'DISCOVERED', description: candidate.conditions.map(c => `${c.feature} ${c.operator} ${c.threshold.toFixed(4)}`).join(' AND '),
      numberOfMisses: d.misses, eligibleGames: d.n, missRate: d.rate, baselineMissRate: d.baseline, missRateLift: d.lift,
      seasonsRepresented: d.seasons, teamsRepresented: d.teams, weeksRepresented: d.weeks,
      meanModelConfidence: selected.reduce((a,r) => a+r.confidence,0) / Math.max(1, selected.length), effectSize: d.lift / .5,
      stabilityScore: stable ? Math.min(1, v.lift + .7) : 0, stability: stable ? 'STABLE' : 'NOISE',
      dominantFeatures: candidate.conditions.map(c => c.feature), conditions: candidate.conditions,
      discovery: d, validation: v, thresholdStable, foldLifts } satisfies DiscoveredCluster;
  });
  // Equivalent membership discovered via correlated features must not multiply the hypothesis queue.
  const accepted: DiscoveredCluster[] = [];
  for (const c of clusters.filter(c => c.stability === 'STABLE').sort((a,b) => b.validation.lift - a.validation.lift || a.conditions.length - b.conditions.length)) {
    const ids = new Set(discovery.filter(r => matchesConditions(r, c.conditions)).map(r => r.gameId));
    if (accepted.some(a => { const other = new Set(discovery.filter(r => matchesConditions(r,a.conditions)).map(r => r.gameId));
      return [...ids].filter(id => other.has(id)).length / new Set([...ids,...other]).size > .85; })) continue;
    accepted.push(c);
  }
  return { method: 'chronological bounded subgroup beam search', clusters: accepted, rejected: clusters.filter(c => c.stability !== 'STABLE'),
    search: { features: names.length, varyingAvailableFeatures:new Set(splits.map(s=>s.feature)).size,thresholds: splits.length, clustersExamined: examined, validationCandidates: unique.length, requiredZ,validationRequiredZ, budget, maxDepth, minLeaf },
    result: accepted.length ? 'STABLE NEW FAILURE PATTERN FOUND' : 'NO NEW VALIDATED DATA-DRIVEN FAILURE PATTERN FOUND' };
}
