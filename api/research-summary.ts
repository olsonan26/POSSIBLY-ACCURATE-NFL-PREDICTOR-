import summary from '../research/reports/v2-summary.js';
import { authorizeResearch } from '../server/researchAccess.js';
import { liveResearchSummary } from '../server/researchSummary.js';
export const config={maxDuration:300};
export default async function handler(req:any,res:any) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed.'});
  if(!authorizeResearch(req,res)) return;
  try { return res.status(200).json(await liveResearchSummary()); }
  catch { return res.status(200).json({...summary,source:'ARCHIVED_REPORT',liveUnavailable:true,liveStatus:'Live research storage could not be read; showing the dated archived report.'}); }
}
