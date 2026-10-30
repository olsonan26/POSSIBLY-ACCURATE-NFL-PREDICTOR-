import { timingSafeEqual } from 'node:crypto';
import { learningStorageConfigured, syncLearningOutcomes, verifiedSchedule } from '../server/learningStore.js';
import { runLiveResearch } from '../server/researchStore.js';
import {DatabaseResearchState} from '../server/researchStore.js';
import {runForwardCaptures,resumeBackfillJobs,syncResearchPredictionOutcomes} from '../server/forwardResearch.js';
export const config = { maxDuration: 300 };
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = process.env.CRON_SECRET ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`) : null;
  const actual = Buffer.from(typeof req.headers?.authorization === 'string' ? req.headers.authorization : '');
  if (!expected || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!learningStorageConfigured()) return res.status(503).json({ error: 'Learning storage is not configured.' });
  try {
    const games=await verifiedSchedule(),state=new DatabaseResearchState();
    const grading={...await syncLearningOutcomes(games),predictions:await syncResearchPredictionOutcomes(games)};
    const capture=await runForwardCaptures(games,state,{limit:1});
    const backfill=await resumeBackfillJobs(games,state);
    const paidModelCalls=capture.paidCoachAttempts?null:0;
    const healthy=!capture.results.some(r=>r.status==='FAILED_RETRYABLE');
    try { return res.status(healthy?200:503).json({healthy,...grading,capture,backfill,research:await runLiveResearch(),paidModelCalls,paidCoachCaptureReportedSeparately:true}); }
    catch { return res.status(503).json({healthy:false,...grading,capture,backfill,research:{status:'RETRY_REQUIRED'},paidModelCalls,paidCoachCaptureReportedSeparately:true}); }
  }
  catch { return res.status(503).json({ error: 'Outcome sync failed; retry later.' }); }
}
