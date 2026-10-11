import { TEAM_BY_ABBR, normalizeTeamAbbr } from '../data/teamRegistry.js';
import { validDate } from '../services/chineseZodiacService.js';
import { researchZodiacGame } from '../server/zodiacResearch.js';
import { readFileSync } from 'node:fs';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.query?.view === 'evaluation') {
    const report = JSON.parse(readFileSync(new URL('../zodiac/evaluation/retrospective-2020-2025.json', import.meta.url), 'utf8'));
    return res.status(200).json(report);
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 4000) return res.status(413).json({ error: 'Request too large.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['home','away','date'].includes(key))) return res.status(400).json({ error: 'Expected home, away and date only.' });
    const home = typeof body.home === 'string' ? normalizeTeamAbbr(body.home) : '';
    const away = typeof body.away === 'string' ? normalizeTeamAbbr(body.away) : '';
    if (!TEAM_BY_ABBR.has(home) || !TEAM_BY_ABBR.has(away) || home === away || !validDate(body.date) || Number(body.date.slice(0,4)) < 1999 || Number(body.date.slice(0,4)) > 2100) return res.status(400).json({ error: 'Select two different NFL teams and a valid scheduled date from 1999–2100.' });
    return res.status(200).json(await researchZodiacGame(home, away, body.date));
  } catch (e) {
    if (e instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON request.' });
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Zodiac research source unavailable.' });
  }
}
