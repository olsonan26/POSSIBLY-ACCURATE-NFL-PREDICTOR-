import type { ScheduledGame } from '../services/scheduleService.js';
import { normalizeTeamAbbr } from '../data/teamRegistry.js';
async function espnJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!r.ok) throw new Error('Archived ESPN game evidence is unavailable. No paid research was started.');
  return r.json();
}
function matches(competition: any, game: ScheduledGame) {
  const competitors = competition?.competitors || [];
  const home = competitors.find((c: any) => c.homeAway === 'home');
  const away = competitors.find((c: any) => c.homeAway === 'away');
  return normalizeTeamAbbr(home?.team?.abbreviation || '') === game.homeTeam
    && normalizeTeamAbbr(away?.team?.abbreviation || '') === game.awayTeam
    && Number(home?.score) === game.homeScore && Number(away?.score) === game.awayScore;
}
const text = (s: unknown, max: number) => typeof s === 'string' ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export async function archivedPostgameEvidence(game: ScheduledGame) {
  let eventId = game.espnId;
  if (!eventId || !/^\d+$/.test(eventId)) {
    const board = await espnJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${game.gameday.replaceAll('-', '')}&limit=100`);
    eventId = board.events?.find((e: any) => matches(e.competitions?.[0], game))?.id;
  }
  if (!eventId || !/^\d+$/.test(eventId)) throw new Error('No archived box score could be verified for this game. No paid research was started.');
  const apiUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
  const data = await espnJson(apiUrl);
  const competition = data.header?.competitions?.[0];
  if (!matches(competition, game) || !(competition.status?.type?.completed || data.header?.status?.type?.completed)) {
    throw new Error('Archived box score does not match the verified final result. No paid research was started.');
  }
  const articles = [data.article, ...(Array.isArray(data.news) ? data.news : data.news?.articles || [])].filter(a => a && typeof a === 'object');
  const boxscore = (data.boxscore?.teams || []).slice(0, 2).map((t: any) => ({
    team: normalizeTeamAbbr(t.team?.abbreviation || ''), statistics: (t.statistics || []).slice(0, 40).map((s: any) => ({ name: text(s.label || s.name, 80), value: text(s.displayValue, 100) }))
  }));
  if (!boxscore.some((t: any) => t.statistics.length)) throw new Error('The archived game has no usable box-score evidence. No paid research was started.');
  const players = (data.boxscore?.players || []).slice(0, 2).map((t: any) => ({ team: normalizeTeamAbbr(t.team?.abbreviation || ''),
    groups: (t.statistics || []).slice(0, 8).map((s: any) => ({ name: s.name, labels: s.labels, athletes: (s.athletes || []).slice(0, 5).map((a: any) => ({ name: a.athlete?.displayName, stats: a.stats })) })) }));
  const drives = (data.drives?.previous || []).slice(0, 35).map((d: any) => ({ team: d.team?.abbreviation,
    result: d.result, yards: d.yards, plays: d.offensivePlays, elapsed: d.timeElapsed?.displayValue,
    keyPlays: (d.plays || []).filter((p: any) => p.scoringPlay || p.statYardage < 0 || /intercept|fumble|fourth down/i.test(p.text || '')).slice(0, 3).map((p: any) => text(p.text, 350)) }));
  const sources = [{ url: `https://www.espn.com/nfl/boxscore/_/gameId/${eventId}`, title: 'ESPN archived box score' },
    { url: `https://www.espn.com/nfl/recap/_/gameId/${eventId}`, title: 'ESPN archived game recap' },
    { url: apiUrl, title: 'ESPN archived game summary data' }];
  const recaps = articles.slice(0, 2).map((a: any) => ({ headline: text(a.headline, 200), text: text(a.story || a.description, 8000) }));
  const context = JSON.stringify({ sources, boxscore, players, drives, recaps, weather: data.gameInfo?.weather, venue: data.gameInfo?.venue?.fullName });
  if (context.length > 45_000) throw new Error('Archived evidence exceeds the bounded research budget.');
  return { context, sources };
}
