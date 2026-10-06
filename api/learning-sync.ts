import { timingSafeEqual } from 'node:crypto';
import { learningStorageConfigured, syncLearningOutcomes, verifiedSchedule } from '../server/learningStore.js';
export const config = { maxDuration: 60 };
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = process.env.CRON_SECRET ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`) : null;
  const actual = Buffer.from(typeof req.headers?.authorization === 'string' ? req.headers.authorization : '');
  if (!expected || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!learningStorageConfigured()) return res.status(503).json({ error: 'Learning storage is not configured.' });
  try { return res.status(200).json({ healthy: true, ...await syncLearningOutcomes(await verifiedSchedule()), paidModelCalls: 0 }); }
  catch { return res.status(503).json({ error: 'Outcome sync failed; retry later.' }); }
}
