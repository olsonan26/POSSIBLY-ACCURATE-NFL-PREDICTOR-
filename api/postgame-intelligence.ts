import { learningStorageConfigured, verifiedSchedule } from '../server/learningStore.js';
import { completedSeason, POSTGAME_VERSION } from '../services/postgameLearning.js';
import { findReview, researchModel, reviewCompletedGame, ReviewBusyError, seasonReviews } from '../server/postgameResearch.js';

export const config = { maxDuration: 150 };
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!learningStorageConfigured()) return res.status(503).json({ error: 'Learning storage is not configured. No paid research was started.' });
  try {
    const games = await verifiedSchedule();
    const input = req.method === 'GET' ? req.query : req.body;
    const gameId = typeof input?.gameId === 'string' ? input.gameId : '';
    if (gameId) {
      const game = games.find(g => g.gameId === gameId);
      if (!game || !completedSeason([game], game.season, true).length) return res.status(400).json({ error: 'This exact completed game was not found in the verified NFL results.' });
      if (req.method === 'GET') return res.status(200).json({ game, review: await findReview(gameId, researchModel()) });
      const result = await reviewCompletedGame(game);
      return res.status(200).json({ ...result, mode: 'postgame-review', version: POSTGAME_VERSION, modelWeightsChanged: false });
    }
    if (req.method !== 'GET') return res.status(400).json({ error: 'gameId is required. Each request reviews at most one game.' });
    const season = Number(input?.season);
    if (!Number.isInteger(season) || season < 1999 || season > new Date().getUTCFullYear()) return res.status(400).json({ error: 'Choose a valid NFL season.' });
    const selected = completedSeason(games, season, input?.includePostseason === '1');
    const reviews = await seasonReviews(season, researchModel());
    const saved = new Set(reviews.map(r => r.game_id));
    return res.status(200).json({ season, model: researchModel(), total: selected.length,
      completed: selected.filter(g => saved.has(g.gameId)).length,
      games: selected.map(g => ({ gameId: g.gameId, homeTeam: g.homeTeam, awayTeam: g.awayTeam, gameday: g.gameday, cached: saved.has(g.gameId) })) });
  } catch (error) {
    const busy = error instanceof ReviewBusyError;
    return res.status(busy ? 409 : 502).json({ error: busy ? error.message : error instanceof Error ? error.message : 'Postgame research failed.' });
  }
}
