import {authorizeResearch} from '../server/researchAccess.js';
import {verifiedSchedule} from '../server/learningStore.js';
import {DatabaseResearchState,runLiveResearch} from '../server/researchStore.js';
import {startBackfill,advanceBackfill,backfillOptions,coverageReport,historicalSnapshots} from '../server/historicalResearch.js';
export const config={maxDuration:300};
export default async function handler(req:any,res:any){
 res.setHeader('Cache-Control','no-store');if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!authorizeResearch(req,res))return;
 try{
  const state=new DatabaseResearchState(true);
  if(req.method==='GET')return res.status(200).json({coverage:coverageReport(historicalSnapshots(await state.all()))});
  const body=req.body||{};
  if(body.action==='research')return res.status(200).json(await runLiveResearch());
  const games=await verifiedSchedule();
  if(body.action==='start'||body.action==='dry-run')return res.status(200).json(await startBackfill(state,games,backfillOptions(body),body.action==='dry-run'));
  if(body.action==='advance'&&typeof body.jobId==='string')return res.status(200).json(await advanceBackfill(state,games,body.jobId,8,undefined,Date.now()+220000));
  return res.status(400).json({error:'Choose start, dry-run, advance or research'});
 }catch(error){return res.status(503).json({error:error instanceof Error&&/Choose a valid|not found/.test(error.message)?error.message:'Research storage or source data unavailable; no success was assumed.'});}
}
