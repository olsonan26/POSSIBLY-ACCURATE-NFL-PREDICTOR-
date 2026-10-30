import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/** Exclusive creation is deliberate: manifests are never rewritten after results exist. */
export function preregisterManifest(path:string,manifest:Record<string,unknown>) {
  for(const key of ['experiment_id','hypothesis_id','cluster_id','parent_model','created_at','feature_change','parameter_values','validation_range','success_conditions','failure_conditions'])
    if(manifest[key]==null) throw new Error(`Manifest missing ${key}.`);
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify(manifest,null,2),{flag:'wx'});
}
export function evaluateRegistered<T>(path:string,experimentId:string,evaluate:()=>T):T {
  const manifest=JSON.parse(readFileSync(path,'utf8'));
  if(manifest.experiment_id!==experimentId||!Number.isFinite(Date.parse(manifest.created_at))) throw new Error('Evaluation requires the matching preregistered manifest.');
  return evaluate();
}
