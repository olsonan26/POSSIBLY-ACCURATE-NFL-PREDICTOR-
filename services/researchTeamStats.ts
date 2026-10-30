import { getTeamStatsBeforeTarget, type PointInTimeTeamStats } from './pointInTimeTeamStats.js';
import type { ResearchFeature } from './researchSnapshot.js';

/** Transparent season-to-date team proxies; these are not player-level QB ratings or charted pressure rates. */
export function teamStatResearchEdges(home: PointInTimeTeamStats | null, away: PointInTimeTeamStats | null,
  targetWeek: number, cutoffAt: string, capturedAt: string): Record<string, ResearchFeature> {
  const result: Record<string, ResearchFeature> = {};
  const metrics: Record<string, { numerator: string[]; denominator?: string[]; invert?: boolean }> = {
    'football_efficiency.passEpaPerDropback': {numerator:['passing_epa'],denominator:['attempts','sacks_suffered']},
    'football_efficiency.rushEpaPerCarry': {numerator:['rushing_epa'],denominator:['carries']},
    'football_ol.sacksAllowedPerDropback': {numerator:['sacks_suffered'],denominator:['attempts','sacks_suffered'],invert:true},
    'football_pressure.sacksPerGame': {numerator:['def_sacks']},
    'football_pressure.qbHitsPerGame': {numerator:['def_qb_hits']},
    'football_explosive.pass20PerAttempt': {numerator:['passing_20'],denominator:['attempts']},
    'football_explosive.rush20PerCarry': {numerator:['rushing_20'],denominator:['carries']},
    'football_turnover.giveawaysPerGame': {numerator:['passing_interceptions','fumbles_lost_total'],invert:true},
    'football_special_teams.netPuntYardsPerPunt': {numerator:['pt_net_yards'],denominator:['pt_att']}
  };
  const measure = (data: PointInTimeTeamStats | null, config: typeof metrics[string]) => {
    if (!data || data.targetWeek !== targetWeek || !data.rows.length || data.rows.some(r => Number(r.week) >= targetWeek)) return null;
    const fields = [...config.numerator,...(config.denominator || [])];
    if (fields.some(k => !data.headers.has(k)) || data.rows.some(r => fields.some(k => r[k] == null || r[k] === '' || !Number.isFinite(Number(r[k]))))) return null;
    const sum = (keys:string[]) => data.rows.reduce((n,r) => n+keys.reduce((v,k)=>v+Number(r[k]),0),0);
    const denom = config.denominator ? sum(config.denominator) : data.rows.length;
    return denom > 0 ? sum(config.numerator) / denom : null;
  };
  for (const [key,config] of Object.entries(metrics)) {
    const h=measure(home,config),a=measure(away,config);
    result[key] = {value:h===null||a===null?null:(h-a)*(config.invert?-1:1),status:h===null||a===null?'BLOCKED_DATA':'known',
      source:`nflverse stats_team_week; season-to-date team proxy; week < ${targetWeek}; historical feeds may be revised`,
      observedAt:cutoffAt,capturedAt,version:'team-proxies-v1',includedInProduction:false};
  }
  return result;
}
export async function loadResearchTeamEdges(home: string, away: string, date: string, season: number, week: number,
  cutoffAt: string, capturedAt: string) {
  const [h,a] = await Promise.all([getTeamStatsBeforeTarget(home,date,season).catch(()=>null),getTeamStatsBeforeTarget(away,date,season).catch(()=>null)]);
  return teamStatResearchEdges(h,a,week,cutoffAt,capturedAt);
}
