import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {digest} from './research-cohorts.js';
export type EventKind='COHORT'|'SEARCH'|'INPUTS'|'MANIFEST'|'RESULT'|'SHADOW_FORECAST'|'PROMOTION'|'RUN';
export interface ResearchEvent {event_id:string;event_kind:EventKind;event_key:string;payload:any;recorded_at:string}
export interface ResearchState {durable:boolean;all():Promise<ResearchEvent[]>;append(kind:EventKind,key:string,payload:unknown):Promise<ResearchEvent>}
export class FileResearchState implements ResearchState {
  durable=false;
  constructor(private directory:string){mkdirSync(directory,{recursive:true});}
  async all(){return (await import('node:fs')).readdirSync(this.directory).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(resolve(this.directory,f),'utf8')) as ResearchEvent).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.event_id.localeCompare(b.event_id));}
  async append(kind:EventKind,key:string,payload:unknown){
    const event_id=digest({kind,key}),file=resolve(this.directory,`${event_id}.json`);
    if(existsSync(file))return JSON.parse(readFileSync(file,'utf8')) as ResearchEvent;
    const row={event_id,event_kind:kind,event_key:key,payload,recorded_at:new Date().toISOString()};
    try{writeFileSync(file,JSON.stringify(row,null,2),{flag:'wx'});}catch(e){if(!existsSync(file))throw e;return JSON.parse(readFileSync(file,'utf8')) as ResearchEvent;}
    return row;
  }
}
export class MemoryResearchState implements ResearchState {
  durable=false;events:ResearchEvent[]=[];
  async all(){return structuredClone(this.events);}
  async append(kind:EventKind,key:string,payload:unknown){
    const prior=this.events.find(e=>e.event_kind===kind&&e.event_key===key);if(prior)return structuredClone(prior);
    const e={event_id:digest({kind,key}),event_kind:kind,event_key:key,payload:structuredClone(payload),recorded_at:new Date().toISOString()};this.events.push(e);return structuredClone(e);
  }
}
