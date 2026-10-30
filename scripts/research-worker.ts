import {verifiedSchedule,syncLearningOutcomes} from '../server/learningStore.js';
import {DatabaseResearchState,runLiveResearch} from '../server/researchStore.js';
import {runForwardCaptures,resumeBackfillJobs,syncResearchPredictionOutcomes} from '../server/forwardResearch.js';
const state=new DatabaseResearchState(),games=await verifiedSchedule();
const capture=await runForwardCaptures(games,state,{limit:20});
const backfill=await resumeBackfillJobs(games,state);
const day=new Date().toISOString().slice(0,10),events=await state.all();
let maintenance:any={status:'ALREADY_COMPLETED_TODAY'};
if(!events.some(e=>e.event_kind==='RUN'&&e.event_key===`DATA_MAINTENANCE:${day}`)){
 maintenance={recordType:'DATA_MAINTENANCE',outcomes:await syncResearchPredictionOutcomes(games),learning:await syncLearningOutcomes(games),research:await runLiveResearch()};
 await state.append('RUN',`DATA_MAINTENANCE:${day}`,maintenance);
}
console.log(JSON.stringify({capture,backfill,maintenance},null,2));
if(capture.results.some(r=>r.status==='FAILED_RETRYABLE'))process.exitCode=1;
