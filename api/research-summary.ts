import summary from '../research/reports/v2-summary.js';
import { authorizeResearch } from '../server/researchAccess.js';
export default async function handler(req:any,res:any) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed.'});
  if(!authorizeResearch(req,res)) return;
  return res.status(200).json(summary);
}
