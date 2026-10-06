import { learningStorageConfigured, storage, verifiedSchedule, syncLearningOutcomes } from '../server/learningStore';
export const config = { maxDuration: 60 };
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  if (!learningStorageConfigured()) return res.status(503).json({ healthy: false, storageConfigured: false, researchConfigured: Boolean(process.env.OPENROUTER_API_KEY) });
  try {
    await Promise.all(['nfl_learning_forecasts', 'nfl_learning_outcomes', 'nfl_postgame_reviews', 'nfl_postgame_claims'].map(t => storage(`${t}?select=game_id&limit=1`)));
    const synced = req.method === 'POST' ? await syncLearningOutcomes(await verifiedSchedule()) : undefined;
    return res.status(200).json({ healthy: true, storageConfigured: true, researchConfigured: Boolean(process.env.OPENROUTER_API_KEY), synced, modelWeightsChanged: false });
  } catch { return res.status(503).json({ healthy: false, storageConfigured: true, error: 'Learning tables or credentials are unavailable.' }); }
}
