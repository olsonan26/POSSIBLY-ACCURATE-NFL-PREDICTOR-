import type { ResearchFeature } from './researchSnapshot.js';
export const RESEARCH_ENCODING_VERSION='research-encoding-v2';
const categories:Record<string,string[]>={
  roof:['outdoor','outdoors','dome','open','closed','retractable','unknown'],
  surface:['grass','turf','a_turf','astroturf','fieldturf','sportturf','matrixturf','dessograss','astroplay'],
  sourceStatus:['live','partial','fallback'],evidenceMode:['ARCHIVED_REANALYSIS','FROZEN_FORECAST','INDOOR']
};
/** Fixed vocabulary: no labels, team/game IDs, timestamps or future-fitted category dictionaries. */
export function encodeResearchFeatures(features:Record<string,ResearchFeature>):Record<string,number|null> {
  const result:Record<string,number|null>={};
  for(const [key,f] of Object.entries(features)) {
    const known=f.status==='known'&&f.value!==null;
    if(typeof f.value==='number') result[key]=known&&Number.isFinite(f.value)?f.value:null;
    else if(typeof f.value==='boolean') result[key]=known?Number(f.value):null;
    else {
      result[key]=null;
      const suffix=key.split('.').pop()!;
      const vocabulary=categories[suffix]||(suffix.endsWith('SourceStatus')?categories.sourceStatus:undefined);
      if(vocabulary) for(const category of vocabulary) result[`${key}=${category}`]=known&&vocabulary.includes(String(f.value))?Number(f.value===category):null;
    }
  }
  return result;
}
