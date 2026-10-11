import React, { useState } from 'react';
import { getResearchAccess, setResearchAccess } from '../services/researchAccess';
const ResearchAccessField: React.FC<{label?:string}> = ({label='DeepSeek research access key'}) => {
  const [value,setValue]=useState(getResearchAccess());
  return <label className="mt-3 block text-xs text-gray-300">{label}<input type="password" aria-label={label} autoComplete="off" value={value} onChange={event=>{setValue(event.target.value);setResearchAccess(event.target.value);}} placeholder="Owner access key" className="mt-1 block w-full max-w-sm rounded-lg border border-gray-600 bg-gray-950 px-3 py-2 text-white" /><span className="mt-1 block text-[10px] text-gray-500">Kept only while this page is open. Use your research access key, not a provider or database secret.</span></label>;
};
export default ResearchAccessField;
